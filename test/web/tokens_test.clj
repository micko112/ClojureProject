(ns web.tokens-test
  (:require [clojure.test :refer :all]
            [cheshire.core :as json]
            [project.test-db :refer [with-mem-db request json-body]]
            [web.server :as server])
  (:import (java.io ByteArrayInputStream)))

(use-fixtures :each with-mem-db)

(defn- call
  "Through the full app middleware (cookie session, tokens, session version)."
  [method uri body headers]
  (server/app (update (request method uri body) :headers merge headers)))

(defn- login-token []
  (let [r (call :post "/api/login" {:username "Micko" :password "password123"} {"x-auth-mode" "token"})]
    (is (= 200 (:status r)))
    (is (nil? (get-in r [:headers "Set-Cookie"])) "token logins don't set a cookie")
    (:token (json-body r))))

(defn- bearer [t] {"authorization" (str "Bearer " t)})

(deftest token-login-and-use
  (let [t (login-token)]
    (is (string? t))
    (is (= "Micko" (:username (json-body (call :get "/api/me" nil (bearer t))))))
    (is (= 401 (:status (call :get "/api/me" nil (bearer "nope")))))
    (is (= 401 (:status (call :get "/api/me" nil {}))))))

(deftest cookie-login-unchanged
  (let [r (call :post "/api/login" {:username "Micko" :password "password123"} {})]
    (is (= 200 (:status r)))
    (is (nil? (:token (json-body r))))
    (is (some? (get-in r [:headers "Set-Cookie"])))))

(deftest logout-revokes-token
  (let [t (login-token)]
    (is (= 200 (:status (call :post "/api/logout" {} (bearer t)))))
    (is (= 401 (:status (call :get "/api/me" nil (bearer t)))))))

(deftest logout-all-revokes-every-token
  (let [t1 (login-token)
        t2 (login-token)]
    (is (= 200 (:status (call :post "/api/account/logout-all" {} (bearer t1)))))
    (is (= 401 (:status (call :get "/api/me" nil (bearer t2)))))
    (is (= 401 (:status (call :get "/api/me" nil (bearer t1)))))))

(deftest wrong-password-gives-no-token
  (let [r (call :post "/api/login" {:username "Micko" :password "bad-password"} {"x-auth-mode" "token"})]
    (is (= 401 (:status r)))
    (is (nil? (:token (json-body r))))))

(deftest register-with-token
  (let [r (call :post "/api/register" {:username "newbie" :password "secret123" :email "n@example.com"} {"x-auth-mode" "token"})
        t (:token (json-body r))]
    (is (= 201 (:status r)))
    (is (= "newbie" (:username (json-body (call :get "/api/me" nil (bearer t))))))))
