(ns web.live
  "Instagram-style Live (MVP).

   Video transport: WebRTC *mesh*. The server only does signaling over the
   WebSocket: it relays offer/answer/ICE between the broadcaster and each
   viewer, and the broadcaster's browser keeps one RTCPeerConnection per
   viewer. That is fine for small audiences (upload bandwidth grows linearly
   with viewers, so `max-mesh-viewers` caps it).

   PRODUCTION SEAM: for real audiences use an SFU (e.g. LiveKit, mediasoup,
   Janus). The seam is:
     - `transport` (env LIVE_TRANSPORT, default \"mesh\") is returned by
       GET /api/live/ice-servers so the frontend picks a transport class
       (frontend `pages/live/live-transport.ts`, interface LiveTransport).
     - With an SFU, add `POST /api/live/:id/token` here that mints an SFU
       access token (publisher for the host, subscriber for viewers) and
       stop relaying `live:signal`; comments, hearts, viewer counts and
       start/end/notifications stay exactly as they are.

   Room state (viewers, hearts, recent comments) is in memory; the live
   entity (host/status/times/totals) is in Datomic. After a restart all
   active lives are ended by `end-stale-lives!` (called from web.server/-main).

   WebSocket events, client -> server:
     live:join {liveId}  live:leave {liveId}  live:comment {liveId text}
     live:heart {liveId}  live:signal {liveId to data}
   server -> client:
     live:joined {liveId live comments}         (to the joining viewer)
     live:viewer-joined / live:viewer-left {liveId viewer viewerCount} (to host)
     live:viewers {liveId viewerCount}           (to everyone in the room)
     live:comment {liveId comment}  live:heart {liveId from hearts}
     live:signal {liveId from data}  live:ended {liveId}  live:started {live}
     live:error {liveId error}

   OWNER: realtime agent."
  (:require [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s]
            [web.http :refer [parse-body me ok created bad unauth forbidden not-found
                              parse-id instant->str ddb user-e author-dto]]
            [web.accounts :as accounts]
            [web.notifications :as notifications]
            [web.realtime :as rt])
  (:import (java.util Date UUID)))

(def max-mesh-viewers 25)
(def host-reconnect-grace-ms 20000)
(def transport (or (System/getenv "LIVE_TRANSPORT") "mesh"))

;; {live-id {:host username :viewers #{username} :hearts n :peak n :comments [..]}}
(defonce rooms (atom {}))

(defn- room [live-id] (get @rooms live-id))

(defn- room-members [live-id]
  (when-let [r (room live-id)] (conj (:viewers r) (:host r))))

(defn viewer-count [live-id] (count (:viewers (room live-id))))

(defn live-dto [db eid]
  (let [e (d/entity db eid)
        r (room eid)]
    (when (:live/host e)
      {:id          (str eid)
       :host        (author-dto (:live/host e))
       :title       (:live/title e)
       :status      (name (or (:live/status e) :ended))
       :startedAt   (instant->str (:live/started-at e))
       :endedAt     (instant->str (:live/ended-at e))
       :viewerCount (if r (count (:viewers r)) 0)
       :hearts      (if r (:hearts r) (or (:live/hearts e) 0))})))

(defn active? [db live-e] (= :active (:live/status (d/entity db live-e))))

(defn active-lives-of [db host-e]
  (d/q '[:find [?l ...] :in $ ?h :where [?l :live/host ?h] [?l :live/status :active]] db host-e))

(defn can-watch? [db viewer-e live-e]
  (let [host-e (some-> (d/entity db live-e) :live/host :db/id)]
    (boolean (and host-e
                  (or (= host-e viewer-e)
                      (and (accounts/can-view-posts? db viewer-e host-e)
                           (not (contains? (set (accounts/hidden-author-ids db viewer-e)) host-e))))))))

(defn- broadcast! [live-id event]
  (rt/publish-all! (room-members live-id) event))

(defn- broadcast-viewers! [live-id]
  (broadcast! live-id {:type "live:viewers" :liveId (str live-id) :viewerCount (viewer-count live-id)}))

;; ===== LIFECYCLE =====

(declare end-live!)

(defn start-live!
  "Starts a live for host-e (ending any previous active one). Notifies
   followers. Returns the new live eid."
  [host-e title]
  (let [db  (ddb)
        _   (doseq [old (active-lives-of db host-e)] (end-live! old))
        tid (d/tempid :db.part/user)
        res @(d/transact s/conn [(cond-> {:db/id tid
                                          :live/host host-e
                                          :live/status :active
                                          :live/started-at (Date.)}
                                   (not (str/blank? title)) (assoc :live/title (str/trim (str title))))])
        db2 (:db-after res)
        lid (d/resolve-tempid db2 (:tempids res) tid)
        host (d/entity db2 host-e)
        un  (:user/username host)]
    (swap! rooms assoc lid {:host un :viewers #{} :hearts 0 :peak 0 :comments []})
    (let [followers (d/q '[:find [?f ...] :in $ ?h :where [?f :user/follows ?h]] db2 host-e)
          dto       (live-dto db2 lid)]
      (doseq [f followers]
        (try
          (notifications/create-notif! f :live (str un " started a live video")
                                       {:actor-e host-e :live-e lid})
          (rt/publish! (:user/username (d/entity db2 f)) {:type "live:started" :live dto})
          (catch Throwable _ nil))))
    lid))

(defn end-live!
  "Marks the live ended, tells everyone in the room and drops room state."
  [live-e]
  (let [db (ddb)
        e  (d/entity db live-e)]
    (when (= :active (:live/status e))
      (let [r (room live-e)]
        @(d/transact s/conn [{:db/id live-e
                              :live/status :ended
                              :live/ended-at (Date.)
                              :live/hearts (long (or (:hearts r) 0))
                              :live/peak-viewers (long (or (:peak r) 0))}])
        (broadcast! live-e {:type "live:ended" :liveId (str live-e)})
        (swap! rooms dissoc live-e)
        true))))

(defn end-stale-lives!
  "Ends every :active live. Call at boot: room state is in memory, so any
   live that is still active in the DB lost its broadcaster."
  []
  (when s/conn
    (let [db (d/db s/conn)
          ids (d/q '[:find [?l ...] :where [?l :live/status :active]] db)]
      (when (seq ids)
        @(d/transact s/conn (vec (mapcat (fn [l] [[:db/add l :live/status :ended]
                                                  [:db/add l :live/ended-at (Date.)]])
                                         ids))))
      (count ids))))

(defn- ensure-room!
  "Room for an active live (recreated lazily if it is missing)."
  [db live-e]
  (or (room live-e)
      (when (active? db live-e)
        (let [un (some-> (d/entity db live-e) :live/host :user/username)]
          (get (swap! rooms assoc live-e {:host un :viewers #{} :hearts 0 :peak 0 :comments []}) live-e)))))

(defn join!
  "Adds `username` as a viewer. Returns :ok, :not-found, :forbidden or :full."
  [live-e username]
  (let [db  (ddb)
        u-e (user-e db username)]
    (cond
      (not (and u-e (ensure-room! db live-e))) :not-found
      (not (can-watch? db u-e live-e)) :forbidden
      (= username (:host (room live-e))) :ok
      (and (not (contains? (:viewers (room live-e)) username))
           (>= (viewer-count live-e) max-mesh-viewers)) :full
      :else
      (do (swap! rooms update live-e
                 (fn [r] (let [r (update r :viewers conj username)]
                           (assoc r :peak (max (:peak r) (count (:viewers r)))))))
          (let [r (room live-e)]
            (rt/publish! username {:type     "live:joined"
                                   :liveId   (str live-e)
                                   :live     (live-dto db live-e)
                                   :comments (:comments r)})
            (rt/publish! (:host r) {:type        "live:viewer-joined"
                                    :liveId      (str live-e)
                                    :viewer      (author-dto (d/entity db u-e))
                                    :viewerCount (count (:viewers r))}))
          (broadcast-viewers! live-e)
          :ok))))

(defn leave! [live-e username]
  (when-let [r (room live-e)]
    (when (contains? (:viewers r) username)
      (swap! rooms update-in [live-e :viewers] disj username)
      (rt/publish! (:host r) {:type        "live:viewer-left"
                              :liveId      (str live-e)
                              :viewer      {:username username}
                              :viewerCount (viewer-count live-e)})
      (broadcast-viewers! live-e))))

(defn enforce-access!
  "Re-checks can-watch? for every room `username` hosts or watches and
   removes viewers that may no longer watch (called after a block). leave!
   tells the host, whose browser then drops that viewer's peer connection."
  [username]
  (let [db (ddb)]
    (doseq [[lid r] @rooms
            v (:viewers r)
            :when (or (= username (:host r)) (= username v))
            :when (not (can-watch? db (user-e db v) lid))]
      (leave! lid v))))

(defn- member? [live-e username]
  (contains? (set (room-members live-e)) username))

(defn comment! [live-e username text]
  (let [text (str/trim (str text))]
    (when (and (member? live-e username) (seq text))
      (let [c {:id        (str (UUID/randomUUID))
               :user      (author-dto (d/entity (ddb) [:user/username username]))
               :text      (subs text 0 (min 300 (count text)))
               :createdAt (instant->str (Date.))}]
        (swap! rooms update-in [live-e :comments] (fn [cs] (vec (take-last 50 (conj (or cs []) c)))))
        (broadcast! live-e {:type "live:comment" :liveId (str live-e) :comment c})
        c))))

(defn heart! [live-e username]
  (when (member? live-e username)
    (let [n (get-in (swap! rooms update-in [live-e :hearts] (fnil inc 0)) [live-e :hearts])]
      (broadcast! live-e {:type "live:heart" :liveId (str live-e) :from username :hearts n})
      n)))

(defn signal!
  "Relays WebRTC signaling between the host and one viewer."
  [live-e from to data]
  (when-let [r (room live-e)]
    (let [host (:host r) viewers (:viewers r)]
      (when (or (and (= from host) (contains? viewers to))
                (and (= to host) (contains? viewers from)))
        (rt/publish! to {:type "live:signal" :liveId (str live-e) :from from :data data})
        true))))

;; viewers that go offline leave; a host that stays offline past the grace
;; period ends the live.
(rt/add-offline-hook!
 ::live
 (fn [username]
   (doseq [[lid r] @rooms]
     (when (contains? (:viewers r) username) (leave! lid username))
     (when (= username (:host r))
       (future
         (Thread/sleep host-reconnect-grace-ms)
         (when-not (rt/online? username)
           (try (end-live! lid) (catch Throwable _ nil))))))))

;; ===== WEBSOCKET EVENTS =====

(defn- ws-live-id [event] (parse-id (:liveId event)))

(defmethod rt/handle-client-event "live:join" [{:keys [username]} event]
  (when-let [lid (ws-live-id event)]
    (let [r (join! lid username)]
      (when (not= r :ok)
        (rt/publish! username {:type "live:error" :liveId (str lid)
                               :error (case r :full "This live is full" :forbidden "You can't watch this live"
                                            "This live has ended")})))))

(defmethod rt/handle-client-event "live:leave" [{:keys [username]} event]
  (when-let [lid (ws-live-id event)] (leave! lid username)))

(defmethod rt/handle-client-event "live:comment" [{:keys [username]} event]
  (when-let [lid (ws-live-id event)] (comment! lid username (:text event))))

(defmethod rt/handle-client-event "live:heart" [{:keys [username]} event]
  (when-let [lid (ws-live-id event)] (heart! lid username)))

(defmethod rt/handle-client-event "live:signal" [{:keys [username]} event]
  (when-let [lid (ws-live-id event)] (signal! lid username (str (:to event)) (:data event))))

;; ===== HTTP =====

(defn ice-servers []
  (let [turn (System/getenv "TURN_URL")]
    (cond-> [{:urls ["stun:stun.l.google.com:19302" "stun:stun1.l.google.com:19302"]}]
      (seq turn) (conj {:urls       (vec (map str/trim (str/split turn #",")))
                        :username   (System/getenv "TURN_USERNAME")
                        :credential (System/getenv "TURN_CREDENTIAL")}))))

(defn handle-ice-servers [req]
  (if (me req)
    (ok {:iceServers (ice-servers) :transport transport :maxViewers max-mesh-viewers})
    (unauth)))

(defn handle-start [req]
  (if-let [username (me req)]
    (let [{:keys [title]} (parse-body req)
          db (ddb)]
      (let [lid (start-live! (user-e db username) title)]
        (created (live-dto (ddb) lid))))
    (unauth)))

(defn handle-end [req]
  (if-let [username (me req)]
    (let [lid (parse-id (get-in req [:path-params :id]))
          db  (ddb)
          e   (when lid (d/entity db lid))]
      (cond
        (not (:live/host e)) (not-found)
        (not= username (-> e :live/host :user/username)) (forbidden)
        :else (do (end-live! lid) (ok (live-dto (ddb) lid)))))
    (unauth)))

(defn handle-list
  "Active lives of people I follow + my own, mine first."
  [req]
  (if-let [username (me req)]
    (let [db   (ddb)
          me-e (user-e db username)
          hosts (conj (set (map :db/id (:user/follows (d/entity db me-e)))) me-e)
          lids (d/q '[:find [?l ...] :where [?l :live/status :active]] db)]
      (ok (->> lids
               (filter #(contains? hosts (some-> (d/entity db %) :live/host :db/id)))
               (filter #(can-watch? db me-e %))
               (sort-by (fn [l] [(if (= me-e (-> (d/entity db l) :live/host :db/id)) 0 1) (- l)]))
               (mapv #(live-dto db %)))))
    (unauth)))

(defn handle-get [req]
  (if-let [username (me req)]
    (let [lid (parse-id (get-in req [:path-params :id]))
          db  (ddb)]
      (cond
        (not (and lid (:live/host (d/entity db lid)))) (not-found)
        (not (can-watch? db (user-e db username) lid)) (forbidden)
        :else (ok (assoc (live-dto db lid) :comments (or (:comments (room lid)) [])))))
    (unauth)))

(def routes
  [["/api/live"             {:get handle-list :post handle-start}]
   ["/api/live/ice-servers" {:get handle-ice-servers}]
   ["/api/live/:id"         {:get handle-get}]
   ["/api/live/:id/end"     {:post handle-end}]])
