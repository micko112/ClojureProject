(ns main)

(def xp-gained-per-user '(130 40 70))

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
  (sort desc participants-List))
(println(leaderboard xp-gained-per-user))