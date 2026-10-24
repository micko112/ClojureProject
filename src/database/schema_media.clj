(ns database.schema-media)

;; Schema attributes owned by the media area. Appended to database.schema/all-schemas.
;; Additive only: production data exists, never change an existing attribute's type.
(def schema
  [{:db/ident :media/owner        :db/valueType :db.type/ref     :db/cardinality :db.cardinality/one :db/index true
    :db/doc "User who uploaded the media."}
   {:db/ident :media/type         :db/valueType :db.type/string  :db/cardinality :db.cardinality/one
    :db/doc "\"image\" or \"video\"."}
   {:db/ident :media/mime         :db/valueType :db.type/string  :db/cardinality :db.cardinality/one
    :db/doc "Content type of the stored main file (after processing)."}
   {:db/ident :media/url          :db/valueType :db.type/string  :db/cardinality :db.cardinality/one
    :db/doc "Public URL of the largest rendition (image) or the video file."}
   {:db/ident :media/width        :db/valueType :db.type/long    :db/cardinality :db.cardinality/one}
   {:db/ident :media/height       :db/valueType :db.type/long    :db/cardinality :db.cardinality/one}
   {:db/ident :media/variants     :db/valueType :db.type/string  :db/cardinality :db.cardinality/one
    :db/doc "JSON array [{w, url}] ascending by width."}
   {:db/ident :media/placeholder  :db/valueType :db.type/string  :db/cardinality :db.cardinality/one
    :db/doc "Tiny blurred data: URI shown while the real image loads."}
   {:db/ident :media/poster-url   :db/valueType :db.type/string  :db/cardinality :db.cardinality/one}
   {:db/ident :media/duration     :db/valueType :db.type/double  :db/cardinality :db.cardinality/one
    :db/doc "Video duration in seconds."}
   {:db/ident :media/size         :db/valueType :db.type/long    :db/cardinality :db.cardinality/one
    :db/doc "Size in bytes of the uploaded original."}
   {:db/ident :media/hash         :db/valueType :db.type/string  :db/cardinality :db.cardinality/one :db/index true
    :db/doc "SHA-256 (hex) of the uploaded original bytes."}
   {:db/ident :media/storage-keys :db/valueType :db.type/string  :db/cardinality :db.cardinality/many
    :db/doc "Every object key written to storage for this media (for cleanup)."}
   {:db/ident :media/created-at   :db/valueType :db.type/instant :db/cardinality :db.cardinality/one :db/index true}])
