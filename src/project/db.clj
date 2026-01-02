(ns project.db
  (:require [datomic.api :as d ]))

(def db-uri "datomic:dev://localhost:4334/bebetter")
(d/create-database db-uri)
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
;@(d/transact conn user-shema)
(def db (d/db conn))

(def users-db [{}])

(def user-ids (d/q '[:find ?e .
                     :where [?e :user/username]]db))
(map (fn [user-id] ))
(defn create-user! [name] @(d/transact conn [{:user/username name
                                          :user/xp 0
                                          :user/level 0}]))

