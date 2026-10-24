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
            [web.http :refer [jresp parse-body me ok created bad unauth forbidden not-found
                              parse-id instant->str ddb user-e author-dto]]
            [web.notifications :refer [notif-dto create-notif!]]
            [web.media :as media]
            [web.posts :as posts]
            [web.accounts :as accounts]
            [web.realtime :as realtime]
            [web.tokens :as tokens]
            [web.notifications :as notifications]
            [web.dm :as dm]
            [web.live :as live]
            [web.vision :as vision]
            [buddy.hashers :as hashers])
  (:import (java.util UUID Date)
           (java.time Instant LocalDate ZoneId)))

;; ===== HELPERS =====

(defn- parse-instant [s]
  (try (Date/from (Instant/parse s)) (catch Exception _ (Date.))))

(defn- today-str []
  (.toString (LocalDate/now (ZoneId/of "Europe/Belgrade"))))

(defn- valid-date-str? [s]
  (try
    (LocalDate/parse s)
    true
    (catch Exception _ false)))

(def tracking-methods
  #{"ten-wins"
    "deep-work"
    "habit-scorecard"
    "energy-check"
    "one-thing"
    "daily-review"
    "streak-tracker"
    "mood-trigger"
    "bad-habit-avoided"
    "identity-votes"
    "weekly-focus"
    "friction-log"
    "tiny-challenge"})

(defn uploads-dir []
  (io/file (System/getProperty "user.dir") "uploads"))

;; ===== DTO CONVERTERS =====

;; Post/comment DTOs live in web.posts (posts area); kept here for the
;; competition feed.
(defn- post-dto [db eid] (posts/post-dto db eid nil))

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

;; ===== AUTH =====
;; Moved to web.accounts (login/register/me/logout/password reset).

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

(defn- activity-input-error
  "nil when duration/intensity are sane. The UI allows 1-600 minutes and
   intensity 1-5; anything else only serves to inflate (or deflate) XP."
  [{:keys [duration intensity]}]
  (cond
    (not (and (integer? duration) (<= 1 duration 1440)))
    "Duration must be a whole number of minutes between 1 and 1440."
    (not (and (integer? intensity) (<= 1 intensity 5)))
    "Intensity must be a whole number between 1 and 5."
    :else nil))

(defn- activity-type-row [db type]
  (first (d/q '[:find ?e ?xpm :in $ ?t
                :where [?e :activity-type/key ?t]
                [?e :activity-type/xp-per-minute ?xpm]]
              db (keyword (str type)))))

(defn- activity-xp [duration intensity xpm]
  (long (Math/round (* (double duration) (double intensity) (double xpm)))))

(defn- stored-activity-xp
  "XP an existing activity entity granted when it was logged."
  [act-e]
  (activity-xp (or (:activity/duration act-e) 0) (or (:activity/intensity act-e) 0)
               (or (-> act-e :activity/type :activity-type/xp-per-minute) 0)))

(defn- xp-delta-tx [db username delta]
  (let [cur (or (:user/xp (d/entity db [:user/username username])) 0)]
    [:db/add [:user/username username] :user/xp (max 0 (+ cur delta))]))

(defn- handle-create-activity [req]
  (if-let [username (me req)]
    (let [{:keys [type duration intensity note startTime] :as body} (parse-body req)
          db (ddb)
          u-e (user-e db username)
          at-row (activity-type-row db type)]
      (cond
        (not at-row) (bad "Unknown activity type")
        (activity-input-error body) (bad (activity-input-error body))
        :else
        (let [[at-e xpm] at-row
              start   (parse-instant startTime)
              act-id  (d/tempid :db.part/user)
              tx-data (cond-> [{:db/id act-id
                                :activity/user u-e
                                :activity/type at-e
                                :activity/duration (long duration)
                                :activity/intensity (long intensity)
                                :activity/start-time start}
                               (xp-delta-tx db username (activity-xp duration intensity xpm))]
                        (seq note) (conj [:db/add act-id :activity/note (str note)]))
              result  @(d/transact s/conn tx-data)
              new-id  (d/resolve-tempid (:db-after result) (:tempids result) act-id)]
          (created {:id (str new-id) :type type :duration duration
                    :intensity intensity :startTime startTime :note (or note "")}))))
    (unauth)))

(defn- with-own-activity
  "Runs (f db username act-id act-e) for the session user's activity at path :id."
  [req f]
  (if-let [username (me req)]
    (let [act-id (parse-id (get-in req [:path-params :id]))
          db     (ddb)
          act-e  (when act-id (d/entity db act-id))
          owner  (some-> act-e :activity/user :user/username)]
      (cond
        (nil? act-id)         (bad "Invalid id")
        (nil? owner)          (not-found)
        (not= owner username) (forbidden)
        :else (f db username act-id act-e)))
    (unauth)))

(defn- handle-update-activity [req]
  (with-own-activity req
    (fn [db username act-id act-e]
      (let [{:keys [type duration intensity note startTime] :as body} (parse-body req)
            [at-e xpm] (activity-type-row db type)]
        (cond
          (not at-e) (bad "Unknown activity type")
          (activity-input-error body) (bad (activity-input-error body))
          :else
          (let [delta   (- (activity-xp duration intensity xpm) (stored-activity-xp act-e))
                tx-data (cond-> [[:db/add act-id :activity/type at-e]
                                 [:db/add act-id :activity/duration (long duration)]
                                 [:db/add act-id :activity/intensity (long intensity)]
                                 [:db/add act-id :activity/start-time (parse-instant startTime)]
                                 (xp-delta-tx db username delta)]
                          note (conj [:db/add act-id :activity/note (str note)]))]
            @(d/transact s/conn tx-data)
            (ok {:id (str act-id) :type type :duration duration :intensity intensity
                 :startTime startTime :note (or note "")})))))))

(defn- handle-delete-activity [req]
  ;; Deleting takes back the XP the activity granted; otherwise "log a 10h
  ;; activity, delete it, repeat" inflates :user/xp (the global leaderboard).
  (with-own-activity req
    (fn [db username act-id act-e]
      @(d/transact s/conn [(xp-delta-tx db username (- (stored-activity-xp act-e)))
                           [:db/retractEntity act-id]])
      (ok {:ok true}))))

;; ===== TRACKING ENTRIES =====

(defn- parse-payload [payload]
  (try
    (if (seq payload) (json/parse-string payload true) {})
    (catch Exception _ {})))

(defn- tracking-entry-dto [db eid]
  (let [e (d/entity db eid)]
    {:id        (str eid)
     :method    (name (:tracking/method e))
     :date      (:tracking/date e)
     :payload   (parse-payload (:tracking/payload e))
     :createdAt (instant->str (:tracking/created-at e))
     :updatedAt (instant->str (:tracking/updated-at e))}))

(defn- tracking-entry-id [db user-id method date]
  (d/q '[:find ?entry .
         :in $ ?user ?method ?date
         :where
         [?entry :tracking/user ?user]
         [?entry :tracking/method ?method]
         [?entry :tracking/date ?date]]
       db user-id method date))

(defn- handle-get-tracking-entries [req]
  (if-let [username (me req)]
    (let [date (get-in req [:query-params "date"] (today-str))]
      (if-not (valid-date-str? date)
        (bad "Invalid date")
        (let [db (ddb)
              u-e (user-e db username)
              ids (d/q '[:find [?entry ...]
                         :in $ ?user ?date
                         :where
                         [?entry :tracking/user ?user]
                         [?entry :tracking/date ?date]]
                       db u-e date)
              sorted (sort-by #(:tracking/updated-at (d/entity db %)) #(compare %2 %1) ids)]
          (ok (mapv #(tracking-entry-dto db %) sorted)))))
    (unauth)))

(defn- handle-save-tracking-entry [req]
  (if-let [username (me req)]
    (let [method (get-in req [:path-params :method])
          method-kw (keyword method)
          {:keys [date payload]} (parse-body req)
          entry-date (or date (today-str))]
      (cond
        (not (contains? tracking-methods method)) (bad "Unknown tracking method")
        (not (valid-date-str? entry-date))        (bad "Invalid date")
        :else
        (let [db (ddb)
              u-e (user-e db username)
              now (Date.)
              payload-json (json/generate-string (or payload {}))
              existing-id (tracking-entry-id db u-e method-kw entry-date)
              entry-id (or existing-id (d/tempid :db.part/user))
              tx-data (cond-> [[:db/add entry-id :tracking/user u-e]
                               [:db/add entry-id :tracking/method method-kw]
                               [:db/add entry-id :tracking/date entry-date]
                               [:db/add entry-id :tracking/payload payload-json]
                               [:db/add entry-id :tracking/updated-at now]]
                        (nil? existing-id) (conj [:db/add entry-id :tracking/created-at now]))
              result @(d/transact s/conn tx-data)
              real-id (if existing-id
                        existing-id
                        (d/resolve-tempid (:db-after result) (:tempids result) entry-id))]
          (ok (tracking-entry-dto (:db-after result) real-id)))))
    (unauth)))

(defn- handle-delete-tracking-entry [req]
  (if-let [username (me req)]
    (let [raw-id (get-in req [:path-params :id])
          entry-id (try (Long/parseLong raw-id) (catch Exception _ nil))]
      (if-not entry-id
        (bad "Invalid id")
        (let [e (d/entity (ddb) entry-id)
              owner (-> e :tracking/user :user/username)]
          (cond
            (nil? owner) (not-found)
            (not= owner username) (jresp 403 {:error "Forbidden"})
            :else (do @(d/transact s/conn [[:db/retractEntity entry-id]])
                      (ok {:ok true}))))))
    (unauth)))

;; ===== STATS =====

(defn- handle-get-stats [req]
  (if-let [username (me req)]
    (let [period-str (get-in req [:query-params "period"] "30")
          period     (try (max 1 (min 365 (Integer/parseInt period-str))) (catch Exception _ 30))
          db         (ddb)
          u-e        (user-e db username)
          zone       (ZoneId/of "Europe/Belgrade")
          cutoff-date (.minusDays (LocalDate/now zone) period)
          cutoff-inst (.toInstant (.atStartOfDay cutoff-date zone))
          ;; Pre-load xp-per-minute for all types
          xpm-map    (into {} (d/q '[:find ?t ?x :where [_ :activity-type/key ?t] [_ :activity-type/xp-per-minute ?x]] db))
          ;; All activities for user
          acts       (d/q '[:find ?t ?dur ?int ?start
                            :in $ ?u
                            :where
                            [?a :activity/user ?u]
                            [?a :activity/type ?at]
                            [?at :activity-type/key ?t]
                            [?a :activity/duration ?dur]
                            [?a :activity/intensity ?int]
                            [?a :activity/start-time ?start]]
                          db u-e)
          recent     (filter #(-> (nth % 3) .toInstant (.isAfter cutoff-inst)) acts)
          date-str-f (fn [act] (.toString (.toLocalDate (.atZone (.toInstant (nth act 3)) zone))))
          xp-for     (fn [[t dur int _]] (long (Math/round (* dur int (get xpm-map t 1.0)))))
          by-date    (group-by date-str-f recent)
          xp-per-day (into (sorted-map) (map (fn [[d as]] [d (reduce + (map xp-for as))]) by-date))
          ;; Activity breakdown by type
          type-breakdown (frequencies (map #(name (first %)) recent))
          ;; All-time total XP (from user entity)
          user-xp    (or (:user/xp (d/entity db u-e)) 0)
          ;; Tracking consistency dates
          tracking-dates (set (d/q '[:find [?date ...] :in $ ?u
                                     :where [?e :tracking/user ?u] [?e :tracking/date ?date]]
                                   db u-e))]
      (ok {:xpPerDay       xp-per-day
           :typeBreakdown  type-breakdown
           :totalXp        user-xp
           :periodXp       (reduce + (vals xp-per-day))
           :totalMinutes   (reduce + (map #(nth % 1) recent))
           :totalActivities (count recent)
           :trackingDates  (vec (sort tracking-dates))
           :period         period}))
    (unauth)))

(defn- handle-get-tracking-range [req]
  (if-let [username (me req)]
    (let [start (get-in req [:query-params "start"])
          end   (get-in req [:query-params "end"])
          db    (ddb)
          u-e   (user-e db username)]
      (cond
        (or (str/blank? start) (str/blank? end)) (bad "start and end required")
        (or (not (valid-date-str? start)) (not (valid-date-str? end))) (bad "Invalid date format")
        :else
        (let [ids (d/q '[:find [?e ...]
                         :in $ ?u ?start ?end
                         :where
                         [?e :tracking/user ?u]
                         [?e :tracking/date ?date]
                         [(>= ?date ?start)]
                         [(<= ?date ?end)]]
                       db u-e start end)]
          (ok (mapv #(tracking-entry-dto db %) (sort-by #(:tracking/date (d/entity db %)) ids))))))
    (unauth)))

;; ===== POSTS / FEED / COMMENTS / SAVED =====
;; Moved to web.posts (routes in posts/routes).

;; ===== PROFILE / FOLLOW =====
;; Moved to web.accounts (profile header, follow, follow requests, privacy).

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
          me-e     (user-e db username)
          ;; blocked (either way) and deactivated accounts never show up
          hidden   (accounts/unreachable-ids db me-e)
          lb-raw   (lb/leaderboard db :all today)
          lb       (->> lb-raw
                        (remove #(contains? hidden (user-e db (:user/username %))))
                        (mapv #(lb-entry->dto db %)))]
      (if (= filter-p "friends")
        (let [me-e    (user-e db username)
              friends (set (map :db/id (:user/follows (d/entity db me-e))))]
          (ok (filterv #(or (= (:username %) username) (friends (user-e db (:username %)))) lb)))
        (ok lb)))
    (unauth)))

;; ===== SEARCH =====

(defn- handle-search [req]
  (let [q  (get-in req [:query-params "q"] "")
        db (ddb)
        me-e (some->> (me req) (user-e db))]
    (if (str/blank? q)
      (ok [])
      (let [q-lower (str/lower-case q)
            ;; people who blocked you (or you blocked) and deactivated
            ;; accounts can't be found; muted accounts can.
            hidden  (accounts/unreachable-ids db me-e)
            all (remove hidden (d/q '[:find [?e ...] :where [?e :user/username]] db))
            matched (filter (fn [eid]
                              (let [u (d/entity db eid)]
                                (or (str/includes? (str/lower-case (or (:user/username u) "")) q-lower)
                                    (str/includes? (str/lower-case (or (:user/display-name u) "")) q-lower))))
                            all)]
        (ok (mapv #(author-dto (d/entity db %)) (take 20 matched)))))))

;; ===== NOTIFICATIONS =====
;; Moved to web.notifications (handlers + routes).

;; ===== TRENDING =====
;; Moved to web.posts.

;; ===== UPLOAD =====

(defn- handle-upload [req]
  ;; Legacy endpoint, implemented on the media storage layer (local disk or S3/R2).
  (media/handle-legacy-upload req))

(defn- handle-serve-upload [req]
  (media/handle-serve-upload req))

;; ===== CONVERSATIONS / DMs =====
;; Moved to web.dm (handlers + routes).

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

(defn- with-typed-id
  "Parses path :id and calls (f db id) only when it names an entity that has
   `attr` (so a user/post id can't be passed as a group/competition/...).
   400 for non-numeric ids, 404 for ids of anything else."
  [req attr f]
  (let [id (parse-id (get-in req [:path-params :id]))
        db (ddb)]
    (cond
      (nil? id) (bad "Invalid id")
      (nil? (get (d/entity db id) attr)) (not-found)
      :else (f db id))))

(defn- handle-get-group [req]
  (with-typed-id req :group/name (fn [db gid] (ok (group-dto db gid)))))

(defn- handle-toggle-group [req]
  (if-let [username (me req)]
    (with-typed-id req :group/name
      (fn [db gid]
        (let [u-e (user-e db username)
              member? (some #(= (:db/id %) u-e) (:group/members (d/entity db gid)))]
          (if member?
            (do @(d/transact s/conn [[:db/retract gid :group/members u-e]])
                (ok {:action "left"}))
            (do @(d/transact s/conn [[:db/add gid :group/members u-e]])
                (ok {:action "joined"}))))))
    (unauth)))

(defn- group-msg-dto [db mid]
  (let [e (d/entity db mid)
        s (d/entity db (-> e :group-message/sender :db/id))]
    {:id (str mid)
     :groupId (some-> e :group-message/group :db/id str)
     :sender (author-dto s)
     :content (:group-message/content e)
     :mediaUrl (:group-message/media-url e)
     :createdAt (instant->str (:group-message/created-at e))}))

(defn- handle-get-group-messages [req]
  (if-let [username (me req)]
    (let [gid (parse-id (get-in req [:path-params :id]))
          db  (ddb)
          u-e (user-e db username)
          g   (when gid (d/entity db gid))]
      (if-not (some #(= (:db/id %) u-e) (:group/members g))
        (jresp 403 {:error "Forbidden"})
        (let [mids (sort (d/q '[:find [?m ...] :in $ ?g :where [?m :group-message/group ?g]] db gid))]
          (ok (mapv #(group-msg-dto db %) mids)))))
    (unauth)))

(defn- handle-send-group-message [req]
  (if-let [username (me req)]
    (let [gid (parse-id (get-in req [:path-params :id]))
          {:keys [content mediaUrl]} (parse-body req)
          db  (ddb)
          u-e (user-e db username)
          g   (when gid (d/entity db gid))]
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
              db2    (:db-after result)
              new-id (d/resolve-tempid db2 (:tempids result) msg-id)
              dto    (group-msg-dto db2 new-id)]
          ;; live push to every member (incl. the sender's other tabs)
          (realtime/publish-all! (keep #(:user/username (d/entity db2 (:db/id %)))
                                       (:group/members (d/entity db2 gid)))
                                 {:type "group:message" :groupId (str gid) :message dto})
          (created dto))))
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
  (with-typed-id req :competition/name (fn [db cid] (ok (comp-dto db cid)))))

(defn- handle-toggle-competition [req]
  (if-let [username (me req)]
    (with-typed-id req :competition/name
      (fn [db cid]
        (let [u-e (user-e db username)
              member? (some #(= (:db/id %) u-e) (:competition/members (d/entity db cid)))]
          (if member?
            (do @(d/transact s/conn [[:db/retract cid :competition/members u-e]])
                (ok {:action "left"}))
            (do @(d/transact s/conn [[:db/add cid :competition/members u-e]])
                (ok {:action "joined"}))))))
    (unauth)))

(defn- handle-join-by-code [req]
  (if-let [username (me req)]
    (let [{:keys [code]} (parse-body req)
          db (ddb)
          u-e (user-e db username)
          c-e (when-not (str/blank? (str code))
                (d/q '[:find ?c . :in $ ?code :where [?c :competition/invite-code ?code]] db (str code)))]
      (if-not c-e
        (not-found)
        (do @(d/transact s/conn [[:db/add c-e :competition/members u-e]])
            (ok (comp-dto (ddb) c-e)))))
    (unauth)))

(defn- handle-competition-leaderboard [req]
  (with-typed-id req :competition/name
    (fn [db cid]
      (let [c       (d/entity db cid)
            viewer  (some->> (me req) (user-e db))
            hidden  (accounts/unreachable-ids db viewer)
            members (remove hidden (map :db/id (:competition/members c)))
            start (or (:competition/start-date c) (Date. 0))
            end   (or (:competition/end-date c) (Date.))
            entries (map (fn [m-e]
                           (let [un (:user/username (d/entity db m-e))
                                 rows (db/get-activities-in-interval db un start end)
                                 xp   (db/calculate-xp-from-rows rows)]
                             {:username un :xp xp :rank 0}))
                         members)
            sorted (sort-by :xp #(compare %2 %1) entries)
            ranked (map-indexed (fn [i e] (assoc e :rank (inc i))) sorted)]
        (ok (vec ranked))))))

(defn- handle-competition-feed
  "Newest 30 posts of the competition's members that the viewer may see
   (audience, archived, private accounts, blocks — same rules as the feed)."
  [req]
  (let [db  (ddb)
        cid (parse-id (get-in req [:path-params :id]))
        c   (when cid (d/entity db cid))]
    (if-not (:competition/name c)
      (not-found)
      (let [u        (some->> (me req) (user-e db))
            ctx      (posts/viewer-ctx db u)
            members  (vec (map :db/id (:competition/members c)))
            rows     (when (seq members)
                       (d/q '[:find ?p ?t :in $ [?a ...] :where [?p :post/author ?a] [?p :post/created-at ?t]]
                            db members))
            pids     (->> rows
                          (sort-by (fn [[p ^Date t]] [(.getTime t) p]) #(compare %2 %1))
                          (map first)
                          (filter #(posts/listable? ctx (d/entity db %)))
                          (take 30))]
        (ok (posts/post-dtos db pids u))))))

;; ===== CHALLENGES =====

(defn- challenge-dto [db eid]
  (let [e (d/entity db eid)
        challenger (d/entity db (-> e :challenge/challenger :db/id))
        target     (d/entity db (-> e :challenge/target :db/id))]
    {:id         (str eid)
     :challenger (author-dto challenger)
     :target     (author-dto target)
     ;; the challenges page reads `challenged`
     :challenged (author-dto target)
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
          t-e  (accounts/find-user db target)]
      (cond
        (or (nil? t-e) (contains? (accounts/unreachable-ids db me-e) t-e)) (not-found)
        (= t-e me-e) (bad "You can't challenge yourself")
        :else
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

(def ^:private challenge-actions {"accept" :active "decline" :declined})

(defn- handle-respond-challenge
  "PUT /api/challenges/:id {action: accept|decline} — only the challenged
   user may answer, and only while the challenge is pending."
  [req]
  (if-let [username (me req)]
    (with-typed-id req :challenge/target
      (fn [db cid]
        (let [c      (d/entity db cid)
              status (get challenge-actions (str (:action (parse-body req))))]
          (cond
            (not= username (-> c :challenge/target :user/username)) (forbidden)
            (nil? status) (bad "action must be accept or decline")
            (not= :pending (or (:challenge/status c) :pending)) (bad "This challenge was already answered")
            :else (do @(d/transact s/conn [[:db/add cid :challenge/status status]])
                      (ok (challenge-dto (ddb) cid)))))))
    (unauth)))

;; ===== RECAP =====

(defn- recap-response [req db uname]
  (let [period (get-in req [:query-params "period"] "week")
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
         :byType by-type})))

(defn- handle-get-recap [req]
  (if-let [username (me req)]
    (let [db      (ddb)
          me-e    (user-e db username)
          owner-e (accounts/find-user db (get-in req [:path-params :username]))]
      (cond
        (or (nil? owner-e) (contains? (accounts/unreachable-ids db me-e) owner-e)) (not-found)
        ;; activity history is as private as the account's posts
        (not (accounts/can-view-posts? db me-e owner-e)) (forbidden)
        :else (recap-response req db (:user/username (d/entity db owner-e)))))
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
  (let [db    (ddb)
        me-e  (some->> (me req) (user-e db))
        u-e   (accounts/find-user db (get-in req [:path-params :username]))
        u     (when u-e (d/entity db u-e))
        uname (:user/username u)]
    (if (or (nil? uname) (contains? (accounts/unreachable-ids db me-e) u-e))
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
          ;; deactivated, blocked and muted accounts' stories are hidden
          hidden  (set (accounts/hidden-author-ids db me-eid))
          visible (conj (set (remove hidden follows)) me-eid)
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
      (let [db      (ddb)
            me-eid  (user-e db un)
            creator (when sid (some-> (d/entity db sid) :story/creator :db/id))]
        (cond
          (nil? creator) (not-found)
          (and (not= creator me-eid)
               (or (not (accounts/follows? db me-eid creator))
                   (contains? (set (accounts/hidden-author-ids db me-eid)) creator)
                   (not (accounts/can-view-posts? db me-eid creator))))
          (not-found)
          :else (do @(d/transact s/conn [[:db/add sid :story/viewed-by me-eid]])
                    (ok {:ok true})))))
    (unauth)))

(defn- handle-delete-story [req]
  (if-let [un (me req)]
    (let [sid (try (Long/parseLong (get-in req [:path-params :id])) (catch Exception _ nil))]
      (if-not sid
        (not-found)
        (let [e (d/entity (ddb) sid)]
          (cond
            (nil? (:story/creator e)) (not-found)
            ;; 403, not 401: the user is logged in, just not the owner
            (not= un (-> e :story/creator :user/username)) (forbidden)
            :else (do @(d/transact s/conn [[:db/retractEntity sid]])
                      (ok {:ok true}))))))
    (unauth)))

;; ===== ROUTES =====

(def core-routes
  [;; auth/profile/follow routes live in accounts/routes
   ["/api/oauth/google"   {:post oauth/handle-google}]
   ["/api/oauth/facebook" {:post oauth/handle-facebook}]

   ["/api/activities"       {:get handle-get-activities :post handle-create-activity}]
   ["/api/activities/:id"   {:put handle-update-activity :delete handle-delete-activity}]
   ["/api/tracking-entries"        {:get handle-get-tracking-entries}]
   ["/api/tracking-entries/range"  {:get handle-get-tracking-range}]
   ["/api/tracking-entries/:method" {:put handle-save-tracking-entry}]
   ["/api/tracking-entries/id/:id" {:delete handle-delete-tracking-entry}]

   ["/api/stats"                   {:get handle-get-stats}]

   ["/api/users/search"     {:get handle-search}]
   ["/api/users/:username/badges" {:get handle-get-badges}]


   ["/api/leaderboard"      {:get handle-get-leaderboard}]

   ["/api/upload"           {:post handle-upload}]
   ["/uploads/:filename"    {:get handle-serve-upload}]

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

;; Each feature area owns its own route vector; keep this list as the only
;; place they are combined.
(def routes
  (vec (concat core-routes
               media/routes
               posts/routes
               accounts/routes
               realtime/routes
               notifications/routes
               dm/routes
               live/routes
               vision/routes)))

;; ===== APP =====

(defn- header [req k] (get-in req [:headers k]))

(defn- strip-port [h]
  (let [h (str/lower-case (str/trim (str h)))]
    (if (str/starts-with? h "[")
      (str/replace h #"(\])(:\d+)?$" "$1")      ; [::1]:3000
      (str/replace h #":\d+$" ""))))

(defn- uri-host [s]
  (try (some-> (java.net.URI. (str s)) .getHost strip-port) (catch Exception _ nil)))

(defn- own-hosts
  "Host names this request was addressed to (ports ignored: nginx's $host
   drops them, and the dev proxy rewrites them)."
  [req]
  (->> (concat (some-> (header req "x-forwarded-host") (str/split #","))
               [(header req "host") (:server-name req)
                (uri-host (System/getenv "APP_BASE_URL"))])
       (remove str/blank?)
       (map strip-port)
       set))

(defn- cross-site-request?
  "True when a browser tells us the request comes from another site. Uses
   Sec-Fetch-Site when present, otherwise the Origin header. Requests with
   neither (curl, tests, older same-origin GETs) are let through."
  [req]
  (let [site   (some-> (header req "sec-fetch-site") str/lower-case)
        origin (header req "origin")]
    (cond
      (#{"cross-site" "same-site"} site) true
      (= "same-origin" site)             false
      (str/blank? origin)                false
      :else (let [h (uri-host origin)]
              (or (nil? h) (not (contains? (own-hosts req) h)))))))

(defn- websocket-upgrade? [req]
  (= "websocket" (some-> (header req "upgrade") str/lower-case)))

(defn- token-auth-request?
  "Bearer-token requests (mobile app, web.tokens) ignore the cookie session,
   and a page on another site can't attach someone's token, so they are not
   CSRF-able and must not be blocked (native/webview clients send odd
   Origins)."
  [req]
  (or (some-> (header req "authorization") str/lower-case (str/starts-with? "bearer "))
      (and (= "/api/ws" (:uri req))
           (some->> (:query-string req) (re-find #"(?:^|&)access_token=[^&]+")))))

(defn wrap-csrf-guard
  "CSRF / cross-site WebSocket hijacking protection. parse-body accepts JSON
   whatever the Content-Type, so a cross-site <form enctype=text/plain> (or a
   no-cors fetch) could otherwise drive state-changing endpoints whenever the
   browser sends the session cookie (same-site sibling domains, browsers that
   ignore SameSite). The Angular app only makes same-origin requests, so it
   is unaffected (multipart uploads included)."
  [handler]
  (fn [req]
    (if (and (str/starts-with? (str (:uri req)) "/api/")
             (or (#{:post :put :patch :delete} (:request-method req))
                 (websocket-upgrade? req))
             (not (token-auth-request? req))
             (cross-site-request? req))
      (jresp 403 {:error "Cross-site request blocked"})
      (handler req))))

(defn- https-request? [req]
  (or (= :https (:scheme req))
      (= "https" (some-> (header req "x-forwarded-proto") (str/split #",") first str/trim str/lower-case))))

(defn- secure-cookie [c]
  (if (and (str/starts-with? c "bb-session=") (not (re-find #"(?i);\s*Secure(;|$)" c)))
    (str c ";Secure")
    c))

(defn wrap-secure-session-cookie
  "Marks the session cookie Secure when the client reached us over HTTPS
   (directly or through nginx, which sets X-Forwarded-Proto). Without it the
   cookie would also be sent over plain http:// requests (e.g. the port-80
   redirect), where it can be sniffed."
  [handler]
  (fn [req]
    (let [resp (handler req)
          cs   (get-in resp [:headers "Set-Cookie"])]
      (if (and cs (https-request? req))
        (assoc-in resp [:headers "Set-Cookie"] (mapv secure-cookie (if (string? cs) [cs] cs)))
        resp))))

(def app
  (-> (ring/ring-handler
       (ring/router routes
                    {:conflicts nil
                     :data {:middleware [params/parameters-middleware
                                         wrap-keyword-params]}})
       (ring/create-default-handler))
      (wrap-multipart-params)
      (accounts/wrap-session-version)
      (tokens/wrap-token-auth)
      (wrap-session {:cookie-name "bb-session"
                     :cookie-attrs {:same-site :lax
                                    :http-only true
                                    :max-age (* 60 60 24 30)}})
      (wrap-secure-session-cookie)
      (wrap-csrf-guard)))

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
  (s/ensure-schema!)
  (when (= "true" (System/getenv "BEBETTER_SEED"))
    (println "[bootstrap] BEBETTER_SEED=true — running reset-db!")
    (s/reset-db! db/get-all-tx-functions))
  (live/end-stale-lives!)
  (start-server)
  @(promise))
