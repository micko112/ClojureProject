(ns web.accounts-review-test
  "Regression tests for security/privacy defects found in review of the
   accounts area, OAuth, and the remaining web.server handlers."
  (:require [clojure.test :refer :all]
            [clojure.string :as str]
            [cheshire.core :as json]
            [clj-http.client :as http]
            [datomic.api :as d]
            [project.system :as s]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.accounts :as accounts]
            [web.accounts.mail :as mail]
            [web.oauth :as oauth]
            [web.realtime :as rt]
            [web.server :as server])
  (:import (java.util Date)))

(defn- reset-state [f]
  (accounts/reset-rate-limits!)
  (reset! rt/registry {})
  (f)
  (reset! rt/registry {}))

(use-fixtures :each with-mem-db reset-state)

(def pw "password123")

(defn- db [] (d/db s/conn))
(defn- eid [un] (accounts/find-user (db) un))
(defn- call [method uri & [body user]]
  (let [[path qs] (str/split uri #"\?" 2)]
    (api (cond-> (request method path body user) qs (assoc :query-string qs)))))
(defn- status [r] (:status r))

(defn- set-cookies [resp] (get-in resp [:headers "Set-Cookie"]))
(defn- cookie-of [resp]
  (some->> (set-cookies resp) first (re-find #"bb-session=[^;]*")))

(defn- app-req
  ([method uri body cookie] (app-req method uri body cookie {}))
  ([method uri body cookie headers]
   (server/app (cond-> (update (request method uri body) :headers merge headers)
                 cookie (assoc-in [:headers "cookie"] cookie)))))

(defn- login-cookie [un]
  (cookie-of (app-req :post "/api/login" {:username un :password pw} nil)))

(defn- follow! [a b] @(d/transact s/conn [[:db/add (eid a) :user/follows (eid b)]]))

;; ===== CSRF =====

(deftest csrf-cross-site-state-change-rejected
  (let [c (login-cookie "Micko")]
    (testing "a cross-site text/plain form POST (JSON smuggled in the body) is rejected"
      (let [r (app-req :post "/api/follow" {:username "Uros"} c
                       {"content-type" "text/plain" "origin" "https://evil.example"
                        "host" "bebetter.quest"})]
        (is (= 403 (status r)))
        (is (not (accounts/follows? (db) (eid "Micko") (eid "Uros"))))))
    (testing "Sec-Fetch-Site cross-site / same-site is rejected even without Origin"
      (is (= 403 (status (app-req :post "/api/account/logout-all" nil c
                                  {"sec-fetch-site" "cross-site"}))))
      (is (= 403 (status (app-req :post "/api/follow" {:username "Uros"} c
                                  {"sec-fetch-site" "same-site"})))))
    (testing "Origin \"null\" (sandboxed iframe) is rejected"
      (is (= 403 (status (app-req :post "/api/follow" {:username "Uros"} c
                                  {"origin" "null" "host" "bebetter.quest"})))))
    (testing "same-origin requests from the app still work"
      (let [r (app-req :post "/api/follow" {:username "Uros"} c
                       {"origin" "https://bebetter.quest" "host" "bebetter.quest"
                        "sec-fetch-site" "same-origin"})]
        (is (= 200 (status r)))
        (is (accounts/follows? (db) (eid "Micko") (eid "Uros")))))
    (testing "dev proxies that rewrite Host without the port still match"
      (is (= 200 (status (app-req :post "/api/follow" {:username "Milan"} c
                                  {"origin" "http://localhost:4200" "host" "localhost"})))))
    (testing "non-browser clients (no Origin / Sec-Fetch-Site) are unaffected"
      (is (= 200 (status (app-req :post "/api/follow" {:username "Pavel"} c)))))
    (testing "GETs are not affected"
      (is (= 200 (status (app-req :get "/api/me" nil c {"sec-fetch-site" "cross-site"})))))))

(deftest csrf-guard-allows-same-origin-multipart
  (let [seen (atom nil)
        h    (server/wrap-csrf-guard (fn [req] (reset! seen req) {:status 201}))]
    (is (= 201 (:status (h {:request-method :post :uri "/api/media"
                            :headers {"content-type" "multipart/form-data; boundary=x"
                                      "origin" "https://bebetter.quest"
                                      "host" "bebetter.quest"
                                      "sec-fetch-site" "same-origin"}}))))
    (is (= 403 (:status (h {:request-method :post :uri "/api/media"
                            :headers {"content-type" "multipart/form-data; boundary=x"
                                      "origin" "https://evil.example"
                                      "host" "bebetter.quest"}}))))
    (testing "bearer-token clients (mobile app) are not CSRF-able and are let through"
      (is (= 201 (:status (h {:request-method :post :uri "/api/follow"
                              :headers {"authorization" "Bearer abc"
                                        "origin" "capacitor://localhost"
                                        "sec-fetch-site" "cross-site"}})))))
    (testing "cross-site WebSocket handshakes are rejected"
      (is (= 403 (:status (h {:request-method :get :uri "/api/ws"
                              :headers {"upgrade" "websocket" "connection" "Upgrade"
                                        "origin" "https://evil.example"
                                        "host" "bebetter.quest"}})))))))

;; ===== SESSION COOKIE =====

(deftest session-cookie-secure-behind-tls-proxy
  (let [r (app-req :post "/api/login" {:username "Micko" :password pw} nil
                   {"x-forwarded-proto" "https"})]
    (is (= 200 (status r)))
    (is (some #(re-find #"(?i);\s*Secure" %) (set-cookies r))
        "cookie must be Secure when nginx terminated TLS"))
  (testing "plain http (local dev) keeps working without Secure"
    (let [r (app-req :post "/api/login" {:username "Micko" :password pw} nil)]
      (is (not-any? #(re-find #"(?i);\s*Secure" %) (set-cookies r))))))

(deftest login-rotates-session-id
  (let [attacker (login-cookie "Uros")
        r        (app-req :post "/api/login" {:username "Micko" :password pw} attacker)
        victim   (cookie-of r)]
    (is (= 200 (status r)))
    (is (some? victim) "a fresh session cookie is issued")
    (is (not= attacker victim))
    (is (not= "Micko" (:username (json-body (app-req :get "/api/me" nil attacker))))
        "a planted (fixated) session id must not become the victim's session")))

;; ===== LOGIN RATE LIMIT =====

(deftest login-ip-limit-not-bypassed-by-spoofed-x-forwarded-for
  ;; nginx appends the real client address to whatever X-Forwarded-For the
  ;; client sent, so the first entry is attacker-controlled.
  (let [attempt (fn [i]
                  (api (-> (request :post "/api/login" {:username (str "nobody" i) :password "x"})
                           (assoc :remote-addr "172.18.0.5")
                           (assoc-in [:headers "x-forwarded-for"] (str "10.0." (mod i 250) "." i ", 203.0.113.9")))))
        codes   (mapv (comp status attempt) (range 60))]
    (is (= 429 (last codes)))))

(deftest login-user-limit-shared-between-username-and-email
  @(d/transact s/conn [[:db/add (eid "Micko") :user/email "micko@example.com"]])
  (dotimes [i 10]
    (api (-> (request :post "/api/login" {:username "Micko" :password "bad"})
             (assoc :remote-addr (str "198.51.100." i)))))
  (is (= 429 (status (api (-> (request :post "/api/login" {:username "micko@example.com" :password "bad"})
                              (assoc :remote-addr "198.51.100.200")))))))

;; ===== PASSWORD RESET =====

(deftest reset-link-not-logged-when-smtp-configured-and-no-email
  (with-redefs [mail/configured? (constantly true)
                mail/send! (fn [_] (throw (ex-info "should not send" {})))]
    (let [out (with-out-str (call :post "/api/password/forgot" {:username "Micko"}))]
      (is (not (str/includes? out "token=")) "reset tokens must not end up in production logs"))))

;; ===== OAUTH =====

(defn- fake-http [routes]
  (fn [url opts]
    (if-let [f (some (fn [[prefix f]] (when (str/starts-with? url prefix) f)) routes)]
      (f opts)
      {:status 404 :body {}})))

(deftest google-token-for-another-app-rejected-when-client-id-unset
  (with-redefs [oauth/google-client-id nil
                http/get (fake-http {"https://oauth2.googleapis.com/tokeninfo"
                                     (fn [_] {:status 200 :body {:aud "some-other-app" :sub "g-1"
                                                                 :email "x@gmail.com" :email_verified "true"
                                                                 :name "X"}})})]
    (is (= 401 (status (call :post "/api/oauth/google" {:idToken "tok"}))))))

(deftest google-unverified-email-does-not-take-over-local-account
  @(d/transact s/conn [[:db/add (eid "Micko") :user/email "micko@example.com"]])
  (with-redefs [oauth/google-client-id "our-app"
                http/get (fake-http {"https://oauth2.googleapis.com/tokeninfo"
                                     (fn [_] {:status 200 :body {:aud "our-app" :sub "g-attacker"
                                                                 :email "micko@example.com"
                                                                 :email_verified "false"
                                                                 :name "Evil"}})})]
    (let [r (call :post "/api/oauth/google" {:idToken "tok"})]
      (is (not= "Micko" (:username (json-body r))))
      (is (nil? (:user/google-id (d/entity (db) (eid "Micko")))))))
  (testing "a verified email still links the account"
    (with-redefs [oauth/google-client-id "our-app"
                  http/get (fake-http {"https://oauth2.googleapis.com/tokeninfo"
                                       (fn [_] {:status 200 :body {:aud "our-app" :sub "g-micko"
                                                                   :email "micko@example.com"
                                                                   :email_verified true
                                                                   :name "Micko"}})})]
      (is (= "Micko" (:username (json-body (call :post "/api/oauth/google" {:idToken "tok"}))))))))

(deftest facebook-token-must-belong-to-our-app
  (let [routes {"https://graph.facebook.com/debug_token"
                (fn [_] {:status 200 :body {:data {:app_id "other-app" :is_valid true :user_id "fb-1"}}})
                "https://graph.facebook.com/me"
                (fn [_] {:status 200 :body {:id "fb-1" :name "Someone" :email "s@example.com"}})}]
    (testing "token issued to another Facebook app"
      (with-redefs [oauth/facebook-app-id "our-app" oauth/facebook-app-secret "secret"
                    http/get (fake-http routes)]
        (is (= 401 (status (call :post "/api/oauth/facebook" {:accessToken "tok"}))))))
    (testing "Facebook login is disabled when the app is not configured"
      (with-redefs [oauth/facebook-app-id nil oauth/facebook-app-secret nil
                    http/get (fake-http routes)]
        (is (= 401 (status (call :post "/api/oauth/facebook" {:accessToken "tok"}))))))
    (testing "our own app's token works"
      (with-redefs [oauth/facebook-app-id "our-app" oauth/facebook-app-secret "secret"
                    http/get (fake-http (assoc routes "https://graph.facebook.com/debug_token"
                                               (fn [_] {:status 200 :body {:data {:app_id "our-app" :is_valid true
                                                                                  :user_id "fb-1"}}})))]
        (is (= 200 (status (call :post "/api/oauth/facebook" {:accessToken "tok"}))))))))

;; ===== OPEN WEBSOCKETS AFTER SESSION INVALIDATION =====

(defn- fake-socket! [un]
  (let [closed (atom false)]
    (rt/register! un (reify rt/Sink
                       (-send! [_ _] nil)
                       (-ping! [_] nil)
                       (-close! [_] (reset! closed true))))
    closed))

(deftest sockets-closed-when-sessions-are-invalidated
  (testing "log out of all devices"
    (let [closed (fake-socket! "Micko")]
      (call :post "/api/account/logout-all" {:keepCurrent true} "Micko")
      (is @closed)
      (is (zero? (rt/connection-count "Micko")))))
  (testing "password change"
    (let [closed (fake-socket! "Micko")]
      (call :put "/api/account/password" {:currentPassword pw :newPassword "newpass1"} "Micko")
      (is @closed)
      (is (zero? (rt/connection-count "Micko")))))
  (testing "username change (registry is keyed by username)"
    (let [closed (fake-socket! "Uros")]
      (call :put "/api/account/username" {:username "uros.new"} "Uros")
      (is @closed)
      (is (zero? (rt/connection-count "Uros")))))
  (testing "deactivate"
    (let [closed (fake-socket! "Milan")]
      (call :post "/api/account/deactivate" {:password pw} "Milan")
      (is @closed)))
  (testing "delete"
    (let [closed (fake-socket! "Pavel")]
      (call :post "/api/account/delete" {:password pw} "Pavel")
      (is @closed)
      (is (zero? (rt/connection-count "Pavel"))))))

;; ===== CHALLENGES =====

(defn- challenge! [from to]
  (json-body (call :post "/api/challenges" {:target to} from)))

(deftest only-the-target-can-respond-to-a-challenge
  (let [c (challenge! "Micko" "Uros")]
    (is (= 403 (status (call :put (str "/api/challenges/" (:id c)) {:action "decline"} "Milan"))))
    (is (= "pending" (name (:challenge/status (d/entity (db) (parse-long (:id c))))))))
  (testing "arbitrary entity ids / statuses can't be written"
    (is (= 404 (status (call :put (str "/api/challenges/" (eid "Toda")) {:action "accept"} "Toda"))))
    (is (nil? (:challenge/status (d/entity (db) (eid "Toda")))))
    (is (= 400 (status (call :put "/api/challenges/abc" {:action "accept"} "Toda")))))
  (testing "the target can accept; status matches what the app renders"
    (let [c (challenge! "Micko" "Uros")
          r (call :put (str "/api/challenges/" (:id c)) {:action "accept"} "Uros")]
      (is (= 200 (status r)))
      (is (= "active" (:status (json-body r))))
      (is (= "Uros" (get-in (json-body r) [:challenged :username]))))))

(deftest blocked-users-cannot-challenge
  (call :post "/api/blocks/Micko" nil "Uros")
  (is (= 404 (status (call :post "/api/challenges" {:target "Uros"} "Micko"))))
  (is (= 400 (status (call :post "/api/challenges" {:target "Micko"} "Micko")))))

;; ===== GROUPS / COMPETITIONS =====

(deftest join-toggle-requires-a-real-group-or-competition
  (is (= 404 (status (call :post (str "/api/groups/" (eid "Uros") "/join") nil "Micko"))))
  (is (empty? (:group/members (d/entity (db) (eid "Uros")))))
  (is (= 404 (status (call :post (str "/api/competitions/" (eid "Uros") "/join") nil "Micko"))))
  (is (empty? (:competition/members (d/entity (db) (eid "Uros")))))
  (is (= 400 (status (call :post "/api/groups/xyz/join" nil "Micko"))))
  (is (= 400 (status (call :get "/api/groups/xyz" nil "Micko"))))
  (is (#{400 404} (status (call :get "/api/competitions/xyz/feed" nil "Micko")))))

(deftest competition-feed-respects-post-privacy
  (let [c   (json-body (call :post "/api/competitions" {:name "Spring"} "Uros"))
        _   (call :post (str "/api/competitions/" (:id c) "/join") nil "Milan")
        _   (call :put "/api/settings/privacy" {:isPrivate true} "Milan")
        _   @(d/transact s/conn [{:post/author (eid "Milan") :post/caption "secret day 1"
                                   :post/created-at (Date.)}])
        _   @(d/transact s/conn [{:post/author (eid "Uros") :post/caption "public day 1"
                                   :post/created-at (Date.)}])
        feed (fn [viewer] (map :caption (json-body (call :get (str "/api/competitions/" (:id c) "/feed") nil viewer))))]
    (is (not (some #{"secret day 1"} (feed "Toda"))) "private member's posts leak to non-followers")
    (is (not (some #{"secret day 1"} (feed nil))) "... and to logged-out visitors")
    (is (some #{"public day 1"} (feed "Toda")))
    (follow! "Toda" "Milan")
    (is (some #{"secret day 1"} (feed "Toda")) "followers still see it")))

;; ===== RECAP / BADGES / SEARCH / LEADERBOARD / STORIES =====

(deftest recap-respects-private-accounts-and-blocks
  (call :put "/api/settings/privacy" {:isPrivate true} "Uros")
  (is (= 403 (status (call :get "/api/recap/Uros" nil "Micko"))))
  (is (= 200 (status (call :get "/api/recap/Uros" nil "Uros"))))
  (call :post "/api/blocks/Micko" nil "Milan")
  (is (#{403 404} (status (call :get "/api/recap/Milan" nil "Micko")))))

(deftest badges-hidden-from-blocked-users
  (call :post "/api/blocks/Micko" nil "Milan")
  (is (= 404 (status (call :get "/api/users/Milan/badges" nil "Micko"))))
  (call :post "/api/account/deactivate" {:password pw} "Toda")
  (is (= 404 (status (call :get "/api/users/Toda/badges" nil "Micko")))))

(deftest search-hides-blockers-and-deactivated-accounts
  (call :post "/api/blocks/Micko" nil "Milan")
  (call :post "/api/account/deactivate" {:password pw} "Toda")
  (let [names (fn [q viewer] (set (map :username (json-body (call :get (str "/api/users/search?q=" q) nil viewer)))))]
    (is (not (contains? (names "mil" "Micko") "Milan")))
    (is (not (contains? (names "tod" "Micko") "Toda")))
    (is (not (contains? (names "tod" nil) "Toda")))
    (is (contains? (names "uro" "Micko") "Uros"))))

(deftest leaderboard-hides-blocked-and-deactivated-accounts
  (call :post "/api/blocks/Micko" nil "Milan")
  (call :post "/api/account/deactivate" {:password pw} "Toda")
  (let [names (set (map :username (json-body (call :get "/api/leaderboard" nil "Micko"))))]
    (is (not (contains? names "Milan")))
    (is (not (contains? names "Toda")))
    (is (contains? names "Uros"))
    (is (contains? names "Micko"))))

(deftest stories-of-deactivated-or-muted-accounts-hidden
  (follow! "Micko" "Uros")
  (follow! "Micko" "Milan")
  (call :post "/api/stories" {:text "uros story"} "Uros")
  (call :post "/api/stories" {:text "milan story"} "Milan")
  (call :post "/api/account/deactivate" {:password pw} "Uros")
  (call :post "/api/mutes/Milan" nil "Micko")
  (let [owners (set (map :username (json-body (call :get "/api/stories" nil "Micko"))))]
    (is (not (contains? owners "Uros")))
    (is (not (contains? owners "Milan")))))

(deftest stories-respect-blocks-even-with-a-stale-follow
  ;; blocks written without the unfollow (older data / direct writes) must
  ;; still hide stories in both directions
  (follow! "Micko" "Uros")
  (let [sid (:id (json-body (call :post "/api/stories" {:text "uros"} "Uros")))]
    @(d/transact s/conn [[:db/add (eid "Uros") :user/blocks (eid "Micko")]])
    (is (empty? (json-body (call :get "/api/stories" nil "Micko"))))
    (is (= 404 (status (call :post (str "/api/stories/" sid "/view") nil "Micko"))))))

(deftest view-story-only-for-visible-stories
  (call :put "/api/settings/privacy" {:isPrivate true} "Uros")
  (let [sid (:id (json-body (call :post "/api/stories" {:text "private"} "Uros")))]
    (is (#{403 404} (status (call :post (str "/api/stories/" sid "/view") nil "Micko"))))
    (is (empty? (:story/viewed-by (d/entity (db) (parse-long sid))))))
  (testing "a non-story id is not written to"
    (is (= 404 (status (call :post (str "/api/stories/" (eid "Uros") "/view") nil "Micko"))))
    (is (empty? (:story/viewed-by (d/entity (db) (eid "Uros"))))))
  (testing "deleting someone else's story is 403, not 401"
    (let [sid (:id (json-body (call :post "/api/stories" {:text "mine"} "Milan")))]
      (is (= 403 (status (call :delete (str "/api/stories/" sid) nil "Micko")))))))

;; ===== ACTIVITIES =====

(deftest activity-input-validation
  (testing "non-numeric ids are 400, not 500"
    (is (= 400 (status (call :put "/api/activities/abc" {:type "running" :duration 10 :intensity 3} "Micko"))))
    (is (= 400 (status (call :delete "/api/activities/abc" nil "Micko")))))
  (testing "XP can't be inflated (or deflated) with absurd durations/intensities"
    (is (= 400 (status (call :post "/api/activities" {:type "running" :duration 100000000 :intensity 5} "Micko"))))
    (is (= 400 (status (call :post "/api/activities" {:type "running" :duration -500 :intensity 5} "Micko"))))
    (is (= 400 (status (call :post "/api/activities" {:type "running" :duration 30 :intensity 99} "Micko"))))
    (is (= 400 (status (call :post "/api/activities" {:type "running" :duration "30" :intensity 3} "Micko"))))
    (is (zero? (or (:user/xp (d/entity (db) (eid "Micko"))) 0))))
  (testing "valid input still works; bad updates are 400"
    (let [a (json-body (call :post "/api/activities" {:type "running" :duration 30 :intensity 3} "Micko"))]
      (is (some? (:id a)))
      (is (= 400 (status (call :put (str "/api/activities/" (:id a)) {:type "nope" :duration 30 :intensity 3} "Micko"))))
      (is (= 400 (status (call :put (str "/api/activities/" (:id a)) {:type "running" :intensity 3} "Micko"))))
      (is (= 200 (status (call :put (str "/api/activities/" (:id a)) {:type "gym" :duration 20 :intensity 2} "Micko")))))))

(deftest deleting-an-activity-takes-back-its-xp
  (let [xp #(or (:user/xp (d/entity (db) (eid "Micko"))) 0)]
    (dotimes [_ 3]
      (let [a (json-body (call :post "/api/activities" {:type "running" :duration 600 :intensity 5} "Micko"))]
        (call :delete (str "/api/activities/" (:id a)) nil "Micko")))
    (is (zero? (xp)) "log + delete in a loop must not farm leaderboard XP")
    (let [a (json-body (call :post "/api/activities" {:type "running" :duration 10 :intensity 1} "Micko"))]
      (is (= 20 (xp)))
      (call :put (str "/api/activities/" (:id a)) {:type "running" :duration 20 :intensity 1} "Micko")
      (is (= 40 (xp)) "updates adjust XP by the difference"))))

(deftest oauth-new-user-never-upserts-into-an-existing-username
  ;; "Micko" is taken, so the OAuth user gets micko+suffix; if that name is
  ;; ALSO taken, the :db.unique/identity upsert would hand over that account.
  @(d/transact s/conn [{:user/username "mickoaaaa" :user/xp 0 :user/password-hash "x"}])
  (let [suffixes (atom ["aaaa" "bbbb"])]
    (with-redefs [oauth/google-client-id "our-app"
                  oauth/random-suffix (fn [] (let [x (first @suffixes)] (swap! suffixes rest) (or x "cccc")))
                  http/get (fake-http {"https://oauth2.googleapis.com/tokeninfo"
                                       (fn [_] {:status 200 :body {:aud "our-app" :sub "g-new"
                                                                   :email_verified true :email "new@gmail.com"
                                                                   :name "Micko"}})})]
      (let [r (call :post "/api/oauth/google" {:idToken "tok"})]
        (is (= 200 (status r)))
        (is (not= "mickoaaaa" (:username (json-body r))))
        (is (nil? (:user/google-id (d/entity (db) (eid "mickoaaaa")))))))))

(deftest profile-posts-count-excludes-archived
  @(d/transact s/conn [{:post/author (eid "Uros") :post/caption "visible" :post/created-at (Date.)}
                       {:post/author (eid "Uros") :post/caption "archived" :post/created-at (Date.)
                        :post/archived true}])
  (is (= 1 (:postsCount (json-body (call :get "/api/users/Uros" nil "Micko")))))
  (is (= 1 (:postsCount (json-body (call :get "/api/users/Uros" nil "Uros"))))))

(deftest user-streak-hidden-from-blocked-users
  (call :post "/api/blocks/Micko" nil "Uros")
  (is (= 404 (status (call :get "/api/users/Uros/streak" nil "Micko"))))
  (is (= 200 (status (call :get "/api/users/Uros/streak" nil "Milan")))))

(deftest delete-account-removes-reactions-media-tokens-and-files
  (let [pavel (eid "Pavel")
        tx    @(d/transact s/conn [{:db/id "m" :media/owner pavel :media/url "/uploads/p.jpg"
                                    :media/storage-keys ["p.jpg" "p-480.jpg"]}
                                   {:db/id "p" :post/author pavel :post/caption "day 1" :post/created-at (Date.)}
                                   {:db/id "q" :post/author (eid "Uros") :post/caption "uros" :post/created-at (Date.)}
                                   {:db/id "r1" :reaction/post "q" :reaction/user pavel :reaction/emoji "🔥"}
                                   {:db/id "r2" :reaction/post "p" :reaction/user (eid "Uros") :reaction/emoji "👏"}
                                   {:db/id "t" :auth-token/hash "h" :auth-token/user pavel :auth-token/sv 0}])
        ids   (:tempids tx)
        id    #(d/resolve-tempid (:db-after tx) ids %)
        media (id "m")
        deleted (atom nil)]
    (with-redefs [web.media/delete-stored-files! (fn [db eids] (reset! deleted (set eids)))]
      (is (= 200 (status (call :post "/api/account/delete" {:password pw} "Pavel")))))
    (doseq [k ["m" "r1" "r2" "t"]]
      (is (empty? (d/q '[:find ?a :in $ ?e :where [?e ?a]] (db) (id k))) (str k " left behind")))
    (is (= #{media} @deleted) "stored media files are deleted too")))

(deftest forgot-password-capped-per-account
  @(d/transact s/conn [[:db/add (eid "Micko") :user/email "micko@example.com"]])
  (let [sent (atom 0)]
    (with-redefs [accounts/deliver-reset! (fn [& _] (swap! sent inc))]
      (dotimes [i 8]
        (is (= 200 (status (api (-> (request :post "/api/password/forgot" {:email "micko@example.com"})
                                    (assoc :remote-addr (str "192.0.2." i)))))))))
    (is (= 5 @sent))))
