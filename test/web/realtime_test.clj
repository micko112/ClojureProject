(ns web.realtime-test
  (:require [clojure.test :refer :all]
            [cheshire.core :as json]
            [datomic.api :as d]
            [project.system :as s]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.server :as server]
            [web.realtime :as rt]
            [web.notifications :as notifications]
            [web.dm :as dm]
            [web.live :as live]))

(defn- reset-state [f]
  (reset! rt/registry {})
  (reset! live/rooms {})
  (f)
  (reset! rt/registry {})
  (reset! live/rooms {}))

(use-fixtures :each with-mem-db reset-state)

;; ----- helpers -----

(defn fake-sink
  "Returns [sink sent-atom]; sent-atom collects decoded events."
  []
  (let [sent (atom [])]
    [(reify rt/Sink
       (-send! [_ text] (swap! sent conj (json/parse-string text true)))
       (-ping! [_] nil)
       (-close! [_] nil))
     sent]))

(defn broken-sink []
  (reify rt/Sink
    (-send! [_ _] (throw (ex-info "socket closed" {})))
    (-ping! [_] (throw (ex-info "socket closed" {})))
    (-close! [_] nil)))

(defn connect!
  "Registers a fake connection for username, returns the sent atom."
  [username]
  (let [[sink sent] (fake-sink)]
    (rt/register! username sink)
    sent))

(defn of-type [sent t] (filter #(= t (:type %)) @sent))

(defn eid [username] (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] (d/db s/conn) username))

(defn follow! [a b] @(d/transact s/conn [[:db/add (eid a) :user/follows (eid b)]]))

(defn mk-post! [author caption]
  (let [r (api (request :post "/api/posts" {:caption caption} author))]
    (:id (json-body r))))

;; ----- registry & publish -----

(deftest registry-add-remove
  (let [[s1 _] (fake-sink) [s2 _] (fake-sink)
        c1 (rt/register! "Micko" s1)
        c2 (rt/register! "Micko" s2)]
    (is (= 2 (rt/connection-count "Micko")))
    (is (rt/online? "Micko"))
    (rt/unregister! "Micko" c1)
    (is (= 1 (rt/connection-count "Micko")))
    (rt/unregister! "Micko" c2)
    (is (not (rt/online? "Micko")))
    (is (not (contains? @rt/registry "Micko")))
    (testing "going offline persists last-active"
      (is (some? (:user/last-active-at (d/entity (d/db s/conn) (eid "Micko"))))))))

(deftest publish-to-multiple-connections
  (let [a (connect! "Micko") b (connect! "Micko") other (connect! "Uros")]
    (is (= 2 (rt/publish! "Micko" {:type "test" :n 1})))
    (is (= [{:type "test" :n 1}] @a))
    (is (= [{:type "test" :n 1}] @b))
    (is (empty? @other))
    (is (= 0 (rt/publish! "Nobody" {:type "test"})) "offline user is a no-op")))

(deftest broken-connections-are-dropped
  (rt/register! "Micko" (broken-sink))
  (let [ok (connect! "Micko")]
    (is (= 1 (rt/publish! "Micko" {:type "x"})))
    (is (= 1 (count @ok)))
    (is (= 1 (rt/connection-count "Micko")))))

(deftest client-ping-gets-pong
  (let [[sink sent] (fake-sink)
        cid (rt/register! "Micko" sink)]
    (rt/dispatch-text! {:username "Micko" :conn-id cid} "{\"type\":\"ping\"}")
    (is (= "pong" (:type (first @sent))))
    (testing "garbage frames are ignored"
      (rt/dispatch-text! {:username "Micko" :conn-id cid} "not json"))))

(deftest ws-endpoint-requires-session-and-upgrade
  (is (= 401 (:status (api (request :get "/api/ws")))))
  (is (= 400 (:status (api (request :get "/api/ws" nil "Micko")))))
  (let [resp (api (-> (request :get "/api/ws" nil "Micko")
                      (assoc :headers {"connection" "Upgrade" "upgrade" "websocket"})))]
    (is (map? (:ring.websocket/listener resp)))))

;; ----- notifications -----

(deftest create-notif-pushes-to-recipient
  (let [sent (connect! "Uros")]
    (notifications/create-notif! (eid "Uros") :follow "Micko started following you" {:actor-e (eid "Micko")})
    (let [[ev] (of-type sent "notification")]
      (is (= "follow" (get-in ev [:notification :type])))
      (is (= "Micko" (get-in ev [:notification :actor :username])))
      (is (= 1 (:unreadCount ev)))))
  (testing "self notifications are skipped"
    (is (nil? (notifications/create-notif! (eid "Uros") :like "x" {:actor-e (eid "Uros")})))))

(deftest create-notif-respects-disabled-setting
  (with-redefs [notifications/notification-enabled? (fn [_ _ type] (not= type :like))]
    (is (nil? (notifications/create-notif! (eid "Uros") :like "Micko liked your post")))
    (is (some? (notifications/create-notif! (eid "Uros") :comment "Micko commented")))))

(deftest notifications-grouping-pagination-and-read-one
  (let [pid (mk-post! "Micko" "Day 3")]
    (doseq [u ["Uros" "Milan" "Pavel" "Toda"]]
      (notifications/create-notif! (eid "Micko") :like (str u " liked your post")
                                   {:actor-e (eid u) :post-e (Long/parseLong pid)}))
    (notifications/create-notif! (eid "Micko") :follow "Vule started following you" {:actor-e (eid "Vule")})
    (let [r     (api (request :get "/api/notifications" nil "Micko"))
          items (json-body r)
          likes (filter #(= "like" (:type %)) items)]
      (is (= 200 (:status r)))
      (is (= 5 (count items)) "list keeps every notification")
      (is (= "5" (get-in r [:headers "X-Unread-Count"])))
      (is (every? :group likes))
      (is (= "Toda and 3 others liked your post" (-> likes first :group :text)))
      (is (= 1 (count (filter #(get-in % [:group :isLatest]) likes))))
      (is (nil? (:group (first (filter #(= "follow" (:type %)) items))))))
    (testing "pagination"
      (let [r1 (api (request :get "/api/notifications" nil "Micko"))
            p1 (json-body (api (assoc (request :get "/api/notifications" nil "Micko") :query-string "limit=2")))
            cursor (:id (last p1))
            p2 (json-body (api (assoc (request :get "/api/notifications" nil "Micko")
                                      :query-string (str "limit=2&before=" cursor))))]
        (is (= 2 (count p1)))
        (is (= 2 (count p2)))
        (is (= (map :id (take 4 (json-body r1))) (map :id (concat p1 p2))))))
    (testing "mark one read"
      (let [n (first (json-body (api (request :get "/api/notifications" nil "Micko"))))
            r (api (request :post (str "/api/notifications/" (:id n) "/read") nil "Micko"))]
        (is (= 200 (:status r)))
        (is (= 4 (:unreadCount (json-body r))))
        (is (= 403 (:status (api (request :post (str "/api/notifications/" (:id n) "/read") nil "Uros")))))))))

;; ----- DMs -----

(deftest message-requests-flow
  ;; Uros does not follow Micko -> lands in Uros' requests
  (let [uros (connect! "Uros")
        r    (api (request :post "/api/messages" {:to "Uros" :content "hey"} "Micko"))
        msg  (json-body r)
        cid  (:conversationId msg)]
    (is (= 201 (:status r)))
    (is (= "message" (:type (first (of-type uros "message")))))
    (is (empty? (json-body (api (request :get "/api/conversations" nil "Uros")))))
    (let [reqs (json-body (api (assoc (request :get "/api/conversations" nil "Uros") :query-string "folder=requests")))]
      (is (= [cid] (map :id reqs)))
      (is (:isRequest (first reqs))))
    (is (= {:count 0 :requests 1} (json-body (api (request :get "/api/messages/unread" nil "Uros")))))
    (testing "sender sees it as pending in primary"
      (is (:pending (first (json-body (api (request :get "/api/conversations" nil "Micko")))))))
    (testing "accept moves it to primary"
      (is (= 200 (:status (api (request :post (str "/api/conversations/" cid "/accept") nil "Uros")))))
      (is (= [cid] (map :id (json-body (api (request :get "/api/conversations" nil "Uros"))))))
      (is (= {:count 1 :requests 0} (json-body (api (request :get "/api/messages/unread" nil "Uros"))))))))

(deftest decline-request-and-followed-sender-skips-requests
  (follow! "Milan" "Micko")
  (api (request :post "/api/messages" {:to "Milan" :content "yo"} "Micko"))
  (is (= 1 (count (json-body (api (request :get "/api/conversations" nil "Milan"))))) "follower gets it in primary")
  (let [m   (json-body (api (request :post "/api/messages" {:to "Pavel" :content "hi"} "Micko")))
        cid (:conversationId m)]
    (is (= 200 (:status (api (request :post (str "/api/conversations/" cid "/decline") nil "Pavel")))))
    (is (empty? (json-body (api (assoc (request :get "/api/conversations" nil "Pavel") :query-string "folder=requests")))))))

(deftest seen-reactions-reply-unsend
  (follow! "Uros" "Micko")
  (let [micko (connect! "Micko")
        m1    (json-body (api (request :post "/api/messages" {:to "Uros" :content "first"} "Micko")))
        cid   (:conversationId m1)]
    (testing "seen receipt"
      (api (request :post (str "/api/conversations/" cid "/read") nil "Uros"))
      (is (= "Uros" (:by (first (of-type micko "seen")))))
      (is (= ["Uros"] (:seenBy (first (json-body (api (request :get "/api/conversations" nil "Micko"))))))))
    (testing "reply"
      (let [m2 (json-body (api (request :post "/api/messages"
                                        {:conversationId cid :content "re" :replyToId (:id m1)} "Uros")))]
        (is (= (:id m1) (get-in m2 [:replyTo :id])))
        (is (= "first" (get-in m2 [:replyTo :content])))))
    (testing "reaction toggle"
      (let [r (json-body (api (request :post (str "/api/messages/" (:id m1) "/react") {:emoji "❤️"} "Uros")))]
        (is (= [{:username "Uros" :emoji "❤️"}] (:reactions r)))
        (is (seq (of-type micko "message:reaction"))))
      (is (= [] (:reactions (json-body (api (request :post (str "/api/messages/" (:id m1) "/react") {:emoji "❤️"} "Uros")))))))
    (testing "only the sender can unsend"
      (is (= 403 (:status (api (request :delete (str "/api/messages/" (:id m1)) nil "Uros")))))
      (is (= 200 (:status (api (request :delete (str "/api/messages/" (:id m1)) nil "Micko")))))
      (is (= (:id m1) (:messageId (first (of-type micko "message:unsent")))))
      (let [msgs (json-body (api (request :get (str "/api/conversations/" cid "/messages") nil "Micko")))]
        (is (= ["re"] (map :content msgs)))))))

(deftest share-post-into-dm
  (let [pid (mk-post! "Milan" "Day 10 progress")
        r   (api (request :post "/api/messages/share" {:postId pid :to ["Uros" "Pavel"]} "Micko"))]
    (is (= 2 (:sent (json-body r))))
    (let [conv (first (json-body (api (assoc (request :get "/api/conversations" nil "Uros") :query-string "folder=requests"))))
          msgs (json-body (api (request :get (str "/api/conversations/" (:id conv) "/messages") nil "Uros")))]
      (is (= pid (:postId (first msgs))))
      (is (= "Day 10 progress" (get-in (first msgs) [:post :caption]))))))

(deftest typing-is-relayed-to-other-participant
  (follow! "Uros" "Micko")
  (let [cid  (:conversationId (json-body (api (request :post "/api/messages" {:to "Uros" :content "hi"} "Micko"))))
        uros (connect! "Uros")
        mine (connect! "Micko")]
    (rt/dispatch-text! {:username "Micko"} (json/generate-string {:type "typing" :conversationId cid :typing true}))
    (is (= [{:type "typing" :username "Micko" :typing true :conversationId cid}] (of-type uros "typing")))
    (is (empty? (of-type mine "typing")))
    (testing "non-participants can't spoof typing"
      (rt/dispatch-text! {:username "Pavel"} (json/generate-string {:type "typing" :conversationId cid}))
      (is (= 1 (count (of-type uros "typing")))))))

;; ----- live -----

(deftest live-start-list-join-comment-end
  (follow! "Uros" "Micko")
  (let [host   (connect! "Micko")
        viewer (connect! "Uros")
        r      (api (request :post "/api/live" {:title "Morning run"} "Micko"))
        lv     (json-body r)
        lid    (:id lv)]
    (is (= 201 (:status r)))
    (is (= "active" (:status lv)))
    (testing "followers are notified"
      (is (= "live" (get-in (first (of-type viewer "notification")) [:notification :type])))
      (is (= lid (get-in (first (of-type viewer "notification")) [:notification :liveId])))
      (is (seq (of-type viewer "live:started"))))
    (testing "list: followers and host see it, others don't"
      (is (= [lid] (map :id (json-body (api (request :get "/api/live" nil "Uros"))))))
      (is (= [lid] (map :id (json-body (api (request :get "/api/live" nil "Micko"))))))
      (is (empty? (json-body (api (request :get "/api/live" nil "Pavel"))))))
    (testing "join, viewer count, comments, hearts, signaling"
      (rt/dispatch-text! {:username "Uros"} (json/generate-string {:type "live:join" :liveId lid}))
      (is (= 1 (live/viewer-count (Long/parseLong lid))))
      (is (= "Uros" (get-in (first (of-type host "live:viewer-joined")) [:viewer :username])))
      (is (seq (of-type viewer "live:joined")))
      (rt/dispatch-text! {:username "Uros"} (json/generate-string {:type "live:comment" :liveId lid :text "go go"}))
      (is (= "go go" (get-in (first (of-type host "live:comment")) [:comment :text])))
      (rt/dispatch-text! {:username "Uros"} (json/generate-string {:type "live:heart" :liveId lid}))
      (is (= 1 (:hearts (first (of-type host "live:heart")))))
      (rt/dispatch-text! {:username "Micko"} (json/generate-string {:type "live:signal" :liveId lid :to "Uros"
                                                                    :data {:sdp {:type "offer" :sdp "x"}}}))
      (is (= "offer" (get-in (first (of-type viewer "live:signal")) [:data :sdp :type])))
      (testing "signaling to outsiders is dropped"
        (is (nil? (live/signal! (Long/parseLong lid) "Micko" "Pavel" {})))))
    (testing "only host can end"
      (is (= 403 (:status (api (request :post (str "/api/live/" lid "/end") nil "Uros")))))
      (let [r (api (request :post (str "/api/live/" lid "/end") nil "Micko"))]
        (is (= 200 (:status r)))
        (is (= "ended" (:status (json-body r))))
        (is (= 1 (:hearts (json-body r)))))
      (is (seq (of-type viewer "live:ended")))
      (is (empty? (json-body (api (request :get "/api/live" nil "Uros"))))))))

(deftest viewer-going-offline-leaves-live
  (follow! "Uros" "Micko")
  (connect! "Micko")
  (let [lid (Long/parseLong (:id (json-body (api (request :post "/api/live" {} "Micko")))))
        [sink _] (fake-sink)
        cid (rt/register! "Uros" sink)]
    (is (= :ok (live/join! lid "Uros")))
    (rt/unregister! "Uros" cid)
    (is (= 0 (live/viewer-count lid)))))

(deftest ice-servers-and-stale-lives
  (let [r (json-body (api (request :get "/api/live/ice-servers" nil "Micko")))]
    (is (= "mesh" (:transport r)))
    (is (seq (:iceServers r))))
  (api (request :post "/api/live" {} "Micko"))
  (is (= 1 (live/end-stale-lives!)))
  (is (empty? (json-body (api (request :get "/api/live" nil "Micko"))))))

(deftest new-post-fan-out
  (follow! "Uros" "Micko")
  (let [uros (connect! "Uros") pavel (connect! "Pavel")]
    @(rt/notify-followers-new-post! (eid "Micko") 123)
    (is (= [{:type "post:new" :postId "123" :author {:username "Micko" :displayName "Micko" :profilePic nil}}]
           (of-type uros "post:new")))
    (is (empty? (of-type pavel "post:new")))))

(deftest group-messages-are-pushed
  (let [g   (json-body (api (request :post "/api/groups" {:name "Runners"} "Micko")))
        _   (api (request :post (str "/api/groups/" (:id g) "/join") nil "Uros"))
        uros (connect! "Uros")]
    (api (request :post (str "/api/groups/" (:id g) "/messages") {:content "5k today"} "Micko"))
    (is (= "5k today" (get-in (first (of-type uros "group:message")) [:message :content])))))

(deftest toggled-like-does-not-stack-notifications
  (let [db       (d/db s/conn)
        micko    (web.http/user-e db "Micko")
        uros     (web.http/user-e db "Uros")
        notif!   #(notifications/create-notif! micko :like "Uros liked your post" {:actor-e uros})
        count-of #(count (d/q '[:find [?n ...] :in $ ?r :where [?n :notification/recipient ?r]]
                              (d/db s/conn) micko))]
    (notif!)
    (notif!)
    (is (= 1 (count-of)))
    (notifications/create-notif! micko :like "Uros liked your comment" {:actor-e uros})
    (is (= 2 (count-of)) "different text (comment like) is not a duplicate")))
