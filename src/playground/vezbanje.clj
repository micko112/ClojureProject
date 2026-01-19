(ns playground.vezbanje
  (:require [datomic.api :as db ]))

(comment (def xp-gained-per-user [130 40 70])

;(println xp-gained-per-user
;)
(defn desc [a b] ; nasao sam na guglu kako se sortira od najveceg ka najmanjem.
  (compare b a)) ; sort koristi compare i time obrne mesto manjeg i veceg, desc je samo suprotno

(def most-xp (reduce max xp-gained-per-user))

#_(println most-xp)

; stara leaderboard fun
;(defn
;  leaderboard
;  "leaderboard by earned xp"
;  [participants-List]
;  (sort desc participants-List)
;  )



(def users [{:name "Uros" :xp 130 :level 0}
             {:name "Milan" :xp 40 :level 0}
             {:name "Micko" :xp 70 :level 0}
             {:name "Trener" :xp 2400 :level 0}])

(defn
  leaderboard
  "users Leaderboard by earned XP"
  [participant-list]
  (sort-by :xp desc participant-list))

#_(println (leaderboard users))

(defn lvl-up
  "ako korisnik ima od 0-100xp onda je lvl1, a vise od 100xp onda je lvl 2"
  [useri]
  (reduce < 100 useri)
  )
(def map-level
  (map
    (fn [user]
      (if (< (:xp user) 100)
        (assoc user :level 1) (assoc user :level 2)
         ;assoc funkcija dodaje na neki seq key-word i value pair,
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
(def all-levels (vec (range 1 10)))
(defn xp-needed-to-level-up [vector-levels] (map formula-for-level vector-levels))
(def xp-level-up (xp-needed-to-level-up all-levels))
;(defn xp-needed-to-level-up [vector-levels]   ; reseno je sa jednom funkcijom
;  (map (fn [level] (* 25 level (+ level 1))) vector-levels))

;dobijam koji je lvl ako upisem neki xp
(reduce (fn [lvl-count level]
          (if (> 2400 level) (inc lvl-count) lvl-count) )  all-levels)
;sad mi treba za svakog usera da ucita odjednom
#_(map  (fn [user] (reduce (fn [lvl-count level]
               (if (> (:xp user) level) (inc lvl-count) lvl-count) )  all-levels)) users)

; pogresna ali da imam
#_(map (fn [user] (reduce (fn [lvl-count level]
                          (if (> (:xp user) level)
                            (assoc user :level (inc lvl-count))
                            (assoc user :level (lvl-count)))  )  all-levels)) users)
; EVO JE DOBRAAAA
#_(map (fn [user] (reduce (fn [level-count level]
                          (if (>= (:xp user) level) (inc level-count) level-count ))  0
                        xp-level-up))
     users)

;finalna funkcija koja odredjuje nivoe svih usera
#_(map (fn [user] (assoc user :level (reduce (fn [level-count level]
                                             (if (>= (:xp user) level) (inc level-count) level-count ))  0
                                           xp-level-up)))
     users)
; nova lista usersa koji imaju izracunat level
(def users-with-level
  (map (fn [user]
         (assoc user :level
                     (reduce (fn [level-count level]
                               (if (>= (:xp user) level)
                                 (inc level-count) level-count ))
                             0
                             xp-level-up)))
                           users))
; funckija koja odredjuje levele svih usera
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
#_(println (define-users-levels users xp-level-up)
         )

;filter funkcija da vrati igrace koji su odredjeni level
; na primer sve igrace koji su level 1

#_(map (fn [user] (if (= (:level user) 1) (conj users user) (println "nije usao u listu")) )
     users)

#_(map (fn [user]
       (reduce (fn [acc elm]
                 (if (= (:level user) acc))) all-levels))
     users)
; ova vraca ko je level 1
#_(map (fn [user]
       (reduce (fn [level elm]
                 (if (= (:level user) level) (println user) (println "ja nisam level 1" elm))) all-levels))
     users)
; FILTRIRA PO LEVELU
(defn filter-by-level [level] (reduce (fn [acc user]
          (if (= (:level user) level) (conj acc user) acc)) [] users))
; filtrira po duzini stringa
#_(reduce (fn [acc user]
          (if (< (count (:name user)) 5)
            (conj acc user) acc))
        [] users)

(def vec-levels
  (vec (sort( map (fn [user] (:level user) )users))) )

(def set-levels
  (vector (set (sort( map (fn [user] (:level user) )users)))) )

(def vec-set-levels (vec (sort (set ( map (fn [user] (:level user) )users)))))

#_(map (fn [level-sorted] (reduce (fn [acc user]
                                  (if (= (:level user) level-sorted)(conj acc user) acc) )
                                [] users)) set-levels)
(defn make-user [name]
  {:name name
   :xp 0
   :level 0})

(comment
  (make-user "Micko")
(make-user "Milan")
(make-user "Uros")
(make-user "Trener")
  )

(defn add-xp [user xp] (update user :xp + xp))

(defn dodaj-xp [user xp] (map (fn [name ]
                                (if (= (:name user) name)
                                  (add-xp user xp) user)) user))

#_(def micko (add-xp micko 40))

(defn need-for-level-up [user level]
  (first ()))
(defn next-level [xp] (first (reduce (fn [acc elm]
                (if (< xp elm) (conj acc elm) acc)) [] xp-level-up)))
(defn remaining-xp-for-level-up [xp] (- (next-level xp) xp))


   (defn take-first-100 [leaderboard] take 100 leaderboard  )


         (def raw-users [{:name "Uros" :xp 130 :level 0}
                         {:name "Milan" :xp 40 :level 0}
                         {:name "Micko" :xp 70 :level 0}
                         {:name "Trener" :xp 2400 :level 0}])

         (defn formula-for-level [level]
           (* 25 level (+ level 1))
           )

         (def all-levels (vec (range 1 10)))


         )
(defn xp-needed-to-level-up [vector-levels]
  (vec(map formula-for-level vector-levels)))

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

(def users (vec (define-users-levels raw-users xp-level-up)))

(defn filter-by-level [users level] (reduce (fn [acc user]
                                              (if (= (:level user) level) (conj acc user) acc)) [] users))

(defn filter-by-level-with-into [level users] (into []
                                                    (comp (filter #(= (:level %) level))
                                                          (map :name)  )
                                                    users))

(defn vec-set-levels [users] (vec (sort (set ( map (fn [user] (:level user) )users)))))

(defn users-by-level [levels users]
  (map (fn [level-sorted]
         (reduce (fn [acc user]
                   (if (= (:level user) level-sorted)(conj acc user) acc) )
                 [] users)) levels))

;(users-by-level vec-set-levels users)

(defn make-user [name]
  {:name name
   :xp 0
   :level 0})
(defn add-xp [user xp]
  (update user :xp + xp))

(comment
  (vec-set-levels users)
  (users-by-level (vec-set-levels users) users)
  (leaderboard users)
  (def micko (make-user "Micko"))
  (def micko (add-xp micko 40)))

(def micko (atom {:name "Micko"
                  :xp 0
                  :level 0}))

(defn add-xp [user-state xp-to-add]
  (merge-with + user-state {:xp xp-to-add}))


(defn update-xp [user] (swap! user update-in [:xp] + 10))
(def users [])
(defn make-user [name]
  (let [user (atom {:name name
                    :xp 0
                    :level 0})]
    (conj users user))
  )
(defn get-all-users-xp-per-period [db period date]
  (reduce (fn [acc [username _]]
            (let [xp (xp-per-user username period date)]
              ())) [] (usernames-xp db)))

(defn daily-xp-per-user [username date]
  (let [{:keys [start-day end-day]} (t/day-interval date)
        rows (get-activities-in-interval username start-day end-day)]
    (calculate-xp-from-rows rows)))




#_(defn get-all-users-daily-xp [db date]
    (let [[username xp] (usernames-xp db)]
      (reduce (fn [acc [userna]]
                (if (> (daily-xp-per-user elm date) 0)
                  (conj acc elm) acc))
              [] username)))

(defn get-all-users-daily-xp [db date]
  (reduce (fn [acc [username _]]
            (let [xp (daily-xp-per-user username date)]
              (if (> xp 0)
                (conj acc {:user/username username :user/xp xp})
                acc)))
          [] (usernames-xp db)))

(defn weekly-xp-per-user [username date]
  (let [{:keys [start-day end-day]} (t/week-interval date)
        rows (get-activities-in-interval username start-day end-day)]
    (calculate-xp-from-rows rows)))

(defn get-all-users-weekly-xp [db date]
  (reduce (fn [acc [username _]]
            (let [xp (weekly-xp-per-user username date)]
              (if (> xp 0)
                (conj acc {:user/username username :user/xp xp})
                acc)))
          [] (usernames-xp db)))

(defn monthly-xp-per-user [username date]
  (let [{:keys [start-day end-day]} (t/month-interval date)
        rows (get-activities-in-interval username start-day end-day)]
    (calculate-xp-from-rows rows)))

(defn get-all-users-monthly-xp [db date]
  (reduce (fn [acc [username _]]
            (let [xp (monthly-xp-per-user username date)]
              (if (> xp 0)
                (conj acc {:user/username username :user/xp xp})
                acc)))
          [] (usernames-xp db)))

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

;leadreboard for all users
; (db/get-all-users (d/db conn))
(defn
  leaderboard
  "users Leaderboard by earned XP"
  [users]
  (sort-by :user/xp desc (map first users)))