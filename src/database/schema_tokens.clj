(ns database.schema-tokens)

;; Bearer tokens for the mobile app (cookies are unreliable in native HTTP
;; clients and WebSockets). Only the SHA-256 of a token is stored.
(def schema
  [{:db/ident :auth-token/hash         :db/valueType :db.type/string  :db/cardinality :db.cardinality/one :db/unique :db.unique/identity}
   {:db/ident :auth-token/user         :db/valueType :db.type/ref     :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :auth-token/sv           :db/valueType :db.type/long    :db/cardinality :db.cardinality/one}
   {:db/ident :auth-token/device       :db/valueType :db.type/string  :db/cardinality :db.cardinality/one}
   {:db/ident :auth-token/created-at   :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :auth-token/last-used-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}])
