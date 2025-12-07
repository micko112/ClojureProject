(ns uredno)

(defn desc [a b] ; nasao sam na guglu kako se sortira od najveceg ka najmanjem.
  (compare b a))

(def users [{:name "Uros" :xp 130 :level 0}
            {:name "Milan" :xp 40 :level 0}
            {:name "Micko" :xp 70 :level 0}
            {:name "Trener" :xp 2400 :level 0}])

(defn formula-for-level [level]
  (* 25 level (+ level 1))
  )

(def all-levels (vec (range 1 10)))

(defn xp-needed-to-level-up [vector-levels]
  (map formula-for-level vector-levels))

(def xp-level-up
  (xp-needed-to-level-up all-levels))

(defn define-users-levels
  [list-users xp-for-levels]
  (map (fn [user]
         (assoc user :level
                     (reduce (fn [level-count level]
                               (if (>= (:xp user) level)
                                 (inc level-count) level-count ))
                             0
                             xp-for-levels)))
       list-users))
(println (define-users-levels users xp-level-up)
         )
(def users (vec (define-users-levels users xp-level-up)))
(defn
  leaderboard
  "users Leaderboard by earned XP"
  [participant-list]
  (sort-by :xp desc participant-list))
(println (leaderboard users))