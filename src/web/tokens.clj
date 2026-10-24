(ns web.tokens
  "Bearer-token auth for the mobile app.

   The web app uses cookie sessions. Native clients can't rely on cookies
   (especially for WebSockets), so `wrap-token-auth` lets them use tokens
   while every handler keeps reading the same `:session` map:

   - Issuing: a request with header `X-Auth-Mode: token` whose handler sets
     a session (login, register, OAuth, logout-all keepCurrent) gets
     `{\"token\": ...}` added to its JSON body instead of a session cookie.
   - Using: `Authorization: Bearer <token>` (or `?access_token=` on the
     WebSocket endpoint, where some clients can't set headers) is turned into
     the session map. `wrap-session-version` then validates it, so password
     changes and \"log out of all devices\" revoke tokens too.
   - Logout with a token deletes that token."
  (:require [cheshire.core :as json]
            [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s])
  (:import (java.security MessageDigest SecureRandom)
           (java.util Base64 Date)))

(defn- sha256 [^String s]
  (let [md (MessageDigest/getInstance "SHA-256")]
    (apply str (map #(format "%02x" %) (.digest md (.getBytes s "UTF-8"))))))

(defn- random-token []
  (let [b (byte-array 32)]
    (.nextBytes (SecureRandom.) b)
    (.encodeToString (.withoutPadding (Base64/getUrlEncoder)) b)))

(defn issue!
  "Creates a token for `session` ({:uid :sv ...}); returns the raw token."
  [{:keys [uid sv]} device]
  (let [token (random-token)]
    @(d/transact s/conn [(cond-> {:auth-token/hash       (sha256 token)
                                  :auth-token/user       uid
                                  :auth-token/sv         (or sv 0)
                                  :auth-token/created-at (Date.)}
                           (not (str/blank? device)) (assoc :auth-token/device (subs device 0 (min 120 (count device)))))])
    token))

(defn- token-entity [db token]
  (let [e (d/entity db [:auth-token/hash (sha256 token)])]
    (when (:auth-token/user e) e)))

(defn session-for-token
  "Session map for a raw token, or nil when unknown."
  [db token]
  (when-let [e (and (not (str/blank? token)) (token-entity db token))]
    (let [u (:auth-token/user e)]
      {:username (:user/username u)
       :uid      (:db/id u)
       :sv       (or (:auth-token/sv e) 0)})))

(defn revoke! [token]
  (when-let [e (token-entity (d/db s/conn) token)]
    @(d/transact s/conn [[:db/retractEntity (:db/id e)]])))

(defn- bearer [req]
  (let [h (get-in req [:headers "authorization"])]
    (cond
      (and h (str/starts-with? (str/lower-case h) "bearer "))
      (str/trim (subs h 7))

      ;; query params aren't parsed this far out, so read the raw string
      (= "/api/ws" (:uri req))
      (some->> (:query-string req) (re-find #"(?:^|&)access_token=([^&]+)") second))))

(defn- add-token-to-body [resp token]
  (let [body (try (json/parse-string (:body resp) true) (catch Exception _ nil))]
    (-> resp
        (dissoc :session)
        (assoc :body (json/generate-string (assoc (if (map? body) body {}) :token token))))))

(defn wrap-token-auth
  "Ring middleware: must sit INSIDE wrap-session and OUTSIDE
   wrap-session-version (so token sessions are validated like cookies)."
  [handler]
  (fn [req]
    (let [token      (bearer req)
          token-mode (= "token" (some-> (get-in req [:headers "x-auth-mode"]) str/lower-case))
          sess       (when token (session-for-token (d/db s/conn) token))
          req'       (if token (assoc req :session (or sess {})) req)
          resp       (handler req')]
      (cond
        (nil? resp) resp

        ;; handler logged someone in → hand out a token instead of a cookie
        (and token-mode (:uid (:session resp)) (< (:status resp 200) 300))
        (do (when token (revoke! token))
            (add-token-to-body resp (issue! (:session resp) (get-in req [:headers "user-agent"]))))

        ;; logout with a token
        (and token (contains? resp :session) (nil? (:session resp)))
        (do (revoke! token) (dissoc resp :session))

        ;; token requests never create cookie sessions
        token (dissoc resp :session)

        :else resp))))
