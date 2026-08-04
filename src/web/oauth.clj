(ns web.oauth
  (:require [clj-http.client :as http]
            [cheshire.core :as json]
            [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s]
            [buddy.hashers :as hashers])
  (:import (java.util UUID)))

;; Optional: set GOOGLE_CLIENT_ID env var to validate audience
(def google-client-id (System/getenv "GOOGLE_CLIENT_ID"))

(defn verify-google-token [id-token]
  (try
    (let [resp (http/get "https://oauth2.googleapis.com/tokeninfo"
                         {:query-params {:id_token id-token}
                          :as :json
                          :throw-exceptions false})]
      (when (= 200 (:status resp))
        (let [p (:body resp)]
          (when (or (nil? google-client-id) (= (:aud p) google-client-id))
            p))))
    (catch Exception _ nil)))

(defn get-facebook-profile [access-token]
  (try
    (let [resp (http/get "https://graph.facebook.com/me"
                         {:query-params {:fields "id,name,email,picture.type(large)"
                                         :access_token access-token}
                          :as :json
                          :throw-exceptions false})]
      (when (= 200 (:status resp))
        (:body resp)))
    (catch Exception _ nil)))

(defn find-user-by-attr [db attr val]
  (d/q '[:find ?e . :in $ ?a ?v :where [?e ?a ?v]] db attr val))

(defn safe-username [name email]
  (let [base (-> (or name (first (str/split (or email "user") #"@")))
                 (str/lower-case)
                 (str/replace #"[^a-z0-9]" "")
                 (or "user"))
        candidate (if (>= (count base) 3) base (str base "user"))]
    (if (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] (d/db s/conn) candidate)
      (str candidate (subs (str (UUID/randomUUID)) 0 4))
      candidate)))

(defn upsert-oauth-user! [google-id facebook-id email display-name profile-pic]
  (let [db (d/db s/conn)
        existing-e (or (when google-id   (find-user-by-attr db :user/google-id google-id))
                       (when facebook-id (find-user-by-attr db :user/facebook-id facebook-id))
                       (when email       (find-user-by-attr db :user/email email)))]
    (if existing-e
      (do
        (let [updates (cond-> []
                        (and google-id   (not (:user/google-id   (d/entity db existing-e)))) (conj [:db/add existing-e :user/google-id   google-id])
                        (and facebook-id (not (:user/facebook-id (d/entity db existing-e)))) (conj [:db/add existing-e :user/facebook-id facebook-id]))]
          (when (seq updates) @(d/transact s/conn updates)))
        (:user/username (d/entity (d/db s/conn) existing-e)))
      (let [username (safe-username display-name email)
            tx-data  (cond-> {:user/username username :user/xp 0 :user/display-name (or display-name username)}
                       google-id    (assoc :user/google-id google-id)
                       facebook-id  (assoc :user/facebook-id facebook-id)
                       email        (assoc :user/email email)
                       profile-pic  (assoc :user/profile-pic profile-pic))]
        @(d/transact s/conn [tx-data])
        username))))

(defn json-ok [body session-username]
  {:status 200
   :headers {"Content-Type" "application/json"}
   :body (json/generate-string body)
   :session {:username session-username}})

(defn json-err [msg]
  {:status 401
   :headers {"Content-Type" "application/json"}
   :body (json/generate-string {:error msg})})

(defn user->dto [db username]
  (let [u (d/entity db [:user/username username])]
    {:username (:user/username u)
     :displayName (:user/display-name u)
     :profilePic (:user/profile-pic u)
     :bio (:user/bio u)
     :xp (or (:user/xp u) 0)}))

(defn handle-google [req]
  (let [body (json/parse-stream (clojure.java.io/reader (:body req)) true)
        id-token (:idToken body)]
    (if-not id-token
      (json-err "Missing idToken")
      (let [payload (verify-google-token id-token)]
        (if-not payload
          (json-err "Invalid Google token")
          (let [google-id   (str (:sub payload))
                email       (:email payload)
                display-name (:name payload)
                picture     (:picture payload)
                username    (upsert-oauth-user! google-id nil email display-name picture)]
            (json-ok (user->dto (d/db s/conn) username) username)))))))

(defn handle-facebook [req]
  (let [body (json/parse-stream (clojure.java.io/reader (:body req)) true)
        access-token (:accessToken body)]
    (if-not access-token
      (json-err "Missing accessToken")
      (let [profile (get-facebook-profile access-token)]
        (if-not profile
          (json-err "Invalid Facebook token")
          (let [fb-id       (str (:id profile))
                email       (:email profile)
                display-name (:name profile)
                picture     (get-in profile [:picture :data :url])
                username    (upsert-oauth-user! nil fb-id email display-name picture)]
            (json-ok (user->dto (d/db s/conn) username) username)))))))
