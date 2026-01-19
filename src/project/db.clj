(ns project.db
  (:require [datomic.api :as d]
            [clojure.string :as str]
            [project.time :as t]
            [project.validation :as v]
            [project.system :refer [conn]]
            )
  (:import (java.time LocalDate)))


(defn create-user! [conn name]
  (v/validate! v/CreateUserInput {:username name})
  @(d/transact conn [{:user/username name
                      :user/xp 0
                      }]))

(defn add-activity! [conn username activity-key duration intensity]
  (v/validate! v/AddActivityInput {:username username
                                   :activity-type activity-key
                                   :duration duration
                                   :intensity intensity})
  @(d/transact conn [[:activity/add username activity-key duration intensity]]))


(defn user-ids [db] (d/q '[:find ?e .
                     :where [?e :user/username]] db))

(defn get-all-users [db] (map first (d/q '[:find (pull ?e [*])
                     :where [?e :user/username]] db)))

(defn get-user-by-name [db username]
  (let [result (d/pull db "[*]" [:user/username username])]
    (if (:db/id result) result (throw (ex-info "User not found" {:user/username username})  ))
    ))

(defn get-user-activities [db username]
  (d/q '[:find ?a-start-time ?a-type ?a-duration ?a-intensity ?xp-per-min
         :in $ ?username
         :where  [?u :user/username ?username]
         [?a :activity/user ?u]
         [?a :activity/type ?t]
         [?t :activity-type/name ?a-type]
         [?a :activity/intensity ?a-intensity ]
         [?a :activity/duration ?a-duration]
         [?t :activity-type/xp-per-minute ?xp-per-min]
         [?a :activity/start-time ?a-start-time ]
         ] db username))

(defn get-activities-in-interval
  [db username start-day end-day]
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
       db username start-day end-day))

(defn calculate-xp-from-rows [rows]
  (reduce (fn [total-xp [_ _ dur int xp-per-min]]
            (+ total-xp (* dur int xp-per-min)))
          0
          rows))

(def period-interval
  {:daily t/day-interval
   :weekly t/week-interval
   :monthly t/month-interval
   :all     nil})

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

(def add-activity-tx
  {:db/ident :activity/add
   :db/fn (d/function
            '{:lang "clojure"
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

(def get-all-tx-functions [add-xp-tx add-activity-tx])

(defn usernames-xp [db] (vec (d/q '[:find ?username ?xp
                                    :where [?u :user/username ?username]
                                    [?u :user/xp ?xp]] db)))

(defn xp-per-user [db username period date]
  ; slucaj kad je samo all
  (if (= period :all)
    (:user/xp (get-user-by-name db username))
    ;---------------------
    (let [{:keys [start-day end-day]} ((get period-interval period) date)
          rows (get-activities-in-interval db username start-day end-day)]
                        (calculate-xp-from-rows rows))))

(defn report-daily-in-period [db username date]

  ;total xp u danu
  (let [{:keys [start-day end-day]} ((get period-interval :daily) date)
        rows (get-activities-in-interval db username start-day end-day)
        activities-xp (map (fn [[start-time a-type dur int xp-per-min]]
                               {:activity/time (.toLocalTime (t/instant->local start-time))
                                :activity/type a-type
                                :activity/duration dur
                                :activity/intensity int
                                :activity/xp (* dur int xp-per-min)})rows)
        total-xp (calculate-xp-from-rows rows)]

    {
     :date date
     :username username
     :activities activities-xp
     :total-xp total-xp
     }))
