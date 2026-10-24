(ns web.posts-review-test
  "Regression tests for defects found while reviewing the posts area."
  (:require [clojure.test :refer :all]
            [datomic.api :as d]
            [project.system :as s]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.accounts :as accounts]
            [web.http :refer [user-e]])
  (:import (java.util Date)))

(use-fixtures :each with-mem-db)

;; ---------- helpers ----------

(defn- db [] (d/db s/conn))
(defn- uid [username] (user-e (db) username))

(defn- call
  ([method uri user] (call method uri nil user))
  ([method uri body user] (api (request method uri body user))))

(defn- get-q [uri qs user]
  (api (assoc (request :get uri nil user) :query-string qs)))

(defn- post! [user body]
  (let [r (call :post "/api/posts" body user)]
    (is (= 201 (:status r)) (str "create failed: " (:body r)))
    (json-body r)))

(defn- tx! [tx] @(d/transact s/conn tx))

(defn- follow! [a b] (tx! [[:db/add (uid a) :user/follows (uid b)]]))

(defn- hours-ago ^Date [h] (Date. (- (System/currentTimeMillis) (long (* h 3600000)))))

(defn- raw-post!
  "Post with an explicit created-at, bypassing the API."
  [user caption created & {:as extra}]
  (let [r (tx! [(merge {:db/id "p" :post/author (uid user) :post/caption caption
                        :post/created-at created :post/media-url "/uploads/x.jpg"}
                       extra)])]
    (get (:tempids r) "p")))

(defn- like! [pid & users]
  (tx! (for [u users] [:db/add pid :post/likes (uid u)])))

;; ---------- muted users ----------

(deftest muted-users-posts-stay-visible-on-their-profile
  ;; accounts/hidden-author-ids: "Muted users stay visible on their own
  ;; profile". Muting must only take them out of feed/explore/hashtags.
  (follow! "Micko" "Uros")
  (let [p (post! "Uros" {:caption "#gym day"})]
    (tx! [[:db/add (uid "Micko") :user/mutes (uid "Uros")]])
    (let [r (json-body (call :get "/api/users/Uros/posts" "Micko"))]
      (is (not (:private r)))
      (is (= [(:id p)] (map :id (:items r)))))
    (is (= 200 (:status (call :get (str "/api/posts/" (:id p)) "Micko"))))
    (is (= 200 (:status (call :post (str "/api/posts/" (:id p) "/like") "Micko"))))
    (testing "but not in feed, explore or hashtag pages"
      (is (empty? (:items (json-body (call :get "/api/feed" "Micko")))))
      (is (empty? (:items (json-body (call :get "/api/explore" "Micko")))))
      (is (empty? (:items (json-body (call :get "/api/hashtags/gym" "Micko"))))))))

;; ---------- likes ----------

(deftest like-response-respects-hide-likes
  (let [p (post! "Micko" {:caption "secret count" :hideLikes true})]
    (like! (Long/parseLong (:id p)) "Milan" "Pavel")
    (let [r (json-body (call :post (str "/api/posts/" (:id p) "/like") "Uros"))]
      (is (true? (:liked r)))
      (is (nil? (:likeCount r)) "count hidden from non-owners")
      (is (empty? (:likes r)) "liker list hidden from non-owners"))
    (testing "the owner still sees everything"
      (let [r (json-body (call :post (str "/api/posts/" (:id p) "/like") "Micko"))]
        (is (= 4 (:likeCount r)))))))

(deftest likes-list-omits-deactivated-and-blocking-users
  (let [p   (post! "Micko" {:caption "hi"})
        pid (Long/parseLong (:id p))]
    (like! pid "Milan" "Pavel" "Toda")
    (tx! [[:db/add (uid "Pavel") :user/deactivated? true]
          [:db/add (uid "Toda") :user/blocks (uid "Uros")]])
    (is (= ["Milan"] (:likes (json-body (call :get (str "/api/posts/" (:id p)) "Uros")))))))

;; ---------- trending / hashtag search ----------

(deftest hashtag-search-and-trending-only-count-public-posts
  (post! "Micko" {:caption "#pregnant news" :audience "close-friends" :activityTag "secret-cf"})
  (post! "Micko" {:caption "#pregnant hmm" :audience "followers"})
  (tx! [[:db/add (uid "Uros") :user/private? true]])
  (post! "Uros" {:caption "#pregnant private account" :activityTag "secret-priv"})
  (let [arch (post! "Milan" {:caption "#pregnant archived"})]
    (call :post (str "/api/posts/" (:id arch) "/archive") "Milan"))
  (post! "Pavel" {:caption "#gym public" :activityTag "running"})
  (is (= [] (json-body (get-q "/api/hashtags/search" "q=preg" "Vule"))))
  (let [tr (json-body (call :get "/api/trending" "Vule"))]
    (is (= #{"gym" "running"} (set (map :tag tr))))
    (is (every? #(= 1 (:count %)) tr))))

;; ---------- explore ----------

(deftest explore-pagination-is-stable-while-ranking-changes
  (let [a (raw-post! "Micko" "A" (hours-ago 1))
        b (raw-post! "Micko" "B" (hours-ago 1))]
    (like! a "Uros" "Pavel" "Toda")
    (let [p1 (json-body (get-q "/api/explore" "limit=1" "Milan"))]
      (is (= [(str a)] (map :id (:items p1))))
      (is (:nextCursor p1))
      ;; B gets popular while Milan scrolls
      (like! b "Uros" "Pavel" "Toda" "Vule")
      (tx! (for [c ["x" "y"]] {:comment/post b :comment/author (uid "Vule")
                               :comment/content c :comment/created-at (Date.)}))
      (let [p2 (json-body (get-q "/api/explore" (str "limit=1&cursor=" (:nextCursor p1)) "Milan"))]
        (is (= [(str b)] (map :id (:items p2))) "no duplicate, nothing skipped")))))

(deftest explore-ignores-garbage-cursor
  (raw-post! "Micko" "A" (hours-ago 1))
  (is (= 200 (:status (get-q "/api/explore" "cursor=abc_def" "Milan")))))

;; ---------- competition feed ----------

(deftest competition-feed-respects-privacy
  (let [r   (tx! [{:db/id "c" :competition/name "June" :competition/creator (uid "Micko")
                   :competition/members [(uid "Micko") (uid "Uros") (uid "Milan")]}])
        cid (get (:tempids r) "c")
        pub (post! "Uros" {:caption "public"})]
    (post! "Uros" {:caption "followers only" :audience "followers"})
    (post! "Uros" {:caption "close friends" :audience "close-friends"})
    (let [arch (post! "Uros" {:caption "archived"})]
      (call :post (str "/api/posts/" (:id arch) "/archive") "Uros"))
    (tx! [[:db/add (uid "Micko") :user/private? true]])
    (post! "Micko" {:caption "private account"})
    (let [items (json-body (call :get (str "/api/competitions/" cid "/feed") "Milan"))]
      (is (= [(:id pub)] (map :id items))))
    (is (= 404 (:status (call :get "/api/competitions/abc/feed" "Milan"))))))

;; ---------- notifications ----------

(deftest comment-like-is-not-grouped-with-post-likes
  (let [p (post! "Micko" {:caption "x"})
        c (json-body (call :post (str "/api/posts/" (:id p) "/comments") {:content "mine"} "Micko"))]
    (call :post (str "/api/posts/" (:id p) "/like") "Uros")
    (call :post (str "/api/comments/" (:id c) "/like") "Milan")
    (let [ns (json-body (call :get "/api/notifications" "Micko"))]
      (is (= 2 (count ns)))
      (is (not-any? :group ns) "a comment like is not a post like"))))

(deftest notifications-from-blocked-users-disappear
  (let [p (post! "Micko" {:caption "x"})]
    (call :post (str "/api/posts/" (:id p) "/like") "Uros")
    (call :post (str "/api/posts/" (:id p) "/like") "Milan")
    (tx! [[:db/add (uid "Micko") :user/blocks (uid "Uros")]])
    (let [r (call :get "/api/notifications" "Micko")]
      (is (= ["Milan"] (map #(get-in % [:actor :username]) (json-body r))))
      (is (= "1" (get-in r [:headers "X-Unread-Count"]))))
    (is (= {:count 1} (json-body (call :get "/api/notifications/unread-count" "Micko"))))))

;; ---------- deleted users ----------

(deftest reactions-of-deleted-users-are-not-counted
  (let [p (post! "Micko" {:caption "pr"})]
    (call :post (str "/api/posts/" (:id p) "/react") {:emoji "🔥"} "Uros")
    (call :post (str "/api/posts/" (:id p) "/react") {:emoji "🔥"} "Milan")
    (tx! (accounts/delete-user-tx (db) (uid "Uros")))
    (is (= {(keyword "🔥") 1} (:reactions (json-body (call :get (str "/api/posts/" (:id p)) "Micko")))))))

;; ---------- create / edit validation ----------

(deftest create-post-validates-caption
  (is (= 400 (:status (call :post "/api/posts" {} "Micko"))) "empty post")
  (is (= 400 (:status (call :post "/api/posts" {:caption "   "} "Micko"))) "blank post")
  (is (= 400 (:status (call :post "/api/posts" {:caption 42} "Micko"))) "non-string caption")
  (is (= 400 (:status (call :post "/api/posts" {:caption (apply str (repeat 2201 "a"))} "Micko"))))
  (let [p (post! "Micko" {:caption "ok"})]
    (is (= 400 (:status (call :put (str "/api/posts/" (:id p)) {:caption 42} "Micko"))))
    (is (= 400 (:status (call :put (str "/api/posts/" (:id p)) {:caption (apply str (repeat 2201 "a"))} "Micko"))))))
