(ns project.db
  (:require [datomic.api :as d]
            [clojure.string :as str]
            [project.time :as t]
            [project.validation :as v]
            [project.system :as s]
            [project.connection :as conn])
  (:import (java.time LocalDate)))

;; ── Users ────────────────────────────────────────────────────────────────────

(defn create-user! [conn name]
  (v/validate! v/CreateUserInput {:username name})
  @(d/transact conn [{:user/username name
                      :user/xp 0}]))

(defn user-ids [db] (d/q '[:find ?e .
                           :where [?e :user/username]] db))

(defn get-all-users [db] (map first (d/q '[:find (pull ?e [*])
                                           :where [?e :user/username]] db)))

(defn get-user-by-name [db username]
  (let [result (d/pull db "[*]" [:user/username username])]
    (if (:db/id result) result (throw (ex-info "User not found" {:user/username username})))))

;; ── Transaction functions ─────────────────────────────────────────────────────

(def add-xp-tx {:db/ident :user/add-xp
                :db/fn (d/function
                        '{:lang "clojure"
                          :params [db username xp]
                          :code (let [[e current-xp]
                                      (first (d/q '[:find ?e ?xp
                                                    :in $ ?username
                                                    :where [?e :user/username ?username]
                                                    [?e :user/xp ?xp]] db username))]
                                  [[:db/add e :user/xp (+ current-xp xp)]])})})

(def add-activity-tx
  {:db/ident :activity/add
   :db/fn (d/function
           '{:lang "clojure"
             :params [db username activity-type-key duration intensity start-time]
             :code (let [user-e
                         (d/q '[:find ?e .
                                :in $ ?username
                                :where [?e :user/username ?username]]
                              db username)
                         [act-type-e xp-per-min]
                         (first (d/q '[:find ?e ?xp-per-minute
                                       :in $ ?type
                                       :where [?e :activity-type/key ?type]
                                       [?e :activity-type/xp-per-minute ?xp-per-minute]] db activity-type-key))
                         gained-xp (* duration xp-per-min intensity)
                         current-xp (or (:user/xp (d/entity db user-e)) 0)
                         new-xp (+ current-xp gained-xp)]
                     [{:db/id (d/tempid :db.part/user)
                       :activity/user user-e
                       :activity/type act-type-e
                       :activity/duration duration
                       :activity/intensity intensity
                       :activity/start-time start-time}
                      [:db/add user-e :user/xp new-xp]])})})

(def get-all-tx-functions [add-xp-tx add-activity-tx])

;; ── Activities ───────────────────────────────────────────────────────────────

(defn add-activity! [conn username activity-key duration intensity start-time]
  (v/validate! v/AddActivityInput {:username username
                                   :activity-type activity-key
                                   :duration duration
                                   :intensity intensity
                                   :start-time start-time})
  @(d/transact conn [[:activity/add username activity-key duration intensity start-time]]))

;; Returns [eid start-time type-name dur int xp-per-min]
(defn get-user-activities [db username]
  (sort-by second
           (d/q '[:find ?a ?a-start-time ?a-type ?a-duration ?a-intensity ?xp-per-min
                  :in $ ?username
                  :where [?u :user/username ?username]
                  [?a :activity/user ?u]
                  [?a :activity/type ?t]
                  [?t :activity-type/name ?a-type]
                  [?a :activity/intensity ?a-intensity]
                  [?a :activity/duration ?a-duration]
                  [?t :activity-type/xp-per-minute ?xp-per-min]
                  [?a :activity/start-time ?a-start-time]] db username)))

;; Returns [eid start-time type-name dur int xp-per-min]
(defn get-activities-in-interval [db username start-day end-day]
  (d/q '[:find ?a ?start-time ?type-name ?dur ?int ?xp-per-min
         :in $ ?username ?start ?end
         :where
         [?u :user/username ?username]
         [?a :activity/user ?u]
         [?a :activity/start-time ?start-time]
         [?a :activity/duration ?dur]
         [?a :activity/intensity ?int]
         [?a :activity/type ?t]
         [?t :activity-type/name ?type-name]
         [?t :activity-type/xp-per-minute ?xp-per-min]
         [(>= ?start-time ?start)]
         [(< ?start-time ?end)]]
       db username start-day end-day))

;; Rows format: [eid start-time type-name dur int xp-per-min]
(defn calculate-xp-from-rows [rows]
  (reduce (fn [total-xp [_ _ _ dur int xp-per-min]]
            (+ total-xp (* dur int xp-per-min)))
          0
          rows))

(def period-interval
  {:daily   t/day-interval
   :weekly  t/week-interval
   :monthly t/month-interval
   :all     nil})

(defn usernames-xp [db] (vec (d/q '[:find ?username ?xp
                                    :where [?u :user/username ?username]
                                    [?u :user/xp ?xp]] db)))

(defn xp-per-user [db username period date]
  (if (= period :all)
    (:user/xp (get-user-by-name db username))
    (let [{:keys [start-day end-day]} ((get period-interval period) date)
          rows (get-activities-in-interval db username start-day end-day)]
      (calculate-xp-from-rows rows))))

(defn report-daily-in-period [db username date]
  (let [{:keys [start-day end-day]} (t/day-interval date)
        rows (get-activities-in-interval db username start-day end-day)
        sorted-rows (sort-by second rows)
        activities (mapv (fn [[eid start-time a-type dur int xp-per-min]]
                           {:id eid
                            :time (.toLocalTime (t/instant->local start-time))
                            :type a-type
                            :duration dur
                            :intensity int
                            :xp (* dur int xp-per-min)})
                         sorted-rows)
        total-xp (calculate-xp-from-rows rows)]
    {:date date
     :username username
     :activities activities
     :total-xp total-xp}))

(defn delete-activity! [conn db activity-eid]
  (let [activity      (d/entity db activity-eid)
        user-entity   (:activity/user activity)
        user-eid      (:db/id user-entity)
        act-type      (:activity/type activity)
        xp-per-min    (:activity-type/xp-per-minute act-type)
        duration      (:activity/duration activity)
        intensity     (:activity/intensity activity)
        xp-lost       (* duration intensity xp-per-min)
        current-xp    (:user/xp (d/entity db user-eid))
        new-xp        (max 0 (- current-xp xp-lost))]
    @(d/transact conn [[:db/retractEntity activity-eid]
                       [:db/add user-eid :user/xp new-xp]])))

;; Returns [username start-time type-name dur int xp-per-min]
(defn get-feed-activities [db start-day end-day]
  (sort-by second
           (d/q '[:find ?username ?start-time ?type-name ?dur ?int ?xp-per-min
                  :in $ ?start ?end
                  :where
                  [?u :user/username ?username]
                  [?a :activity/user ?u]
                  [?a :activity/start-time ?start-time]
                  [?a :activity/duration ?dur]
                  [?a :activity/intensity ?int]
                  [?a :activity/type ?t]
                  [?t :activity-type/name ?type-name]
                  [?t :activity-type/xp-per-minute ?xp-per-min]
                  [(>= ?start-time ?start)]
                  [(< ?start-time ?end)]]
                db start-day end-day)))

(defn get-activity-types [db]
  (map (fn [[k type-name xpm]]
         {:key (name k) :name type-name :xpPerMinute xpm})
       (d/q '[:find ?key ?name ?xpm
              :where [?e :activity-type/key ?key]
              [?e :activity-type/name ?name]
              [?e :activity-type/xp-per-minute ?xpm]] db)))

;; ── Reactions ────────────────────────────────────────────────────────────────

;; Returns #{[from-name to-name emoji] ...}
(defn get-reactions-for-date [db date-str]
  (d/q '[:find ?from-name ?to-name ?emoji
         :in $ ?date
         :where
         [?r :reaction/date ?date]
         [?r :reaction/from-user ?from]
         [?from :user/username ?from-name]
         [?r :reaction/to-user ?to]
         [?to :user/username ?to-name]
         [?r :reaction/emoji ?emoji]]
       db date-str))

(defn get-reactions-for-period [db start-date-str end-date-str]
  "Reactions za period - vraca sve reakcije ciji date je >= start i < end"
  (d/q '[:find ?from-name ?to-name ?date ?emoji
         :in $ ?start ?end
         :where
         [?r :reaction/date ?date]
         [(>= ?date ?start)]
         [(< ?date ?end)]
         [?r :reaction/from-user ?from]
         [?from :user/username ?from-name]
         [?r :reaction/to-user ?to]
         [?to :user/username ?to-name]
         [?r :reaction/emoji ?emoji]]
       db start-date-str end-date-str))

(defn find-reaction [db from-username to-username date-str emoji]
  (d/q '[:find ?r .
         :in $ ?from-name ?to-name ?date ?emoji
         :where
         [?from :user/username ?from-name]
         [?to :user/username ?to-name]
         [?r :reaction/from-user ?from]
         [?r :reaction/to-user ?to]
         [?r :reaction/date ?date]
         [?r :reaction/emoji ?emoji]]
       db from-username to-username date-str emoji))

(defn toggle-reaction! [conn db from-username to-username date-str emoji]
  (let [existing (find-reaction db from-username to-username date-str emoji)]
    (if existing
      (do @(d/transact conn [[:db/retractEntity existing]])
          :removed)
      (let [from-id (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] db from-username)
            to-id   (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] db to-username)]
        @(d/transact conn [{:reaction/from-user from-id
                            :reaction/to-user   to-id
                            :reaction/date      date-str
                            :reaction/emoji     emoji}])
        :added))))

;; ── Stats ────────────────────────────────────────────────────────────────────

(defn calculate-streak [db username]
  "Broj uzastopnih dana sa aktivnoscu, racunajuci od danas unazad."
  (loop [date  (LocalDate/now)
         streak 0]
    (let [{:keys [start-day end-day]} (t/day-interval date)
          rows (get-activities-in-interval db username start-day end-day)]
      (if (seq rows)
        (recur (.minusDays date 1) (inc streak))
        streak))))

;; Returns {type-name total-xp}
(defn get-xp-by-type [db username start-day end-day]
  (let [rows (get-activities-in-interval db username start-day end-day)]
    (->> rows
         (group-by #(nth % 2))  ; group by type-name
         (map (fn [[type-name type-rows]]
                [type-name (calculate-xp-from-rows type-rows)]))
         (into {}))))

(defn count-active-days [db username start-day end-day]
  (let [rows (get-activities-in-interval db username start-day end-day)]
    (->> rows
         (map (fn [[_ start-time _ _ _ _]]
                (str (.toLocalDate (t/instant->local start-time)))))
         set
         count)))

;; ── Posts ─────────────────────────────────────────────────────────────────────

(defn create-post! [conn db username content activity-tag]
  (let [user-id (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] db username)
        tx-data (cond-> {:db/id          "new-post"
                         :post/author     user-id
                         :post/content    content
                         :post/created-at (java.util.Date.)}
                  (seq activity-tag) (assoc :post/activity-tag activity-tag))]
    @(d/transact conn [tx-data])))

(defn get-recent-posts
  ([db limit] (get-recent-posts db limit nil))
  ([db limit username]
   (->> (if username
          (d/q '[:find (pull ?p [* {:post/author   [:user/username]
                                    :post/liked-by [:user/username]}])
                 :in $ ?uname
                 :where [?p :post/content]
                        [?p :post/author ?a]
                        [?a :user/username ?uname]]
               db username)
          (d/q '[:find (pull ?p [* {:post/author   [:user/username]
                                    :post/liked-by [:user/username]}])
                 :where [?p :post/content]]
               db))
        (map first)
        (sort-by :post/created-at #(compare %2 %1))
        (take limit))))

(defn toggle-post-like! [conn db post-id username]
  (let [user-id  (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] db username)
        liked-by (set (map :db/id (:post/liked-by (d/entity db post-id))))]
    (if (contains? liked-by user-id)
      (do @(d/transact conn [[:db/retract post-id :post/liked-by user-id]])
          :removed)
      (do @(d/transact conn [[:db/add post-id :post/liked-by user-id]])
          :added))))
