(ns database.schema-realtime)

;; Schema attributes owned by the realtime area. Appended to database.schema/all-schemas.
;; Additive only: production data exists.

(def presence-schema
  [{:db/ident :user/last-active-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one
    :db/doc "Last time the user had an open realtime connection (presence)."}])

(def dm-schema
  [;; message requests: set at conversation creation when the recipient does
   ;; not follow the sender; retracted on accept (or when the recipient replies)
   {:db/ident :conversation/request-to :db/valueType :db.type/ref :db/cardinality :db.cardinality/one
    :db/doc "Participant for whom this conversation is a pending message request."}
   {:db/ident :conversation/hidden-for :db/valueType :db.type/ref :db/cardinality :db.cardinality/many
    :db/doc "Participants that declined/hid the conversation (re-appears on a new message)."}
   {:db/ident :conversation/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}

   {:db/ident :message/reply-to :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :message/post :db/valueType :db.type/ref :db/cardinality :db.cardinality/one
    :db/doc "A post shared into the DM."}
   {:db/ident :message/reactions :db/valueType :db.type/ref :db/cardinality :db.cardinality/many
    :db/isComponent true}
   {:db/ident :message-reaction/user :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :message-reaction/emoji :db/valueType :db.type/string :db/cardinality :db.cardinality/one}])

(def live-schema
  [{:db/ident :live/host :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :live/title :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :live/status :db/valueType :db.type/keyword :db/cardinality :db.cardinality/one :db/index true
    :db/doc ":active or :ended"}
   {:db/ident :live/started-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :live/ended-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :live/peak-viewers :db/valueType :db.type/long :db/cardinality :db.cardinality/one}
   {:db/ident :live/hearts :db/valueType :db.type/long :db/cardinality :db.cardinality/one}

   {:db/ident :notification/live :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}])

(def schema (vec (concat presence-schema dm-schema live-schema)))
