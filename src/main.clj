(ns main)

(def xp-gained-per-user [130 40 70])

;(println xp-gained-per-user
;)
(defn desc [a b] ; nasao sam na guglu kako se sortira od najveceg ka najmanjem.
  (compare b a)) ; sort koristi compare i time obrne mesto manjeg i veceg, desc je samo suprotno

(def most-xp (reduce max xp-gained-per-user))

(println most-xp)

(defn
  leaderboard
  "leaderboard by earned xp"
  [participants-List]
  (sort desc participants-List)
  )

(println(leaderboard xp-gained-per-user))

(def users [{:name "Uros" :xp 130 }
            {:name "Milan" :xp 40}
            {:name "Micko" :xp 70}])
(defn
  leaderboard
  "users Leaderboard by earned XP"
  [participant-list]
  (sort-by :xp desc participant-list))

(println leaderboard users)