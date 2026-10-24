(ns web.accounts-test
  (:require [clojure.test :refer :all]
            [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.accounts :as accounts]
            [web.accounts.mail :as mail]
            [web.server :as server])
  (:import (java.util Date)))

(defn- reset-limits [f] (accounts/reset-rate-limits!) (f))

(use-fixtures :each with-mem-db reset-limits)

(def pw "password123") ; seed users' password

(defn- db [] (d/db s/conn))
(defn- eid [un] (accounts/find-user (db) un))
(defn- call [method uri & [body user]]
  (let [[path qs] (str/split uri #"\?" 2)]
    (api (cond-> (request method path body user) qs (assoc :query-string qs)))))
(defn- status [r] (:status r))

(defn- login [ident password]
  (call :post "/api/login" {:username ident :password password}))

;; ---- cookie helpers for full-stack (server/app) session tests ----

(defn- cookie-of [resp]
  (some->> (get-in resp [:headers "Set-Cookie"]) first (re-find #"bb-session=[^;]*")))

(defn- app-req [method uri body cookie]
  (server/app (cond-> (request method uri body)
                cookie (assoc-in [:headers "cookie"] cookie))))

;; ===== privacy contract =====

(deftest private-follow-request-flow
  (is (= 200 (status (call :put "/api/settings/privacy" {:isPrivate true} "Uros"))))
  (testing "following a private account creates a request"
    (let [r (call :post "/api/follow" {:username "Uros"} "Micko")]
      (is (= "requested" (:followStatus (json-body r))))
      (is (not (accounts/follows? (db) (eid "Micko") (eid "Uros"))))
      (is (false? (accounts/can-view-posts? (db) (eid "Micko") (eid "Uros"))))
      (is (= "requested" (:followStatus (json-body (call :get "/api/users/Uros" nil "Micko")))))))
  (testing "profile still returns header info"
    (let [p (json-body (call :get "/api/users/Uros" nil "Micko"))]
      (is (= "Uros" (:username p)))
      (is (true? (:isPrivate p)))
      (is (false? (:canViewPosts p)))))
  (testing "owner sees and accepts the request"
    (let [reqs (json-body (call :get "/api/follow-requests" nil "Uros"))]
      (is (= ["Micko"] (map (comp :username :user) reqs))))
    (is (= 1 (get-in (json-body (call :get "/api/me" nil "Uros")) [:settings :followRequestCount])))
    (is (= 200 (status (call :post "/api/follow-requests/Micko/accept" nil "Uros"))))
    (is (accounts/follows? (db) (eid "Micko") (eid "Uros")))
    (is (true? (accounts/can-view-posts? (db) (eid "Micko") (eid "Uros"))))
    (is (empty? (json-body (call :get "/api/follow-requests" nil "Uros"))))
    (is (= "following" (:followStatus (json-body (call :get "/api/users/Uros" nil "Micko"))))))
  (testing "decline and cancel"
    (call :post "/api/follow" {:username "Uros"} "Milan")
    (is (= 200 (status (call :post "/api/follow-requests/Milan/decline" nil "Uros"))))
    (is (not (accounts/follows? (db) (eid "Milan") (eid "Uros"))))
    (call :post "/api/follow" {:username "Uros"} "Pavel")
    (is (= "cancelled" (:action (json-body (call :post "/api/follow" {:username "Uros"} "Pavel")))))
    (is (not (accounts/requested? (db) (eid "Pavel") (eid "Uros")))))
  (testing "logged-out viewers can't see private posts"
    (is (false? (accounts/can-view-posts? (db) nil (eid "Uros"))))
    (is (true? (accounts/can-view-posts? (db) nil (eid "Toda")))))
  (testing "going public accepts pending requests"
    (call :post "/api/follow" {:username "Uros"} "Vule")
    (call :put "/api/settings/privacy" {:isPrivate false} "Uros")
    (is (accounts/follows? (db) (eid "Vule") (eid "Uros")))))

(deftest block-hides-and-unfollows
  (call :post "/api/follow" {:username "Uros"} "Micko")
  (call :post "/api/follow" {:username "Micko"} "Uros")
  (call :post "/api/close-friends/Uros" nil "Micko")
  (is (= 200 (status (call :post "/api/blocks/Uros" nil "Micko"))))
  (let [m (eid "Micko") u (eid "Uros")]
    (is (not (accounts/follows? (db) m u)))
    (is (not (accounts/follows? (db) u m)))
    (is (not (accounts/close-friend? (db) m u)))
    (is (contains? (accounts/hidden-author-ids (db) m) u))
    (is (contains? (accounts/hidden-author-ids (db) u) m))
    (is (false? (accounts/can-view-posts? (db) u m)))
    (is (false? (accounts/can-view-posts? (db) m u))))
  (testing "blocked user can't find the profile or follow"
    (is (= 404 (status (call :get "/api/users/Micko" nil "Uros"))))
    (is (= 404 (status (call :post "/api/follow" {:username "Micko"} "Uros")))))
  (testing "blocker still sees the header with blocked flag"
    (is (true? (:blocked (json-body (call :get "/api/users/Uros" nil "Micko"))))))
  (is (= ["Uros"] (map :username (json-body (call :get "/api/blocks" nil "Micko")))))
  (call :delete "/api/blocks/Uros" nil "Micko")
  (is (empty? (accounts/hidden-author-ids (db) (eid "Micko")))))

(deftest mute-hides-without-unfollowing
  (call :post "/api/follow" {:username "Uros"} "Micko")
  (call :post "/api/mutes/Uros" nil "Micko")
  (is (accounts/follows? (db) (eid "Micko") (eid "Uros")))
  (is (contains? (accounts/hidden-author-ids (db) (eid "Micko")) (eid "Uros")))
  (is (true? (accounts/can-view-posts? (db) (eid "Micko") (eid "Uros"))))
  (is (= ["Uros"] (map :username (json-body (call :get "/api/mutes" nil "Micko"))))))

(deftest close-friends
  (is (false? (accounts/close-friend? (db) (eid "Micko") (eid "Uros"))))
  (call :post "/api/close-friends/Uros" nil "Micko")
  (call :post "/api/close-friends/Milan" nil "Micko")
  (is (true? (accounts/close-friend? (db) (eid "Micko") (eid "Uros"))))
  (is (false? (accounts/close-friend? (db) (eid "Uros") (eid "Micko"))))
  (is (= ["Milan" "Uros"] (map :username (json-body (call :get "/api/close-friends" nil "Micko")))))
  (call :delete "/api/close-friends/Uros" nil "Micko")
  (is (false? (accounts/close-friend? (db) (eid "Micko") (eid "Uros")))))

(deftest remove-follower-and-lists
  (call :post "/api/follow" {:username "Micko"} "Uros")
  (call :post "/api/follow" {:username "Micko"} "Milan")
  (is (= #{"Uros" "Milan"} (set (map :username (json-body (call :get "/api/users/Micko/followers" nil "Micko"))))))
  (is (= ["Milan"] (map :username (json-body (call :get "/api/users/Micko/followers?q=mil" nil "Micko")))))
  (call :post "/api/followers/Uros/remove" nil "Micko")
  (is (not (accounts/follows? (db) (eid "Uros") (eid "Micko"))))
  (is (= ["Milan"] (json-body (call :get "/api/followers/Micko" nil "Micko")))))

(deftest notification-preferences
  (is (accounts/notification-enabled? (db) (eid "Uros") :like))
  (call :put "/api/settings/notifications" {:likes false :follows false} "Uros")
  (is (not (accounts/notification-enabled? (db) (eid "Uros") :like)))
  (is (not (accounts/notification-enabled? (db) (eid "Uros") "follow")))
  (is (accounts/notification-enabled? (db) (eid "Uros") :comment))
  (is (false? (get-in (json-body (call :get "/api/me" nil "Uros")) [:settings :notifications :likes])))
  (call :post "/api/follow" {:username "Uros"} "Micko")
  (is (empty? (d/q '[:find [?n ...] :in $ ?u :where [?n :notification/recipient ?u]] (db) (eid "Uros")))))

;; ===== account settings =====

(deftest change-username-uniqueness
  (is (= 400 (status (call :put "/api/account/username" {:username "uros"} "Micko"))) "case-insensitive")
  (is (= 400 (status (call :put "/api/account/username" {:username "ab"} "Micko"))))
  (is (= 400 (status (call :put "/api/account/username" {:username "bad name!"} "Micko"))))
  (let [r (call :put "/api/account/username" {:username "micko.dev_1"} "Micko")]
    (is (= 200 (status r)))
    (is (= "micko.dev_1" (:username (json-body r))))
    (is (= "micko.dev_1" (get-in r [:session :username]))))
  (is (nil? (accounts/find-user (db) "Micko")))
  (is (= 400 (status (call :post "/api/register" {:username "MICKO.DEV_1" :password "secret12"})))))

(deftest update-profile-validation
  (is (= 400 (status (call :put "/api/profile" {:bio (apply str (repeat 151 "x"))} "Micko"))))
  (let [r (json-body (call :put "/api/profile" {:bio "Day 12" :website "example.com" :pronouns "he/him"} "Micko"))]
    (is (= "https://example.com" (:website r)))
    (is (= "he/him" (:pronouns r))))
  (is (nil? (:website (json-body (call :put "/api/profile" {:website ""} "Micko"))))))

(deftest change-password
  (is (= 400 (status (call :put "/api/account/password" {:currentPassword "nope" :newPassword "newpass1"} "Micko"))))
  (is (= 200 (status (call :put "/api/account/password" {:currentPassword pw :newPassword "newpass1"} "Micko"))))
  (is (= 401 (status (login "Micko" pw))))
  (is (= 200 (status (login "Micko" "newpass1"))))
  (testing "OAuth-only account can set a password without current one"
    @(d/transact s/conn [{:user/username "googler" :user/google-id "g-1"}])
    (is (= 200 (status (call :put "/api/account/password" {:newPassword "mypass12"} "googler"))))
    (is (= 200 (status (login "googler" "mypass12"))))))

(deftest change-email
  (is (= 400 (status (call :put "/api/account/email" {:email "not-an-email"} "Micko"))))
  (is (= 200 (status (call :put "/api/account/email" {:email "Micko@Example.com"} "Micko"))))
  (is (= 400 (status (call :put "/api/account/email" {:email "micko@example.com"} "Uros"))))
  (is (= "micko@example.com" (get-in (json-body (call :get "/api/me" nil "Micko")) [:settings :email]))))

(deftest register-with-email-and-login-with-email
  (let [r (call :post "/api/register" {:username "ana.b" :email "Ana@Mail.com" :password "secret12" :displayName "Ana"})]
    (is (= 201 (status r)))
    (is (= "Ana" (:displayName (json-body r))))
    (is (= "ana@mail.com" (get-in (json-body r) [:settings :email]))))
  (is (= 400 (status (call :post "/api/register" {:username "ana2" :email "ana@mail.com" :password "secret12"}))))
  (is (= 200 (status (login "ANA@mail.com" "secret12"))))
  (is (= 200 (status (login "ANA.B" "secret12"))) "username is case-insensitive")
  (is (= 401 (status (login "ana@mail.com" "wrong")))))

(deftest no-hash-login-bug
  @(d/transact s/conn [{:user/username "fbuser" :user/facebook-id "fb-1"}])
  (let [r (login "fbuser" "anything")]
    (is (= 401 (status r)))
    (is (= "oauth-only" (:code (json-body r))))
    (is (nil? (:session r))))
  (is (= 401 (status (login "fbuser" nil)))))

(deftest login-rate-limit
  (dotimes [_ 10] (login "Micko" "wrong"))
  (is (= 429 (status (login "Micko" pw))))
  (accounts/reset-rate-limits!)
  (is (= 200 (status (login "Micko" pw)))))

(deftest password-reset-single-use-and-expiry
  (call :put "/api/account/email" {:email "micko@example.com"} "Micko")
  (let [links (atom [])]
    (with-redefs [accounts/deliver-reset! (fn [_to _un link] (swap! links conj link))]
      (is (= 200 (status (call :post "/api/password/forgot" {:email "nobody@example.com"}))))
      (is (empty? @links) "unknown email sends nothing but still answers 200")
      (is (= 200 (status (call :post "/api/password/forgot" {:email "MICKO@example.com"}))))
      (is (= 1 (count @links))))
    (let [token (second (re-find #"token=(.+)$" (first @links)))]
      (is (= 400 (status (call :post "/api/password/reset" {:token "bogus" :password "brandnew1"}))))
      (let [r (call :post "/api/password/reset" {:token token :password "brandnew1"})]
        (is (= 200 (status r)))
        (is (= "Micko" (get-in r [:session :username]))))
      (is (= 400 (status (call :post "/api/password/reset" {:token token :password "another12"}))) "single use")
      (is (= 200 (status (login "Micko" "brandnew1")))))
    (testing "expired token"
      (let [token (accounts/create-reset-token! (eid "Micko"))
            t     (d/q '[:find ?t . :in $ ?u :where [?t :reset-token/user ?u] (not [?t :reset-token/used-at])]
                       (db) (eid "Micko"))]
        @(d/transact s/conn [[:db/add t :reset-token/expires-at (Date. (- (System/currentTimeMillis) 1000))]])
        (is (= 400 (status (call :post "/api/password/reset" {:token token :password "brandnew2"}))))))))

(deftest session-version-invalidation
  (let [login! #(app-req :post "/api/login" {:username "Micko" :password pw} nil)
        a (cookie-of (login!))
        b (cookie-of (login!))]
    (is (and a b (not= a b)))
    (is (= 200 (status (app-req :get "/api/me" nil a))))
    (is (= 200 (status (app-req :get "/api/me" nil b))))
    (is (= 200 (status (app-req :post "/api/account/logout-all" {:keepCurrent true} a))))
    (is (= 401 (status (app-req :get "/api/me" nil b))) "other device logged out")
    (is (= 200 (status (app-req :get "/api/me" nil a))) "current device kept")
    (testing "legacy sessions without a version keep working until a bump"
      (let [handler (accounts/wrap-session-version (fn [req] {:status 200 :body (get-in req [:session :username])}))]
        (is (= "Uros" (:body (handler {:session {:username "Uros"}}))))
        @(d/transact s/conn [[:db/add (eid "Uros") :user/session-version 1]])
        (let [r (handler {:session {:username "Uros"}})]
          (is (nil? (:body r)))
          (is (contains? r :session)))))))

(deftest deactivate-and-delete
  (testing "deactivate hides the account until next login"
    (is (= 400 (status (call :post "/api/account/deactivate" {:password "nope"} "Uros"))))
    (is (= 200 (status (call :post "/api/account/deactivate" {:password pw} "Uros"))))
    (is (= 404 (status (call :get "/api/users/Uros" nil "Micko"))))
    (is (contains? (accounts/hidden-author-ids (db) (eid "Micko")) (eid "Uros")))
    (is (= 200 (status (login "Uros" pw))))
    (is (= 200 (status (call :get "/api/users/Uros" nil "Micko")))))
  (testing "delete account removes user and content"
    (call :post "/api/posts" {:caption "bye"} "Milan")
    (call :post "/api/follow" {:username "Milan"} "Micko")
    (is (= 400 (status (call :post "/api/account/delete" {:password "nope"} "Milan"))))
    (is (= 200 (status (call :post "/api/account/delete" {:password pw} "Milan"))))
    (is (nil? (eid "Milan")))
    (is (empty? (d/q '[:find [?p ...] :where [?p :post/caption "bye"]] (db))))
    (is (= 404 (status (call :get "/api/users/Milan" nil "Micko"))))))

(deftest suggested-accounts
  ;; Micko -> Uros -> Milan: Milan is a friend of a friend
  (call :post "/api/follow" {:username "Uros"} "Micko")
  (call :post "/api/follow" {:username "Milan"} "Uros")
  (call :post "/api/blocks/Vule" nil "Micko")
  (let [names (map :username (json-body (call :get "/api/users/suggested" nil "Micko")))]
    (is (= "Milan" (first names)))
    (is (not-any? #{"Micko" "Uros" "Vule"} names))
    (is (some #{"Pavel"} names))))

(deftest smtp-client-talks-plain-smtp
  (let [server (java.net.ServerSocket. 0)
        port   (.getLocalPort server)
        seen   (atom [])
        worker (future
                 (with-open [sock (.accept server)]
                   (let [in  (java.io.BufferedReader. (java.io.InputStreamReader. (.getInputStream sock)))
                         out (.getOutputStream sock)
                         say #(do (.write out (.getBytes (str % "\r\n"))) (.flush out))]
                     (say "220 fake")
                     (loop [data? false auth 0]
                       (when-let [l (.readLine in)]
                         (swap! seen conj l)
                         (cond
                           data?                       (if (= l ".") (do (say "250 queued") (recur false auth)) (recur true auth))
                           (str/starts-with? l "EHLO") (do (say "250-fake") (say "250 AUTH LOGIN") (recur false auth))
                           (= l "AUTH LOGIN")          (do (say "334 VXNlcm5hbWU6") (recur false 1))
                           (= auth 1)                  (do (say "334 UGFzc3dvcmQ6") (recur false 2))
                           (= auth 2)                  (do (say "235 ok") (recur false 0))
                           (= l "DATA")                (do (say "354 go") (recur true auth))
                           (= l "QUIT")                (say "221 bye")
                           :else                       (do (say "250 ok") (recur false auth))))))))]
    (with-redefs [mail/config (constantly {:host "127.0.0.1" :port port :user "u" :pass "p"
                                           :from "BeBetter <no-reply@example.com>" :ssl? false})]
      (is (true? (mail/send! {:to "a@example.com" :subject "Reset" :body "Hi\n.dot line"}))))
    (deref worker 5000 nil)
    (.close server)
    (is (some #{"MAIL FROM:<no-reply@example.com>"} @seen))
    (is (some #{"RCPT TO:<a@example.com>"} @seen))
    (is (some #{"..dot line"} @seen) "dot-stuffing")))
