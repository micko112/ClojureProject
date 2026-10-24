(ns database.schema-vision)

;; Schema attributes owned by the vision (activity classifier) area.
;; Appended to database.schema/all-schemas.
;; Additive only: production data exists, never change an existing attribute's type.
(def schema
  [;; --- on media entities (written by POST /api/media) ---
   {:db/ident :media/predictions     :db/valueType :db.type/string  :db/cardinality :db.cardinality/one
    :db/doc "JSON [{activity, score}] — top classifier suggestions at upload time."}
   {:db/ident :media/embedding       :db/valueType :db.type/bytes   :db/cardinality :db.cardinality/one
    :db/doc "CLIP image embedding: 512 float32, little-endian. Training input for the head."}
   {:db/ident :media/embedding-model :db/valueType :db.type/string  :db/cardinality :db.cardinality/one
    :db/doc "Which model produced :media/embedding (embeddings of different models are not comparable)."}

   ;; --- labelled examples (one per media, from the post's activity tag) ---
   {:db/ident :vision-label/media      :db/valueType :db.type/ref     :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :vision-label/post       :db/valueType :db.type/ref     :db/cardinality :db.cardinality/one :db/index true}
   {:db/ident :vision-label/user       :db/valueType :db.type/ref     :db/cardinality :db.cardinality/one}
   {:db/ident :vision-label/activity   :db/valueType :db.type/string  :db/cardinality :db.cardinality/one :db/index true
    :db/doc "Normalized class key, e.g. \"running\"."}
   {:db/ident :vision-label/predicted  :db/valueType :db.type/string  :db/cardinality :db.cardinality/one
    :db/doc "Top-1 suggestion the user saw (absent when there was none)."}
   {:db/ident :vision-label/source     :db/valueType :db.type/keyword :db/cardinality :db.cardinality/one
    :db/doc ":confirmed (user kept the top suggestion) or :corrected."}
   {:db/ident :vision-label/created-at :db/valueType :db.type/instant :db/cardinality :db.cardinality/one}])
