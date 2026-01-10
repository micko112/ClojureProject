(ns project.db
  (:require [datomic.api :as d]
            [database.schema :as schema]
            [database.seed :as seed-db])
  (:import (java.time.temporal TemporalAdjusters)
           (java.util Date)
           (java.time ZonedDateTime LocalDate ZoneId)
           (java.time Instant LocalDate DayOfWeek MonthDay YearMonth ZoneId))

  )

(def db-uri "datomic:dev://localhost:4334/bebetter")
;(d/create-database db-uri)
(def conn (d/connect db-uri))


@(d/transact conn schema/user-schema)
(def db (d/db conn))

(def user-ids (d/q '[:find ?e .
                     :where [?e :user/username]]db))

(defn get-all-users [db] (d/q '[:find (pull ?e [*])
                     :where [?e :user/username]] db))

(defn create-user! [name] @(d/transact conn [{:user/username name
                                          :user/xp 0
                                              }]))
; pokusaj 1

#_(defn add-xp [username xp] @(d/transact conn [(+ xp (d/q '[:find ?xp
                                                     :where [?e :user/username username]
                                                            [?e :user/xp ?xp]
                                                     ] db))]))
; pokusaj 2 sa pomoci jer ne bih znao sam
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
#_(defn add-xp-3 [conn db username xp-to-add]
  (let [[e current-xp]
        (first (d/q '[:find ?e ?xp
                      :in $ ?username
                      :where [?e :user/username ?username]
                      [?e :user/xp ?xp]] db ))]))
#_(defn add-xp-4 [conn db username xp-to-add]
  (let [[e current-xp]
        (d/q)]))
#_(d/q '[:find ?e ?xp
       :in $ ?username
       :where [?e :user/username "Micko"]
       [?e :user/xp ?xp]
       ]
     db)

; Transakciona funckija
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

;@(d/transact conn [add-xp-tx])
;@(d/transact conn [[:user/add-xp "Micko" 40]])



;@(d/transact conn schema/activity-schema)

(def db (d/db conn))
;@(d/transact conn schema/activity-type-schema)
;@(d/transact conn seed-db/initial-type-activities)
;@(d/transact conn seed-db/users)

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
                                                     :activity/start-time (Date.)
                                                     }
                                                    [:db/add user-e :user/xp new-xp
                                                     ]])})})

@(d/transact conn [add-activity-tx])
;@(d/transact conn [[:activity/add "Micko" :training 60 3 (java.util.Date.)]])
;@(d/transact conn [[:activity/add "Micko" :training 60 3 ]])
;@(d/transact conn [[:activity/add "Micko" :study 60 3 ]])
(defn user-activities [username] (d/q '[:find ?a-type ?a-duration ?a-intensity ?a-start-time
                                        :in $ ?username
                                        :where  [?u :user/username ?username]
                                        [?a :activity/user ?u]
                                        [?a :activity/type ?t]
                                        [?t :activity-type/name ?a-type]
                                        [?a :activity/duration ?a-duration]
                                        [?a :activity/intensity ?a-intensity ]
                                        [?a :activity/start-time ?a-start-time ]
                                        ] (d/db conn) username))

;DAILY FUNCTIONS ------------------------------------
; chatgpt pomoc za datume i vreme
(def zone (ZoneId/of "Europe/Belgrade"))

(defn day-interval [^LocalDate date]
  (let [start (.atStartOfDay date zone)
        end   (.plusDays start 1)]
    {:start-day (Date/from (.toInstant start))
     :end-day   (Date/from (.toInstant end))}))

(day-interval (LocalDate/now))

(defn daily-activities-by-user [username date]
  (let [{:keys [start-day end-day]} ( day-interval date)]
    (d/q '[:find ?a-start-time ?a-type ?a-duration ?a-intensity
           :in $ ?username ?start ?end
           :where [?u :user/username ?username]
           [?a :activity/user ?u]
           [?a :activity/type ?t]
           [?t :activity-type/name ?a-type]
           [?a :activity/duration ?a-duration]
           [(>= ?a-start-time ?start)]
           [(< ?a-start-time ?end)]
           [?a :activity/intensity ?a-intensity ]
           [?a :activity/start-time ?a-start-time ]
           ]
         (d/db conn) username start-day end-day )
    )
  )

(defn daily-xp-per-user [username date]
  (let [{:keys [start-day end-day]} (day-interval date)
        rows (d/q '[:find ?a-dur ?a-int ?xp-per-min
                                           :in $ ?username ?start ?end
                    :where
                                           [?u :user/username ?username]
                                           [?a :activity/user ?u]
                                           [?a :activity/type ?t]
                                           [?t :activity-type/key ?a-type-key]
                                           [?t :activity-type/xp-per-minute ?xp-per-min]
                                           [?a :activity/duration ?a-dur]
                                           [?a :activity/intensity ?a-int]
                                           [?a :activity/start-time ?a-start-time]
                                           [(>= ?a-start-time ?start)]
                                           [(< ?a-start-time ?end)]
                                           ]
                                         (d/db conn) username start-day end-day)]
    (reduce (fn [sum [dur int xp-by-min]] (+ (* dur int xp-by-min) sum)) 0 rows)
    ))

; WEEKLY FUNCTIONS ---------------------------------------------
(defn week-interval [^LocalDate date]
  (let [start (.with date (TemporalAdjusters/previousOrSame DayOfWeek/MONDAY))
        start-zdt (.atStartOfDay start  zone)
        end-zdt (.plusWeeks start-zdt 1)
        ]
    {:start-day (Date/from (.toInstant start-zdt))
     :end-day (Date/from (.toInstant end-zdt))}))

(defn weekly-activities-by-user [username date]
  (let [{:keys [start-day end-day]} (week-interval date)]
    (d/q '[:find ?a ?username ?t-key ?name ?duration ?intensity
           :in $ ?username ?start ?end
           :where [?u :user/username ?username]
           [?a :activity/user ?u]
           [?a :activity/type ?t]
           [?t :activity-type/name ?name]
           [?t :activity-type/key ?t-key]
           [?a :activity/duration ?duration]
           [?a :activity/intensity ?intensity]
           [?a :activity/start-time ?start-time]
           [(>= ?start-time ?start)]
           [(< ?start-time ?end)]
           ]
      (d/db conn) username start-day end-day)))

; Ne stima jer d/q vraca SET Sto znaci da ako imamo dva ista treninga, on racuna samo jedan,
; dodajemo id jer je on uvek razlicit
(defn weekly-xp-per-user [username date]
  (let [{:keys [start-day end-day]} (week-interval date)
        rows (d/q '[:find ?a ?dur ?int ?xp-min
                    :in $ ?username ?start ?end
                    :where
                    [?u :user/username ?username]
                    [?a :activity/user ?u]
                    [?a :activity/type ?t]
                    [?t :activity-type/key ?t-key]
                    [?t :activity-type/xp-per-minute ?xp-min]
                    [?a :activity/duration ?dur]
                    [?a :activity/intensity ?int]
                    [?a :activity/start-time ?start-time]
                    [(>= ?start-time ?start)]
                    [(< ?start-time ?end)]] (d/db conn) username start-day end-day)
        ]
    (reduce (fn [sum [_ dur int xp]] (+ (* dur int xp) sum)) 0 ; linija _ znaci da ignorisemo id
            rows)

    )
  )

;---------- MONTH

(defn month-interval [^LocalDate date]
  (let [ym (YearMonth/of(.getYear date) (.getMonthValue date))
        start (.atDay ym 1)
        start-zdt (.atStartOfDay start zone)
        end (.atDay ym (.lengthOfMonth ym))
        end-zdt (.plusDays (.atStartOfDay end zone) 1)]
    {:start-day (Date/from (.toInstant start-zdt))
     :end-day (Date/from (.toInstant end-zdt))
     }
    ))

(defn monthly-xp-per-user [username date]
  (let [{:keys [start-day end-day]} (month-interval date)
        rows (d/q '[:find ?a ?dur ?int ?xp-min
                    :in $ ?username ?start ?end
                    :where
                    [?u :user/username ?username]
                    [?a :activity/user ?u]
                    [?a :activity/type ?t]
                    [?t :activity-type/key ?t-key]
                    [?t :activity-type/xp-per-minute ?xp-min]
                    [?a :activity/duration ?dur]
                    [?a :activity/intensity ?int]
                    [?a :activity/start-time ?start-time]
                    [(>= ?start-time ?start)]
                    [(< ?start-time ?end)]] (d/db conn) username start-day end-day)
        ]
    (reduce (fn [sum [_ dur int xp]] (+ (* dur int xp) sum)) 0 ; linija _ znaci da ignorisemo id
            rows)
    )
  )



