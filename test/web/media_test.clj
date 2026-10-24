(ns web.media-test
  (:require [clojure.test :refer :all]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.media :as media]
            [web.media.image :as img]
            [web.media.storage :as storage]
            [web.media.video :as video])
  (:import (java.awt Color)
           (java.awt.image BufferedImage)
           (java.io ByteArrayOutputStream File)
           (java.nio.file Files)
           (java.nio.file.attribute FileAttribute)
           (javax.imageio ImageIO IIOImage ImageTypeSpecifier)
           (javax.imageio.metadata IIOMetadataNode)))

;; ---------------------------------------------------------------------------
;; Fixtures: in-memory Datomic + throwaway local storage dir

(def ^:dynamic *dir* nil)

(defn- temp-dir ^File []
  (.toFile (Files/createTempDirectory "media-test" (make-array FileAttribute 0))))

(defn- with-local-storage [f]
  (let [dir (temp-dir)]
    (binding [*dir* dir
              storage/*storage* (storage/local-storage dir)]
      (try (f)
           (finally (doseq [x (reverse (file-seq dir))] (.delete ^File x)))))))

(use-fixtures :each with-mem-db with-local-storage)

;; ---------------------------------------------------------------------------
;; Helpers

(defn- two-tone
  "w x h image: left half red, right half blue."
  ^BufferedImage [w h]
  (let [im (BufferedImage. w h BufferedImage/TYPE_INT_RGB)
        g (.createGraphics im)]
    (.setColor g Color/RED)  (.fillRect g 0 0 (quot w 2) h)
    (.setColor g Color/BLUE) (.fillRect g (quot w 2) 0 (- w (quot w 2)) h)
    (.dispose g)
    im))

(defn- red? [rgb] (let [r (bit-and (bit-shift-right rgb 16) 0xff) b (bit-and rgb 0xff)] (and (> r 200) (< b 60))))
(defn- blue? [rgb] (let [r (bit-and (bit-shift-right rgb 16) 0xff) b (bit-and rgb 0xff)] (and (< r 60) (> b 200))))

(defn- tmp-file ^File [suffix ^bytes content]
  (let [f (File/createTempFile "upload" suffix)]
    (.deleteOnExit f)
    (io/copy content f)
    f))

(defn- png-bytes ^bytes [^BufferedImage im]
  (let [out (ByteArrayOutputStream.)] (ImageIO/write im "png" out) (.toByteArray out)))

(defn- jpeg-with-comment
  "JPEG whose metadata carries a COM marker with `text` (stand-in for EXIF/GPS)."
  ^bytes [^BufferedImage im text]
  (let [writer (.next (ImageIO/getImageWritersByFormatName "jpeg"))
        param (.getDefaultWriteParam writer)
        meta (.getDefaultImageMetadata writer (ImageTypeSpecifier/createFromRenderedImage im) param)
        root (.getAsTree meta "javax_imageio_jpeg_image_1.0")
        seq-node (.item (.getElementsByTagName ^IIOMetadataNode root "markerSequence") 0)
        com (doto (IIOMetadataNode. "com") (.setAttribute "comment" text))
        out (ByteArrayOutputStream.)]
    (.appendChild seq-node com)
    (.setFromTree meta "javax_imageio_jpeg_image_1.0" root)
    (with-open [ios (ImageIO/createImageOutputStream out)]
      (.setOutput writer ios)
      (.write writer nil (IIOImage. im nil meta) param))
    (.toByteArray out)))

(defn- upload-req [user parts]
  (assoc (request :post "/api/media" nil user)
         :multipart-params
         (into {} (map (fn [[k v]]
                         [k (if (instance? File v)
                              {:tempfile v :filename (.getName ^File v)
                               :content-type "application/octet-stream" :size (.length ^File v)}
                              v)])
                       parts))))

(defn- bytes-contain? [^bytes hay ^String needle]
  (str/includes? (String. hay "ISO-8859-1") needle))

;; ---------------------------------------------------------------------------
;; Pure image pipeline

(deftest sniff-detects-real-types
  (is (= :png (img/sniff (png-bytes (two-tone 4 4)))))
  (is (= :jpeg (img/sniff (img/encode-jpeg (two-tone 4 4) 0.8))))
  (is (= :webm (img/sniff (byte-array (map unchecked-byte [0x1A 0x45 0xDF 0xA3 0 0 0 0])))))
  (is (= :mp4 (img/sniff (.getBytes "\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0002\u0000" "ISO-8859-1"))))
  (is (= :mov (img/sniff (.getBytes "\u0000\u0000\u0000\u0014ftypqt  \u0000\u0000\u0000\u0000" "ISO-8859-1"))))
  (is (= :heic (img/sniff (.getBytes "\u0000\u0000\u0000\u0018ftypheic\u0000\u0000\u0000\u0000" "ISO-8859-1"))))
  (is (nil? (img/sniff (.getBytes "<html><script>alert(1)</script>" "UTF-8")))))

(deftest rendition-targets-never-upscale
  (is (= [320 640 1080] (img/rendition-targets 4000)))
  (is (= [320 640 1080] (img/rendition-targets 1080)))
  (is (= [320 500] (img/rendition-targets 500)))
  (is (= [200] (img/rendition-targets 200))))

(deftest orient-rotates-by-exif
  (let [src (two-tone 40 20)
        r6 (img/orient src 6)          ; 90 deg clockwise: left half -> top
        r8 (img/orient src 8)          ; 90 deg counter-clockwise: left half -> bottom
        r3 (img/orient src 3)]         ; 180
    (is (= [20 40] [(.getWidth r6) (.getHeight r6)]))
    (is (red? (.getRGB r6 10 5)))
    (is (blue? (.getRGB r6 10 35)))
    (is (blue? (.getRGB r8 10 5)))
    (is (red? (.getRGB r8 10 35)))
    (is (= [40 20] [(.getWidth r3) (.getHeight r3)]))
    (is (blue? (.getRGB r3 5 10)))
    (is (red? (.getRGB r3 35 10)))))

(deftest process-resizes-strips-and-makes-placeholder
  (let [f (tmp-file ".jpg" (jpeg-with-comment (two-tone 1600 1200) "GPS 44.8125N 20.4612E secret"))
        {:keys [width height placeholder renditions]} (img/process f)]
    (testing "renditions at standard widths, ascending, aspect kept"
      (is (= [320 640 1080] (mapv :w renditions)))
      (is (= [1080 810] [width height]))
      (doseq [{:keys [w bytes]} renditions]
        (let [im (ImageIO/read (io/input-stream bytes))]
          (is (= w (.getWidth im)))
          (is (= (Math/round (* w 0.75)) (.getHeight im))))))
    (testing "metadata is stripped from every rendition"
      (is (bytes-contain? (Files/readAllBytes (.toPath f)) "secret") "fixture really has metadata")
      (doseq [{:keys [bytes]} renditions]
        (is (not (bytes-contain? bytes "secret")))
        (is (not (bytes-contain? bytes "Exif")))))
    (testing "placeholder is a tiny jpeg data URI"
      (is (str/starts-with? placeholder "data:image/jpeg;base64,"))
      (is (< (count placeholder) 2000))
      (let [b (.decode (java.util.Base64/getDecoder) (subs placeholder (count "data:image/jpeg;base64,")))
            im (ImageIO/read (io/input-stream b))]
        (is (= img/placeholder-width (.getWidth im)))
        (is (= 15 (.getHeight im)))))))

(deftest small-images-are-not-upscaled
  (let [f (tmp-file ".png" (png-bytes (two-tone 300 600)))
        {:keys [width height renditions]} (img/process f)]
    (is (= [300] (mapv :w renditions)))
    (is (= [300 600] [width height]))))

;; ---------------------------------------------------------------------------
;; MP4 metadata stripping

(defn- box ^bytes [type & bodies]
  (let [body (byte-array (mapcat seq bodies))
        out (java.io.ByteArrayOutputStream.)
        size (+ 8 (alength body))]
    (.write out (byte-array (map unchecked-byte [(bit-shift-right size 24) (bit-shift-right size 16)
                                                 (bit-shift-right size 8) size])))
    (.write out (.getBytes ^String type "ISO-8859-1"))
    (.write out body)
    (.toByteArray out)))

(defn- int-bytes [& xs]
  (byte-array (mapcat (fn [x] (map #(unchecked-byte (bit-shift-right x %)) [24 16 8 0])) xs)))

(deftest mp4-probe-and-strip
  (let [mvhd (box "mvhd" (byte-array 4) (int-bytes 0 0 1000 12500) (byte-array 80))
        ;; tkhd v0 with a 90-degree rotation matrix and 1920x1080
        tkhd (box "tkhd" (byte-array 4) (int-bytes 0 0 1 0 0) (byte-array 16)
                  (int-bytes 0 0x10000 0 -0x10000 0 0 0 0 0x40000000)
                  (int-bytes (* 1920 65536) (* 1080 65536)))
        udta (box "udta" (box "©xyz" (.getBytes "+44.8125+020.4612/" "ISO-8859-1")))
        file (tmp-file ".mp4" (byte-array (concat (box "ftyp" (.getBytes "isom" "ISO-8859-1") (byte-array 4))
                                                  (box "moov" mvhd (box "trak" tkhd) udta)
                                                  (box "mdat" (byte-array 16)))))]
    (is (= :mp4 (img/sniff (img/read-head file 32))))
    (is (= {:duration 12.5 :width 1080 :height 1920} (video/probe file)))
    (is (= 1 (video/strip-metadata! file)))
    (let [bs (java.nio.file.Files/readAllBytes (.toPath file))]
      (is (not (bytes-contain? bs "udta")))
      (is (bytes-contain? bs "moov")))
    (is (= 12.5 (:duration (video/probe file))) "still parseable after stripping")))

;; ---------------------------------------------------------------------------
;; Endpoint (local storage)

(deftest upload-requires-auth
  (let [f (tmp-file ".png" (png-bytes (two-tone 50 50)))]
    (is (= 401 (:status (api (upload-req nil {"file" f})))))))

(deftest upload-rejects-fake-image
  (let [f (tmp-file ".jpg" (.getBytes "<svg onload=alert(1)>definitely not a jpeg</svg>" "UTF-8"))
        r (api (upload-req "Micko" {"file" f}))]
    (is (= 415 (:status r)))
    (is (re-find #"Unsupported" (:error (json-body r))))
    (is (empty? (.listFiles ^File *dir*)) "nothing stored")))

(deftest upload-rejects-missing-file
  (is (= 400 (:status (api (upload-req "Micko" {}))))))

(deftest upload-image-returns-media-dto
  (let [f (tmp-file ".jpg" (jpeg-with-comment (two-tone 1400 1000) "GPS secret"))
        r (api (upload-req "Micko" {"file" f}))
        m (json-body r)]
    (is (= 201 (:status r)))
    (is (= "image" (:type m)))
    (is (= [1080 771] [(:width m) (:height m)]))
    (is (= [320 640 1080] (mapv :w (:variants m))))
    (is (= (:url (last (:variants m))) (:url m)))
    (is (str/starts-with? (:placeholder m) "data:image/jpeg;base64,"))
    (is (every? #(str/starts-with? (:url %) "/uploads/") (:variants m)))
    (testing "files exist, are served with long cache headers and have no metadata"
      (let [fname (subs (:url m) (count "/uploads/"))
            resp (api (request :get (:url m)))]
        (is (.isFile (io/file *dir* fname)))
        (is (= 200 (:status resp)))
        (is (= "image/jpeg" (get-in resp [:headers "Content-Type"])))
        (is (str/includes? (get-in resp [:headers "Cache-Control"]) "max-age=31536000"))
        (is (not (bytes-contain? (java.nio.file.Files/readAllBytes (.toPath (io/file *dir* fname))) "secret")))))
    (testing "range requests"
      (let [resp (api (assoc-in (request :get (:url m)) [:headers "range"] "bytes=0-9"))]
        (is (= 206 (:status resp)))
        (is (= "10" (get-in resp [:headers "Content-Length"])))
        (is (= 10 (count (.readAllBytes ^java.io.InputStream (:body resp)))))))
    (testing "entity stored and media-dto round-trips"
      (let [db (d/db s/conn)
            eid (Long/parseLong (:id m))
            owner (d/q '[:find ?e . :where [?e :user/username "Micko"]] db)]
        (is (= m (media/media-dto db eid)))
        (is (= eid (media/owned-media-eid db owner (:id m))))
        (is (nil? (media/owned-media-eid db (inc owner) (:id m))))
        (is (= 64 (count (:media/hash (d/entity db eid)))))))))

(deftest upload-video-with-poster
  (let [mvhd (box "mvhd" (byte-array 4) (int-bytes 0 0 600 1800) (byte-array 80))
        video (tmp-file ".mp4" (byte-array (concat (box "ftyp" (.getBytes "isom" "ISO-8859-1") (byte-array 4))
                                                   (box "moov" mvhd)
                                                   (box "mdat" (byte-array 64)))))
        poster (tmp-file ".jpg" (img/encode-jpeg (two-tone 720 1280) 0.8))
        r (api (upload-req "Micko" {"file" video "poster" poster "width" "720" "height" "1280"}))
        m (json-body r)]
    (is (= 201 (:status r)))
    (is (= "video" (:type m)))
    (is (str/ends-with? (:url m) ".mp4"))
    (is (= 3.0 (:durationSec m)))
    (is (= [720 1280] [(:width m) (:height m)]))
    (is (str/ends-with? (:posterUrl m) "_poster.jpg"))
    (is (str/starts-with? (:placeholder m) "data:image/jpeg"))
    (is (= "video/mp4" (get-in (api (request :get (:url m))) [:headers "Content-Type"])))))

(deftest legacy-upload-still-works
  (let [f (tmp-file ".png" (png-bytes (two-tone 3000 100)))
        r (api (assoc (request :post "/api/upload" nil "Micko")
                      :multipart-params {"file" {:tempfile f :filename "a.png" :content-type "image/png"}}))
        {:keys [url]} (json-body r)]
    (is (= 200 (:status r)))
    (is (str/starts-with? url "/uploads/"))
    (let [im (ImageIO/read (io/file *dir* (subs url (count "/uploads/"))))]
      (is (= 2160 (.getWidth im)) "downscaled to the legacy max side"))
    (is (= 415 (:status (api (assoc (request :post "/api/upload" nil "Micko")
                                    :multipart-params {"file" {:tempfile (tmp-file ".html" (.getBytes "<html>" "UTF-8"))
                                                               :filename "x.html"}})))))))

(deftest serve-rejects-traversal
  (is (= 404 (:status (api (request :get "/uploads/..%2Fproject.clj")))))
  (is (= 404 (:status (api (request :get "/uploads/missing.jpg"))))))

(deftest s3-config-from-env
  (is (nil? (storage/s3-config-from-env {})))
  (let [cfg (storage/s3-config-from-env
             {"S3_BUCKET" "bb" "S3_ACCESS_KEY" "a" "S3_SECRET_KEY" "s"
              "S3_ENDPOINT" "https://acc.r2.cloudflarestorage.com/"
              "MEDIA_PUBLIC_BASE_URL" "https://media.example.com/"})]
    (is (= "auto" (:region cfg)))
    (is (= "media/" (:prefix cfg)))
    (is (true? (:path-style? cfg)))
    (is (= "https://media.example.com" (:public-base cfg)))
    (is (= "https://media.example.com/media/x.jpg"
           (storage/url-for (storage/->S3Storage nil "bb" (:prefix cfg) (:public-base cfg)) "x.jpg"))))
  (testing "s3 client builds for R2-style config without network"
    (is (some? (storage/s3-storage (storage/s3-config-from-env
                                    {"S3_BUCKET" "bb" "S3_ACCESS_KEY" "a" "S3_SECRET_KEY" "s"
                                     "S3_ENDPOINT" "http://localhost:9000"}))))))
