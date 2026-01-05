(ns project.db
  (:require [datomic.api :as d ]))

(def db-uri "datomic:dev://localhost:4334/bebetter")
;(d/create-database db-uri)
(def conn (d/connect db-uri))

(def user-shema [{:db/ident       :user/username
                  :db/valueType   :db.type/string
                  :db/cardinality :db.cardinality/one
                  :db/unique      :db.unique/identity
                  :db/doc         "Username"}
                 {:db/ident       :user/xp
                  :db/valueType   :db.type/long
                  :db/cardinality :db.cardinality/one
                  :db/doc         "Experience of user"}
                 {:db/ident       :user/level
                  :db/valueType   :db.type/long
                  :db/cardinality :db.cardinality/one
                  :db/doc         "Level of user"}
                 {:db/ident       :user/rang
                  :db/valueType   :db.type/long
                  :db/cardinality :db.cardinality/one
                  :db/doc         "Rang on leaderboard of user"}
                 ])
@(d/transact conn user-shema)
(def db (d/db conn))

(def users-db [{}])

(def user-ids (d/q '[:find ?e .
                     :where [?e :user/username]]db))

(defn get-all-users [db] (d/q '[:find (pull ?e [*])
                     :where [?e :user/username]] db))
(map (fn [user-id] ))
(defn create-user! [name] @(d/transact conn [{:user/username name
                                          :user/xp 0
                                              :user/level 0}]))
; pokusaj 1
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
