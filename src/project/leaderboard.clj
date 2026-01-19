(ns project.leaderboard
  (:require [project.db :as db]
            [datomic.api :as d]
            [project.connection :refer [conn]]
            [project.time :as t]
            [clojure.pprint :refer [print-table]])
  (:import (java.time.temporal TemporalAdjusters)
           (java.util Date)
           (java.time ZonedDateTime LocalDate ZoneId)
           (java.time Instant LocalDate DayOfWeek MonthDay YearMonth ZoneId)))


(defn desc [a b] ; nasao sam na guglu kako se sortira od najveceg ka najmanjem.
  (compare b a))

;leadreboard for all users
; (db/get-all-users (d/db conn))
(defn
  leaderboard
  "users Leaderboard by earned XP"
  [users]
  (sort-by :user/xp desc (map first users)))

(defn leaderboard [db period date]
  (sort-by :user/xp > (map (fn [user]
                             {:user/username (:user/username user)
                              :user/xp (db/xp-per-user db (:user/username user) period date)})
                           (db/get-all-users db)))
    )

(defn leaderboard-rank [db period date]
  (let [users (db/get-all-users db)
        users-with-xp (map (fn [user]
                             {:user/username (:user/username user)
                              :user/xp (db/xp-per-user db (:user/username user) period date)})
                           users)
        sorted-users-with-xp (sort-by :user/xp > users-with-xp)
        ]
    (map-indexed (fn [idx itm] (assoc itm
                                 :rank (inc idx))) sorted-users-with-xp)

    ))

(defn leaderboard-rank-ties [db period date]
  (let [users (db/get-all-users db)
        users-with-xp (map (fn [user]
                             {:user/username (:user/username user)
                              :user/xp (db/xp-per-user db (:user/username user) period date)})
                           users)
        sorted-users-with-xp (sort-by :user/xp > users-with-xp)
        ]

    (loop [users-left sorted-users-with-xp
           result []
           current-rank 1
           prev-xp nil
           same-count 0]
      (if (empty? users-left)
        result
        (let [user (first users-left)
              user-xp (:user/xp user)]
          (if (= user-xp prev-xp)
            (recur (rest users-left)
                   (conj result (assoc user :rank current-rank))
                   current-rank
                   user-xp
                   (inc same-count))
            (let [new-rank (+ current-rank same-count)]
              (recur (rest users-left)
                     (conj result (assoc user :rank new-rank))
                     new-rank
                     user-xp
                     1)
              )
            )
          )
        )
      )
    )
  )

















