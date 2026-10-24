(ns web.media-review-test
  "Regression tests for defects found while reviewing the media pipeline."
  (:require [clojure.test :refer :all]
            [clojure.java.io :as io]
            [datomic.api :as d]
            [project.system :as s]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.http :refer [user-e]]
            [web.media.image :as img]
            [web.media.storage :as storage])
  (:import (java.awt Color)
           (java.awt.image BufferedImage)
           (java.io ByteArrayOutputStream DataOutputStream File)
           (java.nio.file Files)
           (java.nio.file.attribute FileAttribute)
           (java.util.zip CRC32 Deflater DeflaterOutputStream)
           (javax.imageio ImageIO)))

(def ^:dynamic *dir* nil)

(defn- with-local-storage [f]
  (let [dir (.toFile (Files/createTempDirectory "media-review" (make-array FileAttribute 0)))]
    (binding [*dir* dir
              storage/*storage* (storage/local-storage dir)]
      (try (f)
           (finally (doseq [x (reverse (file-seq dir))] (.delete ^File x)))))))

(use-fixtures :each with-mem-db with-local-storage)

(defn- tmp-file ^File [suffix ^bytes content]
  (let [f (File/createTempFile "upload" suffix)]
    (.deleteOnExit f)
    (io/copy content f)
    f))

(defn- png ^bytes [w h color]
  (let [im (BufferedImage. w h BufferedImage/TYPE_INT_RGB)
        g (.createGraphics im)
        out (ByteArrayOutputStream.)]
    (.setColor g color) (.fillRect g 0 0 w h) (.dispose g)
    (ImageIO/write im "png" out)
    (.toByteArray out)))

(defn- upload! [user ^bytes content]
  (let [f (tmp-file ".png" content)
        r (api (assoc (request :post "/api/media" nil user)
                      :multipart-params {"file" {:tempfile f :filename "a.png"
                                                 :content-type "image/png" :size (.length f)}}))]
    (is (= 201 (:status r)) (:body r))
    (json-body r)))

(defn- stored-files [] (set (map #(.getName ^File %) (.listFiles ^File *dir*))))

(defn- call
  ([method uri user] (call method uri nil user))
  ([method uri body user] (api (request method uri body user))))

;; ---------------------------------------------------------------------------

(deftest deleting-a-post-cleans-up-its-media
  (let [m1 (upload! "Micko" (png 700 500 Color/RED))
        m2 (upload! "Micko" (png 700 500 Color/BLUE))
        shared (upload! "Micko" (png 700 500 Color/GREEN))
        p  (json-body (call :post "/api/posts" {:caption "two" :mediaIds [(:id m1) (:id m2) (:id shared)]} "Micko"))
        p2 (json-body (call :post "/api/posts" {:caption "reuses one" :mediaIds [(:id shared)]} "Micko"))
        before (stored-files)]
    (is (= 9 (count before)) "3 uploads x renditions")
    (call :post (str "/api/posts/" (:id p) "/like") "Uros")
    (is (seq (json-body (call :get "/api/notifications" "Micko"))))
    (is (= 200 (:status (call :delete (str "/api/posts/" (:id p)) "Micko"))))
    (let [db (d/db s/conn)]
      (testing "media only used by the deleted post is gone (entity and files)"
        (is (nil? (:media/url (d/entity db (Long/parseLong (:id m1))))))
        (is (nil? (:media/url (d/entity db (Long/parseLong (:id m2))))))
        (is (= 3 (count (stored-files)))))
      (testing "media still used by another post is kept"
        (is (:media/url (d/entity db (Long/parseLong (:id shared)))))
        (is (= 200 (:status (api (request :get (:url shared))))))
        (is (= [(:id shared)] (map :id (:media (json-body (call :get (str "/api/posts/" (:id p2)) "Micko")))))))
      (testing "notifications about the deleted post are removed"
        (is (empty? (json-body (call :get "/api/notifications" "Micko"))))))))

;; ---------------------------------------------------------------------------
;; Decompression bombs / heap: -Xmx512m in production.

(defn- png-chunk [^DataOutputStream out ^String type ^bytes data]
  (let [crc (CRC32.) tb (.getBytes type "ISO-8859-1")]
    (.update crc tb) (.update crc data)
    (.writeInt out (alength data)) (.write out tb) (.write out data)
    (.writeInt out (unchecked-int (.getValue crc)))))

(defn- gray-png
  "w x h 8-bit grayscale PNG, all black, built without allocating the image."
  ^bytes [w h]
  (let [bos (ByteArrayOutputStream.)
        out (DataOutputStream. bos)
        ihdr (let [b (ByteArrayOutputStream.) o (DataOutputStream. b)]
               (.writeInt o w) (.writeInt o h)
               (.write o (byte-array [8 0 0 0 0])) ; depth 8, gray, deflate, no filter, no interlace
               (.toByteArray b))
        idat (let [b (ByteArrayOutputStream.)
                   z (DeflaterOutputStream. b (Deflater. 9))
                   row (byte-array (inc w))]
               (dotimes [_ h] (.write z row))
               (.close z)
               (.toByteArray b))]
    (.write out (byte-array (map unchecked-byte [0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A])))
    (png-chunk out "IHDR" ihdr)
    (png-chunk out "IDAT" idat)
    (png-chunk out "IEND" (byte-array 0))
    (.toByteArray bos)))

(deftest panoramas-are-subsampled-while-decoding
  ;; A 16000x4000 phone panorama is 64 Mpx: decoded at full size it is
  ;; ~190 MB (3 bytes/px), plus a ~256 MB RGB copy in `orient` — more than
  ;; the whole 512 MB heap. The short side used to block subsampling.
  (let [f  (tmp-file ".png" (gray-png 16000 4000))
        im (img/decode f)]
    (is (<= (* (long (.getWidth im)) (.getHeight im)) img/decode-pixel-budget))
    (is (>= (.getWidth im) 2160) "still plenty for 1080 px renditions")))

(deftest legacy-upload-does-not-store-heic-with-metadata
  ;; /api/upload promises EXIF/GPS never get stored, but HEIC/AVIF (iPhone
  ;; photos picked on a desktop browser) can't be re-encoded and used to be
  ;; stored byte-for-byte, location included.
  (let [heic (byte-array (concat [0 0 0 24] (.getBytes "ftypheic" "ISO-8859-1") (byte-array 12)
                                 (.getBytes "Exif GPS 44.8125N 20.4612E" "ISO-8859-1")))
        f (tmp-file ".heic" heic)
        r (api (assoc (request :post "/api/upload" nil "Micko")
                      :multipart-params {"file" {:tempfile f :filename "IMG_0001.HEIC" :content-type "image/heic"}}))]
    (is (= 415 (:status r)))
    (is (empty? (stored-files)))))
