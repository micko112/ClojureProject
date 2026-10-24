(ns web.smoke-test
  (:require [clojure.test :refer :all]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.server :as server]))

(use-fixtures :each with-mem-db)

(deftest register-and-post
  (is (= 201 (:status (server/app (request :post "/api/register" {:username "ana" :password "secret12"})))))
  (let [r (api (request :post "/api/posts" {:caption "Day 1 #gym"} "Micko"))]
    (is (= 201 (:status r)))
    (is (= "Day 1 #gym" (:caption (json-body r)))))
  (let [r (api (request :get "/api/feed" nil "Micko"))]
    (is (= 200 (:status r)))
    (is (= 1 (count (:items (json-body r)))))))
