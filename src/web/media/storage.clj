(ns web.media.storage
  "Object storage for uploaded media.

   Two implementations of the `Storage` protocol:
   - `S3Storage`: any S3-compatible API (Cloudflare R2, AWS S3, MinIO, ...)
     through the AWS SDK v2. Selected when S3_BUCKET, S3_ACCESS_KEY and
     S3_SECRET_KEY are all set.
   - `LocalStorage`: files in the `uploads/` directory, served by
     GET /uploads/:filename. Used when S3 is not configured (dev, tests).

   Env vars:
     S3_ENDPOINT            e.g. https://<account-id>.r2.cloudflarestorage.com
                            (omit for AWS S3; set for R2 / MinIO)
     S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
     S3_REGION              \"auto\" for R2 (default), e.g. eu-central-1 for AWS
     S3_PREFIX              key prefix, default \"media/\"
     S3_FORCE_PATH_STYLE    default true when S3_ENDPOINT is set (MinIO needs it)
     MEDIA_PUBLIC_BASE_URL  public base the objects are served from, e.g.
                            https://media.example.com (R2 custom domain / r2.dev)
     MEDIA_LOCAL_DIR        local storage dir, default <cwd>/uploads"
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [clojure.tools.logging :as log])
  (:import (java.io File)
           (java.net URI)
           (software.amazon.awssdk.auth.credentials AwsBasicCredentials StaticCredentialsProvider)
           (software.amazon.awssdk.core.checksums RequestChecksumCalculation ResponseChecksumValidation)
           (software.amazon.awssdk.core.sync RequestBody)
           (software.amazon.awssdk.http.urlconnection UrlConnectionHttpClient)
           (software.amazon.awssdk.regions Region)
           (software.amazon.awssdk.services.s3 S3Client S3ClientBuilder S3Configuration)
           (software.amazon.awssdk.services.s3.model PutObjectRequest DeleteObjectRequest)))

(set! *warn-on-reflection* true)

(defprotocol Storage
  (put! [this key content content-type]
    "Stores `content` (a java.io.File or a byte array) under `key`; returns the public URL.")
  (delete! [this key] "Deletes the object; never throws.")
  (url-for [this key] "Public URL of `key`.")
  (local-dir [this] "Directory for LocalStorage, nil for remote storage."))

(def cache-control
  "Object keys are random UUIDs and never overwritten, so they are immutable."
  "public, max-age=31536000, immutable")

;; ---------------------------------------------------------------------------
;; Local disk

(defn safe-key?
  "Keys are flat file names: letters, digits, dot, dash, underscore."
  [k]
  (boolean (and (string? k) (re-matches #"[A-Za-z0-9][A-Za-z0-9._-]{0,200}" k)
                (not (str/includes? k "..")))))

(defrecord LocalStorage [^File dir]
  Storage
  (put! [this key content _content-type]
    (when-not (safe-key? key) (throw (ex-info "Invalid storage key" {:key key})))
    (.mkdirs dir)
    (io/copy content (io/file dir key))
    (url-for this key))
  (delete! [_ key]
    (when (safe-key? key)
      (try (io/delete-file (io/file dir key) true) (catch Exception _ nil))))
  (url-for [_ key] (str "/uploads/" key))
  (local-dir [_] dir))

(defn default-local-dir ^File []
  (io/file (or (not-empty (System/getenv "MEDIA_LOCAL_DIR"))
               (str (System/getProperty "user.dir") File/separator "uploads"))))

(defn local-storage
  ([] (local-storage (default-local-dir)))
  ([dir] (->LocalStorage (io/file dir))))

;; ---------------------------------------------------------------------------
;; S3-compatible (Cloudflare R2 / AWS S3 / MinIO)

(defrecord S3Storage [^S3Client client bucket prefix public-base]
  Storage
  (put! [this key content content-type]
    (let [req (-> (PutObjectRequest/builder)
                  (.bucket bucket)
                  (.key (str prefix key))
                  (.contentType content-type)
                  (.cacheControl cache-control)
                  (.build))]
      (.putObject client ^PutObjectRequest req ^RequestBody (if (bytes? content)
                                                             (RequestBody/fromBytes ^bytes content)
                                                             (RequestBody/fromFile (io/file content))))
      (url-for this key)))
  (delete! [_ key]
    (try
      (let [^DeleteObjectRequest req (-> (DeleteObjectRequest/builder)
                                         (.bucket bucket) (.key (str prefix key)) (.build))]
        (.deleteObject client req))
      (catch Exception e (log/warn e "S3 delete failed" key))))
  (url-for [_ key] (str public-base "/" prefix key))
  (local-dir [_] nil))

(defn- env [k] (not-empty (some-> (System/getenv k) str/trim)))

(defn s3-config-from-env
  "Returns the S3 config map when S3 is configured, else nil."
  ([] (s3-config-from-env env))
  ([getenv]
   (let [bucket (getenv "S3_BUCKET")
         ak     (getenv "S3_ACCESS_KEY")
         sk     (getenv "S3_SECRET_KEY")]
     (when (and bucket ak sk)
       (let [endpoint (some-> (getenv "S3_ENDPOINT") (str/replace #"/+$" ""))
             region   (or (getenv "S3_REGION") (if endpoint "auto" "us-east-1"))
             prefix   (let [p (or (getenv "S3_PREFIX") "media/")]
                        (cond (= p "") ""
                              (str/ends-with? p "/") p
                              :else (str p "/")))
             path-style (if-let [v (getenv "S3_FORCE_PATH_STYLE")]
                          (= "true" (str/lower-case v))
                          (boolean endpoint))
             public-base (some-> (or (getenv "MEDIA_PUBLIC_BASE_URL")
                                     ;; Fallbacks: only MinIO / public AWS buckets
                                     ;; serve objects from the API endpoint.
                                     (if endpoint
                                       (str endpoint "/" bucket)
                                       (str "https://" bucket ".s3." region ".amazonaws.com")))
                                 (str/replace #"/+$" ""))]
         {:bucket bucket :access-key ak :secret-key sk :endpoint endpoint
          :region region :prefix prefix :path-style? path-style
          :public-base public-base
          :public-base-explicit? (boolean (getenv "MEDIA_PUBLIC_BASE_URL"))})))))

(defn s3-storage [{:keys [bucket access-key secret-key endpoint region prefix path-style? public-base]}]
  (let [^S3Configuration s3-conf (-> (S3Configuration/builder)
                                     (.pathStyleAccessEnabled (boolean path-style?))
                                     (.build))
        ^S3ClientBuilder b (S3Client/builder)]
    (.region b (Region/of region))
    (.credentialsProvider b (StaticCredentialsProvider/create
                             (AwsBasicCredentials/create access-key secret-key)))
    (.httpClient b (UrlConnectionHttpClient/create))
    (.serviceConfiguration b s3-conf)
    ;; R2/MinIO compatibility: only send checksums when an API requires them.
    (.requestChecksumCalculation b RequestChecksumCalculation/WHEN_REQUIRED)
    (.responseChecksumValidation b ResponseChecksumValidation/WHEN_REQUIRED)
    (when endpoint (.endpointOverride b (URI/create endpoint)))
    (->S3Storage (.build b) bucket prefix public-base)))

;; ---------------------------------------------------------------------------
;; Current storage

(def ^:dynamic *storage*
  "Bind to override the storage (tests)."
  nil)

(defonce ^:private default-storage
  (delay
    (if-let [cfg (s3-config-from-env)]
      (do (log/info "[media] S3 storage: bucket" (:bucket cfg) "endpoint" (or (:endpoint cfg) "AWS")
                    "public base" (:public-base cfg))
          (when-not (:public-base-explicit? cfg)
            (log/warn "[media] MEDIA_PUBLIC_BASE_URL is not set; Cloudflare R2 buckets need it (custom domain or r2.dev URL)."))
          (s3-storage cfg))
      (do (log/info "[media] S3 not configured, storing media on local disk:" (str (default-local-dir)))
          (local-storage)))))

(defn storage [] (or *storage* @default-storage))
