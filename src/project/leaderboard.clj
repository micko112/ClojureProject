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
                      (db/get-all-users db))))


