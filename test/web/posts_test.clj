(ns web.posts-test
  (:require [clojure.test :refer :all]
            [datomic.api :as d]
            [project.system :as s]
            [project.test-db :refer [with-mem-db request json-body api]]
            [web.http :refer [user-e]]
            [web.posts :as posts])
  (:import (java.util Date)
           (java.time LocalDate LocalTime)))

(use-fixtures :each with-mem-db)

;; ---------- helpers ----------

(defn- db [] (d/db s/conn))
(defn- uid [username] (user-e (db) username))

(defn- call
  ([method uri user] (call method uri nil user))
  ([method uri body user] (api (request method uri body user))))

(defn- get-q [uri qs user]
  (api (assoc (request :get uri nil user) :query-string qs)))

(defn- ensure-media-schema!
  "Media attributes belong to the media area. Install minimal ones only when
   absent, so this keeps working once the media schema is merged."
  []
  (let [missing (remove #(d/entity (db) (:db/ident %))
                        [{:db/ident :media/url :db/valueType :db.type/string :db/cardinality :db.cardinality/one}
                         {:db/ident :media/owner :db/valueType :db.type/ref :db/cardinality :db.cardinality/one}])]
    (when (seq missing) @(d/transact s/conn missing))))

(defn- media! [owner url]
  (ensure-media-schema!)
  (let [r @(d/transact s/conn [{:db/id "m" :media/url url :media/owner (uid owner)}])]
    (str (get (:tempids r) "m"))))

(defn- post! [user body]
  (let [r (call :post "/api/posts" body user)]
    (is (= 201 (:status r)) (str "create failed: " (:body r)))
    (json-body r)))

(defn- post-at!
  "Post with an explicit created-at (noon Belgrade on `ld`)."
  [user ^LocalDate ld caption]
  (let [inst (Date/from (.toInstant (.atZone (.atTime ld (LocalTime/NOON)) posts/zone)))
        r @(d/transact s/conn [{:db/id "p" :post/author (uid user) :post/caption caption :post/created-at inst}])]
    (get (:tempids r) "p")))

(defn- follow! [a b]
  @(d/transact s/conn [[:db/add (uid a) :user/follows (uid b)]]))

;; ---------- tests ----------

(deftest carousel-create-keeps-media-order
  (let [m1 (media! "Micko" "/uploads/a.jpg")
        m2 (media! "Micko" "/uploads/b.mp4")
        m3 (media! "Micko" "/uploads/c.jpg")
        p  (post! "Micko" {:caption "three shots" :mediaIds [m3 m1 m2]})]
    (is (= "carousel" (:layout p)))
    (is (= [m3 m1 m2] (mapv :id (:media p))))
    (is (= "/uploads/c.jpg" (:mediaUrl p)) "mediaUrl mirrors the first media for old clients")
    (testing "order survives a re-read"
      (is (= [m3 m1 m2] (mapv :id (:media (json-body (call :get (str "/api/posts/" (:id p)) "Micko")))))))
    (testing "compare layout needs exactly two media"
      (is (= "compare" (:layout (post! "Micko" {:mediaIds [m1 m3] :layout "compare"}))))
      (is (= 400 (:status (call :post "/api/posts" {:mediaIds [m1] :layout "compare"} "Micko")))))
    (testing "someone else's media is rejected"
      (is (= 403 (:status (call :post "/api/posts" {:mediaIds [m1]} "Uros")))))))

(deftest legacy-media-url-mapping
  (let [p (post! "Micko" {:caption "old style" :mediaUrl "/uploads/clip.mp4"})]
    (is (= "single" (:layout p)))
    (is (= [{:id (str "legacy-" (:id p)) :type "video" :url "/uploads/clip.mp4"}] (:media p)))
    (is (= "/uploads/clip.mp4" (:mediaUrl p)))))

(deftest feed-cursor-pagination
  (let [today (posts/today)
        ids   (mapv #(post-at! "Micko" (.minusDays today %) (str "p" %)) (range 5))]
    (loop [cursor nil seen [] pages 0]
      (let [r    (get-q "/api/feed" (str "limit=2" (when cursor (str "&cursor=" cursor))) "Micko")
            body (json-body r)
            seen (into seen (map :id (:items body)))]
        (is (= 200 (:status r)))
        (is (<= (count (:items body)) 2))
        (if (:nextCursor body)
          (recur (:nextCursor body) seen (inc pages))
          (do (is (= 2 pages))
              (is (= (mapv str ids) seen) "newest first, no duplicates, nothing skipped")))))))

(deftest feed-includes-followed-and-respects-audience
  (post! "Uros" {:caption "public from uros"})
  (post! "Uros" {:caption "followers only" :audience "followers"})
  (post! "Milan" {:caption "not followed"})
  (is (empty? (:items (json-body (call :get "/api/feed" "Micko")))))
  (follow! "Micko" "Uros")
  (is (= #{"public from uros" "followers only"}
         (set (map :caption (:items (json-body (call :get "/api/feed" "Micko")))))))
  (let [fo (post! "Milan" {:caption "milan followers" :audience "followers"})]
    (is (= 404 (:status (call :get (str "/api/posts/" (:id fo)) "Micko"))))
    (is (= 200 (:status (call :get (str "/api/posts/" (:id fo)) "Milan"))))))

(deftest streak-and-day-number
  (let [today (posts/today)]
    (doseq [n [5 4 3 1]] (post-at! "Micko" (.minusDays today n) (str "day -" n)))
    (post-at! "Micko" (.minusDays today 3) "second post same day")
    (let [s (json-body (call :get "/api/me/streak" "Micko"))]
      (is (= {:current 1 :best 3 :postedToday false :totalDays 4 :nextDayNumber 5}
             (dissoc s :today)) "yesterday keeps the streak alive"))
    (let [p (post! "Micko" {:caption "today!"})]
      (is (= 5 (:dayNumber p))))
    (is (= {:current 2 :best 3 :postedToday true :totalDays 5 :nextDayNumber 5}
           (dissoc (json-body (call :get "/api/me/streak" "Micko")) :today)))
    (let [by-caption (into {} (map (juxt :caption :dayNumber)) (:items (json-body (call :get "/api/feed" "Micko"))))]
      (is (= 1 (by-caption "day -5")))
      (is (= 3 (by-caption "day -3")))
      (is (= 3 (by-caption "second post same day")))
      (is (= 4 (by-caption "day -1"))))
    (testing "a gap resets current"
      (is (= 0 (:current (posts/streak-info (sorted-set (.minusDays today 2)) today)))))))

(deftest hashtags-and-mentions
  (is (= ["gym" "progress_2" "día"]
         (posts/parse-hashtags "Day 3 #Gym #gym #Progress_2 mail@x.com a#b &#123; #Día")))
  (is (= ["Uros" "milan"] (posts/parse-mentions "thanks @Uros and @milan. email a@b.com")))
  (post! "Micko" {:caption "Leg day #Gym #legs with @uros"})
  (post! "Uros" {:caption "#gym again"})
  (let [r (json-body (call :get "/api/hashtags/gym" "Milan"))]
    (is (= "gym" (:tag r)))
    (is (= 2 (:count r)))
    (is (= 2 (count (:items r)))))
  (is (= [{:tag "gym" :count 2}] (json-body (get-q "/api/hashtags/search" "q=%23GY" "Milan"))))
  (testing "mentioned user (case-insensitive) is notified"
    (let [notifs (json-body (call :get "/api/notifications" "Uros"))]
      (is (some #(and (= "mention" (:type %)) (= "Micko" (get-in % [:actor :username]))) notifs)))))

(deftest comments-off-and-threads
  (let [closed (post! "Micko" {:caption "quiet" :commentsOff true})
        open   (post! "Micko" {:caption "talk to me"})]
    (is (= 403 (:status (call :post (str "/api/posts/" (:id closed) "/comments") {:content "hi"} "Uros"))))
    (let [c  (json-body (call :post (str "/api/posts/" (:id open) "/comments") {:content "nice"} "Uros"))
          r  (json-body (call :post (str "/api/posts/" (:id open) "/comments") {:content "agreed" :parentId (:id c)} "Milan"))
          r2 (json-body (call :post (str "/api/posts/" (:id open) "/comments") {:content "reply to reply" :parentId (:id r)} "Uros"))]
      (is (= (:id c) (:parentId r)))
      (is (= (:id c) (:parentId r2)) "replies stay one level deep")
      (is (= {:liked true :likeCount 1} (json-body (call :post (str "/api/comments/" (:id c) "/like") "Micko"))))
      (let [page (json-body (call :get (str "/api/posts/" (:id open) "/comments") "Micko"))]
        (is (= 3 (:total page)))
        (is (= 1 (count (:items page))))
        (is (= ["agreed" "reply to reply"] (map :content (:replies (first (:items page))))))
        (is (= 1 (:likeCount (first (:items page))))))
      (testing "post owner can delete any comment on their post; replies go with it"
        (is (= 403 (:status (call :delete (str "/api/comments/" (:id c)) "Milan"))))
        (is (= 200 (:status (call :delete (str "/api/comments/" (:id c)) "Micko"))))
        (is (= 0 (:total (json-body (call :get (str "/api/posts/" (:id open) "/comments") "Micko"))))))
      (testing "reply notification carries actor + post"
        (is (some #(and (= "reply" (:type %)) (= (:id open) (:postId %)))
                  (json-body (call :get "/api/notifications" "Uros"))))))))

(deftest comments-pagination
  (let [p (post! "Micko" {:caption "many"})]
    (dotimes [i 5] (call :post (str "/api/posts/" (:id p) "/comments") {:content (str "c" i)} "Uros"))
    (let [a (json-body (get-q (str "/api/posts/" (:id p) "/comments") "limit=3" "Micko"))
          b (json-body (get-q (str "/api/posts/" (:id p) "/comments") (str "limit=3&cursor=" (:nextCursor a)) "Micko"))]
      (is (= ["c0" "c1" "c2"] (map :content (:items a))))
      (is (= ["c3" "c4"] (map :content (:items b))))
      (is (nil? (:nextCursor b))))))

(deftest archive-hides-from-feed
  (let [p (post! "Micko" {:caption "oops"})
        url (str "/api/posts/" (:id p) "/archive")]
    (is (= {:archived true} (json-body (call :post url "Micko"))))
    (is (empty? (:items (json-body (call :get "/api/feed" "Micko")))))
    (is (= [(:id p)] (map :id (:items (json-body (call :get "/api/posts/archived" "Micko"))))))
    (is (= 403 (:status (call :post url "Uros"))))
    (is (= 404 (:status (call :get (str "/api/posts/" (:id p)) "Uros"))) "archived is owner-only")
    (is (= {:archived false} (json-body (call :post url "Micko"))))
    (is (= 1 (count (:items (json-body (call :get "/api/feed" "Micko"))))))))

(deftest edit-post
  (let [p (post! "Micko" {:caption "first #old"})
        r (call :put (str "/api/posts/" (:id p)) {:caption "fixed #new" :hideLikes true} "Micko")
        e (json-body r)]
    (is (= 200 (:status r)))
    (is (= "fixed #new" (:caption e)))
    (is (= ["new"] (:hashtags e)))
    (is (:editedAt e))
    (is (= 403 (:status (call :put (str "/api/posts/" (:id p)) {:caption "hack"} "Uros"))))
    (testing "hideLikes hides the count from others but not the owner"
      (call :post (str "/api/posts/" (:id p) "/like") "Uros")
      (is (nil? (:likeCount (json-body (call :get (str "/api/posts/" (:id p)) "Uros")))))
      (is (= 1 (:likeCount (json-body (call :get (str "/api/posts/" (:id p)) "Micko"))))))))

(deftest reactions-toggle
  (let [p   (post! "Micko" {:caption "pr!"})
        url (str "/api/posts/" (:id p) "/react")
        fire (keyword "🔥")]
    (is (= {:reactions {fire 1} :myReaction "🔥"} (json-body (call :post url {:emoji "🔥"} "Uros"))))
    (is (= {:reactions {(keyword "💪") 1} :myReaction "💪"} (json-body (call :post url {:emoji "💪"} "Uros"))))
    (is (= {:reactions {} :myReaction nil} (json-body (call :post url {:emoji "💪"} "Uros"))))
    (is (= 400 (:status (call :post url {:emoji "👎"} "Uros"))) "no dislikes, ever")))

(deftest explore-excludes-followed
  (follow! "Micko" "Uros")
  (post! "Uros" {:caption "followed" :mediaUrl "/uploads/1.jpg"})
  (let [hot  (post! "Milan" {:caption "hot" :mediaUrl "/uploads/2.jpg"})
        cold (post! "Pavel" {:caption "cold" :mediaUrl "/uploads/3.jpg"})]
    (post! "Toda" {:caption "friends only" :audience "followers"})
    (call :post (str "/api/posts/" (:id hot) "/like") "Vule")
    (call :post (str "/api/posts/" (:id hot) "/comments") {:content "wow"} "Vule")
    (let [items (:items (json-body (call :get "/api/explore" "Micko")))]
      (is (= [(:id hot) (:id cold)] (map :id items))))))

(deftest profile-posts-paginated
  (dotimes [i 3] (post-at! "Uros" (.minusDays (posts/today) i) (str "u" i)))
  (let [a (json-body (get-q "/api/users/Uros/posts" "limit=2" "Micko"))]
    (is (= ["u0" "u1"] (map :caption (:items a))))
    (is (= ["u2"] (map :caption (:items (json-body (get-q "/api/users/Uros/posts" (str "limit=2&cursor=" (:nextCursor a)) "Micko"))))))))
