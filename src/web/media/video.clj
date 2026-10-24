(ns web.media.video
  "Minimal ISO-BMFF (MP4 / QuickTime) box walker: reads duration and display
   size, and strips user metadata in place.

   Stripping renames `udta` and `meta` boxes inside `moov` and each `trak` to
   `free`. Box sizes stay the same, so chunk offsets remain valid and players
   simply skip them. This removes e.g. the iPhone location
   (com.apple.quicktime.location.ISO6709 / ©xyz), device make/model and
   software tags."
  (:import (java.io File RandomAccessFile)))

(set! *warn-on-reflection* true)

(defn- read-type [^RandomAccessFile raf]
  (let [b (byte-array 4)]
    (.readFully raf b)
    (String. b "ISO-8859-1")))

(defn- box-at
  "Box header at `pos`, or nil when it doesn't fit in [pos, end)."
  [^RandomAccessFile raf pos end]
  (when (<= (+ pos 8) end)
    (.seek raf pos)
    (let [size32 (bit-and (long (.readInt raf)) 0xffffffff)
          type (read-type raf)
          [size hdr] (case size32
                       1 [(.readLong raf) 16]
                       0 [(- end pos) 8]
                       [size32 8])]
      (when (and (>= size hdr) (<= (+ pos size) end))
        {:type type :pos pos :size size :body (+ pos hdr) :end (+ pos size)}))))

(defn- children [raf start end]
  (loop [pos start acc []]
    (if-let [b (and (< (count acc) 10000) (box-at raf pos end))]
      (recur (:end b) (conj acc b))
      acc)))

(defn- child [raf parent type]
  (first (filter #(= type (:type %)) (children raf (:body parent) (:end parent)))))

(defn- fixed16 [^long v] (/ (double v) 65536.0))

(defn- parse-mvhd [^RandomAccessFile raf box]
  (.seek raf (:body box))
  (let [version (.readUnsignedByte raf)]
    (.skipBytes raf 3)
    (if (= 1 version)
      (do (.skipBytes raf 16)
          (let [ts (bit-and (long (.readInt raf)) 0xffffffff) dur (.readLong raf)]
            (when (pos? ts) (/ (double dur) ts))))
      (do (.skipBytes raf 8)
          (let [ts (bit-and (long (.readInt raf)) 0xffffffff)
                dur (bit-and (long (.readInt raf)) 0xffffffff)]
            (when (pos? ts) (/ (double dur) ts)))))))

(defn- parse-tkhd
  "[display-width display-height] of a track (rotation applied), nil for
   tracks without a visual size."
  [^RandomAccessFile raf box]
  (.seek raf (:body box))
  (let [version (.readUnsignedByte raf)]
    (.skipBytes raf 3)
    (.skipBytes raf (if (= 1 version) 32 20))
    (.skipBytes raf 16)                    ; reserved(8) layer alt-group volume reserved
    (let [a (.readInt raf) b (.readInt raf)]
      (.skipBytes raf 28)                  ; rest of the 3x3 matrix
      (let [w (Math/round (fixed16 (bit-and (long (.readInt raf)) 0xffffffff)))
            h (Math/round (fixed16 (bit-and (long (.readInt raf)) 0xffffffff)))
            rotated? (and (zero? a) (not (zero? b)))]
        (when (and (pos? w) (pos? h))
          (if rotated? [h w] [w h]))))))

(defn probe
  "{:duration seconds :width :height} for an MP4/MOV file; missing keys when
   not found. Never throws."
  [f]
  (try
    (with-open [raf (RandomAccessFile. ^File (clojure.java.io/file f) "r")]
      (let [len (.length raf)
            moov (first (filter #(= "moov" (:type %)) (children raf 0 len)))]
        (if-not moov
          {}
          (let [mvhd (child raf moov "mvhd")
                traks (filter #(= "trak" (:type %)) (children raf (:body moov) (:end moov)))
                dims (some (fn [t] (some->> (child raf t "tkhd") (parse-tkhd raf))) traks)]
            (cond-> {}
              mvhd (assoc :duration (parse-mvhd raf mvhd))
              dims (assoc :width (first dims) :height (second dims)))))))
    (catch Exception _ {})))

(def ^:private strip-types #{"udta" "meta"})

(defn strip-metadata!
  "Renames metadata boxes to `free` in place. Returns the number of boxes
   neutralised. Never throws."
  [f]
  (try
    (with-open [raf (RandomAccessFile. ^File (clojure.java.io/file f) "rw")]
      (let [len (.length raf)
            top (children raf 0 len)
            moovs (filter #(= "moov" (:type %)) top)
            containers (concat moovs
                               (mapcat (fn [m] (filter #(= "trak" (:type %))
                                                       (children raf (:body m) (:end m))))
                                       moovs))
            targets (concat (filter #(strip-types (:type %)) top)
                            (mapcat (fn [c] (filter #(strip-types (:type %))
                                                    (children raf (:body c) (:end c))))
                                    containers))]
        (doseq [b targets]
          (.seek raf (+ (:pos b) 4))
          (.write raf (.getBytes "free" "ISO-8859-1")))
        (count targets)))
    (catch Exception _ 0)))
