(ns web.server
  (:gen-class)
  (:require [ring.adapter.jetty :as jetty]
            [reitit.ring :as ring]
            [reitit.ring.middleware.parameters :as params]
            [ring.middleware.keyword-params :refer [wrap-keyword-params]]
            [ring.middleware.session :refer [wrap-session]]
            [ring.middleware.multipart-params :refer [wrap-multipart-params]]
            [ring.util.response :as resp]
            [clojure.java.io :as io]
            [cheshire.core :as json]
            [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s]
            [project.db :as db]
            [project.leaderboard :as lb]
            [project.time :as t]
            [web.oauth :as oauth]
            [buddy.hashers :as hashers])
  (:import (java.util UUID Date)
           (java.time Instant LocalDate ZoneId)))

;; ===== HELPERS =====

(defn- jresp [status body]
  {:status status
   :headers {"Content-Type" "application/json"}
   :body (json/generate-string body)})

(defn- parse-body [req]
  (try (json/parse-stream (io/reader (:body req)) true)
       (catch Exception _ {})))

(defn- me [req] (get-in req [:session :username]))

(defn- ok [body]  (jresp 200 body))
(defn- created [body] (jresp 201 body))
(defn- bad [msg]  (jresp 400 {:error msg}))
(defn- unauth []  (jresp 401 {:error "Unauthorized"}))
(defn- not-found [] (jresp 404 {:error "Not found"}))

(defn- parse-instant [s]
  (try (Date/from (Instant/parse s)) (catch Exception _ (Date.))))

(defn- instant->str [d]
  (when d (.toString (.toInstant d))))

(defn uploads-dir []
  (io/file (System/getProperty "user.dir") "uploads"))

;; ===== DTO CONVERTERS =====

(defn- user-dto [u]
  (when (and u (:user/username u))
    {:username    (:user/username u)
     :displayName (:user/display-name u)
     :profilePic  (:user/profile-pic u)
     :bio         (:user/bio u)
     :website     (:user/website u)
     :xp          (or (:user/xp u) 0)}))

(defn- user-dto-e [db eid]
  (user-dto (d/entity db eid)))

(defn- author-dto [u]
  (when u {:username    (:user/username u)
            :displayName (:user/display-name u)
            :profilePic  (:user/profile-pic u)}))

(defn- post-dto [db eid]
  (let [e (d/entity db eid)
        author (d/entity db (-> e :post/author :db/id))
        likes (keep #(:user/username (d/entity db (:db/id %))) (:post/likes e))
        cc (or (d/q '[:find (count ?c) . :in $ ?p :where [?c :comment/post ?p]] db eid) 0)]
    {:id          (str eid)
     :author      (author-dto author)
     :caption     (:post/caption e)
     :mediaUrl    (:post/media-url e)
     :activityTag (:post/activity-tag e)
     :likes       (vec likes)
     :commentCount cc
     :createdAt   (instant->str (:post/created-at e))}))

(defn- comment-dto [db eid]
  (let [e (d/entity db eid)
        author (d/entity db (-> e :comment/author :db/id))]
    {:id        (str eid)
     :author    (author-dto author)
     :content   (:comment/content e)
     :createdAt (instant->str (:comment/created-at e))}))

(defn- notif-dto [db eid]
  (let [e (d/entity db eid)]
    {:id        (str eid)
     :type      (name (or (:notification/type e) :info))
     :message   (:notification/message e)
     :read      (boolean (:notification/read e))
     :createdAt (instant->str (:notification/created-at e))}))

(defn- msg-dto [db eid]
  (let [e (d/entity db eid)
        sender (d/entity db (-> e :message/sender :db/id))]
    {:id        (str eid)
     :sender    (author-dto sender)
     :content   (:message/content e)
     :mediaUrl  (:message/media-url e)
     :mediaType (:message/media-type e)
     :createdAt (instant->str (:message/created-at e))}))

(defn- group-dto [db eid]
  (let [e (d/entity db eid)
        creator (d/entity db (-> e :group/creator :db/id))
        members (mapv #(author-dto (d/entity db (:db/id %))) (:group/members e))]
    {:id          (str eid)
     :name        (:group/name e)
     :description (:group/description e)
     :avatar      (:group/avatar e)
     :creator     (author-dto creator)
     :members     members
     :memberCount (count members)
     :createdAt   (instant->str (:group/created-at e))}))

(defn- comp-dto [db eid]
  (let [e (d/entity db eid)
        creator (d/entity db (-> e :competition/creator :db/id))
        members (mapv #(author-dto (d/entity db (:db/id %))) (:competition/members e))]
    {:id          (str eid)
     :name        (:competition/name e)
     :description (:competition/description e)
     :theme       (:competition/theme e)
     :rules       (:competition/rules e)
     :creator     (author-dto creator)
     :members     members
     :inviteCode  (:competition/invite-code e)
     :startDate   (instant->str (:competition/start-date e))
     :endDate     (instant->str (:competition/end-date e))
     :createdAt   (instant->str (:competition/created-at e))}))

;; ===== DB HELPERS =====

(defn- ddb [] (d/db s/conn))

(defn- user-e [db username]
  (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] db username))

(defn- create-notif! [recipient-e type msg]
  @(d/transact s/conn [{:notification/recipient recipient-e
                         :notification/type type
                         :notification/message msg
                         :notification/read false
                         :notification/created-at (Date.)}]))

;; ===== AUTH =====

(defn- handle-me [req]
  (if-let [un (me req)]
    (let [u (d/entity (ddb) [:user/username un])]
      (if (:db/id u) (ok (user-dto u)) (unauth)))
    (unauth)))

(defn- handle-login [req]
  (let [{:keys [username password]} (parse-body req)
        un (str/trim (str username))
        u  (d/entity (ddb) [:user/username un])]
    (cond
      (not (:db/id u))
      (jresp 401 {:error "User not found"})

      (and (seq (:user/password-hash u))
           (not (hashers/check (str password) (:user/password-hash u))))
      (jresp 401 {:error "Wrong password"})

      :else
      (-> (ok (user-dto u))
          (assoc :session {:username un})))))

(defn- handle-register [req]
  (let [{:keys [username password displayName]} (parse-body req)
        un (str/trim (str username))]
    (cond
      (str/blank? un)           (bad "Username required")
      (< (count (str password)) 6) (bad "Password too short")
      (d/entity (ddb) [:user/username un]) (bad "Username taken")
      :else
      (do
        @(d/transact s/conn [{:user/username un
                               :user/xp 0
                               :user/display-name (or (str/trim (str displayName)) un)
                               :user/password-hash (hashers/derive (str password))}])
        (-> (created (user-dto (d/entity (ddb) [:user/username un])))
            (assoc :session {:username un}))))))

(defn- handle-logout [_]
  (-> (ok {:ok true}) (assoc :session nil)))

;; ===== ACTIVITIES =====

(defn- handle-get-activities [req]
  (if-let [username (me req)]
    (let [db (ddb)
          rows (d/q '[:find ?a ?t ?dur ?int ?start ?note
                      :in $ ?username
                      :where
                      [?u :user/username ?username]
                      [?a :activity/user ?u]
                      [?a :activity/type ?at]
                      [?at :activity-type/key ?t]
                      [?a :activity/duration ?dur]
                      [?a :activity/intensity ?int]
                      [?a :activity/start-time ?start]
                      [(get-else $ ?a :activity/note "") ?note]]
                    db username)
          sorted (sort-by #(nth % 4) #(compare %2 %1) rows)]
      (ok (mapv (fn [[id t dur int start note]]
                  {:id (str id) :type (name t) :duration dur
                   :intensity int :startTime (instant->str start) :note note})
               sorted)))
    (unauth)))

(defn- handle-create-activity [req]
  (if-let [username (me req)]
    (let [{:keys [type duration intensity note startTime]} (parse-body req)
          db (ddb)
          type-kw (keyword type)
          u-e (user-e db username)
          at-row (first (d/q '[:find ?e ?xpm :in $ ?t
                               :where [?e :activity-type/key ?t]
                               [?e :activity-type/xp-per-minute ?xpm]]
                             db type-kw))]
      (if-not at-row
        (bad "Unknown activity type")
        (let [[at-e xpm] at-row
              start   (parse-instant startTime)
              gained  (long (Math/round (* (double duration) (double intensity) (double xpm))))
              cur-xp  (or (:user/xp (d/entity db u-e)) 0)
              act-id  (d/tempid :db.part/user)
              tx-data (cond-> [{:db/id act-id
                                :activity/user u-e
                                :activity/type at-e
                                :activity/duration (long duration)
                                :activity/intensity (long intensity)
                                :activity/start-time start}
                               [:db/add [:user/username username] :user/xp (+ cur-xp gained)]]
                        (seq note) (conj [:db/add act-id :activity/note note]))
              result  @(d/transact s/conn tx-data)
              new-id  (d/resolve-tempid (:db-after result) (:tempids result) act-id)]
          (created {:id (str new-id) :type type :duration duration
                    :intensity intensity :startTime startTime :note (or note "")}))))
    (unauth)))

(defn- handle-update-activity [req]
  (if-let [username (me req)]
    (let [act-id (Long/parseLong (get-in req [:path-params :id]))
          {:keys [type duration intensity note startTime]} (parse-body req)
          db (ddb)
          act-e (d/entity db act-id)
          owner (-> act-e :activity/user :user/username)]
      (if (not= owner username)
        (jresp 403 {:error "Forbidden"})
        (let [type-kw (keyword type)
              at-e (d/q '[:find ?e . :in $ ?t :where [?e :activity-type/key ?t]] db type-kw)
              start (parse-instant startTime)
              tx-data (cond-> [[:db/add act-id :activity/type at-e]
                               [:db/add act-id :activity/duration (long duration)]
                               [:db/add act-id :activity/intensity (long intensity)]
                               [:db/add act-id :activity/start-time start]]
                        note (conj [:db/add act-id :activity/note note]))]
          @(d/transact s/conn tx-data)
          (ok {:id (str act-id) :type type :duration duration :intensity intensity :startTime startTime :note (or note "")}))))
    (unauth)))

(defn- handle-delete-activity [req]
  (if-let [username (me req)]
    (let [act-id (Long/parseLong (get-in req [:path-params :id]))
          act-e (d/entity (ddb) act-id)
          owner (-> act-e :activity/user :user/username)]
      (if (not= owner username)
        (jresp 403 {:error "Forbidden"})
        (do @(d/transact s/conn [[:db/retractEntity act-id]])
            (ok {:ok true}))))
    (unauth)))

;; ===== POSTS / FEED =====

(defn- handle-get-feed [req]
  (if-let [username (me req)]
    (let [db (ddb)
          u-e (user-e db username)
          ;; posts from me and people I follow
          post-ids (d/q '[:find [?p ...]
                          :in $ ?me
                          :where
                          (or [?me :user/follows ?followed]
                              [(identity ?me) ?followed])
                          [?p :post/author ?followed]]
                        db u-e)
          sorted (sort-by #(:post/created-at (d/entity db %)) #(compare %2 %1) post-ids)]
      (ok (mapv #(post-dto db %) (take 50 sorted))))
    (unauth)))

(defn- handle-create-post [req]
  (if-let [username (me req)]
    (let [{:keys [caption mediaUrl activityTag]} (parse-body req)
          db (ddb)
          u-e (user-e db username)
          post-id (d/tempid :db.part/user)
          tx-data (cond-> [{:db/id post-id
                            :post/author u-e
                            :post/created-at (Date.)}]
                    (seq caption)     (conj [:db/add post-id :post/caption caption])
                    (seq mediaUrl)    (conj [:db/add post-id :post/media-url mediaUrl])
                    (seq activityTag) (conj [:db/add post-id :post/activity-tag activityTag]))
          result @(d/transact s/conn tx-data)
          new-id (d/resolve-tempid (:db-after result) (:tempids result) post-id)]
      (created (post-dto (:db-after result) new-id)))
    (unauth)))

(defn- handle-get-post [req]
  (let [pid (Long/parseLong (get-in req [:path-params :id]))
        db  (ddb)
        e   (d/entity db pid)]
    (if (:post/author e)
      (ok (post-dto db pid))
      (not-found))))

(defn- handle-like-post [req]
  (if-let [username (me req)]
    (let [pid (Long/parseLong (get-in req [:path-params :id]))
          db  (ddb)
          u-e (user-e db username)
          post-e (d/entity db pid)
          liked? (some #(= (:db/id %) u-e) (:post/likes post-e))]
      (if liked?
        (do @(d/transact s/conn [[:db/retract pid :post/likes u-e]])
            (ok {:action "removed"}))
        (do
          @(d/transact s/conn [[:db/add pid :post/likes u-e]])
          (let [author-e (-> post-e :post/author :db/id)]
            (when (not= author-e u-e)
              (create-notif! author-e :like (str username " liked your post"))))
          (ok {:action "added"}))))
    (unauth)))

(defn- handle-delete-post [req]
  (if-let [username (me req)]
    (let [pid (Long/parseLong (get-in req [:path-params :id]))
          post-e (d/entity (ddb) pid)
          owner  (-> post-e :post/author :user/username)]
      (if (not= owner username)
        (jresp 403 {:error "Forbidden"})
        (do @(d/transact s/conn [[:db/retractEntity pid]])
            (ok {:ok true}))))
    (unauth)))

;; ===== COMMENTS =====

(defn- handle-get-comments [req]
  (let [pid (Long/parseLong (get-in req [:path-params :id]))
        db  (ddb)
        cids (sort (d/q '[:find [?c ...] :in $ ?p :where [?c :comment/post ?p]] db pid))]
    (ok (mapv #(comment-dto db %) cids))))

(defn- handle-add-comment [req]
  (if-let [username (me req)]
    (let [pid (Long/parseLong (get-in req [:path-params :id]))
          {:keys [content]} (parse-body req)
          db (ddb)
          u-e (user-e db username)
          result @(d/transact s/conn [{:comment/post pid
                                        :comment/author u-e
                                        :comment/content content
                                        :comment/created-at (Date.)}])
          cid (first (vals (:tempids result)))]
      (let [post-e (d/entity (ddb) pid)
            author-e (-> post-e :post/author :db/id)]
        (when (and author-e (not= author-e u-e))
          (create-notif! author-e :comment (str username " commented on your post"))))
      (created (comment-dto (:db-after result) cid)))
    (unauth)))

(defn- handle-delete-comment [req]
  (if-let [username (me req)]
    (let [cid (Long/parseLong (get-in req [:path-params :id]))
          c-e (d/entity (ddb) cid)
          owner (-> c-e :comment/author :user/username)]
      (if (not= owner username)
        (jresp 403 {:error "Forbidden"})
        (do @(d/transact s/conn [[:db/retractEntity cid]])
            (ok {:ok true}))))
    (unauth)))

;; ===== PROFILE =====

(defn- handle-get-profile [req]
  (let [uname (get-in req [:path-params :username])
        db    (ddb)
        u     (d/entity db [:user/username uname])]
    (if-not (:db/id u)
      (not-found)
      (let [me-un (me req)
            me-e  (when me-un (user-e db me-un))
            followers (d/q '[:find [?f ...] :in $ ?u :where [?f :user/follows ?u]] db (:db/id u))
            following (map :db/id (:user/follows u))
            am-following (boolean (some #(= % me-e) followers))]
        (ok (merge (user-dto u)
                   {:followersCount (count followers)
                    :followingCount (count following)
                    :isFollowing    am-following}))))))

(defn- handle-update-profile [req]
  (if-let [username (me req)]
    (let [{:keys [displayName bio website profilePic]} (parse-body req)
          tx-data (cond-> []
                    displayName (conj [:db/add [:user/username username] :user/display-name displayName])
                    bio         (conj [:db/add [:user/username username] :user/bio bio])
                    website     (conj [:db/add [:user/username username] :user/website website])
                    profilePic  (conj [:db/add [:user/username username] :user/profile-pic profilePic]))]
      (when (seq tx-data) @(d/transact s/conn tx-data))
      (ok (user-dto (d/entity (ddb) [:user/username username]))))
    (unauth)))

(defn- handle-delete-account [req]
  (if-let [username (me req)]
    (let [param-un (get-in req [:path-params :username])]
      (if (not= username param-un)
        (jresp 403 {:error "Forbidden"})
        (let [u-e (user-e (ddb) username)]
          @(d/transact s/conn [[:db/retractEntity u-e]])
          (-> (ok {:ok true}) (assoc :session nil)))))
    (unauth)))

;; ===== FOLLOW =====

(defn- handle-toggle-follow [req]
  (if-let [me-un (me req)]
    (let [{:keys [username]} (parse-body req)
          target username
          db     (ddb)
          me-e   (user-e db me-un)
          t-e    (user-e db target)]
      (if-not t-e
        (not-found)
        (let [following? (some #(= (:db/id %) t-e) (:user/follows (d/entity db me-e)))]
          (if following?
            (do @(d/transact s/conn [[:db/retract me-e :user/follows t-e]])
                (ok {:action "unfollowed"}))
            (do @(d/transact s/conn [[:db/add me-e :user/follows t-e]])
                (create-notif! t-e :follow (str me-un " started following you"))
                (ok {:action "followed"}))))))
    (unauth)))

(defn- handle-get-followers [req]
  (let [uname (get-in req [:path-params :username])
        db    (ddb)
        u-e   (user-e db uname)
        fids  (d/q '[:find [?f ...] :in $ ?u :where [?f :user/follows ?u]] db u-e)]
    (ok (mapv #(:user/username (d/entity db %)) fids))))

(defn- handle-get-following [req]
  (let [uname (get-in req [:path-params :username])
        db    (ddb)
        u     (d/entity db [:user/username uname])
        fids  (map :db/id (:user/follows u))]
    (ok (mapv #(:user/username (d/entity db %)) fids))))

;; ===== LEADERBOARD =====

(defn- lb-entry->dto [db entry]
  (let [un  (:user/username entry)
        u   (d/entity db [:user/username un])]
    {:username    un
     :displayName (:user/display-name u)
     :profilePic  (:user/profile-pic u)
     :xp          (or (:user/xp entry) 0)
     :rank        (:rank entry)
     :delta       (or (:delta entry) 0)}))

(defn- handle-get-leaderboard [req]
  (if-let [username (me req)]
    (let [filter-p (get-in req [:query-params "filter"] "global")
          db       (ddb)
          today    (LocalDate/now)
          lb-raw   (lb/leaderboard db :all today)
          lb       (mapv #(lb-entry->dto db %) lb-raw)]
      (if (= filter-p "friends")
        (let [me-e    (user-e db username)
              friends (set (map :db/id (:user/follows (d/entity db me-e))))]
          (ok (filterv #(or (= (:username %) username) (friends (user-e db (:username %)))) lb)))
        (ok lb)))
    (unauth)))

;; ===== SEARCH =====

(defn- handle-search [req]
  (let [q  (get-in req [:query-params "q"] "")
        db (ddb)]
    (if (str/blank? q)
      (ok [])
      (let [q-lower (str/lower-case q)
            all (d/q '[:find [?e ...] :where [?e :user/username]] db)
            matched (filter (fn [eid]
                              (let [u (d/entity db eid)]
                                (or (str/includes? (str/lower-case (or (:user/username u) "")) q-lower)
                                    (str/includes? (str/lower-case (or (:user/display-name u) "")) q-lower))))
                            all)]
        (ok (mapv #(author-dto (d/entity db %)) (take 20 matched)))))))

;; ===== NOTIFICATIONS =====

(defn- handle-get-notifications [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u-e (user-e db username)
          nids (sort #(compare %2 %1)
                     (d/q '[:find [?n ...] :in $ ?u :where [?n :notification/recipient ?u]] db u-e))]
      (ok (mapv #(notif-dto db %) (take 30 nids))))
    (unauth)))

(defn- handle-mark-notifs-read [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u-e (user-e db username)
          nids (d/q '[:find [?n ...] :in $ ?u :where [?n :notification/recipient ?u] [?n :notification/read false]] db u-e)
          tx-data (mapv #(vector :db/add % :notification/read true) nids)]
      (when (seq tx-data) @(d/transact s/conn tx-data))
      (ok {:ok true}))
    (unauth)))

;; ===== TRENDING =====

(defn- handle-trending [_]
  (let [db (ddb)
        tags (d/q '[:find ?tag (count ?p)
                    :where [?p :post/activity-tag ?tag]]
                  db)
        sorted (sort-by second #(compare %2 %1) tags)]
    (ok (mapv (fn [[tag cnt]] {:tag tag :count cnt}) (take 10 sorted)))))

;; ===== UPLOAD =====

(defn- handle-upload [req]
  (if-let [_username (me req)]
    (let [file-data (get-in req [:multipart-params "file"])]
      (if-not file-data
        (bad "No file")
        (let [orig-name (:filename file-data)
              ext  (last (str/split (or orig-name "file.bin") #"\."))
              fname (str (UUID/randomUUID) "." ext)
              dir  (uploads-dir)
              _    (.mkdirs dir)
              dest (io/file dir fname)]
          (io/copy (:tempfile file-data) dest)
          (ok {:url (str "/uploads/" fname)}))))
    (unauth)))

(defn- handle-serve-upload [req]
  (let [fname (get-in req [:path-params :filename])
        f (io/file (uploads-dir) fname)]
    (if (.exists f)
      (resp/file-response (.getPath f))
      {:status 404 :body "Not found"})))

;; ===== CONVERSATIONS / DMs =====

(defn- find-or-create-conv! [me-e other-e]
  (let [db (ddb)
        existing (d/q '[:find ?c .
                         :in $ ?a ?b
                         :where
                         [?c :conversation/participants ?a]
                         [?c :conversation/participants ?b]]
                       db me-e other-e)]
    (or existing
        (let [result @(d/transact s/conn [{:conversation/participants #{me-e other-e}
                                            :conversation/last-message-at (Date.)}])
              cid (first (vals (:tempids result)))]
          cid))))

(defn- conv-dto [db me-e conv-e]
  (let [c (d/entity db conv-e)
        parts (map :db/id (:conversation/participants c))
        other-e (first (remove #(= % me-e) parts))
        other (when other-e (d/entity db other-e))
        last-msg (first (sort-by #(:message/created-at (d/entity db %)) #(compare %2 %1)
                                 (d/q '[:find [?m ...] :in $ ?c :where [?m :message/conversation ?c]] db conv-e)))]
    {:id           (str conv-e)
     :other        (author-dto other)
     :lastMessage  (when last-msg (:message/content (d/entity db last-msg)))
     :lastMessageAt (instant->str (:conversation/last-message-at c))
     :unreadCount  (or (d/q '[:find (count ?m) . :in $ ?c ?me
                               :where [?m :message/conversation ?c]
                               (not [?m :message/read-by ?me])]
                             db conv-e me-e) 0)}))

(defn- handle-get-conversations [req]
  (if-let [username (me req)]
    (let [db (ddb)
          u-e (user-e db username)
          cids (d/q '[:find [?c ...] :in $ ?u :where [?c :conversation/participants ?u]] db u-e)
          sorted (sort-by #(or (:conversation/last-message-at (d/entity db %)) (Date. 0)) #(compare %2 %1) cids)]
      (ok (mapv #(conv-dto db u-e %) sorted)))
    (unauth)))

(defn- handle-send-message [req]
  (if-let [username (me req)]
    (let [{:keys [to content mediaUrl mediaType]} (parse-body req)
          db (ddb)
          me-e (user-e db username)
          other-e (user-e db to)]
      (if-not other-e
        (not-found)
        (let [conv-e (find-or-create-conv! me-e other-e)
              msg-id (d/tempid :db.part/user)
              result @(d/transact s/conn (cond-> [{:db/id msg-id
                                                    :message/conversation conv-e
                                                    :message/sender me-e
                                                    :message/content (or content "")
                                                    :message/created-at (Date.)}
                                                   [:db/add conv-e :conversation/last-message-at (Date.)]]
                                           (seq mediaUrl)  (conj [:db/add msg-id :message/media-url mediaUrl])
                                           (seq mediaType) (conj [:db/add msg-id :message/media-type mediaType])))
              new-id (d/resolve-tempid (:db-after result) (:tempids result) msg-id)]
          (created (msg-dto (:db-after result) new-id)))))
    (unauth)))

(defn- handle-get-messages [req]
  (if-let [username (me req)]
    (let [conv-id (Long/parseLong (get-in req [:path-params :id]))
          db (ddb)
          u-e (user-e db username)
          ;; check user is a participant
          participants (map :db/id (:conversation/participants (d/entity db conv-id)))]
      (if-not (some #(= % u-e) participants)
        (jresp 403 {:error "Forbidden"})
        (let [mids (sort (d/q '[:find [?m ...] :in $ ?c :where [?m :message/conversation ?c]] db conv-id))]
          (ok (mapv #(msg-dto db %) mids)))))
    (unauth)))

(defn- handle-mark-conv-read [req]
  (if-let [username (me req)]
    (let [conv-id (Long/parseLong (get-in req [:path-params :id]))
          db (ddb)
          u-e (user-e db username)
          mids (d/q '[:find [?m ...] :in $ ?c ?u
                      :where [?m :message/conversation ?c]
                      (not [?m :message/read-by ?u])]
                    db conv-id u-e)
          tx-data (mapv #(vector :db/add % :message/read-by u-e) mids)]
      (when (seq tx-data) @(d/transact s/conn tx-data))
      (ok {:ok true}))
    (unauth)))

(defn- handle-unread-messages [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u-e (user-e db username)
          cnt (or (d/q '[:find (count ?m) .
                          :in $ ?u
                          :where
                          [?c :conversation/participants ?u]
                          [?m :message/conversation ?c]
                          (not [?m :message/sender ?u])
                          (not [?m :message/read-by ?u])]
                        db u-e) 0)]
      (ok {:count cnt}))
    (unauth)))

;; ===== GROUPS =====

(defn- handle-get-groups [req]
  (if-let [username (me req)]
    (let [db (ddb)
          u-e (user-e db username)
          gids (d/q '[:find [?g ...] :in $ ?u :where [?g :group/members ?u]] db u-e)]
      (ok (mapv #(group-dto db %) gids)))
    (unauth)))

(defn- handle-create-group [req]
  (if-let [username (me req)]
    (let [{:keys [name description avatar]} (parse-body req)
          db (ddb)
          u-e (user-e db username)
          g-id (d/tempid :db.part/user)
          result @(d/transact s/conn (cond-> [{:db/id g-id
                                               :group/name name
                                               :group/creator u-e
                                               :group/members #{u-e}
                                               :group/created-at (Date.)}]
                                       (seq description) (conj [:db/add g-id :group/description description])
                                       (seq avatar)      (conj [:db/add g-id :group/avatar avatar])))
          new-id (d/resolve-tempid (:db-after result) (:tempids result) g-id)]
      (created (group-dto (:db-after result) new-id)))
    (unauth)))

(defn- handle-get-group [req]
  (let [gid (Long/parseLong (get-in req [:path-params :id]))
        db (ddb)
        g (d/entity db gid)]
    (if (:group/name g)
      (ok (group-dto db gid))
      (not-found))))

(defn- handle-toggle-group [req]
  (if-let [username (me req)]
    (let [gid (Long/parseLong (get-in req [:path-params :id]))
          db  (ddb)
          u-e (user-e db username)
          g   (d/entity db gid)
          member? (some #(= (:db/id %) u-e) (:group/members g))]
      (if member?
        (do @(d/transact s/conn [[:db/retract gid :group/members u-e]])
            (ok {:action "left"}))
        (do @(d/transact s/conn [[:db/add gid :group/members u-e]])
            (ok {:action "joined"}))))
    (unauth)))

(defn- handle-get-group-messages [req]
  (if-let [username (me req)]
    (let [gid (Long/parseLong (get-in req [:path-params :id]))
          db  (ddb)
          u-e (user-e db username)
          g   (d/entity db gid)]
      (if-not (some #(= (:db/id %) u-e) (:group/members g))
        (jresp 403 {:error "Forbidden"})
        (let [mids (sort (d/q '[:find [?m ...] :in $ ?g :where [?m :group-message/group ?g]] db gid))]
          (ok (mapv (fn [mid]
                      (let [e (d/entity db mid)
                            s (d/entity db (-> e :group-message/sender :db/id))]
                        {:id (str mid)
                         :sender (author-dto s)
                         :content (:group-message/content e)
                         :mediaUrl (:group-message/media-url e)
                         :createdAt (instant->str (:group-message/created-at e))}))
                    mids)))))
    (unauth)))

(defn- handle-send-group-message [req]
  (if-let [username (me req)]
    (let [gid (Long/parseLong (get-in req [:path-params :id]))
          {:keys [content mediaUrl]} (parse-body req)
          db  (ddb)
          u-e (user-e db username)
          g   (d/entity db gid)]
      (if-not (some #(= (:db/id %) u-e) (:group/members g))
        (jresp 403 {:error "Forbidden"})
        (let [msg-id (d/tempid :db.part/user)
              tx-data (cond-> [{:db/id msg-id
                                :group-message/group gid
                                :group-message/sender u-e
                                :group-message/content (or content "")
                                :group-message/created-at (Date.)}]
                        (seq mediaUrl) (conj [:db/add msg-id :group-message/media-url mediaUrl]))
              result @(d/transact s/conn tx-data)
              new-id (d/resolve-tempid (:db-after result) (:tempids result) msg-id)]
          (created {:id (str new-id) :content content}))))
    (unauth)))

;; ===== COMPETITIONS =====

(defn- handle-get-competitions [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u-e (user-e db username)
          cids (d/q '[:find [?c ...] :in $ ?u :where [?c :competition/members ?u]] db u-e)
          ;; also include public competitions (all)
          all-cids (d/q '[:find [?c ...] :where [?c :competition/name]] db)
          merged (distinct (concat cids all-cids))]
      (ok (mapv #(comp-dto db %) (take 50 merged))))
    (unauth)))

(defn- handle-create-competition [req]
  (if-let [username (me req)]
    (let [{:keys [name description theme rules startDate endDate]} (parse-body req)
          db (ddb)
          u-e (user-e db username)
          invite-code (subs (str (UUID/randomUUID)) 0 8)
          c-id (d/tempid :db.part/user)
          result @(d/transact s/conn (cond-> [{:db/id c-id
                                               :competition/name name
                                               :competition/theme (or theme "general")
                                               :competition/creator u-e
                                               :competition/members #{u-e}
                                               :competition/invite-code invite-code
                                               :competition/created-at (Date.)}]
                                       (seq description) (conj [:db/add c-id :competition/description description])
                                       (seq rules)      (conj [:db/add c-id :competition/rules rules])
                                       (seq startDate)  (conj [:db/add c-id :competition/start-date (parse-instant startDate)])
                                       (seq endDate)    (conj [:db/add c-id :competition/end-date (parse-instant endDate)])))
          new-id (d/resolve-tempid (:db-after result) (:tempids result) c-id)]
      (created (comp-dto (:db-after result) new-id)))
    (unauth)))

(defn- handle-get-competition [req]
  (let [cid (Long/parseLong (get-in req [:path-params :id]))
        db  (ddb)
        e   (d/entity db cid)]
    (if (:competition/name e)
      (ok (comp-dto db cid))
      (not-found))))

(defn- handle-toggle-competition [req]
  (if-let [username (me req)]
    (let [cid (Long/parseLong (get-in req [:path-params :id]))
          db  (ddb)
          u-e (user-e db username)
          c   (d/entity db cid)
          member? (some #(= (:db/id %) u-e) (:competition/members c))]
      (if member?
        (do @(d/transact s/conn [[:db/retract cid :competition/members u-e]])
            (ok {:action "left"}))
        (do @(d/transact s/conn [[:db/add cid :competition/members u-e]])
            (ok {:action "joined"}))))
    (unauth)))

(defn- handle-join-by-code [req]
  (if-let [username (me req)]
    (let [{:keys [code]} (parse-body req)
          db (ddb)
          u-e (user-e db username)
          c-e (d/q '[:find ?c . :in $ ?code :where [?c :competition/invite-code ?code]] db code)]
      (if-not c-e
        (not-found)
        (do @(d/transact s/conn [[:db/add c-e :competition/members u-e]])
            (ok (comp-dto (ddb) c-e)))))
    (unauth)))

(defn- handle-competition-leaderboard [req]
  (let [cid (Long/parseLong (get-in req [:path-params :id]))
        db  (ddb)
        c   (d/entity db cid)
        members (map :db/id (:competition/members c))
        start (or (:competition/start-date c) (Date. 0))
        end   (or (:competition/end-date c) (Date.))
        now   (LocalDate/now)
        entries (map (fn [m-e]
                       (let [un (:user/username (d/entity db m-e))
                             rows (db/get-activities-in-interval db un start end)
                             xp   (db/calculate-xp-from-rows rows)]
                         {:username un :xp xp :rank 0}))
                     members)
        sorted (sort-by :xp #(compare %2 %1) entries)
        ranked (map-indexed (fn [i e] (assoc e :rank (inc i))) sorted)]
    (ok (vec ranked))))

(defn- handle-competition-feed [req]
  (let [cid (Long/parseLong (get-in req [:path-params :id]))
        db  (ddb)
        c   (d/entity db cid)
        members (set (map :db/id (:competition/members c)))
        post-ids (d/q '[:find [?p ...] :where [?p :post/author]] db)
        filtered (filter (fn [pid]
                           (let [author-e (-> (d/entity db pid) :post/author :db/id)]
                             (members author-e)))
                         post-ids)
        sorted (sort-by #(:post/created-at (d/entity db %)) #(compare %2 %1) filtered)]
    (ok (mapv #(post-dto db %) (take 30 sorted)))))

;; ===== CHALLENGES =====

(defn- challenge-dto [db eid]
  (let [e (d/entity db eid)
        challenger (d/entity db (-> e :challenge/challenger :db/id))
        target     (d/entity db (-> e :challenge/target :db/id))]
    {:id         (str eid)
     :challenger (author-dto challenger)
     :target     (author-dto target)
     :status     (name (or (:challenge/status e) :pending))
     :createdAt  (instant->str (:challenge/created-at e))
     :expiresAt  (instant->str (:challenge/expires-at e))}))

(defn- handle-get-challenges [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u-e (user-e db username)
          cids (d/q '[:find [?c ...]
                       :in $ ?u
                       :where (or [?c :challenge/challenger ?u]
                                  [?c :challenge/target ?u])]
                     db u-e)]
      (ok (mapv #(challenge-dto db %) (sort #(compare %2 %1) cids))))
    (unauth)))

(defn- handle-create-challenge [req]
  (if-let [username (me req)]
    (let [{:keys [target]} (parse-body req)
          db  (ddb)
          me-e (user-e db username)
          t-e  (user-e db target)]
      (if-not t-e
        (not-found)
        (let [expires (Date. (+ (System/currentTimeMillis) (* 7 24 60 60 1000)))
              result @(d/transact s/conn [{:challenge/challenger me-e
                                            :challenge/target t-e
                                            :challenge/status :pending
                                            :challenge/created-at (Date.)
                                            :challenge/expires-at expires}])
              cid (first (vals (:tempids result)))]
          (create-notif! t-e :challenge (str username " challenged you!"))
          (created (challenge-dto (:db-after result) cid)))))
    (unauth)))

(defn- handle-respond-challenge [req]
  (if-let [username (me req)]
    (let [cid (Long/parseLong (get-in req [:path-params :id]))
          {:keys [action]} (parse-body req)
          status (keyword action)]
      @(d/transact s/conn [[:db/add cid :challenge/status status]])
      (ok (challenge-dto (ddb) cid)))
    (unauth)))

;; ===== RECAP =====

(defn- handle-get-recap [req]
  (if-let [_username (me req)]
    (let [uname  (get-in req [:path-params :username])
          period (get-in req [:query-params "period"] "week")
          db     (ddb)
          now    (LocalDate/now)
          {:keys [start-day end-day]} (case period
                                        "week"  (t/week-interval now)
                                        "month" (t/month-interval now)
                                        "year"  {:start-day (Date/from (.toInstant (.atStartOfDay (.withDayOfYear now 1) (ZoneId/of "Europe/Belgrade"))))
                                                  :end-day (Date.)}
                                        (t/week-interval now))
          rows   (db/get-activities-in-interval db uname start-day end-day)
          by-day (group-by (fn [[start _ _ _ _]]
                             (.toString (.toLocalDate (.atZone (.toInstant start) (ZoneId/of "Europe/Belgrade")))))
                           rows)
          daily  (into {} (map (fn [[day day-rows]]
                                 [day {:xp (db/calculate-xp-from-rows day-rows)
                                       :count (count day-rows)}])
                               by-day))
          total-xp (db/calculate-xp-from-rows rows)
          by-type (frequencies (map #(name (second %)) rows))]
      (ok {:username uname
           :period period
           :totalXp total-xp
           :activityCount (count rows)
           :daily daily
           :byType by-type}))
    (unauth)))

;; ===== BADGES =====

(def badge-defs
  [{:id "first-step"   :name "First Step"    :desc "Log your first activity"  :icon "🚀"}
   {:id "ten-acts"     :name "Getting Going"  :desc "Log 10 activities"        :icon "💪"}
   {:id "fifty-acts"   :name "Dedicated"      :desc "Log 50 activities"        :icon "🏅"}
   {:id "hundred-acts" :name "Century"        :desc "Log 100 activities"       :icon "🎖️"}
   {:id "xp-100"       :name "Beginner"       :desc "Earn 100 XP"              :icon "⭐"}
   {:id "xp-1000"      :name "Intermediate"   :desc "Earn 1000 XP"             :icon "🌟"}
   {:id "xp-5000"      :name "Advanced"       :desc "Earn 5000 XP"             :icon "💫"}
   {:id "xp-10000"     :name "Master"         :desc "Earn 10,000 XP"           :icon "🏆"}
   {:id "runner"       :name "Runner"         :desc "Log 5 running sessions"   :icon "🏃"}
   {:id "scholar"      :name "Scholar"        :desc "Log 5 study sessions"     :icon "📚"}
   {:id "coder"        :name "Coder"          :desc "Log 5 coding sessions"    :icon "💻"}])

(defn- handle-get-badges [req]
  (let [uname (get-in req [:path-params :username])
        db    (ddb)
        u     (d/entity db [:user/username uname])]
    (if-not (:db/id u)
      (not-found)
      (let [xp       (or (:user/xp u) 0)
            act-rows (d/q '[:find ?a ?t :in $ ?u
                             :where [?u2 :user/username ?u]
                             [?a :activity/user ?u2]
                             [?a :activity/type ?at]
                             [?at :activity-type/key ?t]]
                           db uname)
            act-count (count act-rows)
            by-type   (frequencies (map #(second %) act-rows))
            earned    (filter (fn [b]
                                (case (:id b)
                                  "first-step"   (> act-count 0)
                                  "ten-acts"     (>= act-count 10)
                                  "fifty-acts"   (>= act-count 50)
                                  "hundred-acts" (>= act-count 100)
                                  "xp-100"       (>= xp 100)
                                  "xp-1000"      (>= xp 1000)
                                  "xp-5000"      (>= xp 5000)
                                  "xp-10000"     (>= xp 10000)
                                  "runner"       (>= (get by-type :running 0) 5)
                                  "scholar"      (>= (get by-type :studying 0) 5)
                                  "coder"        (>= (get by-type :coding 0) 5)
                                  false))
                              badge-defs)]
        (ok (mapv #(assoc % :earned true) earned))))))

;; ===== STORIES =====

(defn- story-dto [db eid me-eid]
  (let [e          (d/entity db eid)
        viewed-ids (set (map :db/id (:story/viewed-by e)))]
    {:id          (str eid)
     :mediaUrl    (:story/media-url e)
     :mediaType   (:story/media-type e)
     :text        (:story/text e)
     :bgColor     (or (:story/bg-color e) "#1a1a2e")
     :createdAt   (instant->str (:story/created-at e))
     :expiresAt   (instant->str (:story/expires-at e))
     :viewedByMe  (boolean (and me-eid (contains? viewed-ids me-eid)))}))

(defn- active-stories [db]
  (let [now (Date.)]
    (->> (d/q '[:find ?s ?exp :where [?s :story/expires-at ?exp]] db)
         (filter (fn [[_ exp]] (.after ^java.util.Date exp now)))
         (map first))))

(defn- handle-get-stories [req]
  (if-let [un (me req)]
    (let [db      (ddb)
          me-e    (d/entity db [:user/username un])
          me-eid  (:db/id me-e)
          follows (set (map :db/id (:user/follows me-e)))
          visible (conj follows me-eid)
          active  (active-stories db)
          grouped (->> active
                       (keep (fn [sid]
                               (let [e    (d/entity db sid)
                                     ceid (-> e :story/creator :db/id)]
                                 (when (contains? visible ceid) [ceid sid]))))
                       (group-by first)
                       (map (fn [[ceid pairs]]
                              (let [u    (d/entity db ceid)
                                    sids (sort-by #(inst-ms (:story/created-at (d/entity db %)))
                                                  (map second pairs))
                                    dtos (mapv #(story-dto db % me-eid) sids)
                                    any? (boolean (some #(not (:viewedByMe %)) dtos))]
                                {:username    (:user/username u)
                                 :displayName (:user/display-name u)
                                 :profilePic  (:user/profile-pic u)
                                 :isMe        (= ceid me-eid)
                                 :hasUnviewed any?
                                 :stories     dtos})))
                       (sort-by (fn [g] [(if (:isMe g) 0 1) (if (:hasUnviewed g) 0 1)])))]
      (ok (vec grouped)))
    (unauth)))

(defn- handle-create-story [req]
  (if-let [un (me req)]
    (let [body       (parse-body req)
          media-url  (:mediaUrl body)
          media-type (:mediaType body)
          text       (:text body)
          bg-color   (:bgColor body)
          db         (ddb)
          me-eid     (:db/id (d/entity db [:user/username un]))]
      (if (and (str/blank? media-url) (str/blank? text))
        (bad "Story must have media or text")
        (let [now    (Date.)
              exp    (Date. (+ (.getTime now) (* 24 60 60 1000)))
              tid    (d/tempid :db.part/user)
              tx     (cond-> {:db/id            tid
                              :story/creator    me-eid
                              :story/created-at now
                              :story/expires-at exp}
                       (seq media-url)  (assoc :story/media-url media-url)
                       (seq media-type) (assoc :story/media-type media-type)
                       (seq text)       (assoc :story/text text)
                       (seq bg-color)   (assoc :story/bg-color bg-color))
              result @(d/transact s/conn [tx])
              db2    (:db-after result)
              eid    (d/resolve-tempid db2 (:tempids result) tid)]
          (created (story-dto db2 eid me-eid)))))
    (unauth)))

(defn- handle-view-story [req]
  (if-let [un (me req)]
    (let [sid (try (Long/parseLong (get-in req [:path-params :id])) (catch Exception _ nil))]
      (if-not sid
        (not-found)
        (let [me-eid (:db/id (d/entity (ddb) [:user/username un]))]
          @(d/transact s/conn [[:db/add sid :story/viewed-by me-eid]])
          (ok {:ok true}))))
    (unauth)))

(defn- handle-delete-story [req]
  (if-let [un (me req)]
    (let [sid (try (Long/parseLong (get-in req [:path-params :id])) (catch Exception _ nil))]
      (if-not sid
        (not-found)
        (let [e (d/entity (ddb) sid)]
          (if (not= un (-> e :story/creator :user/username))
            (unauth)
            (do @(d/transact s/conn [[:db/retractEntity sid]])
                (ok {:ok true}))))))
    (unauth)))

;; ===== ROUTES =====

(def routes
  [["/api/me"           {:get handle-me}]
   ["/api/login"        {:post handle-login}]
   ["/api/register"     {:post handle-register}]
   ["/api/logout"       {:post handle-logout}]

   ["/api/oauth/google"   {:post oauth/handle-google}]
   ["/api/oauth/facebook" {:post oauth/handle-facebook}]

   ["/api/activities"       {:get handle-get-activities :post handle-create-activity}]
   ["/api/activities/:id"   {:put handle-update-activity :delete handle-delete-activity}]

   ["/api/feed"             {:get handle-get-feed}]
   ["/api/posts"            {:post handle-create-post}]
   ["/api/posts/:id"        {:get handle-get-post :delete handle-delete-post}]
   ["/api/posts/:id/like"   {:post handle-like-post}]
   ["/api/posts/:id/comments" {:get handle-get-comments :post handle-add-comment}]
   ["/api/comments/:id"     {:delete handle-delete-comment}]

   ["/api/profile"          {:put handle-update-profile}]
   ["/api/users/search"     {:get handle-search}]
   ["/api/users/:username"  {:get handle-get-profile :delete handle-delete-account}]
   ["/api/users/:username/badges" {:get handle-get-badges}]

   ["/api/follow"           {:post handle-toggle-follow}]
   ["/api/followers/:username" {:get handle-get-followers}]
   ["/api/following/:username" {:get handle-get-following}]

   ["/api/leaderboard"      {:get handle-get-leaderboard}]
   ["/api/trending"         {:get handle-trending}]
   ["/api/notifications"    {:get handle-get-notifications}]
   ["/api/notifications/read" {:post handle-mark-notifs-read}]

   ["/api/upload"           {:post handle-upload}]
   ["/uploads/:filename"    {:get handle-serve-upload}]

   ["/api/conversations"    {:get handle-get-conversations}]
   ["/api/messages"         {:post handle-send-message}]
   ["/api/messages/unread"  {:get handle-unread-messages}]
   ["/api/conversations/:id/messages" {:get handle-get-messages}]
   ["/api/conversations/:id/read"     {:post handle-mark-conv-read}]

   ["/api/groups"           {:get handle-get-groups :post handle-create-group}]
   ["/api/groups/:id"       {:get handle-get-group}]
   ["/api/groups/:id/join"  {:post handle-toggle-group}]
   ["/api/groups/:id/messages" {:get handle-get-group-messages :post handle-send-group-message}]

   ["/api/competitions"     {:get handle-get-competitions :post handle-create-competition}]
   ["/api/competitions/join" {:post handle-join-by-code}]
   ["/api/competitions/:id" {:get handle-get-competition}]
   ["/api/competitions/:id/join"        {:post handle-toggle-competition}]
   ["/api/competitions/:id/leaderboard" {:get handle-competition-leaderboard}]
   ["/api/competitions/:id/feed"        {:get handle-competition-feed}]

   ["/api/challenges"       {:get handle-get-challenges :post handle-create-challenge}]
   ["/api/challenges/:id"   {:put handle-respond-challenge}]

   ["/api/recap/:username"  {:get handle-get-recap}]

   ["/api/stories"          {:get handle-get-stories :post handle-create-story}]
   ["/api/stories/:id"      {:delete handle-delete-story}]
   ["/api/stories/:id/view" {:post handle-view-story}]

   ["/favicon.ico"          {:get (fn [_] {:status 204 :body ""})}]])

;; ===== APP =====

(def app
  (-> (ring/ring-handler
       (ring/router routes
                    {:conflicts nil
                     :data {:middleware [params/parameters-middleware
                                         wrap-keyword-params]}})
       (ring/create-default-handler))
      (wrap-multipart-params)
      (wrap-session {:cookie-name "bb-session"
                     :cookie-attrs {:same-site :lax
                                    :http-only true
                                    :max-age (* 60 60 24 30)}})))

(defonce server (atom nil))

(defn- server-port []
  (Integer/parseInt (or (System/getenv "PORT") "3000")))

(defn start-server
  ([] (start-server (server-port)))
  ([port]
   (when-not @server
     (reset! server (jetty/run-jetty #'app {:port port :join? false}))
     (println (format "BeBetter REST API running on http://0.0.0.0:%d" port)))))

(defn stop-server []
  (when-some [s @server]
    (.stop s)
    (reset! server nil)))

(defn restart-server []
  (stop-server)
  (start-server))

(defn -main
  "Container entry point. Starts the server and blocks the JVM.
   Set BEBETTER_SEED=true on first boot to reset+seed the DB."
  [& _args]
  (when (nil? s/conn)
    (s/init-conn!))
  (when (= "true" (System/getenv "BEBETTER_SEED"))
    (println "[bootstrap] BEBETTER_SEED=true — running reset-db!")
    (s/reset-db! db/get-all-tx-functions))
  (start-server)
  @(promise))
