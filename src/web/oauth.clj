(ns web.oauth
  (:require [clj-http.client :as http]
            [cheshire.core :as json]
            [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s]
            [web.accounts :as accounts]
            [web.http :refer [parse-body]])
  (:import (java.util UUID)))

(defn- env [k] (let [v (System/getenv k)] (when-not (str/blank? v) v)))

;; Google sign-in is enabled only when GOOGLE_CLIENT_ID is set: an ID token
;; is only proof of identity for the app it was issued to (its `aud`). Without
;; the check, a token minted for ANY site using Google sign-in (e.g. one the
;; attacker runs) would log its owner in here.
(def google-client-id (env "GOOGLE_CLIENT_ID"))

;; Facebook login is enabled only when both are set; tokens are checked with
;; /debug_token to belong to this app.
(def facebook-app-id (env "FACEBOOK_APP_ID"))
(def facebook-app-secret (env "FACEBOOK_APP_SECRET"))

(defn- truthy? [v] (or (true? v) (= "true" v)))

(defn verify-google-token [id-token]
  (when google-client-id
    (try
      (let [resp (http/get "https://oauth2.googleapis.com/tokeninfo"
                           {:query-params {:id_token id-token}
                            :as :json
                            :throw-exceptions false})]
        (when (= 200 (:status resp))
          (let [p (:body resp)]
            (when (and (= (:aud p) google-client-id)
                       (contains? #{"accounts.google.com" "https://accounts.google.com" nil} (:iss p)))
              p))))
      (catch Exception _ nil))))

(defn- facebook-token-ok?
  "Is `access-token` a valid user token issued to OUR Facebook app? Graph's
   /me accepts tokens of any app, so without this a token a third-party app
   obtained for a user would log in as that user here."
  [access-token]
  (when (and facebook-app-id facebook-app-secret)
    (try
      (let [resp (http/get "https://graph.facebook.com/debug_token"
                           {:query-params {:input_token access-token
                                           :access_token (str facebook-app-id "|" facebook-app-secret)}
                            :as :json
                            :throw-exceptions false})
            data (get-in resp [:body :data])]
        (and (= 200 (:status resp))
             (truthy? (:is_valid data))
             (= (str facebook-app-id) (str (:app_id data)))
             (:user_id data)))
      (catch Exception _ nil))))

(defn get-facebook-profile [access-token]
  (when-let [fb-user (facebook-token-ok? access-token)]
    (try
      (let [resp (http/get "https://graph.facebook.com/me"
                           {:query-params {:fields "id,name,email,picture.type(large)"
                                           :access_token access-token}
                            :as :json
                            :throw-exceptions false})]
        (when (and (= 200 (:status resp))
                   (= (str fb-user) (str (get-in resp [:body :id]))))
          (:body resp)))
      (catch Exception _ nil))))

(defn find-user-by-attr [db attr val]
  (d/q '[:find ?e . :in $ ?a ?v :where [?e ?a ?v]] db attr val))

(defn random-suffix [] (subs (str (UUID/randomUUID)) 0 4))

(defn- subs* [s n] (subs s 0 (min n (count s))))

(defn safe-username [name email]
  (let [base (-> (or name (first (str/split (or email "user") #"@")))
                 (str/lower-case)
                 (str/replace #"[^a-z0-9]" "")
                 (or "user"))
        candidate (subs* (if (>= (count base) 3) base (str base "user")) 24)
        db        (d/db s/conn)]
    ;; :user/username is :db.unique/identity, so a name that already exists
    ;; would make the new-user transaction UPSERT into (and log in as) that
    ;; existing account: keep drawing suffixes until the name is free.
    (loop [c candidate tries 0]
      (cond
        (not (accounts/find-user db c)) c
        (< tries 50) (recur (str candidate (random-suffix)) (inc tries))
        :else (str (subs* candidate 18) (subs (str/replace (str (UUID/randomUUID)) "-" "") 0 12))))))

(defn upsert-oauth-user! [google-id facebook-id email display-name profile-pic]
  (let [db (d/db s/conn)
        existing-e (or (when google-id   (find-user-by-attr db :user/google-id google-id))
                       (when facebook-id (find-user-by-attr db :user/facebook-id facebook-id))
                       (when email       (accounts/find-user-by-email db email)))]
    (if existing-e
      (do
        (let [updates (cond-> []
                        (and google-id   (not (:user/google-id   (d/entity db existing-e)))) (conj [:db/add existing-e :user/google-id   google-id])
                        (and facebook-id (not (:user/facebook-id (d/entity db existing-e)))) (conj [:db/add existing-e :user/facebook-id facebook-id]))]
          (when (seq updates) @(d/transact s/conn updates)))
        (:user/username (d/entity (d/db s/conn) existing-e)))
      (let [username (safe-username display-name email)
            tx-data  (cond-> {:user/username username :user/xp 0 :user/display-name (or display-name username)
                          :user/session-version 0 :user/created-at (java.util.Date.)}
                       google-id    (assoc :user/google-id google-id)
                       facebook-id  (assoc :user/facebook-id facebook-id)
                       email        (assoc :user/email (str/lower-case email))
                       profile-pic  (assoc :user/profile-pic profile-pic))]
        @(d/transact s/conn [tx-data])
        username))))

(defn json-ok
  "Logs `session-username` in: reactivates a deactivated account and puts the
   current session version in the session (see accounts/wrap-session-version)."
  [_body session-username]
  (let [db  (d/db s/conn)
        eid (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] db session-username)
        db  (if (:user/deactivated? (d/entity db eid))
              (:db-after @(d/transact s/conn [[:db/retract eid :user/deactivated? true]]))
              db)]
    {:status 200
     :headers {"Content-Type" "application/json"}
     :body (json/generate-string (accounts/me-dto db eid))
     :session (accounts/login-session db eid)}))

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
  (let [body (parse-body req)
        id-token (:idToken body)]
    (if-not id-token
      (json-err "Missing idToken")
      (let [payload (verify-google-token id-token)]
        (if-not payload
          (json-err "Invalid Google token")
          (let [google-id   (str (:sub payload))
                ;; only a VERIFIED email may link to (and log into) an
                ;; existing account; an unverified one is not stored at all
                email       (when (truthy? (:email_verified payload)) (:email payload))
                display-name (:name payload)
                picture     (:picture payload)
                username    (upsert-oauth-user! google-id nil email display-name picture)]
            (json-ok (user->dto (d/db s/conn) username) username)))))))

(defn handle-facebook [req]
  (let [body (parse-body req)
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
