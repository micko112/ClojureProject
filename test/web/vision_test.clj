(ns web.vision-test
  (:require [clojure.test :refer :all]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [datomic.api :as d]
            [project.system :as s]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.media.image :as img]
            [web.media.storage :as storage]
            [web.vision :as vision])
  (:import (java.awt Color)
           (java.awt.image BufferedImage)
           (java.io File)
           (java.net ConnectException ServerSocket)
           (java.nio.file Files)
           (java.nio.file.attribute FileAttribute)))

;; ---------------------------------------------------------------------------
;; Fixtures: in-memory Datomic, throwaway local storage, fresh circuit breaker

(defn- with-local-storage [f]
  (let [dir (.toFile (Files/createTempDirectory "vision-test" (make-array FileAttribute 0)))]
    (binding [storage/*storage* (storage/local-storage dir)]
      (try (f)
           (finally (doseq [x (reverse (file-seq dir))] (.delete ^File x)))))))

(defn- with-fresh-breaker [f]
  (vision/reset-breaker!)
  (try (f) (finally (vision/reset-breaker!))))

(use-fixtures :each with-mem-db with-local-storage with-fresh-breaker)

;; ---------------------------------------------------------------------------
;; Helpers

(def embedding (vec (for [i (range 512)] (/ (double (- (mod i 7) 3)) 100.0))))

(defn- ml-ok
  "Stub for vision/ml-request: classify answers `labels`; records calls."
  [calls labels]
  (fn [method path opts]
    (swap! calls conj {:method method :path path :opts opts})
    (cond
      (re-find #"^/classify" path)
      {:status 200 :body (json/generate-string
                          (cond-> {:labels labels :model "zero-shot" :embeddingModel "clip-test"}
                            (re-find #"embedding=1" path) (assoc :embedding embedding)))}
      (= "/train" path)
      {:status 200 :body (json/generate-string {:trained true :examples 3 :valAccuracy 1.0
                                                :model "head+zero-shot"})}
      (= "/health" path)
      {:status 200 :body (json/generate-string {:status "ok" :model "zero-shot"})}
      :else {:status 404 :body "{}"})))

(def running-labels [{:activity "running" :score 0.87} {:activity "walking" :score 0.08}
                     {:activity "other" :score 0.03}])

(defmacro with-ml [calls labels & body]
  `(with-redefs [vision/ml-url (constantly "http://ml.test:8000")
                 vision/ml-request (ml-ok ~calls ~labels)]
     ~@body))

(defn- jpeg-file ^File []
  (let [im (BufferedImage. 800 600 BufferedImage/TYPE_INT_RGB)
        g (.createGraphics im)]
    (.setColor g Color/ORANGE) (.fillRect g 0 0 800 600)
    (.dispose g)
    (let [f (File/createTempFile "vision" ".jpg")]
      (.deleteOnExit f)
      (io/copy (img/encode-jpeg im 0.85) f)
      f)))

(defn- upload-req [user parts]
  (assoc (request :post "/api/media" nil user)
         :multipart-params
         (into {} (map (fn [[k v]]
                         [k (if (instance? File v)
                              {:tempfile v :filename (.getName ^File v)
                               :content-type "application/octet-stream" :size (.length ^File v)}
                              v)])
                       parts))))

(defn- upload! [user]
  (let [r (api (upload-req user {"file" (jpeg-file)}))]
    (is (= 201 (:status r)))
    (json-body r)))

(defn- labels-of [pid]
  (d/q '[:find ?a ?src :in $ ?p :where [?l :vision-label/post ?p] [?l :vision-label/activity ?a]
         [?l :vision-label/source ?src]]
       (d/db s/conn) pid))

;; ---------------------------------------------------------------------------
;; Pure parts

(deftest normalize-activity-maps-tags-to-class-keys
  (is (= "running" (vision/normalize-activity "Running")))
  (is (= "running" (vision/normalize-activity "#jogging")))
  (is (= "gym" (vision/normalize-activity "workout")))
  (is (= "gym" (vision/normalize-activity "gym")))
  (is (= "cold-shower" (vision/normalize-activity "Cold shower")))
  (is (= "cold-shower" (vision/normalize-activity "coldshower")))
  (is (= "martial-arts" (vision/normalize-activity "martial_arts")))
  (is (= "studying" (vision/normalize-activity "study")))
  (is (= "cycling" (vision/normalize-activity " bike ")))
  (is (nil? (vision/normalize-activity "other")))
  (is (nil? (vision/normalize-activity "day 12")))
  (is (nil? (vision/normalize-activity "")))
  (is (nil? (vision/normalize-activity nil))))

(deftest embedding-bytes-round-trip
  (let [b (vision/floats->bytes embedding)]
    (is (= 2048 (alength ^bytes b)))
    (is (every? true? (map #(< (Math/abs (- (double %1) (double %2))) 1e-6)
                           embedding (vision/bytes->floats b))))))

(deftest suggestions-skip-other-and-tiny-scores
  (is (= [{:activity "running" :score 0.87 :label "Running" :emoji "🏃"}
          {:activity "walking" :score 0.08 :label "Walking" :emoji "🚶"}]
         (vision/suggestions-dto running-labels))))

;; ---------------------------------------------------------------------------
;; Upload

(deftest upload-includes-suggestions-and-stores-embedding
  (let [calls (atom [])]
    (with-ml calls running-labels
      (let [m (upload! "Micko")
            e (d/entity (d/db s/conn) (parse-long (:id m)))]
        (is (= ["running" "walking"] (mapv :activity (:suggestions m))))
        (is (= "🏃" (:emoji (first (:suggestions m)))))
        (is (= 0.87 (:score (first (:suggestions m)))))
        (is (= "/classify?top=3&embedding=1" (:path (first @calls))))
        (is (bytes? (get-in (first @calls) [:opts :body])) "sends a JPEG rendition, not the original")
        (is (= "clip-test" (:media/embedding-model e)))
        (is (= 512 (count (vision/bytes->floats (:media/embedding e)))))
        (is (string? (:media/predictions e)))))))

(deftest upload-works-when-ml-is-down
  (let [calls (atom 0)]
    (with-redefs [vision/ml-url (constantly "http://ml.test:8000")
                  vision/ml-request (fn [& _] (swap! calls inc) (throw (ConnectException. "Connection refused")))]
      (let [m1 (upload! "Micko")
            m2 (upload! "Micko")]
        (is (empty? (:suggestions m1)))
        (is (empty? (:suggestions m2)))
        (is (string? (:url m1)))
        (is (= 1 @calls) "circuit breaker: the second upload doesn't wait for the dead service")
        (is (nil? (:media/embedding (d/entity (d/db s/conn) (parse-long (:id m1))))))))))

(deftest upload-does-not-wait-for-a-hanging-ml-service
  ;; Real HTTP client against a socket that accepts but never answers.
  (with-open [ss (ServerSocket. 0)]
    (let [held (atom [])
          acceptor (future (try (loop [] (swap! held conj (.accept ss)) (recur)) (catch Exception _)))]
      (try
        (with-redefs [vision/ml-url (constantly (str "http://127.0.0.1:" (.getLocalPort ss)))
                      vision/timeout-ms (constantly 300)]
          (let [t0 (System/currentTimeMillis)
                m (upload! "Micko")
                ms (- (System/currentTimeMillis) t0)]
            (is (empty? (:suggestions m)))
            (is (< ms 3000) (str "upload took " ms " ms"))))
        (finally
          (future-cancel acceptor)
          (doseq [^java.net.Socket s @held] (.close s)))))))

(deftest upload-without-ml-url-never-calls-the-service
  (let [called (atom false)]
    (with-redefs [vision/ml-url (constantly nil)
                  vision/ml-request (fn [& _] (reset! called true) nil)]
      (is (empty? (:suggestions (upload! "Micko"))))
      (is (false? @called)))))

(deftest ml-errors-and-garbage-answers-are-ignored
  (with-redefs [vision/ml-url (constantly "http://ml.test:8000")
                vision/ml-request (fn [& _] {:status 200 :body "{\"labels\": [{\"activity\": \"teleporting\", \"score\": 0.99}]}"})]
    (is (empty? (:suggestions (upload! "Micko"))))))

(deftest video-is-classified-from-its-poster
  (let [calls (atom [])
        video (doto (File/createTempFile "video" ".webm") (.deleteOnExit))
        _ (io/copy (byte-array (map unchecked-byte [0x1A 0x45 0xDF 0xA3 0 0 0 0 0 0 0 0])) video)]
    (with-ml calls running-labels
      (let [r (api (upload-req "Micko" {"file" video "poster" (jpeg-file) "width" "800" "height" "600"}))
            m (json-body r)]
        (is (= 201 (:status r)))
        (is (= "video" (:type m)))
        (is (= "running" (:activity (first (:suggestions m)))))
        (is (= 1 (count @calls)))))))

(deftest feed-media-dto-has-no-suggestions
  (let [calls (atom [])]
    (with-ml calls running-labels
      (let [m (upload! "Micko")
            p (json-body (api (request :post "/api/posts" {:caption "Day 3" :mediaIds [(:id m)]} "Micko")))]
        (is (not (contains? (first (:media p)) :suggestions)))))))

;; ---------------------------------------------------------------------------
;; Composer preview classify

(deftest classify-endpoint
  (let [calls (atom [])]
    (with-ml calls running-labels
      (let [req (assoc (request :post "/api/vision/classify" nil "Micko")
                       :multipart-params {"file" {:tempfile (jpeg-file) :filename "a.jpg"}})
            r (api req)]
        (is (= 200 (:status r)))
        (is (= "running" (-> r json-body :suggestions first :activity)))
        (is (= "/classify?top=3" (:path (first @calls))) "no embedding needed for a preview")
        (is (= 401 (:status (api (dissoc req :session))))))))
  (with-redefs [vision/ml-url (constantly nil)]
    (let [r (api (assoc (request :post "/api/vision/classify" nil "Micko")
                        :multipart-params {"file" {:tempfile (jpeg-file) :filename "a.jpg"}}))]
      (is (= 200 (:status r)))
      (is (= [] (:suggestions (json-body r)))))))

;; ---------------------------------------------------------------------------
;; Labels from posts

(deftest label-stored-on-post-create
  (let [calls (atom [])]
    (with-ml calls running-labels
      (testing "tag equal to the top suggestion -> confirmed"
        (let [m (upload! "Micko")
              p (json-body (api (request :post "/api/posts" {:caption "5k" :mediaIds [(:id m)]
                                                             :activityTag "Running"} "Micko")))]
          (is (= #{["running" :confirmed]} (labels-of (parse-long (:id p)))))))
      (testing "different tag -> corrected, normalized to the class key"
        (let [m (upload! "Micko")
              p (json-body (api (request :post "/api/posts" {:caption "legs" :mediaIds [(:id m)]
                                                             :activityTag "#workout"} "Micko")))]
          (is (= #{["gym" :corrected]} (labels-of (parse-long (:id p)))))))
      (testing "unknown tag or no tag -> no label"
        (let [m1 (upload! "Micko")
              m2 (upload! "Micko")
              p1 (json-body (api (request :post "/api/posts" {:mediaIds [(:id m1)] :activityTag "day 12"} "Micko")))
              p2 (json-body (api (request :post "/api/posts" {:mediaIds [(:id m2)]} "Micko")))]
          (is (empty? (labels-of (parse-long (:id p1)))))
          (is (empty? (labels-of (parse-long (:id p2))))))))))

(deftest carousel-labels-only-the-cover
  (let [calls (atom [])]
    (with-ml calls running-labels
      (let [ms (repeatedly 3 #(upload! "Micko"))
            p (json-body (api (request :post "/api/posts" {:mediaIds (mapv :id ms) :activityTag "running"} "Micko")))
            labelled (d/q '[:find [?m ...] :in $ ?p :where [?l :vision-label/post ?p] [?l :vision-label/media ?m]]
                          (d/db s/conn) (parse-long (:id p)))]
        (is (= [(parse-long (:id (first ms)))] labelled))))))

(deftest editing-the-tag-updates-and-deleting-the-post-removes-labels
  (let [calls (atom [])]
    (with-ml calls running-labels
      (let [m (upload! "Micko")
            pid (:id (json-body (api (request :post "/api/posts" {:mediaIds [(:id m)] :activityTag "running"} "Micko"))))]
        (api (request :put (str "/api/posts/" pid) {:activityTag "walking"} "Micko"))
        (is (= #{["walking" :corrected]} (labels-of (parse-long pid))))
        (api (request :put (str "/api/posts/" pid) {:activityTag ""} "Micko"))
        (is (empty? (labels-of (parse-long pid))))
        (api (request :put (str "/api/posts/" pid) {:activityTag "run"} "Micko"))
        (is (= #{["running" :confirmed]} (labels-of (parse-long pid))))
        (is (= 200 (:status (api (request :delete (str "/api/posts/" pid) nil "Micko")))))
        (is (empty? (d/q '[:find ?l :where [?l :vision-label/activity _]] (d/db s/conn))))))))

(deftest media-without-embedding-gets-no-label
  (with-redefs [vision/ml-url (constantly nil)]
    (let [m (upload! "Micko")
          p (json-body (api (request :post "/api/posts" {:mediaIds [(:id m)] :activityTag "running"} "Micko")))]
      (is (= 201 (:status (api (request :post "/api/posts" {:mediaIds [] :caption "Rest day" :activityTag "running"} "Micko")))))
      (is (empty? (labels-of (parse-long (:id p))))))))

;; ---------------------------------------------------------------------------
;; Admin: status / retrain / export

(defn- seed-labels! []
  (doseq [tag ["running" "gym" "reading"]]
    (let [m (upload! "Micko")]
      (api (request :post "/api/posts" {:mediaIds [(:id m)] :activityTag tag} "Micko")))))

(deftest retrain-is-admin-only
  (let [calls (atom [])]
    (with-ml calls running-labels
      (with-redefs [vision/admin-usernames (constantly #{"Micko"})]
        (seed-labels!)
        (is (= 401 (:status (api (request :post "/api/vision/retrain" {})))))
        (is (= 403 (:status (api (request :post "/api/vision/retrain" {} "Uros")))))
        (is (= 403 (:status (api (request :get "/api/vision/status" nil "Uros")))))
        (is (= 403 (:status (api (request :get "/api/vision/export" nil "Uros")))))
        (reset! calls [])
        (let [r (api (request :post "/api/vision/retrain" {:hidden 16} "Micko"))
              body (json-body r)
              call (first @calls)
              sent (json/parse-string (get-in call [:opts :body]) true)]
          (is (= 200 (:status r)))
          (is (true? (:trained body)))
          (is (= 3 (:sent body)))
          (is (= "/train" (:path call)))
          (is (= 16 (:hidden sent)))
          (is (= #{"running" "gym" "reading"} (set (map :activity (:examples sent)))))
          (is (every? #(= 512 (count (:embedding %))) (:examples sent)))
          (is (every? #(= "clip-test" (:embeddingModel %)) (:examples sent))))))))

(deftest status-and-export-for-admins
  (let [calls (atom [])]
    (with-ml calls running-labels
      (with-redefs [vision/admin-usernames (constantly #{"Micko"})]
        (seed-labels!)
        (let [st (json-body (api (request :get "/api/vision/status" nil "Micko")))]
          (is (true? (:mlUp st)))
          (is (= "zero-shot" (:model st)))
          (is (= 3 (get-in st [:labels :total])))
          (is (= 1 (get-in st [:labels :confirmed])))
          (is (= 2 (get-in st [:labels :corrected])))
          (is (= {:corrected 1 :total 1} (get-in st [:labels :perClass :gym])))
          (is (= 3 (get-in st [:labels :mediaWithEmbeddings]))))
        (let [ex (json-body (api (request :get "/api/vision/export" nil "Micko")))]
          (is (= 3 (count ex)))
          (is (= 512 (count (:embedding (first ex))))))))))

(deftest retrain-without-ml-url-is-503
  (with-redefs [vision/ml-url (constantly nil)
                vision/admin-usernames (constantly #{"Micko"})]
    (is (= 503 (:status (api (request :post "/api/vision/retrain" {} "Micko")))))
    (is (= "disabled" (:model (json-body (api (request :get "/api/vision/status" nil "Micko"))))))))

(deftest admin-usernames-from-env-format
  (with-redefs [vision/admin-usernames (constantly #{"Micko" "Ana"})]
    (is (vision/admin? "Ana"))
    (is (not (vision/admin? "ana")))
    (is (not (vision/admin? nil)))))
