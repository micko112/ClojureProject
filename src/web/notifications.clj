(ns web.notifications
  "Notification creation, DTO, live push and the /api/notifications endpoints.
   OWNER: realtime agent."
  (:require [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s]
            [web.http :refer [ok unauth not-found forbidden me ddb user-e parse-id
                              instant->str author-dto]]
            [web.realtime :as rt])
  (:import (java.util Date)))

(defn notif-dto [db eid]
  (let [e     (d/entity db eid)
        actor (:notification/actor e)
        post  (:notification/post e)
        live  (:notification/live e)]
    (cond-> {:id        (str eid)
             :type      (name (or (:notification/type e) :info))
             :message   (:notification/message e)
             :read      (boolean (:notification/read e))
             :createdAt (instant->str (:notification/created-at e))}
      actor (assoc :actor (author-dto actor))
      post  (assoc :postId (str (:db/id post)))
      live  (assoc :liveId (str (:db/id live))))))

(defn- resolve-optional [sym]
  (try (requiring-resolve sym) (catch Throwable _ nil)))

(defn notification-enabled?
  "Delegates to `(web.accounts/notification-enabled? db recipient-e type)`
   when the accounts area provides it; otherwise everything is enabled."
  [db recipient-e type]
  (if-let [f (resolve-optional 'web.accounts/notification-enabled?)]
    (try (boolean (f db recipient-e type)) (catch Throwable _ true))
    true))

(defn- hidden-actor?
  "Recipient blocked/muted the actor (or vice versa)."
  [db recipient-e actor-e]
  (when actor-e
    (when-let [f (resolve-optional 'web.accounts/hidden-author-ids)]
      (try (contains? (set (f db recipient-e)) actor-e) (catch Throwable _ false)))))

(defn unread-count [db recipient-e]
  (or (d/q '[:find (count ?n) . :in $ ?u
             :where [?n :notification/recipient ?u] [?n :notification/read false]]
           db recipient-e)
      0))

(defn create-notif!
  "opts: {:actor-e eid, :post-e eid, :live-e eid} — all optional.
   Skips self-notifications, notifications from hidden (blocked/muted) actors
   and types the recipient disabled. After transacting, pushes
   {:type \"notification\" :notification dto :unreadCount n} to the recipient.
   Returns the transaction result, or nil when skipped."
  ([recipient-e type msg] (create-notif! recipient-e type msg {}))
  ([recipient-e type msg {:keys [actor-e post-e live-e]}]
   (let [db (d/db s/conn)]
     (when (and recipient-e
                (not (and actor-e (= actor-e recipient-e)))
                (notification-enabled? db recipient-e type)
                (not (hidden-actor? db recipient-e actor-e)))
       (let [tid (d/tempid :db.part/user)
             res @(d/transact s/conn [(cond-> {:db/id tid
                                               :notification/recipient recipient-e
                                               :notification/type type
                                               :notification/message msg
                                               :notification/read false
                                               :notification/created-at (Date.)}
                                        actor-e (assoc :notification/actor actor-e)
                                        post-e  (assoc :notification/post post-e)
                                        live-e  (assoc :notification/live live-e))])
             db2 (:db-after res)
             nid (d/resolve-tempid db2 (:tempids res) tid)]
         (try
           (rt/publish! (:user/username (d/entity db2 recipient-e))
                        {:type         "notification"
                         :notification (notif-dto db2 nid)
                         :unreadCount  (unread-count db2 recipient-e)})
           (catch Throwable _ nil))
         res)))))

;; ===== GROUPING =====
;; "ana and 3 others liked your post": notifications of the same type on the
;; same post (likes/comments), or follows on the same day, form a group. Every
;; item of the list stays; grouped items get an extra :group field so clients
;; may collapse them (show only the item where group.isLatest is true).

(def ^:private verbs {:like "liked your post"
                      :comment "commented on your post"
                      :follow "started following you"})

(defn- group-key [e]
  (let [t (:notification/type e)]
    (case t
      (:like :comment) (when-let [p (:notification/post e)] (str (name t) ":" (:db/id p)))
      :follow (when-let [c (:notification/created-at e)]
                (str "follow:" (subs (instant->str c) 0 10)))
      nil)))

(defn- actor-name [e]
  (or (some-> e :notification/actor :user/username)
      (some-> (:notification/message e) str/trim (str/split #"\s+") first)))

(defn group-text [type names]
  (let [verb (get verbs type "")
        n    (count names)]
    (case n
      0 verb
      1 (str (first names) " " verb)
      2 (str (first names) " and " (second names) " " verb)
      (str (first names) " and " (dec n) " others " verb))))

(defn- build-groups
  "Map group-key -> group info, computed over all of the recipient's
   notifications (newest first)."
  [db all-ids]
  (->> all-ids
       (keep (fn [nid] (let [e (d/entity db nid)]
                         (when-let [k (group-key e)] [k nid e]))))
       (group-by first)
       (keep (fn [[k items]]
               (let [names (distinct (keep (fn [[_ _ e]] (actor-name e)) items))]
                 (when (> (count names) 1)
                   (let [[_ latest-id latest-e] (first items)
                         actors (->> items
                                     (keep (fn [[_ _ e]] (:notification/actor e)))
                                     (distinct)
                                     (take 3)
                                     (mapv author-dto))]
                     [k {:key      k
                         :count    (count names)
                         :actors   actors
                         :text     (group-text (:notification/type latest-e) names)
                         :latestId (str latest-id)
                         :unread   (count (remove (fn [[_ _ e]] (:notification/read e)) items))}])))))
       (into {})))

(defn notifications-page
  "Newest first. Returns {:items [dto...] :next-before id-or-nil}."
  [db recipient-e {:keys [limit before]}]
  (let [limit   (-> (or limit 30) (max 1) (min 100))
        all-ids (sort #(compare %2 %1)
                      (d/q '[:find [?n ...] :in $ ?u :where [?n :notification/recipient ?u]]
                           db recipient-e))
        page-src (if before (drop-while #(>= % before) all-ids) all-ids)
        page    (take limit page-src)
        groups  (build-groups db all-ids)
        items   (mapv (fn [nid]
                        (let [dto (notif-dto db nid)
                              g   (some-> (group-key (d/entity db nid)) groups)]
                          (cond-> dto
                            g (assoc :group (assoc g :isLatest (= (:latestId g) (str nid)))))))
                      page)]
    {:items items
     :next-before (when (> (count page-src) limit) (last page))}))

;; ===== HANDLERS =====

(defn- query-long [req k]
  (parse-id (get-in req [:query-params k])))

(defn handle-get-notifications
  "GET /api/notifications?limit=30&before=<id> — JSON array (unchanged shape)
   plus headers X-Next-Before (cursor for the next page) and X-Unread-Count."
  [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u-e (user-e db username)
          {:keys [items next-before]} (notifications-page db u-e {:limit  (query-long req "limit")
                                                                  :before (query-long req "before")})]
      (cond-> (ok items)
        true        (assoc-in [:headers "X-Unread-Count"] (str (unread-count db u-e)))
        next-before (assoc-in [:headers "X-Next-Before"] (str next-before))))
    (unauth)))

(defn handle-mark-notifs-read [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u-e (user-e db username)
          nids (d/q '[:find [?n ...] :in $ ?u :where [?n :notification/recipient ?u] [?n :notification/read false]] db u-e)
          tx-data (mapv #(vector :db/add % :notification/read true) nids)]
      (when (seq tx-data) @(d/transact s/conn tx-data))
      (rt/publish! username {:type "notifications:read" :unreadCount 0})
      (ok {:ok true}))
    (unauth)))

(defn handle-mark-one-read [req]
  (if-let [username (me req)]
    (let [nid (parse-id (get-in req [:path-params :id]))
          db  (ddb)
          u-e (user-e db username)
          n   (when nid (d/entity db nid))]
      (cond
        (not (:notification/type n)) (not-found)
        (not= u-e (-> n :notification/recipient :db/id)) (forbidden)
        :else
        (let [db2 (:db-after @(d/transact s/conn [[:db/add nid :notification/read true]]))
              cnt (unread-count db2 u-e)]
          (rt/publish! username {:type "notifications:read" :id (str nid) :unreadCount cnt})
          (ok {:ok true :unreadCount cnt}))))
    (unauth)))

(defn handle-unread-count [req]
  (if-let [username (me req)]
    (let [db (ddb)]
      (ok {:count (unread-count db (user-e db username))}))
    (unauth)))

(def routes
  [["/api/notifications"              {:get handle-get-notifications}]
   ["/api/notifications/read"         {:post handle-mark-notifs-read}]
   ["/api/notifications/unread-count" {:get handle-unread-count}]
   ["/api/notifications/:id/read"     {:post handle-mark-one-read}]])
