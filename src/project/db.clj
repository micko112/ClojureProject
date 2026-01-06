(ns project.db
  (:require [datomic.api :as d ]
            [database.schema :as schema]
            [database.seed :as seed-db]))

(def db-uri "datomic:dev://localhost:4334/bebetter")
(d/create-database db-uri)
(def conn (d/connect db-uri))

@(d/transact conn schema/user-schema)
(def db (d/db conn))

(def user-ids (d/q '[:find ?e .
                     :where [?e :user/username]]db))

(defn get-all-users [db] (d/q '[:find (pull ?e [*])
                     :where [?e :user/username]] db))

(defn create-user! [name] @(d/transact conn [{:user/username name
                                          :user/xp 0
                                              :user/level 0}]))
; pokusaj 1
()
#_(defn add-xp [username xp] @(d/transact conn [(+ xp (d/q '[:find ?xp
                                                     :where [?e :user/username username]
                                                            [?e :user/xp ?xp]
                                                     ] db))]))
; pokusaj 2 sa pomoci jer ne bih znao sam
(defn add-xp [conn db username xp-to-add]
  (let [[e current-xp]
        (first (d/q '[:find ?e ?xp
                      :in $ ?username
                      :where [?e :user/username ?username]
                      [?e :user/xp ?xp]
                      ]
                    db username))
        new-xp (+ current-xp xp-to-add)]
    @(d/transact conn [[:db/add e :user/xp new-xp]])
    ))
#_(defn add-xp-3 [conn db username xp-to-add]
  (let [[e current-xp]
        (first (d/q '[:find ?e ?xp
                      :in $ ?username
                      :where [?e :user/username ?username]
                      [?e :user/xp ?xp]] db ))]))
#_(defn add-xp-4 [conn db username xp-to-add]
  (let [[e current-xp]
        (d/q)]))
#_(d/q '[:find ?e ?xp
       :in $ ?username
       :where [?e :user/username "Micko"]
       [?e :user/xp ?xp]
       ]
     db)

; Transakciona funckija
(def add-xp-tx {:db/ident :user/add-xp
                :db/fn (d/function
                         '{:lang "clojure"
                          :params [db username xp]
                          :code (let [[e current-xp]
                                      (first (d/q '[:find ?e ?xp
                                                    :in $ ?username
                                                    :where [?e :user/username ?username]
                                                    [?e :user/xp ?xp]
                                                    ] db username))]
                                  [[:db/add e :user/xp (+ current-xp xp)]])})})

;@(d/transact conn [add-xp-tx])
;@(d/transact conn [[:user/add-xp "Micko" 40]])

@(d/transact conn schema/activity-schema)

(def db (d/db conn))
@(d/transact conn schema/activity-type-schema)



