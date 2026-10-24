(ns web.vision
  "Activity suggestions from photos (CLIP zero-shot + trained head, served by
   the Python service in ml/) and the labelled examples that train it.

   Everything here is optional: without ML_URL, or while the ML service is
   down or slow, uploads and posts work exactly as before, just without
   suggestions. Calls use short timeouts and a small circuit breaker so a
   hanging service never slows uploads down for long.

   POST /api/vision/classify  multipart `file` (small JPEG) -> {suggestions, model}
                              suggestion for the composer; nothing is stored
   GET  /api/vision/status    admin: label counts per class, model mode
   POST /api/vision/retrain   admin: sends labelled embeddings to the ML /train
   GET  /api/vision/export    admin: [{embedding, activity, embeddingModel}]
                              (input for `python -m app.train` in ml/)

   Env: ML_URL (e.g. http://ml:8000), ML_TIMEOUT_MS (default 2000),
        ML_TOKEN (optional shared secret for /train), ADMIN_USERNAMES (a,b,c)."
  (:require [cheshire.core :as json]
            [clj-http.client :as http]
            [clojure.string :as str]
            [clojure.tools.logging :as log]
            [datomic.api :as d]
            [project.system :as s]
            [web.http :refer [jresp ok bad unauth me ddb parse-body]])
  (:import (java.io File)
           (java.nio ByteBuffer ByteOrder)
           (java.util Date)))

;; ===== Activity classes =====

(def activities
  "Class keys shared with ml/app/activities.py, with display label and emoji."
  [["running" "Running" "🏃"]
   ["gym" "Gym" "🏋️"]
   ["cycling" "Cycling" "🚴"]
   ["swimming" "Swimming" "🏊"]
   ["yoga" "Yoga" "🧘"]
   ["stretching" "Stretching" "🙆"]
   ["hiking" "Hiking" "🥾"]
   ["walking" "Walking" "🚶"]
   ["climbing" "Climbing" "🧗"]
   ["martial-arts" "Martial arts" "🥋"]
   ["sports" "Sports" "⚽"]
   ["cold-shower" "Cold shower" "🚿"]
   ["meditation" "Meditation" "🪷"]
   ["reading" "Reading" "📖"]
   ["studying" "Studying" "📚"]
   ["coding" "Coding" "💻"]
   ["writing" "Writing" "✍️"]
   ["drawing" "Drawing" "🎨"]
   ["music" "Music" "🎸"]
   ["cooking" "Cooking" "🍳"]
   ["nutrition" "Nutrition" "🥗"]
   ["cleaning" "Cleaning" "🧹"]
   ["gardening" "Gardening" "🌱"]
   ["other" "Other" "✨"]])

(def activity-info
  (into {} (map (fn [[k label emoji]] [k {:label label :emoji emoji}]) activities)))

(def ^:private aliases
  "Words people tag posts with -> class key (keys are already normalized)."
  (into {}
        (for [[k words] {"running"      ["run" "runs" "runner" "jog" "jogging" "sprint" "sprints" "marathon"
                                         "halfmarathon" "5k" "10k" "trcanje" "trčanje" "trcao" "trčao"]
                         "gym"          ["training" "train" "workout" "workouts" "weights" "weightlifting" "lifting"
                                         "lift" "fitness" "strength" "bodybuilding" "powerlifting" "crossfit"
                                         "calisthenics" "pushups" "push-ups" "pullups" "teretana" "trening"]
                         "cycling"      ["bike" "biking" "bicycle" "cycle" "ride" "mtb" "roadbike" "bicikl"
                                         "biciklizam"]
                         "swimming"     ["swim" "pool" "laps" "plivanje" "bazen"]
                         "yoga"         ["joga" "vinyasa" "asana"]
                         "stretching"   ["stretch" "mobility" "flexibility" "istezanje"]
                         "hiking"       ["hike" "trekking" "trek" "mountains" "planinarenje"]
                         "walking"      ["walk" "walks" "steps" "stroll" "setnja" "šetnja"]
                         "climbing"     ["climb" "bouldering" "boulder" "penjanje"]
                         "martial-arts" ["martialarts" "boxing" "box" "mma" "bjj" "jiujitsu" "jiu-jitsu" "judo"
                                         "karate" "kickboxing" "muaythai" "muay-thai" "taekwondo" "wrestling"]
                         "sports"       ["sport" "football" "soccer" "basketball" "tennis" "volleyball" "padel"
                                         "fudbal" "kosarka" "košarka" "tenis" "odbojka"]
                         "cold-shower"  ["coldshower" "ice-bath" "icebath" "cold-plunge" "coldplunge"
                                         "wimhof" "wim-hof"]
                         "meditation"   ["meditate" "meditating" "mindfulness" "breathwork" "meditacija"]
                         "reading"      ["read" "books" "book" "bookworm" "citanje" "čitanje"]
                         "studying"     ["study" "studies" "learning" "learn" "exam" "exams" "homework"
                                         "ucenje" "učenje"]
                         "coding"       ["code" "programming" "dev" "developer" "software" "leetcode"
                                         "programiranje"]
                         "writing"      ["write" "journaling" "journal" "blog" "blogging" "pisanje"]
                         "drawing"      ["draw" "art" "painting" "paint" "sketch" "sketching" "illustration"
                                         "crtanje"]
                         "music"        ["guitar" "piano" "singing" "sing" "drums" "violin" "musician" "muzika"]
                         "cooking"      ["cook" "baking" "bake" "kuvanje"]
                         "nutrition"    ["food" "meal" "meals" "mealprep" "meal-prep" "diet" "healthy-eating"
                                         "healthyeating" "healthyfood" "eating" "ishrana"]
                         "cleaning"     ["clean" "tidy" "chores" "ciscenje" "čišćenje"]
                         "gardening"    ["garden" "plants" "bastovanstvo"]}
              w words]
          [w k])))

(defn normalize-activity
  "Activity tag as the user typed it (\"#Running\", \"Cold shower\", \"gym\")
   -> class key (\"running\", \"cold-shower\", \"gym\"), or nil when it is not
   one of the classes the model knows."
  [s]
  (when (string? s)
    (let [t (-> s str/trim (str/replace #"^#+" "") str/lower-case
                (str/replace #"[\s_]+" "-")
                (str/replace #"[^\p{L}\p{N}-]" "")
                (str/replace #"-+" "-")
                (str/replace #"^-|-$" ""))
          squashed (str/replace t "-" "")]
      (when (seq t)
        (cond
          (and (contains? activity-info t) (not= t "other")) t
          (aliases t) (aliases t)
          (aliases squashed) (aliases squashed)
          :else (some (fn [[k _ _]] (when (and (not= k "other") (= squashed (str/replace k "-" ""))) k))
                      activities))))))

;; ===== Config =====

(defn ml-url []
  (some-> (System/getenv "ML_URL") str/trim not-empty (str/replace #"/+$" "")))

(defn- env-long [k default]
  (or (some-> (System/getenv k) str/trim parse-long) default))

(defn timeout-ms [] (env-long "ML_TIMEOUT_MS" 2000))

(defn admin-usernames []
  (->> (str/split (or (System/getenv "ADMIN_USERNAMES") "") #",")
       (map str/trim)
       (remove str/blank?)
       set))

(defn admin? [username] (boolean (and username (contains? (admin-usernames) username))))

;; ===== HTTP to the ML service =====

(defn ml-request
  "Raw HTTP call to the ML service. Returns {:status :body} (body = string).
   Tests replace this with with-redefs."
  [method path {:keys [body content-type timeout headers]}]
  (http/request {:method method
                 :url (str (ml-url) path)
                 :body body
                 :headers (cond-> (or headers {}) content-type (assoc "Content-Type" content-type))
                 :connection-timeout (min 1000 timeout)
                 :connection-request-timeout (min 1000 timeout)
                 :socket-timeout timeout
                 :throw-exceptions false
                 :as :string}))

;; Circuit breaker: after a failure, skip calls for a while instead of making
;; every upload wait for the timeout again.
(defonce ^:private down-until (atom 0))
(def breaker-ms 15000)

(defn reset-breaker! [] (reset! down-until 0))

(defn- available? [] (and (ml-url) (> (System/currentTimeMillis) @down-until)))

(defn- trip! [why]
  (reset! down-until (+ (System/currentTimeMillis) breaker-ms))
  (log/info "[vision] ML service unavailable, pausing suggestions for" (quot breaker-ms 1000) "s:" why))

(defn- call-ml
  "Parsed JSON body of a 200 response, nil otherwise (never throws)."
  [method path opts]
  (when (available?)
    (try
      (let [{:keys [status body]} (ml-request method path (merge {:timeout (timeout-ms)} opts))]
        (cond
          (= 200 status) (json/parse-string body true)
          (and status (>= status 500)) (do (trip! (str "HTTP " status)) nil)
          :else (do (log/info "[vision] ML" path "returned" status) nil)))
      (catch Exception e (trip! (or (.getMessage e) (str (class e)))) nil))))

;; ===== Classification =====

(defn- clean-labels [labels]
  (->> labels
       (filter #(and (contains? activity-info (:activity %)) (number? (:score %))))
       (map (fn [{:keys [activity score]}]
              {:activity activity :score (-> (double score) (max 0.0) (min 1.0))}))
       (take 5)
       vec))

(defn classify
  "Image bytes (or File) -> {:labels [{:activity :score}] :model :embedding? :embedding-model}
   or nil when the ML service is not configured, down, slow or can't read it."
  ([content] (classify content {}))
  ([content {:keys [embedding?]}]
   (when (and content (or (not (instance? File content)) (.exists ^File content)))
     (when-let [r (call-ml :post (str "/classify?top=3" (when embedding? "&embedding=1"))
                           {:body content :content-type "application/octet-stream"})]
       (let [emb (:embedding r)]
         (cond-> {:labels (clean-labels (:labels r))
                  :model (:model r)
                  :embedding-model (:embeddingModel r)}
           (and (sequential? emb) (seq emb) (every? number? emb)) (assoc :embedding (vec emb))))))))

(defn floats->bytes ^bytes [xs]
  (let [buf (.order (ByteBuffer/allocate (* 4 (count xs))) ByteOrder/LITTLE_ENDIAN)]
    (doseq [x xs] (.putFloat buf (float x)))
    (.array buf)))

(defn bytes->floats [^bytes b]
  (when b
    (let [buf (.order (ByteBuffer/wrap b) ByteOrder/LITTLE_ENDIAN)]
      (vec (repeatedly (quot (alength b) 4) #(.getFloat buf))))))

(defn prediction-attrs
  "Attributes to store on the media entity for a classify result."
  [{:keys [labels embedding embedding-model]}]
  (cond-> {}
    (seq labels)    (assoc :media/predictions (json/generate-string labels))
    (seq embedding) (assoc :media/embedding (floats->bytes embedding))
    (and (seq embedding) embedding-model) (assoc :media/embedding-model (str embedding-model))))

(defn- parse-predictions [s]
  (when (seq s)
    (try (clean-labels (json/parse-string s true)) (catch Exception _ nil))))

(def min-suggestion-score 0.05)

(defn suggestions-dto
  "[{:activity :label :emoji :score}] for the UI: best first, \"other\" and
   near-zero scores left out."
  [labels]
  (->> labels
       (remove #(= "other" (:activity %)))
       (filter #(>= (:score %) min-suggestion-score))
       (take 3)
       (mapv (fn [{:keys [activity score]}]
               (merge {:activity activity :score (/ (Math/round (* 1000.0 score)) 1000.0)}
                      (activity-info activity))))))

(defn media-suggestions
  "Suggestions stored on a media entity (possibly empty)."
  [media-e]
  (suggestions-dto (parse-predictions (:media/predictions media-e))))

(defn- top-prediction [media-e]
  (:activity (first (parse-predictions (:media/predictions media-e)))))

;; ===== Labels (feedback from posts) =====

(defn- label-targets
  "Media of a post that get the post's activity as a label: all of a single
   or before/after post, only the cover of a carousel (later slides are often
   something else)."
  [post-e]
  (let [media (->> (:post/media post-e) (sort-by :post-media/position) (keep :post-media/media))]
    (if (= :carousel (:post/layout post-e)) (take 1 media) media)))

(defn sync-labels-tx
  "Transaction data that makes the labels of post `pid` match its current
   activity tag: one label per target media with an embedding; labels are
   retracted when the tag is cleared or is not a known activity."
  [db pid]
  (let [post     (d/entity db pid)
        cls      (normalize-activity (:post/activity-tag post))
        existing (into {} (d/q '[:find ?m ?l :in $ ?p
                                 :where [?l :vision-label/post ?p] [?l :vision-label/media ?m]]
                               db pid))
        targets  (if cls (filter :media/embedding (label-targets post)) [])
        keep-ms  (set (map :db/id targets))
        now      (Date.)]
    (concat
     (for [[m l] existing :when (not (contains? keep-ms m))] [:db/retractEntity l])
     (for [m targets
           :let [mid  (:db/id m)
                 top  (top-prediction m)
                 prev (some->> (get existing mid) (d/entity db))]
           :when (not= cls (:vision-label/activity prev))]
       (cond-> {:db/id                   (or (:db/id prev) (str "label-" mid))
                :vision-label/media      mid
                :vision-label/post       pid
                :vision-label/activity   cls
                :vision-label/source     (if (= top cls) :confirmed :corrected)
                :vision-label/created-at now}
         (-> post :post/author :db/id) (assoc :vision-label/user (-> post :post/author :db/id))
         top (assoc :vision-label/predicted top))))))

(defn sync-labels!
  "Stores/updates the labelled examples for a post. Never throws: labels are
   a bonus, they must not break posting."
  [pid]
  (try
    (let [tx (vec (sync-labels-tx (d/db s/conn) pid))]
      (when (seq tx) @(d/transact s/conn tx)))
    (catch Exception e (log/warn e "[vision] could not store labels for post" pid))))

(defn training-examples
  "[{:embedding [...] :activity :embeddingModel}] for every labelled media."
  [db]
  (->> (d/q '[:find ?l ?a ?b ?em
              :where [?l :vision-label/activity ?a] [?l :vision-label/media ?m]
              [?m :media/embedding ?b]
              [(get-else $ ?m :media/embedding-model "") ?em]]
            db)
       (sort-by first)
       (mapv (fn [[_ a b em]] {:embedding (bytes->floats b) :activity a :embeddingModel em}))))

(defn label-stats [db]
  (let [rows (d/q '[:find ?a ?src (count ?l)
                    :where [?l :vision-label/activity ?a] [?l :vision-label/source ?src]]
                  db)
        per  (reduce (fn [m [a src n]] (assoc-in m [a (name src)] n)) {} rows)
        conf (reduce + 0 (for [[_ src n] rows :when (= src :confirmed)] n))
        corr (reduce + 0 (for [[_ src n] rows :when (= src :corrected)] n))
        tot  (+ conf corr)]
    {:total     tot
     :confirmed conf
     :corrected corr
     ;; How often the top suggestion was what people picked (production accuracy).
     :acceptanceRate (when (pos? tot) (/ (Math/round (* 1000.0 (/ conf tot))) 1000.0))
     :perClass  (into (sorted-map)
                      (map (fn [[a m]] [a (assoc m :total (reduce + (vals m)))]) per))
     :mediaWithEmbeddings (or (d/q '[:find (count ?m) . :where [?m :media/embedding _]] db) 0)}))

;; ===== Handlers =====

(def classify-max-bytes (* 5 1024 1024))

(defn handle-classify
  "POST /api/vision/classify — composer preview: suggestions for an image
   that hasn't been uploaded yet. Always 200; empty list when unavailable."
  [req]
  (if-not (me req)
    (unauth)
    (let [part (get-in req [:multipart-params "file"])
          ^File f (when (map? part) (:tempfile part))]
      (cond
        (not (and f (.exists f) (pos? (.length f)))) (bad "No file")
        (> (.length f) classify-max-bytes) (jresp 413 {:error "Image is too large"})
        :else (let [r (classify f)]
                (ok {:suggestions (suggestions-dto (:labels r))
                     :model (:model r)}))))))

(defn- with-admin [req f]
  (let [u (me req)]
    (cond
      (nil? u) (unauth)
      (not (admin? u)) (jresp 403 {:error "Admins only"})
      :else (f u))))

(defn handle-status
  "GET /api/vision/status (admin)"
  [req]
  (with-admin req
    (fn [_]
      (let [health (when (ml-url) (call-ml :get "/health" {}))]
        (ok {:mlConfigured (boolean (ml-url))
             :mlUp (boolean health)
             :model (or (:model health) (when (ml-url) "unavailable") "disabled")
             :embeddingModel (:embeddingModel health)
             :head (:head health)
             :labels (label-stats (ddb))})))))

(defn handle-retrain
  "POST /api/vision/retrain (admin) {hidden?, epochs?} -> metrics from the ML service."
  [req]
  (with-admin req
    (fn [_]
      (if-not (ml-url)
        (jresp 503 {:error "ML_URL is not configured"})
        (let [{:keys [hidden epochs]} (parse-body req)
              examples (training-examples (ddb))
              body (cond-> {:examples examples}
                     (integer? hidden) (assoc :hidden hidden)
                     (integer? epochs) (assoc :epochs epochs))
              token (System/getenv "ML_TOKEN")]
          ;; Retraining is explicit and rare: bypass the breaker, allow 2 minutes.
          (try
            (let [{:keys [status body]} (ml-request :post "/train"
                                                    {:body (json/generate-string body)
                                                     :content-type "application/json"
                                                     :timeout 120000
                                                     :headers (if (seq token) {"X-ML-Token" token} {})})]
              (if (= 200 status)
                (do (reset-breaker!)
                    (ok (assoc (json/parse-string body true) :sent (count examples))))
                (jresp 502 {:error (str "ML service returned " status) :detail body})))
            (catch Exception e
              (jresp 503 {:error (str "ML service unreachable: " (.getMessage e))}))))))))

(defn handle-export
  "GET /api/vision/export (admin) -> training examples as JSON."
  [req]
  (with-admin req (fn [_] (ok (training-examples (ddb))))))

(def routes
  [["/api/vision/classify" {:post handle-classify}]
   ["/api/vision/status"   {:get handle-status}]
   ["/api/vision/retrain"  {:post handle-retrain}]
   ["/api/vision/export"   {:get handle-export}]])
