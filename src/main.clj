(ns main)

(def xp-gained-per-user [130 40 70])

;(println xp-gained-per-user
;)
(defn desc [a b]                                            ; nasao sam na guglu kako se sortira od najveceg ka najmanjem.
  (compare b a))                                            ; sort koristi compare i time obrne mesto manjeg i veceg, desc je samo suprotno

(def most-xp (reduce max xp-gained-per-user))

(println most-xp)

(defn
  leaderboard
  "leaderboard by earned xp"
  [participants-List]
  (sort desc participants-List)
  )

(println (leaderboard xp-gained-per-user))

(def users [{:name "Uros" :xp 130 :level 0}
             {:name "Milan" :xp 40 :level 0}
             {:name "Micko" :xp 70 :level 0}
             {:name "Trener" :xp 2400 :level 0}])

(defn
  leaderboard
  "users Leaderboard by earned XP"
  [participant-list]
  (sort-by :xp desc participant-list))

(println leaderboard users)

(defn lvl-up
  "ako korisnik ima od 0-100xp onda je lvl1, a vise od 100xp onda je lvl 2"
  [useri]
  (reduce < 100 useri)
  )
(def map-level
  (map
    (fn [user]
      (if (< (:xp user) 100)
        (assoc user :level 1) (assoc user :level 2)         ;assoc funkcija dodaje na neki seq key-word i value pair,
        ))
    users))
;(println map-level
;         )

;funkcija koja ce racunati koliko xp treba za svaki level,
;formula ce biti nesto od ovog:
;    25*X*(1+X)
;    40*X*(1+X)
;    50*X*(1+X)

(defn formula-for-level [level]
  (* 25 level (+ level 1))
  )
(def max-level 10)
(def all-levels (vec (range 10)))
(defn xp-needed-to-level-up [vector-levels] (map formula-for-level vector-levels))
(def xp-level-up (xp-needed-to-level-up all-levels))
;(defn xp-needed-to-level-up [vector-levels]   ; reseno je sa jednom funkcijom
;  (map (fn [level] (* 25 level (+ level 1))) vector-levels))

;dobijam koji je lvl ako upisem neki xp
(reduce (fn [lvl-count level]
          (if (> 2400 level) (inc lvl-count) lvl-count) )  all-levels)
;sad mi treba za svakog usera da ucita odjednom
(map  (fn [user] (reduce (fn [lvl-count level]
               (if (> (:xp user) level) (inc lvl-count) lvl-count) )  all-levels)) users)

; pogresna ali da imam
(map (fn [user] (reduce (fn [lvl-count level]
                          (if (> (:xp user) level)
                            (assoc user :level (inc lvl-count))
                            (assoc user :level (lvl-count)))  )  all-levels)) users)
; EVO JE DOBRAAAA
(map (fn [user] (reduce (fn [level-count level]
                          (if (>= (:xp user) level) (inc level-count) level-count ))  0
                        xp-level-up))
     users)

;finalna funkcija koja odredjuje nivoe svih usera
(map (fn [user] (assoc user :level (reduce (fn [level-count level]
                                             (if (>= (:xp user) level) (inc level-count) level-count ))  0
                                           xp-level-up)))
     users)
;
(def users-with-level (map (fn [user] (assoc user :level (reduce (fn [level-count level]
                                                                   (if (>= (:xp user) level) (inc level-count) level-count ))  0
                                                                 xp-level-up)))
                           users))












