(ns project.db
  (:require [datomic.api :as d]
            [database.schema :as schema]
            [database.seed :as seed-db]
            [clojure.string :as str]
            [project.time :as t]
            [project.validation :as v]
            [project.connection :refer [conn]]
            [malli.core :as m])

  (:import (java.time.temporal TemporalAdjusters)
           (java.util Date)
           (java.time ZonedDateTime LocalDate ZoneId)
           (java.time Instant LocalDate DayOfWeek MonthDay YearMonth ZoneId))

  )

(def db-uri "datomic:dev://localhost:4334/bebetter")


(def db (d/db conn))

(def user-ids (d/q '[:find ?e .
                     :where [?e :user/username]]db))

(defn get-all-users [db] (d/q '[:find (pull ?e [*])
                     :where [?e :user/username]] db))



(defn create-user! [name]
  (v/validate! v/CreateUserInput {:username name})
  @(d/transact conn [{:user/username name
                      :user/xp 0
                      }]))

(defn add-xp [conn db username xp-to-add]
  (let [[e current-xp]
        (first (d/q '[:find ?e ?xp
                      :in $ ?username
                      :where [?e :user/username ?username]
                      [?e :user/xp ?xp]
                      ]
                    db username))
        new-xp (+ current-xp xp-to-add)]
    @(d/transact conn [[:db/add e :user/xp new-xp]])
    ))

(def add-xp-tx {:db/ident :user/add-xp
                :db/fn (d/function
                         '{:lang "clojure"
                          :params [db username xp]
                          :code (let [[e current-xp]
                                      (first (d/q '[:find ?e ?xp
                                                    :in $ ?username
                                                    :where [?e :user/username ?username]
                                                    [?e :user/xp ?xp]
                                                    ] db username))]
                                  [[:db/add e :user/xp (+ current-xp xp)]])})})

(def add-activity-tx {:db/ident :activity/add
                      :db/fn (d/function '{:lang "clojure"
                                           :params [db username activity-type-key duration intensity]
                                           :code (let [
                                                       user-e
                                                       (d/q '[:find ?e .
                                                              :in $ ?username
                                                              :where [?e :user/username ?username]]
                                                            db username)
                                                       [act-type-e xp-per-min]
                                                       (first (d/q '[:find ?e ?xp-per-minute
                                                                     :in $ ?type
                                                                     :where [?e :activity-type/key ?type]
                                                                     [?e :activity-type/xp-per-minute ?xp-per-minute]
                                                                     ] db activity-type-key))
                                                       gained-xp (* duration xp-per-min intensity)

                                                       current-xp (or (:user/xp (d/entity db user-e)) 0)

                                                       new-xp (+ current-xp gained-xp)
                                                       activity-id (d/tempid :db.part/user)]
                                                   [
                                                    {:db/id activity-id
                                                     :activity/user user-e
                                                     :activity/type act-type-e
                                                     :activity/duration duration
                                                     :activity/intensity intensity
                                                     :activity/start-time (java.util.Date.)
                                                     }
                                                    [:db/add user-e :user/xp new-xp
                                                     ]])})})

(defn add-activity! [conn username activity-key duration intensity]
  (v/validate! v/AddActivityInput {:username username
                                   :activity-type activity-key
                                   :duration duration
                                   :intensity intensity})
  @(d/transact conn [[:activity/add username activity-key duration intensity]]))

(def all-tx-functions [add-xp-tx add-activity-tx])


(defn user-activities [username]
  (d/q '[:find ?a-type ?a-duration ?a-intensity ?a-start-time
         :in $ ?username
         :where  [?u :user/username ?username]
         [?a :activity/user ?u]
         [?a :activity/type ?t]
         [?t :activity-type/name ?a-type]
         [?a :activity/intensity ?a-intensity ]
         [?a :activity/start-time ?a-start-time ]
         ] (d/db conn) username))

(defn get-activities-in-interval
  [username start-day end-day]
  (d/q '[:find ?start-time ?type-name ?dur ?int ?xp-per-min
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
       (d/db conn) username start-day end-day))

(defn calculate-xp-from-rows [rows]
  (reduce (fn [total-xp [_ _ dur int xp-per-min]]
            (+ total-xp (* dur int xp-per-min)))
          0
          rows))

(defn daily-xp-per-user [username date]
  (let [{:keys [start-day end-day]} (t/day-interval date)
        rows (get-activities-in-interval username start-day end-day)]
    (calculate-xp-from-rows rows)))

(defn usernames-xp [db] (vec (d/q '[:find ?username ?xp
                                       :where [?u :user/username ?username]
                                                [?u :user/xp ?xp]] db)))


#_(defn get-all-users-daily-xp [db date]
  (let [[username xp] (usernames-xp db)]
    (reduce (fn [acc [userna]]
              (if (> (daily-xp-per-user elm date) 0)
                (conj acc elm) acc))
            [] username)))

(defn get-all-users-daily-xp [db date]
  (reduce (fn [acc [username _]]
            (let [xp (daily-xp-per-user username date)]
              (if (> xp 0)
                (conj acc {:user/username username :user/xp xp})
                acc)))
          [] (usernames-xp db)))

(defn weekly-xp-per-user [username date]
  (let [{:keys [start-day end-day]} (t/week-interval date)
        rows (get-activities-in-interval username start-day end-day)]
    (calculate-xp-from-rows rows)))

(defn get-all-users-weekly-xp [db date]
  (reduce (fn [acc [username _]]
            (let [xp (weekly-xp-per-user username date)]
              (if (> xp 0)
                (conj acc {:user/username username :user/xp xp})
                acc)))
          [] (usernames-xp db)))

(defn monthly-xp-per-user [username date]
  (let [{:keys [start-day end-day]} (t/month-interval date)
        rows (get-activities-in-interval username start-day end-day)]
    (calculate-xp-from-rows rows)))

(defn get-all-users-monthly-xp [db date]
  (reduce (fn [acc [username _]]
            (let [xp (monthly-xp-per-user username date)]
              (if (> xp 0)
                (conj acc {:user/username username :user/xp xp})
                acc)))
          [] (usernames-xp db)))

(defn clean-username! [conn username]
  (let [user (d/pull (d/db conn) "[*]" [:user/username username])
        clean-name (str/trim (:user/username user))] ; str/trim skida sav višak razmaka i novih redova
    @(d/transact conn [{:db/id (:db/id user)
                        :user/username clean-name}])))


