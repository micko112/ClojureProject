(ns project.db
  (:require [datomic.api :as d]
            [database.schema :as schema]
            [database.seed :as seed-db])
  (:import (java.util Date)))

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
                                              }]))
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
;@(d/transact conn schema/activity-type-schema)
@(d/transact conn seed-db/initial-type-activities)

(def add-activity-tx {:db/ident :activity/add
                      :db/fn (d/function '{:lang "clojure"
                                           :params [db username activity-type-key duration intensity]
                                           :code (let [
                                                       user-e
                                                       (d/q '[:find ?e .
                                                              :in $ ?username
                                                              :where [?e :user/username ?username]]
                                                            db username)
                                                       [act-type-e xp-per-min]
                                                       (first (d/q '[:find ?e ?xp-per-minute
                                                                     :in $ ?type
                                                                     :where [?e :activity-type/key ?type]
                                                                     [?e :activity-type/xp-per-minute ?xp-per-minute]
                                                                     ] db activity-type-key))
                                                       gained-xp (* duration xp-per-min intensity)

                                                       current-xp (or (:user/xp (d/entity db user-e)) 0)

                                                       new-xp (+ current-xp gained-xp)
                                                       activity-id (d/tempid :db.part/user)]
                                                   [
                                                    {:db/id activity-id
                                                     :activity/user user-e
                                                     :activity/type act-type-e
                                                     :activity/duration duration
                                                     :activity/intensity intensity
                                                     :activity/start-time (java.util.Date.)
                                                     }
                                                    [:db/add user-e :user/xp new-xp
                                                     ]])})})

@(d/transact conn [add-activity-tx])
;@(d/transact conn [[:activity/add "Micko" :training 60 3 (java.util.Date.)]])
@(d/transact conn [[:activity/add "Micko" :training 60 3 ]])
@(d/transact conn [[:activity/add "Micko" :study 60 3 ]])
(defn user-activities [username] (d/q '[:find ?a-type ?a-duration ?a-intensity ?a-start-time
                                        :in $ ?username
                                        :where  [?u :user/username ?username]
                                        [?a :activity/user ?u]
                                        [?a :activity/type ?t]
                                        [?t :activity-type/name ?a-type]
                                        [?a :activity/duration ?a-duration]
                                        [?a :activity/intensity ?a-intensity ]
                                        [?a :activity/start-time ?a-start-time ]
                                        ] (d/db conn) username))




