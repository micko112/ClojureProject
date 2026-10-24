(ns web.media
  "Media storage (S3-compatible cloud or local disk), image optimization and
   the /api/media upload endpoint. OWNER: media agent.

   POST /api/media      multipart `file` (+ optional `poster` image for videos,
                        optional `width`/`height`/`durationSec` hints) -> Media DTO
   POST /api/upload     legacy, returns {url}; metadata is stripped too
   GET  /uploads/:file  serves locally stored files (dev / no S3)"
  (:require [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [clojure.tools.logging :as log]
            [datomic.api :as d]
            [project.system :as s]
            [web.http :refer [jresp me ok bad unauth ddb user-e parse-id]]
            [web.media.image :as img]
            [web.media.storage :as storage]
            [web.media.video :as video]
            [web.vision :as vision])
  (:import (java.io File RandomAccessFile InputStream)
           (java.util Date UUID)))

;; ===== Limits =====

(def image-max-bytes (* 15 1024 1024))
(def video-max-bytes (* 100 1024 1024))
(def audio-max-bytes (* 25 1024 1024))
(def legacy-image-max-side 2160)

(defn- mb [n] (quot n (* 1024 1024)))

;; ===== DTO =====

(defn- parse-variants [s]
  (when (seq s)
    (try (->> (json/parse-string s true)
              (filter #(and (number? (:w %)) (string? (:url %))))
              (map #(select-keys % [:w :url]))
              (sort-by :w)
              vec)
         (catch Exception _ nil))))

(defn- drop-nils [m] (into {} (remove (comp nil? val) m)))

(defn media-dto
  "Shape (see docs/ARCHITECTURE.md): {:id :type :url :width :height
   :variants [{:w :url}] :placeholder :posterUrl :durationSec}
   Keys without a value are omitted. Returns nil when `eid` is not a media.
   With {:suggestions? true} (upload response only) adds
   :suggestions [{:activity :label :emoji :score}] from the activity
   classifier, when there are any."
  ([db eid] (media-dto db eid nil))
  ([db eid {:keys [suggestions?]}]
   (let [e (d/entity db eid)
         sg (when suggestions? (seq (vision/media-suggestions e)))]
     (when (:media/url e)
       (drop-nils
        {:id          (str (:db/id e))
         :type        (or (:media/type e) "image")
         :url         (:media/url e)
         :width       (:media/width e)
         :height      (:media/height e)
         :variants    (or (parse-variants (:media/variants e)) [])
         :placeholder (:media/placeholder e)
         :posterUrl   (:media/poster-url e)
         :durationSec (:media/duration e)
         :suggestions (some-> sg vec)})))))

(def ^:private video-ext-re #"(?i)\.(mp4|mov|webm|m4v|ogv)(\?.*)?$")

(defn url->media-dto
  "Media DTO for a legacy post that only has a URL (no :media entity).
   `id` is used as the DTO id (e.g. the post id)."
  [url id]
  (when (seq url)
    {:id (str id)
     :type (if (re-find video-ext-re url) "video" "image")
     :url url
     :variants []}))

(defn owned-media-eid
  "Entity id of media `media-id` (string or long) when it exists and belongs
   to user entity `owner-e`; nil otherwise. For POST /api/posts validation."
  [db owner-e media-id]
  (when-let [eid (if (number? media-id) (long media-id) (parse-id media-id))]
    (let [e (d/entity db eid)]
      (when (and (:media/url e) (= owner-e (:db/id (:media/owner e))))
        eid))))

(defn delete-stored-files!
  "Deletes every stored object of media `eids`, read from `db` (a value from
   before the entities were retracted). Never throws."
  [db eids]
  (doseq [eid eids
          k (:media/storage-keys (d/entity db eid))]
    (try (storage/delete! (storage/storage) k)
         (catch Exception e (log/warn e "[media] could not delete" k)))))

;; ===== Helpers =====

(defn- file-of [part] (when (map? part) (:tempfile part)))

(defn- new-base [] (str (UUID/randomUUID)))

(defn- parse-num [s]
  (try (when (seq (str s)) (Double/parseDouble (str s))) (catch Exception _ nil)))

(defn- pos-long [x] (when (and x (pos? x) (< x 100000)) (long (Math/round (double x)))))

(defn- error [status msg] (jresp status {:error msg}))

(defn- unsupported [kind]
  (case kind
    :heic (error 415 "HEIC/AVIF photos aren't supported yet. Please upload JPEG, PNG or WebP (the app converts automatically).")
    (error 415 "Unsupported file type. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM, MOV.")))

(defn- store!
  "Puts content in storage, returns [key url]."
  [base suffix ext content mime]
  (let [k (str base suffix "." ext)]
    [k (storage/put! (storage/storage) k content mime)]))

(defn- classify
  "Sniffs `f`. Returns {:kind :class :ext :mime} or nil."
  [f]
  (let [kind (img/sniff (img/read-head f 32))]
    (when kind (assoc (img/kinds kind) :kind kind))))

(defn- process-image-upload
  "Renditions for a still image. Returns the :media/* attributes."
  [^File f base]
  (let [{:keys [width height placeholder renditions]} (img/process f)
        stored (mapv (fn [{:keys [w bytes]}]
                       (let [[k url] (store! base (str "_" w) "jpg" bytes "image/jpeg")]
                         {:w w :url url :key k}))
                     renditions)]
    {:media/type "image"
     :media/mime "image/jpeg"
     :media/url (:url (peek stored))
     :media/width width
     :media/height height
     :media/variants (json/generate-string (mapv #(select-keys % [:w :url]) stored))
     :media/placeholder placeholder
     :media/storage-keys (mapv :key stored)
     ;; not an attribute: what the activity classifier looks at (640 px is
     ;; plenty for its 224 px input)
     ::vision-input (:bytes (or (first (filter #(= 640 (:w %)) renditions)) (peek renditions)))}))

(defn- process-gif-upload
  "GIFs are kept as-is so animation survives (they carry no EXIF/GPS)."
  [^File f base]
  (let [[w h] (img/dimensions f)
        ph (try (img/placeholder (img/orient (img/decode f) 1)) (catch Exception _ nil))
        [k url] (store! base "" "gif" f "image/gif")]
    (cond-> {:media/type "image"
             :media/mime "image/gif"
             :media/url url
             :media/width (long w)
             :media/height (long h)
             :media/variants (json/generate-string [{:w w :url url}])
             :media/storage-keys [k]}
      ph (assoc :media/placeholder ph)
      (<= (.length f) (* 5 1024 1024)) (assoc ::vision-input f))))

(defn- process-poster
  "Optional poster image for a video: one JPEG <= 1080 px wide + placeholder."
  [part base]
  (when-let [pf (file-of part)]
    (let [c (classify pf)]
      (when (and c (= :image (:class c)) (<= (.length ^File pf) image-max-bytes))
        (try
          (let [im (img/orient (img/decode pf) (img/exif-orientation pf))
                top (img/resize-to-width im 1080)
                jpeg (img/encode-jpeg top 0.8)
                [k url] (store! base "_poster" "jpg" jpeg "image/jpeg")]
            {:url url :key k :width (.getWidth top) :height (.getHeight top)
             :placeholder (img/placeholder im) :jpeg jpeg})
          (catch Exception e (log/warn e "[media] poster processing failed") nil))))))

(defn- process-video-upload
  [^File f {:keys [kind ext mime]} params base]
  (when (#{:mp4 :mov} kind) (video/strip-metadata! f))
  (let [probe (if (#{:mp4 :mov} kind) (video/probe f) {})
        poster (process-poster (get params "poster") base)
        hint-w (pos-long (parse-num (get params "width")))
        hint-h (pos-long (parse-num (get params "height")))
        hint-d (parse-num (get params "durationSec"))
        width (or (pos-long (:width probe)) hint-w (:width poster))
        height (or (pos-long (:height probe)) hint-h (:height poster))
        duration (or (:duration probe) (when (and hint-d (pos? hint-d) (< hint-d 86400)) hint-d))
        [k url] (store! base "" ext f mime)]
    (cond-> {:media/type "video"
             :media/mime mime
             :media/url url
             :media/variants "[]"
             :media/storage-keys (cond-> [k] poster (conj (:key poster)))}
      width (assoc :media/width (long width))
      height (assoc :media/height (long height))
      duration (assoc :media/duration (double duration))
      poster (assoc :media/poster-url (:url poster)
                    :media/placeholder (:placeholder poster)
                    ::vision-input (:jpeg poster)))))

;; ===== POST /api/media =====

(defn handle-create-media [req]
  (let [username (me req)
        db (ddb)
        owner (when username (user-e db username))]
    (if-not owner
      (unauth)
      (let [params (:multipart-params req)
            part (get params "file")
            ^File f (file-of part)]
        (if-not (and f (.exists f) (pos? (.length f)))
          (bad "No file")
          (let [{:keys [class] :as c} (classify f)
                size (.length f)]
            (cond
              (nil? c) (unsupported nil)
              (= :heic class) (unsupported :heic)
              (not (#{:image :gif :video} class)) (unsupported nil)
              (and (#{:image :gif} class) (> size image-max-bytes))
              (error 413 (str "Image is too large (max " (mb image-max-bytes) " MB)"))
              (and (= :video class) (> size video-max-bytes))
              (error 413 (str "Video is too large (max " (mb video-max-bytes) " MB)"))
              :else
              (try
                (let [base (new-base)
                      hash (img/sha256-hex f)
                      attrs (case class
                              :image (process-image-upload f base)
                              :gif   (process-gif-upload f base)
                              :video (process-video-upload f c params base))
                      ;; Activity suggestion (videos: from the poster). Short
                      ;; timeout; nil when the ML service is off or slow.
                      prediction (some-> (::vision-input attrs) (vision/classify {:embedding? true}))
                      attrs (merge (dissoc attrs ::vision-input) (vision/prediction-attrs prediction))
                      tmp "new-media"
                      tx @(d/transact s/conn [(merge attrs
                                                     {:db/id tmp
                                                      :media/owner owner
                                                      :media/size size
                                                      :media/hash hash
                                                      :media/created-at (Date.)})])
                      eid (get-in tx [:tempids tmp])]
                  (jresp 201 (media-dto (:db-after tx) eid {:suggestions? true})))
                (catch clojure.lang.ExceptionInfo e
                  (if (#{::img/too-many-pixels} (:type (ex-data e)))
                    (error 413 "Image resolution is too large")
                    (do (log/warn e "[media] upload failed") (error 422 "Could not read this file"))))
                (catch javax.imageio.IIOException e
                  (log/info "[media] undecodable image" (.getMessage e))
                  (error 422 "Could not read this image"))
                (catch Exception e
                  (log/error e "[media] upload failed")
                  (error 500 "Upload failed"))))))))))

;; ===== Legacy POST /api/upload =====

(defn handle-legacy-upload
  "Kept for chat, stories, avatars and banners: returns {:url}. Accepts
   images, video and audio (voice messages). Images are re-encoded so EXIF/GPS
   never get stored; MP4/MOV metadata boxes are neutralised."
  [req]
  (if-not (me req)
    (unauth)
    (let [^File f (file-of (get-in req [:multipart-params "file"]))]
      (if-not (and f (.exists f) (pos? (.length f)))
        (bad "No file")
        (let [{:keys [class ext mime kind] :as c} (classify f)
              size (.length f)
              limit (case class (:image :gif :heic) image-max-bytes :video video-max-bytes audio-max-bytes)]
          (cond
            (nil? c) (unsupported nil)
            ;; can't be re-encoded here, so storing it would keep EXIF/GPS
            (= :heic class) (unsupported :heic)
            (> size limit) (error 413 (str "File is too large (max " (mb limit) " MB)"))
            :else
            (try
              (let [base (new-base)
                    [_ url] (case class
                              :image (let [{:keys [bytes ext mime]} (img/sanitize f legacy-image-max-side)]
                                       (store! base "" ext bytes mime))
                              :video (do (when (#{:mp4 :mov} kind) (video/strip-metadata! f))
                                         (store! base "" ext f mime))
                              (store! base "" ext f mime))]
                (ok {:url url}))
              (catch Exception e
                (log/warn e "[media] legacy upload failed")
                (error 422 "Could not process this file")))))))))

;; ===== GET /uploads/:filename =====

(def ^:private ext->mime
  (merge (into {} (map (fn [[_ {:keys [ext mime]}]] [ext mime]) img/kinds))
         {"jpeg" "image/jpeg" "m4v" "video/mp4"}))

(defn- bounded-stream
  "InputStream over [start, start+len) of a file."
  ^InputStream [^File f start len]
  (let [raf (RandomAccessFile. f "r")
        remaining (atom len)]
    (.seek raf start)
    (proxy [InputStream] []
      (read
        ([] (if (pos? @remaining)
              (let [b (.read raf)] (when (>= b 0) (swap! remaining dec)) b)
              -1))
        ([^bytes buf] (.read ^InputStream this buf 0 (alength buf)))
        ([^bytes buf off n]
         (if (pos? @remaining)
           (let [r (.read raf buf (int off) (int (min n @remaining)))]
             (when (pos? r) (swap! remaining - r))
             r)
           -1)))
      (available [] (int (min Integer/MAX_VALUE @remaining)))
      (close [] (.close raf)))))

(defn- parse-range
  "[start end] (inclusive) for a single `bytes=` range, nil when absent or
   unsatisfiable/multi-range."
  [header len]
  (when-let [[_ a b] (and header (re-matches #"bytes=(\d*)-(\d*)" (str/trim header)))]
    (let [a (when (seq a) (parse-long a)) b (when (seq b) (parse-long b))]
      (cond
        (and a b (<= a b) (< a len)) [a (min b (dec len))]
        (and a (nil? b) (< a len))   [a (dec len)]
        (and (nil? a) b (pos? b))    [(max 0 (- len b)) (dec len)]
        :else nil))))

(defn handle-serve-upload
  "Serves a locally stored file with long-lived cache headers and byte-range
   support (Safari needs ranges to play video)."
  [req]
  (let [fname (get-in req [:path-params :filename])
        dir (or (storage/local-dir (storage/storage)) (storage/default-local-dir))
        f (when (storage/safe-key? fname) (io/file dir fname))]
    (if-not (and f (.isFile ^File f))
      {:status 404 :headers {"Content-Type" "text/plain"} :body "Not found"}
      (let [len (.length ^File f)
            ext (str/lower-case (or (second (re-find #"\.([A-Za-z0-9]+)$" fname)) ""))
            headers {"Content-Type" (get ext->mime ext "application/octet-stream")
                     "Cache-Control" storage/cache-control
                     "Accept-Ranges" "bytes"
                     "X-Content-Type-Options" "nosniff"}
            range-h (get-in req [:headers "range"])
            rng (parse-range range-h len)]
        (cond
          (and range-h (re-find #"^bytes=" range-h) (nil? rng) (not (str/includes? range-h ",")))
          {:status 416 :headers (assoc headers "Content-Range" (str "bytes */" len)) :body ""}

          rng
          (let [[a b] rng n (inc (- b a))]
            {:status 206
             :headers (assoc headers
                             "Content-Range" (str "bytes " a "-" b "/" len)
                             "Content-Length" (str n))
             :body (bounded-stream f a n)})

          :else
          {:status 200
           :headers (assoc headers "Content-Length" (str len))
           :body f})))))

(def routes
  [["/api/media" {:post handle-create-media}]])
