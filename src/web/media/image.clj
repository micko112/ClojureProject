(ns web.media.image
  "Pure-JVM image pipeline: content sniffing by magic bytes, EXIF
   auto-rotation, metadata stripping (every output is re-encoded from pixels,
   so EXIF/GPS/XMP never survive), resized JPEG renditions and a tiny blurred
   placeholder data URI.

   Decoding: javax.imageio + TwelveMonkeys plugins (WebP, robust JPEG incl.
   CMYK). Resizing: Thumbnailator. EXIF: metadata-extractor."
  (:require [clojure.java.io :as io])
  (:import (java.awt Color RenderingHints)
           (java.awt.geom AffineTransform)
           (java.awt.image BufferedImage ConvolveOp Kernel)
           (java.io ByteArrayOutputStream File InputStream)
           (java.security MessageDigest)
           (java.util Base64)
           (javax.imageio IIOImage ImageIO ImageReadParam ImageReader ImageWriteParam)
           (javax.imageio.stream ImageInputStream)
           (com.drew.imaging ImageMetadataReader)
           (com.drew.metadata.exif ExifIFD0Directory)
           (net.coobird.thumbnailator Thumbnails)))

(set! *warn-on-reflection* true)

;; ---------------------------------------------------------------------------
;; Sniffing

(defn read-head
  "First `n` bytes of a file (fewer if the file is shorter)."
  ^bytes [f n]
  (with-open [^InputStream in (io/input-stream f)]
    (let [buf (byte-array n)
          cnt (loop [off 0]
                (if (< off n)
                  (let [r (.read in buf off (- n off))]
                    (if (neg? r) off (recur (+ off r))))
                  off))]
      (java.util.Arrays/copyOf buf (int cnt)))))

(defn- ascii [^bytes b off len]
  (when (<= (+ off len) (alength b))
    (String. b (int off) (int len) "ISO-8859-1")))

(defn- u8 [^bytes b i] (bit-and (aget b i) 0xff))

(defn- starts-with? [^bytes b & xs]
  (and (>= (alength b) (count xs))
       (every? true? (map-indexed (fn [i x] (= (u8 b i) x)) xs))))

(def ^:private heif-brands #{"heic" "heix" "heim" "heis" "hevc" "hevx" "hevm" "hevs" "mif1" "msf1"})
(def ^:private avif-brands #{"avif" "avis"})
(def ^:private m4a-brands  #{"M4A " "M4B " "F4A "})

(defn sniff
  "Detects the real file type from its first bytes (never trusts the
   extension or the client's Content-Type). Returns one of
   :jpeg :png :webp :gif :heic :avif :mp4 :mov :webm :m4a :ogg :mp3 :wav, or nil."
  [^bytes b]
  (let [ftyp (= "ftyp" (ascii b 4 4))
        brand (when ftyp (ascii b 8 4))]
    (cond
      (starts-with? b 0xFF 0xD8 0xFF)                       :jpeg
      (starts-with? b 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A) :png
      (and (= "RIFF" (ascii b 0 4)) (= "WEBP" (ascii b 8 4))) :webp
      (and (= "RIFF" (ascii b 0 4)) (= "WAVE" (ascii b 8 4))) :wav
      (#{"GIF87a" "GIF89a"} (ascii b 0 6))                  :gif
      (and ftyp (heif-brands brand))                        :heic
      (and ftyp (avif-brands brand))                        :avif
      (and ftyp (m4a-brands brand))                         :m4a
      (and ftyp (= "qt  " brand))                           :mov
      ftyp                                                  :mp4
      ;; Old QuickTime files without ftyp
      (#{"moov" "mdat" "wide" "free" "skip" "pnot"} (ascii b 4 4)) :mov
      (starts-with? b 0x1A 0x45 0xDF 0xA3)                  :webm
      (= "OggS" (ascii b 0 4))                              :ogg
      (or (= "ID3" (ascii b 0 3))
          (and (>= (alength b) 2) (= 0xFF (u8 b 0)) (= 0xE0 (bit-and (u8 b 1) 0xE0)))) :mp3
      :else nil)))

(def kinds
  {:jpeg {:class :image :ext "jpg"  :mime "image/jpeg"}
   :png  {:class :image :ext "png"  :mime "image/png"}
   :webp {:class :image :ext "webp" :mime "image/webp"}
   :gif  {:class :gif   :ext "gif"  :mime "image/gif"}
   :heic {:class :heic  :ext "heic" :mime "image/heic"}
   :avif {:class :heic  :ext "avif" :mime "image/avif"}
   :mp4  {:class :video :ext "mp4"  :mime "video/mp4"}
   :mov  {:class :video :ext "mov"  :mime "video/quicktime"}
   :webm {:class :video :ext "webm" :mime "video/webm"}
   :m4a  {:class :audio :ext "m4a"  :mime "audio/mp4"}
   :ogg  {:class :audio :ext "ogg"  :mime "audio/ogg"}
   :mp3  {:class :audio :ext "mp3"  :mime "audio/mpeg"}
   :wav  {:class :audio :ext "wav"  :mime "audio/wav"}})

;; ---------------------------------------------------------------------------
;; Decoding

(def max-pixels
  "Images above this are rejected outright (decompression bombs)."
  (* 120 1000 1000))

(def decode-pixel-budget
  "Larger images are subsampled while decoding to bound heap use; outputs are
   at most 1080 px wide anyway."
  (* 16 1000 1000))

(defn exif-orientation
  "EXIF orientation 1..8 (1 when absent/unreadable)."
  [f]
  (try
    (let [md (ImageMetadataReader/readMetadata (io/file f))
          dir (.getFirstDirectoryOfType md ExifIFD0Directory)]
      (if (and dir (.containsTag dir ExifIFD0Directory/TAG_ORIENTATION))
        (let [o (.getInt dir ExifIFD0Directory/TAG_ORIENTATION)]
          (if (<= 1 o 8) o 1))
        1))
    (catch Throwable _ 1)))

(defn- with-reader [f g]
  (with-open [^ImageInputStream iis (ImageIO/createImageInputStream (io/file f))]
    (let [it (ImageIO/getImageReaders iis)]
      (when-not (.hasNext it)
        (throw (ex-info "No image reader" {:type ::unreadable})))
      (let [^ImageReader r (.next it)]
        (try
          (.setInput r iis true true)
          (g r)
          (finally (.dispose r)))))))

(defn dimensions
  "[width height] as stored (before EXIF rotation), without decoding pixels."
  [f]
  (with-reader f (fn [^ImageReader r] [(.getWidth r 0) (.getHeight r 0)])))

(defn decode
  "Decodes the first frame of an image file, subsampling huge images."
  ^BufferedImage [f]
  (with-reader f
    (fn [^ImageReader r]
      (let [w (.getWidth r 0) h (.getHeight r 0)
            px (* (long w) (long h))]
        (when (> px max-pixels)
          (throw (ex-info "Image has too many pixels" {:type ::too-many-pixels})))
        (let [param (.getDefaultReadParam r)
              ;; ceil: the decoded image must fit the budget (floor let up to ~4x through)
              s (long (Math/ceil (Math/sqrt (/ (double px) decode-pixel-budget))))
              ;; keep the LONG side >= 2160 px (legacy max side; renditions are
              ;; <= 1080 wide). Capping by the short side disabled subsampling
              ;; for panoramas: 16000x4000 decoded at full 64 Mpx.
              s (max 1 (min s (quot (max w h) 2160)))]
          (when (> s 1) (.setSourceSubsampling ^ImageReadParam param (int s) (int s) 0 0))
          (.read r 0 param))))))

;; ---------------------------------------------------------------------------
;; Transform

(defn- draw-transformed ^BufferedImage [^BufferedImage img nw nh ^AffineTransform tx]
  (let [out (BufferedImage. (int nw) (int nh) BufferedImage/TYPE_INT_RGB)
        g (.createGraphics out)]
    (try
      (.setColor g Color/WHITE)
      (.fillRect g 0 0 (int nw) (int nh))
      (.setRenderingHint g RenderingHints/KEY_INTERPOLATION RenderingHints/VALUE_INTERPOLATION_NEAREST_NEIGHBOR)
      (.drawImage g img tx nil)
      out
      (finally (.dispose g)))))

(defn orient
  "Applies an EXIF orientation (1..8) and flattens to opaque RGB (alpha over
   white), so the result needs no orientation tag."
  ^BufferedImage [^BufferedImage img orientation]
  (let [w (.getWidth img) h (.getHeight img)
        swap? (#{5 6 7 8} orientation)
        tx (case (int orientation)
             2 (AffineTransform. -1.0 0.0 0.0 1.0 (double w) 0.0)
             3 (AffineTransform. -1.0 0.0 0.0 -1.0 (double w) (double h))
             4 (AffineTransform. 1.0 0.0 0.0 -1.0 0.0 (double h))
             5 (AffineTransform. 0.0 1.0 1.0 0.0 0.0 0.0)
             6 (AffineTransform. 0.0 1.0 -1.0 0.0 (double h) 0.0)
             7 (AffineTransform. 0.0 -1.0 -1.0 0.0 (double h) (double w))
             8 (AffineTransform. 0.0 -1.0 1.0 0.0 0.0 (double w))
             (AffineTransform.))]
    (if (and (= 1 orientation) (= BufferedImage/TYPE_INT_RGB (.getType img)))
      img
      (draw-transformed img (if swap? h w) (if swap? w h) tx))))

(defn resize-to-width
  "High-quality downscale to `width` keeping aspect ratio. Never upscales.
   Output is opaque RGB unless `image-type` says otherwise."
  (^BufferedImage [img width] (resize-to-width img width BufferedImage/TYPE_INT_RGB))
  (^BufferedImage [^BufferedImage img width image-type]
   (if (>= width (.getWidth img))
     img
     (let [h (max 1 (Math/round (* (.getHeight img) (/ (double width) (.getWidth img)))))
           ^"[Ljava.awt.image.BufferedImage;" arr (into-array BufferedImage [img])]
       (-> (Thumbnails/of arr)
           (.size (int width) (int h))
           (.keepAspectRatio false)
           (.imageType (int image-type))
           (.asBufferedImage))))))

(defn fit-within
  "Downscales so the longest side is at most `max-side`."
  (^BufferedImage [img max-side] (fit-within img max-side BufferedImage/TYPE_INT_RGB))
  (^BufferedImage [^BufferedImage img max-side image-type]
   (let [w (.getWidth img) h (.getHeight img)]
     (if (<= (max w h) max-side)
       img
       (resize-to-width img (max 1 (Math/round (* w (/ (double max-side) (max w h))))) image-type)))))

;; ---------------------------------------------------------------------------
;; Encoding

(defn encode-jpeg
  "Encodes as baseline/progressive JPEG with no metadata besides JFIF."
  ^bytes [^BufferedImage img quality]
  (let [writer (.next (ImageIO/getImageWritersByFormatName "jpeg"))
        param (.getDefaultWriteParam ^javax.imageio.ImageWriter writer)
        out (ByteArrayOutputStream.)]
    (.setCompressionMode param ImageWriteParam/MODE_EXPLICIT)
    (.setCompressionQuality param (float quality))
    (when (> (.getWidth img) 200)
      (.setProgressiveMode param ImageWriteParam/MODE_DEFAULT))
    (with-open [ios (ImageIO/createImageOutputStream out)]
      (.setOutput ^javax.imageio.ImageWriter writer ios)
      (.write ^javax.imageio.ImageWriter writer nil (IIOImage. img nil nil) param)
      (.dispose ^javax.imageio.ImageWriter writer))
    (.toByteArray out)))

(defn encode-png ^bytes [^BufferedImage img]
  (let [out (ByteArrayOutputStream.)]
    (ImageIO/write img "png" out)
    (.toByteArray out)))

(defn- box-blur ^BufferedImage [^BufferedImage img]
  (let [k (float-array 9 (float (/ 1.0 9)))
        op (ConvolveOp. (Kernel. 3 3 k) ConvolveOp/EDGE_NO_OP nil)]
    (.filter op img nil)))

(def placeholder-width 20)

(defn placeholder
  "Tiny (20 px wide) blurred JPEG as a data: URI, a few hundred bytes."
  [^BufferedImage img]
  (let [small (-> (resize-to-width (orient img 1) placeholder-width) box-blur)]
    (str "data:image/jpeg;base64,"
         (.encodeToString (Base64/getEncoder) (encode-jpeg small 0.6)))))

;; ---------------------------------------------------------------------------
;; Pipeline

(def rendition-widths [320 640 1080])

(defn rendition-targets
  "Widths to generate for an image `w` px wide: the standard widths below it
   plus min(w, 1080) as the largest; never upscales."
  [w]
  (let [top (min w (last rendition-widths))]
    (vec (distinct (concat (filter #(< % top) rendition-widths) [top])))))

(defn process
  "Decodes `f`, auto-rotates and strips metadata. Returns
   {:width :height :placeholder :renditions [{:w :bytes}]}; widths ascending,
   width/height are those of the largest rendition."
  [f]
  (let [img (orient (decode f) (exif-orientation f))
        renditions (mapv (fn [w] {:w w :bytes (encode-jpeg (resize-to-width img w) 0.82)})
                         (rendition-targets (.getWidth img)))
        top (resize-to-width img (:w (peek renditions)))]
    {:width (.getWidth top)
     :height (.getHeight top)
     :placeholder (placeholder img)
     :renditions renditions}))

(defn sanitize
  "Re-encodes an image for legacy uploads: rotated upright, metadata stripped,
   longest side <= `max-side`. PNG when the source has transparency, else JPEG.
   Returns {:bytes :ext :mime :width :height}."
  [f max-side]
  (let [raw (decode f)
        alpha? (.hasAlpha (.getColorModel raw))
        o (exif-orientation f)]
    (if alpha?
      ;; keep transparency (EXIF orientation on images with alpha is rare)
      (let [img (fit-within raw max-side BufferedImage/TYPE_INT_ARGB)]
        {:bytes (encode-png img) :ext "png" :mime "image/png"
         :width (.getWidth img) :height (.getHeight img)})
      (let [img (fit-within (orient raw o) max-side)]
        {:bytes (encode-jpeg img 0.85) :ext "jpg" :mime "image/jpeg"
         :width (.getWidth img) :height (.getHeight img)}))))

(defn sha256-hex [f]
  (let [md (MessageDigest/getInstance "SHA-256")
        buf (byte-array 65536)]
    (with-open [^InputStream in (io/input-stream f)]
      (loop []
        (let [n (.read in buf)]
          (when (pos? n) (.update md buf 0 n) (recur)))))
    (apply str (map #(format "%02x" (bit-and % 0xff)) (.digest md)))))
