(ns web.server
  (:require [ring.adapter.jetty :as jetty]
            [reitit.ring :as rr]
            [reitit.ring.middleware.parameters :as parameters]
            [ring.middleware.keyword-params :refer [wrap-keyword-params]]
            [ring.middleware.session :refer [wrap-session]]
            [ring.middleware.json :refer [wrap-json-body]]
            [cheshire.core :as json]
            [cheshire.generate :as gen]
            [project.api :as api]
            [project.time :as t]
            [project.system :as sys])
  (:import (java.time LocalDate LocalTime)
           (java.util Date)))

(def port 3000)

(gen/add-encoder LocalDate (fn [d jg] (.writeString jg (str d))))
(gen/add-encoder LocalTime (fn [lt jg] (.writeString jg (str lt))))

(defn cors-headers []
  {"Access-Control-Allow-Origin"      "http://localhost:4200"
   "Access-Control-Allow-Credentials" "true"
   "Access-Control-Allow-Methods"     "GET, POST, PUT, DELETE, OPTIONS"
   "Access-Control-Allow-Headers"     "Content-Type, Accept"})

(defn json-ok [body]
  {:status 200
   :headers (merge {"Content-Type" "application/json"} (cors-headers))
   :body (json/generate-string body)})

(defn json-ok-session [body session]
  {:status 200
   :headers (merge {"Content-Type" "application/json"} (cors-headers))
   :session session
   :body (json/generate-string body)})

(defn json-err [status msg]
  {:status status
   :headers (merge {"Content-Type" "application/json"} (cors-headers))
   :body (json/generate-string {:error msg})})

(defn cors-ok [] {:status 204 :headers (cors-headers) :body ""})

(defn parse-date [s]
  (try (if (or (nil? s) (empty? s)) (LocalDate/now) (LocalDate/parse s))
       (catch Exception _ (LocalDate/now))))

(defn parse-period [s]
  (let [k (keyword (or s "daily"))]
    (if (#{:daily :weekly :monthly :all} k) k :daily)))

;; ── Users ─────────────────────────────────────────────────────────────────────

(defn get-users-handler [_]
  (try (json-ok (api/get-all-users))
       (catch Exception e (json-err 500 (.getMessage e)))))

(defn create-user-handler [{:keys [body]}]
  (try (api/register-user! (:username body))
       (json-ok {:message "User created"})
       (catch Exception e (json-err 400 (.getMessage e)))))

;; ── Auth ──────────────────────────────────────────────────────────────────────

(defn login-handler [{:keys [body session]}]
  (try
    (let [username (:username body)
          user     (api/get-user-profile username)]
      (json-ok-session {:username (:user/username user) :xp (:user/xp user)}
                       (assoc session :username (:user/username user))))
    (catch Exception _ (json-err 401 "User not found"))))

(defn me-handler [{:keys [session]}]
  (if-let [username (:username session)]
    (try (let [user (api/get-user-profile username)]
           (json-ok {:username (:user/username user) :xp (:user/xp user)}))
         (catch Exception _ (json-err 401 "Not logged in")))
    (json-err 401 "Not logged in")))

(defn logout-handler [{:keys [session]}]
  (json-ok-session {:message "Logged out"} (dissoc session :username)))

;; ── Activities ────────────────────────────────────────────────────────────────

(defn serialize-activity [{:keys [id time type duration intensity xp]}]
  {:id id :time (str time) :type type :duration duration :intensity intensity :xp xp})

(defn get-activities-handler [{:keys [params session]}]
  (let [username (or (:username params) (:username session))
        date     (parse-date (:date params))]
    (if username
      (try
        (let [report (api/get-daily-report username date)]
          (json-ok {:date       (str (:date report))
                    :username   (:username report)
                    :activities (mapv serialize-activity (:activities report))
                    :totalXp    (:total-xp report)}))
        (catch Exception e (json-err 500 (.getMessage e))))
      (json-err 401 "Not logged in"))))

(defn add-activity-handler [{:keys [body session]}]
  (if-let [username (:username session)]
    (try
      (let [{:keys [activityType duration intensity startTime]} body
            inst (Date. (long startTime))]
        (api/log-activity! username (keyword activityType)
                           (int duration) (int intensity) inst)
        (json-ok {:message "Activity added"}))
      (catch Exception e (json-err 400 (.getMessage e))))
    (json-err 401 "Not logged in")))

(defn delete-activity-handler [{:keys [path-params session]}]
  (if (:username session)
    (try (api/delete-activity! (Long/parseLong (:id path-params)))
         (json-ok {:message "Deleted"})
         (catch Exception e (json-err 400 (.getMessage e))))
    (json-err 401 "Not logged in")))

;; ── Leaderboard ───────────────────────────────────────────────────────────────

(defn serialize-lb-entry [{:user/keys [username xp total-xp] :keys [rank delta]}]
  {:username username :xp xp :totalXp (or total-xp 0) :rank rank :delta delta})

(defn leaderboard-handler [{:keys [params]}]
  (try
    (let [period (parse-period (:period params))
          date   (parse-date   (:date params))]
      (json-ok (mapv serialize-lb-entry (api/get-leaderboard period date))))
    (catch Exception e (json-err 500 (.getMessage e)))))

;; ── Feed ──────────────────────────────────────────────────────────────────────

(defn feed-handler [{:keys [params]}]
  (try
    (let [date     (parse-date   (:date params))
          period   (parse-period (:period params))
          items    (api/get-feed date period)
          ;; Reactions map: {to-username {date {emoji [from-usernames]}}}
          reactions (if (= period :daily)
                      ;; Wrap daily reactions in date key so Angular has uniform structure
                      (let [date-str (str date)
                            day-rxns (api/get-reactions-for-date date-str)]
                        (reduce-kv (fn [m to-user emoji-map]
                                     (assoc-in m [to-user date-str] emoji-map))
                                   {}
                                   day-rxns))
                      ;; Weekly: reactions keyed by date already
                      (let [{:keys [start-day end-day]} (t/week-interval date)
                            start-str (str (.toLocalDate (t/instant->local start-day)))
                            end-str   (str (.toLocalDate (t/instant->local end-day)))]
                        (api/get-reactions-for-period start-str end-str)))]
      (json-ok {:period    (name period)
                :items     items
                :reactions reactions}))
    (catch Exception e (json-err 500 (.getMessage e)))))

;; ── Reactions ─────────────────────────────────────────────────────────────────

(defn toggle-reaction-handler [{:keys [body session]}]
  (if-let [from-username (:username session)]
    (try
      (let [{:keys [toUser date emoji]} body]
        (let [result (api/toggle-reaction! from-username toUser date emoji)]
          (json-ok {:action (name result)})))
      (catch Exception e (json-err 400 (.getMessage e))))
    (json-err 401 "Not logged in")))

;; ── Activity Types ────────────────────────────────────────────────────────────

(defn activity-types-handler [_]
  (try (json-ok (api/get-activity-types))
       (catch Exception e (json-err 500 (.getMessage e)))))

;; ── Stats ─────────────────────────────────────────────────────────────────────

(defn stats-handler [{:keys [path-params]}]
  (try
    (json-ok (api/get-user-stats (:username path-params)))
    (catch Exception e (json-err 500 (.getMessage e)))))

;; ── Posts ──────────────────────────────────────────────────────────────────────

(defn get-posts-handler [{:keys [params]}]
  (try
    (let [limit    (or (some-> (:limit params) Integer/parseInt) 30)
          username (:username params)]
      (json-ok (api/get-posts limit username)))
    (catch Exception e (json-err 500 (.getMessage e)))))

(defn create-post-handler [{:keys [body session]}]
  (if-let [username (:username session)]
    (try
      (let [{:keys [content activityTag]} body]
        (when (or (nil? content) (empty? (clojure.string/trim content)))
          (throw (ex-info "Content cannot be empty" {})))
        (api/create-post! username (clojure.string/trim content) activityTag)
        (json-ok {:message "Post created"}))
      (catch Exception e (json-err 400 (.getMessage e))))
    (json-err 401 "Not logged in")))

(defn toggle-post-like-handler [{:keys [path-params session]}]
  (if-let [username (:username session)]
    (try
      (let [post-id (Long/parseLong (:id path-params))
            result  (api/toggle-post-like! post-id username)]
        (json-ok {:action (name result)}))
      (catch Exception e (json-err 400 (.getMessage e))))
    (json-err 401 "Not logged in")))

;; ── Router ────────────────────────────────────────────────────────────────────

(def app
  (wrap-session
   (wrap-json-body
    (rr/ring-handler
     (rr/router
      [["/" {:get (fn [_] {:status 200 :headers {"Content-Type" "text/plain"} :body "BeBetter API v1.0"})}]
       ["/api/users"
        {:get get-users-handler :post create-user-handler :options (fn [_] (cors-ok))}]
       ["/api/users/:username/stats"
        {:get stats-handler :options (fn [_] (cors-ok))}]
       ["/api/login"
        {:post login-handler :options (fn [_] (cors-ok))}]
       ["/api/logout"
        {:post logout-handler :options (fn [_] (cors-ok))}]
       ["/api/me"
        {:get me-handler :options (fn [_] (cors-ok))}]
       ["/api/activities"
        {:get get-activities-handler :post add-activity-handler :options (fn [_] (cors-ok))}]
       ["/api/activities/:id"
        {:delete delete-activity-handler :options (fn [_] (cors-ok))}]
       ["/api/leaderboard"
        {:get leaderboard-handler :options (fn [_] (cors-ok))}]
       ["/api/feed"
        {:get feed-handler :options (fn [_] (cors-ok))}]
       ["/api/reactions"
        {:post toggle-reaction-handler :options (fn [_] (cors-ok))}]
       ["/api/activity-types"
        {:get activity-types-handler :options (fn [_] (cors-ok))}]
       ["/api/posts"
        {:get get-posts-handler :post create-post-handler :options (fn [_] (cors-ok))}]
       ["/api/posts/:id/like"
        {:post toggle-post-like-handler :options (fn [_] (cors-ok))}]]
      {:data {:middleware [parameters/parameters-middleware
                           wrap-keyword-params]}}))
    {:keywords? true})))

(defonce server (atom nil))

(defn start-server []
  (when-not @server
    (reset! server (jetty/run-jetty #'app {:port port :join? false}))
    (println "Server started at http://localhost:3000")))

(defn stop-server []
  (when-some [s @server]
    (.stop s)
    (reset! server nil)))
