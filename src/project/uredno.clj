(ns project.uredno
  (:require [datomic.api :as d]
            [project.db :as db]
            [malli.core :as m]
            [malli.generator :as mg]))

(defn desc [a b] ; nasao sam na guglu kako se sortira od najveceg ka najmanjem.
  (compare b a))

(defn
  leaderboard
  "users Leaderboard by earned XP"
  [participant-list]
  (sort-by :xp desc participant-list))

(defn take-first-n [n vec-of-users] (take n (vec (leaderboard vec-of-users))))

(def activity)