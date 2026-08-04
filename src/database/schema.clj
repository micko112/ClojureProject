(ns database.schema)

(def user-schema
  [{:db/ident :user/username :db/valueType :db.type/string :db/cardinality :db.cardinality/one :db/unique :db.unique/identity}
   {:db/ident :user/xp :db/valueType :db.type/long :db/cardinality :db.cardinality/one}
   {:db/ident :user/display-name :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :user/profile-pic :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :user/bio :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :user/website :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :user/password-hash :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :user/email :db/valueType :db.type/string :db/cardinality :db.cardinality/one :db/unique :db.unique/identity}
   {:db/ident :user/google-id :db/valueType :db.type/string :db/cardinality :db.cardinality/one :db/unique :db.unique/identity}
   {:db/ident :user/facebook-id :db/valueType :db.type/string :db/cardinality :db.cardinality/one :db/unique :db.unique/identity}
   {:db/ident :user/follows :db/valueType :db.type/ref :db/cardinality :db.cardinality/many}])

(def activity-schema
  [{:db/ident :activity/user :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :activity/type :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :activity/subtype :db/valueType :db.type/keyword :db/cardinality :db.cardinality/one}
   {:db/ident :activity/duration :db/valueType :db.type/long :db/cardinality :db.cardinality/one}
   {:db/ident :activity/intensity :db/valueType :db.type/long :db/cardinality :db.cardinality/one}
   {:db/ident :activity/start-time :db/valueType :db.type/instant :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :activity/note :db/valueType :db.type/string :db/cardinality :db.cardinality/one}])

(def activity-type-schema
  [{:db/ident :activity-type/key :db/valueType :db.type/keyword :db/cardinality :db.cardinality/one :db/unique :db.unique/identity}
   {:db/ident :activity-type/name :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :activity-type/xp-per-minute :db/valueType :db.type/double :db/cardinality :db.cardinality/one}])

(def post-schema
  [{:db/ident :post/author :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :post/caption :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :post/media-url :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :post/activity-tag :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :post/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :post/likes :db/valueType :db.type/ref :db/cardinality :db.cardinality/many}])

(def comment-schema
  [{:db/ident :comment/post :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :comment/author :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :comment/content :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :comment/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}])

(def notification-schema
  [{:db/ident :notification/recipient :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :notification/type :db/valueType :db.type/keyword :db/cardinality :db.cardinality/one}
   {:db/ident :notification/message :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :notification/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :notification/read :db/valueType :db.type/boolean :db/cardinality :db.cardinality/one}])

(def conversation-schema
  [{:db/ident :conversation/participants :db/valueType :db.type/ref :db/cardinality :db.cardinality/many}
   {:db/ident :conversation/last-message-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}])

(def message-schema
  [{:db/ident :message/conversation :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :message/sender :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :message/content :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :message/media-url :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :message/media-type :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :message/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :message/read-by :db/valueType :db.type/ref :db/cardinality :db.cardinality/many}])

(def group-schema
  [{:db/ident :group/name :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :group/description :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :group/creator :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :group/members :db/valueType :db.type/ref :db/cardinality :db.cardinality/many}
   {:db/ident :group/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :group/avatar :db/valueType :db.type/string :db/cardinality :db.cardinality/one}])

(def group-message-schema
  [{:db/ident :group-message/group :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :group-message/sender :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :group-message/content :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :group-message/media-url :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :group-message/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}])

(def competition-schema
  [{:db/ident :competition/name :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :competition/description :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :competition/theme :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :competition/rules :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :competition/creator :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :competition/members :db/valueType :db.type/ref :db/cardinality :db.cardinality/many}
   {:db/ident :competition/start-date :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :competition/end-date :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :competition/invite-code :db/valueType :db.type/string :db/cardinality :db.cardinality/one :db/unique :db.unique/identity}
   {:db/ident :competition/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}])

(def challenge-schema
  [{:db/ident :challenge/challenger :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :challenge/target :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}
   {:db/ident :challenge/status :db/valueType :db.type/keyword :db/cardinality :db.cardinality/one}
   {:db/ident :challenge/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :challenge/expires-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :challenge/winner :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}])

(def story-schema
  [{:db/ident :story/creator    :db/valueType :db.type/ref     :db/cardinality :db.cardinality/one  :db/index true}
   {:db/ident :story/media-url  :db/valueType :db.type/string  :db/cardinality :db.cardinality/one}
   {:db/ident :story/media-type :db/valueType :db.type/string  :db/cardinality :db.cardinality/one}
   {:db/ident :story/text       :db/valueType :db.type/string  :db/cardinality :db.cardinality/one}
   {:db/ident :story/bg-color   :db/valueType :db.type/string  :db/cardinality :db.cardinality/one}
   {:db/ident :story/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one  :db/index true}
   {:db/ident :story/expires-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :story/viewed-by  :db/valueType :db.type/ref     :db/cardinality :db.cardinality/many}])

(def all-schemas
  (concat user-schema activity-schema activity-type-schema
          post-schema comment-schema notification-schema
          conversation-schema message-schema
          group-schema group-message-schema
          competition-schema challenge-schema story-schema))
