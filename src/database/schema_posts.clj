(ns database.schema-posts)

;; Schema attributes owned by the posts area. Appended to database.schema/all-schemas.
;; Additive only: production data exists, never change an existing attribute.
;;
;; Ordered media: a post points at its media through component "slide" entities
;; (`:post/media` -> {:post-media/media <media eid>, :post-media/position n}).
;; Why a join entity instead of putting a position on the media entity itself:
;;  * Datomic cardinality-many refs are unordered sets, so order must live
;;    somewhere explicit.
;;  * the media entity belongs to the media area (web.media); position is a
;;    property of the post<->media relationship, not of the file, so the same
;;    upload could in principle appear in two posts at different positions.
;;  * `:db/isComponent` makes `retractEntity` on a post clean up its slides
;;    (but never the media entities themselves, which the media area manages).
(def schema
  [;; --- post: ordered media, layout, audience, flags ---
   {:db/ident :post/media :db/valueType :db.type/ref :db/cardinality :db.cardinality/many :db/isComponent true
    :db/doc "Component slides of a post; order given by :post-media/position."}
   {:db/ident :post-media/media :db/valueType :db.type/ref :db/cardinality :db.cardinality/one
    :db/doc "Media entity (owned by web.media) shown on this slide."}
   {:db/ident :post-media/position :db/valueType :db.type/long :db/cardinality :db.cardinality/one
    :db/doc "0-based slide position."}
   {:db/ident :post/layout :db/valueType :db.type/keyword :db/cardinality :db.cardinality/one
    :db/doc ":single | :carousel | :compare"}
   {:db/ident :post/audience :db/valueType :db.type/keyword :db/cardinality :db.cardinality/one
    :db/doc ":public | :followers | :close-friends (missing = :public)"}
   {:db/ident :post/hide-likes :db/valueType :db.type/boolean :db/cardinality :db.cardinality/one}
   {:db/ident :post/comments-off :db/valueType :db.type/boolean :db/cardinality :db.cardinality/one}
   {:db/ident :post/edited-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}
   {:db/ident :post/archived :db/valueType :db.type/boolean :db/cardinality :db.cardinality/one}
   {:db/ident :post/hashtags :db/valueType :db.type/string :db/cardinality :db.cardinality/many :db/index true
    :db/doc "Lowercased hashtags parsed from the caption (without #)."}
   {:db/ident :post/mentions :db/valueType :db.type/ref :db/cardinality :db.cardinality/many
    :db/doc "Users @mentioned in the caption."}

   ;; --- supportive reactions (one per user per post; no dislikes, ever) ---
   {:db/ident :reaction/post :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :reaction/user :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :reaction/emoji :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
   {:db/ident :reaction/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}

   ;; --- comments: replies + likes ---
   {:db/ident :comment/parent :db/valueType :db.type/ref :db/cardinality :db.cardinality/one :db/index true
    :db/doc "Top-level comment this reply belongs to (replies are one level deep)."}
   {:db/ident :comment/likes :db/valueType :db.type/ref :db/cardinality :db.cardinality/many}])
