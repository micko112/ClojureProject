(ns web.realtime-review-test
  "Regression tests for privacy defects found in review of realtime / DM / live."
  (:require [clojure.test :refer :all]
            [cheshire.core :as json]
            [datomic.api :as d]
            [project.system :as s]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.realtime :as rt]
            [web.dm :as dm]
            [web.live :as live]))

(defn- reset-state [f]
  (reset! rt/registry {})
  (reset! live/rooms {})
  (f)
  (reset! rt/registry {})
  (reset! live/rooms {}))

(use-fixtures :each with-mem-db reset-state)

(defn- fake-sink []
  (let [sent (atom [])]
    [(reify rt/Sink
       (-send! [_ text] (swap! sent conj (json/parse-string text true)))
       (-ping! [_] nil)
       (-close! [_] nil))
     sent]))

(defn- connect! [username]
  (let [[sink sent] (fake-sink)]
    (rt/register! username sink)
    sent))

(defn- of-type [sent t] (filter #(= t (:type %)) @sent))

(defn- eid [username] (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] (d/db s/conn) username))

(defn- presence-of [viewer target]
  (get (json-body (api (assoc (request :get "/api/presence" nil viewer) :query-string (str "users=" target))))
       (keyword target)))

(deftest presence-only-for-contacts
  (connect! "Uros")
  (testing "strangers can't track when someone is online"
    (is (nil? (:online (presence-of "Micko" "Uros")))))
  (testing "people you have a conversation with can (Instagram's activity status rule)"
    (api (request :post "/api/messages" {:to "Uros" :content "hi"} "Micko"))
    (is (true? (:online (presence-of "Micko" "Uros")))))
  (testing "but not after they block you"
    (api (request :post "/api/blocks/Micko" nil "Uros"))
    (is (nil? (:online (presence-of "Micko" "Uros")))))
  (testing "you always see your own"
    (connect! "Micko")
    (is (true? (:online (presence-of "Micko" "Micko"))))))

(deftest presence-not-pushed-to-blocked-contacts
  (api (request :post "/api/messages" {:to "Uros" :content "hi"} "Micko"))
  (api (request :post "/api/blocks/Micko" nil "Uros"))
  (let [micko (connect! "Micko")]
    (connect! "Uros")
    (is (empty? (filter #(= "Uros" (:username %)) (of-type micko "presence"))))
    (testing "the conversation DTO doesn't leak the blocker's online status either"
      (let [conv (first (json-body (api (request :get "/api/conversations" nil "Micko"))))]
        (is (some? conv))
        (is (nil? (get-in conv [:other :online])))))))

(deftest blocked-viewer-is-removed-from-live
  (let [host   (connect! "Micko")
        viewer (connect! "Uros")
        lid    (live/start-live! (eid "Micko") "day 10")]
    (is (= :ok (live/join! lid "Uros")))
    (api (request :post "/api/blocks/Uros" nil "Micko"))
    (testing "a blocked viewer can no longer comment, heart or signal"
      (is (nil? (live/comment! lid "Uros" "still here")))
      (is (nil? (live/heart! lid "Uros")))
      (is (nil? (live/signal! lid "Uros" "Micko" {:sdp "x"}))))
    (is (not (contains? (:viewers (get @live/rooms lid)) "Uros")))
    (is (seq (of-type host "live:viewer-left")) "host is told to drop the peer connection")
    (is (empty? (filter #(= "still here" (get-in % [:comment :text])) (of-type viewer "live:comment"))))))
