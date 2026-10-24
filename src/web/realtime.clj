(ns web.realtime
  "Realtime push to connected clients over WebSocket (GET /api/ws).

   - Connection registry per username (several tabs/devices per user).
   - `publish!` pushes an event map (JSON-encoded) to every open connection.
   - Client->server events are dispatched through the `handle-client-event`
     multimethod (keyed on the event's \"type\"); other namespaces (web.dm,
     web.live) add methods, so this namespace has no dependency on them.
   - Presence (online / last active) with an optional privacy hook
     `web.accounts/activity-status-hidden?` resolved at runtime.
   - Heartbeat: the server pings every socket every 25s; clients also send an
     application-level {\"type\":\"ping\"} which is answered with \"pong\".

   OWNER: realtime agent."
  (:require [cheshire.core :as json]
            [clojure.string :as str]
            [datomic.api :as d]
            [ring.websocket :as ws]
            [project.system :as s]
            [web.http :refer [ok bad unauth me ddb user-e author-dto instant->str]])
  (:import (java.util Date UUID)
           (java.util.concurrent Executors ScheduledExecutorService ThreadFactory TimeUnit)))

(defn- log [& args]
  (binding [*out* *err*]
    (apply println "[realtime]" args)))

;; ===== SINKS =====

(defprotocol Sink
  "Something we can push text frames to. Real WebSockets are wrapped by
   `socket-sink`; tests use in-memory fakes."
  (-send! [this text])
  (-ping! [this])
  (-close! [this]))

(defn socket-sink
  "Wraps a ring.websocket Socket. Sends are serialised per socket because
   Jetty does not allow concurrent blocking writes on one session."
  [socket]
  (let [lock (Object.)]
    (reify Sink
      (-send! [_ text] (locking lock (ws/send socket text)))
      (-ping! [_] (locking lock (ws/ping socket)))
      (-close! [_] (try (ws/close socket) (catch Throwable _ nil))))))

;; ===== REGISTRY =====

;; {username {conn-id sink}}
(defonce registry (atom {}))

(defonce ^:private offline-hooks (atom {}))

(defn add-offline-hook!
  "Registers (f username) called when a user's last connection closes."
  [k f]
  (swap! offline-hooks assoc k f))

(defn connections [username] (vals (get @registry username)))

(defn connection-count [username] (count (get @registry username)))

(defn online? [username] (pos? (connection-count username)))

(defn online-usernames [] (set (keys @registry)))

(declare broadcast-presence! ensure-heartbeat!)

(defn register!
  "Adds a connection. Returns conn-id."
  ([username sink] (register! username (str (UUID/randomUUID)) sink))
  ([username conn-id sink]
   (let [[old _] (swap-vals! registry assoc-in [username conn-id] sink)]
     (when (empty? (get old username))
       (broadcast-presence! username true)))
   conn-id))

(defn- persist-last-active! [username]
  (try
    (when-let [conn s/conn]
      (when-let [e (user-e (d/db conn) username)]
        @(d/transact conn [[:db/add e :user/last-active-at (Date.)]])))
    (catch Throwable t (log "last-active update failed:" (.getMessage t)))))

(defn unregister!
  "Removes a connection; when it was the user's last one the user goes
   offline (last-active persisted, presence broadcast, offline hooks run)."
  [username conn-id]
  (let [[old new] (swap-vals! registry
                              (fn [r]
                                (let [m (dissoc (get r username) conn-id)]
                                  (if (empty? m) (dissoc r username) (assoc r username m)))))]
    (when (and (contains? (get old username) conn-id)
               (not (contains? new username)))
      (persist-last-active! username)
      (broadcast-presence! username false)
      (doseq [[k f] @offline-hooks]
        (try (f username) (catch Throwable t (log "offline hook" k "failed:" (.getMessage t))))))
    nil))

(defn- send-to-sink! [username conn-id sink text]
  (try (-send! sink text) true
       (catch Throwable t
         (log "send failed for" username "-" (.getMessage t))
         (unregister! username conn-id)
         false)))

(defn publish!
  "Push `event` (a map with at least :type) to every open connection of the
   user identified by `username`. Safe to call when the user is offline.
   Returns the number of connections the event was delivered to."
  [username event]
  (if-let [conns (and username (seq (get @registry username)))]
    (let [text (json/generate-string event)]
      (count (filter (fn [[cid sink]] (send-to-sink! username cid sink text)) conns)))
    0))

(defn publish-all!
  "publish! to each username in `usernames` (duplicates/nil ignored)."
  [usernames event]
  (doseq [u (distinct (remove nil? usernames))]
    (publish! u event)))

(defn send-to-conn!
  "Push an event to a single connection."
  [username conn-id event]
  (when-let [sink (get-in @registry [username conn-id])]
    (send-to-sink! username conn-id sink (json/generate-string event))))

;; ===== PRESENCE =====

(defn- resolve-optional
  "Resolves a var that another agent may add later; nil when absent."
  [sym]
  (try (requiring-resolve sym) (catch Throwable _ nil)))

(defn activity-hidden?
  "True when `user-e` chose to hide their activity status. Delegates to
   `(web.accounts/activity-status-visible? db user-e)` (or the older name
   `activity-status-hidden?`) when the accounts area provides it."
  [db user-e]
  (if-let [visible? (resolve-optional 'web.accounts/activity-status-visible?)]
    (try (not (visible? db user-e)) (catch Throwable _ false))
    (if-let [hidden? (resolve-optional 'web.accounts/activity-status-hidden?)]
      (try (boolean (hidden? db user-e)) (catch Throwable _ false))
      false)))

(defn presence
  "{:online bool :lastActive iso-string-or-nil} for user entity `u`, or nil
   when the user hides their activity status."
  [db u]
  (when-let [un (:user/username u)]
    (when-not (activity-hidden? db (:db/id u))
      (let [on (online? un)]
        {:online     on
         :lastActive (if on (instant->str (Date.)) (instant->str (:user/last-active-at u)))}))))

(defn with-presence
  "Adds :online/:lastActive to an author-dto-like map for user entity `u`."
  [db dto u]
  (if-let [p (and dto (presence db u))] (merge dto p) dto))

(defn- contacts
  "Usernames that share a DM conversation with `username`."
  [db username]
  (when-let [e (user-e db username)]
    (d/q '[:find [?un ...] :in $ ?me
           :where [?c :conversation/participants ?me]
           [?c :conversation/participants ?o]
           [(!= ?o ?me)]
           [?o :user/username ?un]]
         db e)))

(defn- broadcast-presence! [username online]
  (try
    (when-let [conn s/conn]
      (let [db (d/db conn)
            u  (d/entity db [:user/username username])]
        (when (and (:db/id u) (not (activity-hidden? db (:db/id u))))
          (let [targets (filter online? (contacts db username))]
            (when (seq targets)
              (publish-all! targets {:type       "presence"
                                     :username   username
                                     :online     online
                                     :lastActive (instant->str (Date.))}))))))
    (catch Throwable t (log "presence broadcast failed:" (.getMessage t)))))

(defn- handle-presence [req]
  (if (me req)
    (let [db  (ddb)
          uns (->> (str/split (str (get-in req [:query-params "users"])) #",")
                   (map str/trim) (remove empty?) (take 100))]
      (ok (into {} (keep (fn [un]
                           (let [u (d/entity db [:user/username un])]
                             (when (:db/id u) [un (presence db u)]))))
                uns)))
    (unauth)))

;; ===== CLIENT EVENTS =====

(defmulti handle-client-event
  "ctx = {:username :conn-id}; event = parsed JSON map with keyword keys."
  (fn [_ctx event] (:type event)))

(defmethod handle-client-event :default [_ _] nil)

(defmethod handle-client-event "ping" [{:keys [username conn-id]} _]
  (send-to-conn! username conn-id {:type "pong" :t (System/currentTimeMillis)}))

(defn dispatch-text!
  "Parses a text frame and dispatches it. Errors are logged, never thrown."
  [ctx text]
  (try
    (let [event (json/parse-string (str text) true)]
      (when (map? event)
        (handle-client-event ctx event)))
    (catch Throwable t
      (log "bad client event from" (:username ctx) "-" (.getMessage t)))))

;; ===== HEARTBEAT =====

(def heartbeat-seconds 25)

(defn- daemon-factory []
  (reify ThreadFactory
    (newThread [_ r] (doto (Thread. ^Runnable r "realtime-heartbeat") (.setDaemon true)))))

(defn ping-all! []
  (doseq [[un conns] @registry
          [cid sink] conns]
    (try (-ping! sink)
         (catch Throwable _ (unregister! un cid)))))

(defonce ^:private heartbeat
  (delay
    (doto ^ScheduledExecutorService (Executors/newSingleThreadScheduledExecutor (daemon-factory))
      (.scheduleAtFixedRate ^Runnable (fn [] (try (ping-all!) (catch Throwable _ nil)))
                            heartbeat-seconds heartbeat-seconds TimeUnit/SECONDS))))

(defn- ensure-heartbeat! [] @heartbeat)

;; ===== WEBSOCKET ENDPOINT =====

(defn ws-listener
  "Ring websocket listener for `username`. Exposed for tests."
  [username]
  (let [conn-id (str (UUID/randomUUID))
        ctx     {:username username :conn-id conn-id}]
    {:on-open    (fn [socket]
                   (ensure-heartbeat!)
                   (register! username conn-id (socket-sink socket))
                   (send-to-conn! username conn-id {:type "hello" :username username :connId conn-id
                                                    :heartbeatSeconds heartbeat-seconds}))
     :on-message (fn [_socket msg]
                   (when (instance? CharSequence msg)
                     (dispatch-text! ctx msg)))
     :on-close   (fn [_socket _code _reason] (unregister! username conn-id))
     :on-error   (fn [_socket _t] (unregister! username conn-id))
     :on-pong    (fn [_socket _data] nil)}))

(defn handle-ws [req]
  (let [username (me req)]
    (cond
      (not username) (unauth)
      (not (user-e (ddb) username)) (unauth)
      (not (ws/upgrade-request? req)) (bad "Expected a WebSocket upgrade request")
      :else {:ring.websocket/listener (ws-listener username)})))

;; ===== FAN-OUT HELPERS =====

(defn notify-followers-new-post!
  "Pushes {:type \"post:new\"} to every online follower of `author-e`.
   Runs asynchronously; returns a future. Call after a post is created."
  [author-e post-id]
  (future
    (try
      (let [db       (ddb)
            author   (d/entity db author-e)
            hidden   (resolve-optional 'web.accounts/hidden-author-ids)
            followers (d/q '[:find [?un ...] :in $ ?a
                             :where [?f :user/follows ?a] [?f :user/username ?un]]
                           db author-e)
            event    {:type "post:new" :postId (str post-id) :author (author-dto author)}]
        (doseq [un followers
                :when (online? un)
                :let [fe (user-e db un)]
                :when (not (and hidden (contains? (set (hidden db fe)) author-e)))]
          (publish! un event)))
      (catch Throwable t (log "post fan-out failed:" (.getMessage t))))))

(def routes
  [["/api/ws"       {:get handle-ws}]
   ["/api/presence" {:get handle-presence}]])
