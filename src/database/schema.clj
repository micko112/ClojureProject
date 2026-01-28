(ns database.schema
  (:require [datomic.api :as d]))

(def user-schema [{:db/ident       :user/username
                   :db/valueType   :db.type/string
                   :db/cardinality :db.cardinality/one
                   :db/unique      :db.unique/identity
                   :db/doc         "Username"}
                  {:db/ident       :user/xp
                   :db/valueType   :db.type/long
                   :db/cardinality :db.cardinality/one
                   :db/doc         "Experience of user"}])
;@(d/transact conn user-shema)
(def activity-schema [{:db/ident :activity/user
                       :db/valueType :db.type/ref
                       :db/cardinality :db.cardinality/one
                       :db/index true
                       :db/doc "User who performed activity"}
                      {:db/ident :activity/type
                       :db/valueType :db.type/ref
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
                       :db/valueType :db.type/ref
                       :db/cardinality :db.cardinality/one
                       :db/index true
                       :db/doc "When activity happened"}
                      {:db/ident :activity/start-time
                       :db/valueType :db.type/instant
                       :db/cardinality :db.cardinality/one
                       :db/index true
                       :db/doc "When activity happened"}])
;@(d/transact conn activity-schema)

(def activity-type-schema [{:db/ident :activity-type/key
                            :db/valueType :db.type/keyword
                            :db/cardinality :db.cardinality/one
                            :db/unique      :db.unique/identity
                            :db/doc "Key word type of activity"}
                           {:db/ident :activity-type/name
                            :db/valueType :db.type/string
                            :db/cardinality :db.cardinality/one
                            :db/doc "Name of activity type"}
                           {:db/ident :activity-type/xp-per-minute
                            :db/valueType :db.type/long
                            :db/cardinality :db.cardinality/one
                            :db/doc "Xp per minute"}])
;@(d/transact conn activity-type-schema)
(def all-schemas (concat user-schema activity-schema activity-type-schema))