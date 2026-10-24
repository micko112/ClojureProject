(ns database.schema-accounts)

;; Schema attributes owned by the accounts area. Appended to database.schema/all-schemas.
;; Additive only: every attribute is optional, so existing users (nil values)
;; behave as public, active, all notifications on, session version 0.

(defn- attr
  ([ident type] (attr ident type :db.cardinality/one))
  ([ident type card] {:db/ident ident :db/valueType type :db/cardinality card}))

(def user-settings-schema
  [(attr :user/private?        :db.type/boolean)
   (attr :user/pronouns        :db.type/string)
   (attr :user/deactivated?    :db.type/boolean)
   ;; bumped by "log out of all devices", password change/reset, deactivate;
   ;; sessions carrying an older version are rejected by wrap-session-version
   (attr :user/session-version :db.type/long)
   (attr :user/hide-activity?  :db.type/boolean)
   ;; :everyone | :followers (nil = :everyone)
   (attr :user/message-policy  :db.type/keyword)
   ;; notification preference keys that are switched OFF
   ;; (:likes :comments :follows :mentions :messages :live)
   (attr :user/notif-off       :db.type/keyword :db.cardinality/many)
   (attr :user/created-at      :db.type/instant)])

(def relationship-schema
  [(attr :user/blocks        :db.type/ref :db.cardinality/many)
   (attr :user/mutes         :db.type/ref :db.cardinality/many)
   (attr :user/restricts     :db.type/ref :db.cardinality/many)
   (attr :user/close-friends :db.type/ref :db.cardinality/many)])

(def follow-request-schema
  [;; "<from-eid>-<to-eid>", makes requests idempotent
   (assoc (attr :follow-request/key :db.type/string) :db/unique :db.unique/identity)
   (assoc (attr :follow-request/from :db.type/ref) :db/index true)
   (assoc (attr :follow-request/to :db.type/ref) :db/index true)
   (attr :follow-request/created-at :db.type/instant)])

(def reset-token-schema
  [;; SHA-256 of the token; the raw token only ever exists in the email/link
   (assoc (attr :reset-token/hash :db.type/string) :db/unique :db.unique/identity)
   (attr :reset-token/user       :db.type/ref)
   (attr :reset-token/expires-at :db.type/instant)
   (attr :reset-token/used-at    :db.type/instant)])

(def schema
  (vec (concat user-settings-schema relationship-schema
               follow-request-schema reset-token-schema)))
