(ns database.schema
  (:require [datomic.api :as d]
            [project.connection :as conn]))

(def user-schema [{:db/ident       :user/username
                   :db/valueType   :db.type/string
                   :db/cardinality :db.cardinality/one
                   :db/unique      :db.unique/identity
                   :db/doc         "Username"}
                  {:db/ident       :user/xp
                   :db/valueType   :db.type/long
                   :db/cardinality :db.cardinality/one
                   :db/doc         "Experience of user"}])

(def activity-schema [{:db/ident :activity/user
                       :db/valueType :db.type/ref
                       :db/cardinality :db.cardinality/one
                       :db/index true
                       :db/doc "User who performed activity"}
                      {:db/ident :activity/type
                       :db/valueType :db.type/ref
                       :db/cardinality :db.cardinality/one
                       :db/doc "Main type of activity"}
                      {:db/ident :activity/subtype
                       :db/valueType :db.type/keyword
                       :db/cardinality :db.cardinality/one
                       :db/doc "Optional subtype"}
                      {:db/ident :activity/duration
                       :db/valueType :db.type/long
                       :db/cardinality :db.cardinality/one
                       :db/doc "Duration in minutes"}
                      {:db/ident :activity/intensity
                       :db/valueType :db.type/long
                       :db/cardinality :db.cardinality/one
                       :db/doc "Intensity 1-5"}
                      {:db/ident :activity/start-time
                       :db/valueType :db.type/instant
                       :db/cardinality :db.cardinality/one
                       :db/index true
                       :db/doc "When activity happened"}])

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

(def reaction-schema [{:db/ident       :reaction/from-user
                       :db/valueType   :db.type/ref
                       :db/cardinality :db.cardinality/one
                       :db/doc         "User who reacted"}
                      {:db/ident       :reaction/to-user
                       :db/valueType   :db.type/ref
                       :db/cardinality :db.cardinality/one
                       :db/doc         "User being reacted to"}
                      {:db/ident       :reaction/date
                       :db/valueType   :db.type/string
                       :db/cardinality :db.cardinality/one
                       :db/doc         "ISO date string yyyy-MM-dd"}
                      {:db/ident       :reaction/emoji
                       :db/valueType   :db.type/string
                       :db/cardinality :db.cardinality/one
                       :db/doc         "Emoji character"}])

(def post-schema [{:db/ident       :post/author
                   :db/valueType   :db.type/ref
                   :db/cardinality :db.cardinality/one
                   :db/index       true
                   :db/doc         "User who wrote the post"}
                  {:db/ident       :post/content
                   :db/valueType   :db.type/string
                   :db/cardinality :db.cardinality/one
                   :db/doc         "Post text content"}
                  {:db/ident       :post/created-at
                   :db/valueType   :db.type/instant
                   :db/cardinality :db.cardinality/one
                   :db/index       true
                   :db/doc         "Creation timestamp"}
                  {:db/ident       :post/activity-tag
                   :db/valueType   :db.type/string
                   :db/cardinality :db.cardinality/one
                   :db/doc         "Optional activity type label"}
                  {:db/ident       :post/liked-by
                   :db/valueType   :db.type/ref
                   :db/cardinality :db.cardinality/many
                   :db/doc         "Users who liked this post"}])

(def all-schemas
  (concat user-schema
          activity-schema
          activity-type-schema
          reaction-schema
          post-schema))
