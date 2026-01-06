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

(def activity-schema [{:db/ident :activity/user
                       :db/valueType :db.type/ref
                       :db/cardinality :db.cardinality/one
                       :db/doc "User who performed activity"}
                      {:db/ident :activity/type
                       :db/valueType :db.type/keyword
                       :db/cardinality :db.cardinality/one
                       :db/doc "Main type of activity (training, work, studying etc.)"}
                      {:db/ident :activity/subtype
                       :db/valueType :db.type/keyword
                       :db/cardinality :db.cardinality/one
                       :db/doc "Optional type of activity (training, work, studying etc.)"}
                      {:db/ident :activity/duration
                       :db/valueType :db.type/long
                       :db/cardinality :db.cardinality/one
                       :db/doc "Duration of activity in minutes."}
                      {:db/ident :activity/intensity
                       :db/valueType :db.type/long
                       :db/cardinality :db.cardinality/one
                       :db/doc "Intensity of activity on scale 1-5"}
                      {:db/ident :activity/at
                       :db/valueType :db.type/instant
                       :db/cardinality :db.cardinality/one
                       :db/doc "When activity happened"}
                      ])

@(d/transact conn activity-schema)

(def activity-type-schema [{:db/ident :activity-type/key
                            :db/valueType :db.type/keyword
                            :db/cardinality :db.cardinality/one
                            :db/doc "Key word type of activity"}
                           {:db/ident :activity-type/name
                            :db/valueType :db.type/string
                            :db/cardinality :db.cardinality/one
                            :db/doc "Name of activity type"}
                           {:db/ident :activity-type/xp-per-minute
                            :db/valueType :db.type/long
                            :db/cardinality :db.cardinality/one
                            :db/doc "Xp per minute"}
                           ])
(def db (d/db conn))
@(d/transact conn activity-type-schema)

