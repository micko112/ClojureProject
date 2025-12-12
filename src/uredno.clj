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

(defn filter-by-level [level] (reduce (fn [acc user]
                                        (if (= (:level user) level) (conj acc user) acc)) [] users))


(def vec-set-levels (vec (sort (set ( map (fn [user] (:level user) )users)))))

(defn users-by-level [vec-set-levels users]
  (map (fn [level-sorted]
         (reduce (fn [acc user]
                   (if (= (:level user) level-sorted)(conj acc user) acc) )
                 [] users)) vec-set-levels))

(users-by-level vec-set-levels users)

(defn make-user [name]
  {:name name
   :xp 0
   :level 0})

(make-user "Micko")
(make-user "Milan")
(make-user "Uros")
(make-user "Trener")
(def micko (make-user "Micko"))
(defn add-xp [user xp] (update user :xp + xp))
(def micko (add-xp micko 40))