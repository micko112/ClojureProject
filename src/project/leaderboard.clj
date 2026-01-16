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


(defn
  leaderboard-daily
  "DAILY - users Leaderboard by earned XP"
  [db date]
  (print-table
    (sort-by :user/xp > (db/get-all-users-daily-xp db date))))

(defn prettify-leaderboard [users]
  (map-indexed
    (fn [idx user]
      {:rank (inc idx)
       :username (:user/username user)
       :xp (:user/xp user)})
    users))

(defn
  leaderboard-weekly
  "WEEKLY - users leaderboard by earned xp"
  [db date]
  (print-table
    (sort-by :user/xp > (db/get-all-users-weekly-xp db date))))

(defn
  leaderboard-monthly
  "MONTHLY - users leaderboard by earned xp"
  [db date]
  (print-table
    (sort-by :user/xp > (db/get-all-users-monthly-xp db date))))
(defn
  leaderboard-all-time
  "ALL TIME LEADERBOARD"
  [db]
  (print-table
    (sort-by :user/xp > (db/get-all-users-all-time-xp db))))