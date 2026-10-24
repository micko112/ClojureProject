(ns web.posts
  "Posts, carousel/compare layouts, feed pagination, explore, hashtags,
   comments, reactions, daily progress streaks. OWNER: posts agent.

   All post/comment/feed/trending/saved handlers live here; web.server only
   concatenates `routes`."
  (:require [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s]
            [web.http :refer [jresp parse-body me ok created bad unauth forbidden
                              not-found parse-id instant->str ddb user-e author-dto]]
            [web.notifications :refer [create-notif!]]
            [web.media :as media]
            [web.accounts :as accounts]
            [web.realtime :as realtime])
  (:import (java.util Date)
           (java.time LocalDate ZoneId)))

;; ===== TIME / DAYS =====

(def ^ZoneId zone (ZoneId/of "Europe/Belgrade"))

(defn local-date
  "Calendar day of an instant in the app's timezone (same as web.server/today-str)."
  ^LocalDate [^Date d]
  (.toLocalDate (.atZone (.toInstant d) zone)))

(defn today ^LocalDate [] (LocalDate/now zone))

(defn author-days
  "{author-eid (sorted-set LocalDate)} — distinct posting days per author.
   One query for all authors (archived posts count: the progress happened)."
  [db author-es]
  (if (empty? author-es)
    {}
    (reduce (fn [m [a t]] (update m a (fnil conj (sorted-set)) (local-date t)))
            {}
            (d/q '[:find ?a ?t :in $ [?a ...]
                   :where [?p :post/author ?a] [?p :post/created-at ?t]]
                 db (vec author-es)))))

(defn day-number
  "How many distinct days the author had posted on, up to and including `ld`."
  [days ^LocalDate ld]
  (if (seq days) (count (subseq days <= ld)) 0))

(defn streak-info
  "days: sorted-set of LocalDate. A streak stays alive through today if the
   user posted yesterday (they still have until midnight)."
  [days ^LocalDate today]
  (let [posted-today (contains? days today)
        yesterday    (.minusDays today 1)
        start        (cond posted-today today
                           (contains? days yesterday) yesterday)
        current      (if start
                       (loop [^LocalDate d start n 0]
                         (if (contains? days d) (recur (.minusDays d 1) (inc n)) n))
                       0)
        best         (first (reduce (fn [[best run ^LocalDate prev] ^LocalDate d]
                                      (let [run (if (and prev (= d (.plusDays prev 1))) (inc run) 1)]
                                        [(max best run) run d]))
                                    [0 0 nil] days))]
    {:current       current
     :best          best
     :postedToday   posted-today
     :totalDays     (count days)
     :nextDayNumber (+ (count days) (if posted-today 0 1))
     :today         (str today)}))

;; ===== CAPTION PARSING =====

(def ^:private hashtag-re #"(?<![\p{L}\p{N}_&#])#([\p{L}\p{N}_]{1,64})")
(def ^:private mention-re #"(?<![\p{L}\p{N}_.@])@([A-Za-z0-9_.]{1,30})")

(defn parse-hashtags
  "Distinct lowercased hashtags (without #), in order of appearance."
  [caption]
  (->> (re-seq hashtag-re (or caption ""))
       (map (comp str/lower-case second))
       distinct
       vec))

(defn parse-mentions [caption]
  (->> (re-seq mention-re (or caption ""))
       (map #(str/replace (second %) #"\.+$" ""))
       (remove str/blank?)
       distinct
       vec))

(defn normalize-tag [s]
  (-> (or s "") str/trim (str/replace #"^#+" "") str/lower-case
      (str/replace #"[^\p{L}\p{N}_]" "")))

(defn- resolve-username
  "Exact username, falling back to a case-insensitive match (@micko -> Micko)."
  [db uname]
  (or (user-e db uname)
      (d/q '[:find ?e . :in $ ?lc
             :where [?e :user/username ?u]
             [(clojure.string/lower-case ?u) ?l]
             [(= ?l ?lc)]]
           db (str/lower-case uname))))

(defn- mention-eids [db caption author-e]
  (->> (parse-mentions caption)
       (keep #(resolve-username db %))
       (remove #{author-e})
       distinct
       vec))

;; ===== VISIBILITY =====

(defn viewer-ctx
  "Everything needed to decide visibility for one viewer, computed once per
   request. Privacy predicates from web.accounts are memoized per author."
  [db viewer-e]
  (let [ve (when viewer-e (d/entity db viewer-e))]
    {:db       db
     :viewer-e viewer-e
     :hidden   (if viewer-e (set (accounts/hidden-author-ids db viewer-e)) #{})
     :follows  (set (map :db/id (:user/follows ve)))
     :can-view (memoize (fn [author-e] (accounts/can-view-posts? db viewer-e author-e)))
     :close    (memoize (fn [author-e] (boolean (and viewer-e (accounts/close-friend? db author-e viewer-e)))))}))

(defn audience [e] (or (:post/audience e) :public))

(defn visible?
  "Can the viewer open this post? Owners always can (even archived)."
  [{:keys [viewer-e hidden follows can-view close]} e]
  (let [author-e (-> e :post/author :db/id)]
    (cond
      (nil? author-e)              false
      (= author-e viewer-e)        true
      (:post/archived e)           false
      (contains? hidden author-e)  false
      (not (can-view author-e))    false
      :else (case (audience e)
              :followers     (contains? follows author-e)
              :close-friends (close author-e)
              true))))

(defn listable?
  "Visible and not archived — what feeds/grids/lists show."
  [ctx e]
  (and (not (:post/archived e)) (visible? ctx e)))

;; ===== MEDIA =====

(defn- video-url? [url]
  (boolean (and url (re-find #"(?i)\.(mp4|webm|mov|m4v)(\?.*)?$" url))))

(defn legacy-media [pid url]
  {:id (str "legacy-" pid) :type (if (video-url? url) "video" "image") :url url})

(defn post-media
  "Ordered Media DTOs of a post; legacy posts get a one-item array."
  [db e]
  (let [slides (sort-by :post-media/position (:post/media e))]
    (if (seq slides)
      (vec (keep #(some->> % :post-media/media :db/id (media/media-dto db)) slides))
      (if-let [u (:post/media-url e)] [(legacy-media (:db/id e) u)] []))))

(defn media-owner-e
  "Owner of a media entity. The attribute name belongs to the media area;
   accept the likely candidates so this keeps working whichever they chose."
  [e]
  (some #(some-> (get e %) :db/id) [:media/owner :media/user :media/uploader :media/author]))

;; ===== POST DTO =====

(defn- batch-stats
  "Aggregates for a page of posts in a handful of queries (no N+1)."
  [db pids viewer-e author-es]
  (let [pids (vec pids)]
    (if (empty? pids)
      {}
      {:likes     (into {} (d/q '[:find ?p (count ?u) :in $ [?p ...] :where [?p :post/likes ?u]] db pids))
       :comments  (into {} (d/q '[:find ?p (count ?c) :in $ [?p ...] :where [?c :comment/post ?p]] db pids))
       :reactions (reduce (fn [m [p emo n]] (assoc-in m [p emo] n)) {}
                          (d/q '[:find ?p ?emo (count ?r) :in $ [?p ...]
                                 :where [?r :reaction/post ?p] [?r :reaction/emoji ?emo]]
                               db pids))
       :mine      (if viewer-e
                    (into {} (d/q '[:find ?p ?emo :in $ [?p ...] ?me
                                    :where [?r :reaction/post ?p] [?r :reaction/user ?me]
                                    [?r :reaction/emoji ?emo]]
                                  db pids viewer-e))
                    {})
       :days      (author-days db author-es)})))

(defn- dto [db e viewer-e {:keys [likes comments reactions mine days]}]
  (let [pid         (:db/id e)
        author      (:post/author e)
        author-e    (:db/id author)
        owner?      (and viewer-e (= author-e viewer-e))
        hide?       (boolean (:post/hide-likes e))
        show-likes? (or owner? (not hide?))
        media       (post-media db e)
        like-set    (:post/likes e)
        created     (:post/created-at e)]
    (cond-> {:id           (str pid)
             :author       (author-dto author)
             :caption      (:post/caption e)
             :mediaUrl     (or (:post/media-url e) (:url (first media)))
             :media        media
             :layout       (name (or (:post/layout e) (if (> (count media) 1) :carousel :single)))
             :audience     (name (audience e))
             :hideLikes    hide?
             :commentsOff  (boolean (:post/comments-off e))
             :archived     (boolean (:post/archived e))
             :activityTag  (:post/activity-tag e)
             :hashtags     (vec (sort (:post/hashtags e)))
             :likes        (if show-likes? (vec (keep :user/username like-set)) [])
             :likeCount    (when show-likes? (get likes pid 0))
             :commentCount (get comments pid 0)
             :reactions    (if show-likes? (get reactions pid {}) {})
             :myReaction   (get mine pid)
             :dayNumber    (when created (day-number (get days author-e) (local-date created)))
             :createdAt    (instant->str created)
             :editedAt     (instant->str (:post/edited-at e))}
      viewer-e (assoc :liked (boolean (some #(= (:db/id %) viewer-e) like-set))
                      :saved (boolean (some #(= (:db/id %) viewer-e) (:post/saved-by e)))))))

(defn post-dtos
  "Post DTOs (see docs/ARCHITECTURE.md) for `pids`, in order."
  [db pids viewer-e]
  (let [es      (mapv #(d/entity db %) pids)
        authors (distinct (keep #(-> % :post/author :db/id) es))
        st      (batch-stats db pids viewer-e authors)]
    (mapv #(dto db % viewer-e st) es)))

(defn post-dto
  ([db eid] (post-dto db eid nil))
  ([db eid viewer-e] (first (post-dtos db [eid] viewer-e))))

;; ===== PAGINATION =====

(defn- param [req k] (get-in req [:params k]))

(defn- parse-limit [req default]
  (let [n (some-> (param req :limit) str parse-long)]
    (-> (or n default) (max 1) (min 50))))

(defn- parse-cursor
  "Keyset cursor \"<created-at millis>_<eid>\"."
  [s]
  (when (string? s)
    (let [[a b] (str/split s #"_")]
      (when-let [t (some-> a parse-long)]
        (when-let [id (some-> b parse-long)]
          [t id])))))

(defn- page-newest-first
  "rows: [pid ^Date created-at] in any order. Returns {:pids :next} — the
   newest-first page after `cursor` of posts satisfying `keep?`."
  [db rows keep? cursor limit]
  (let [k      (fn [[pid ^Date t]] [(.getTime t) pid])
        cur    (parse-cursor cursor)
        sorted (sort-by k #(compare %2 %1) rows)
        after  (if cur (drop-while #(>= (compare (k %) cur) 0) sorted) sorted)
        page   (take (inc limit) (filter (fn [[pid _]] (keep? (d/entity db pid))) after))
        items  (take limit page)]
    {:pids (mapv first items)
     :next (when (> (count page) limit)
             (let [[pid ^Date t] (last items)] (str (.getTime t) "_" pid)))}))

(defn- page-response [db viewer-e {:keys [pids next]}]
  {:items (post-dtos db pids viewer-e) :nextCursor next})

(defn- author-rows [db author-es]
  (if (empty? author-es)
    []
    (d/q '[:find ?p ?t :in $ [?a ...] :where [?p :post/author ?a] [?p :post/created-at ?t]]
         db (vec author-es))))

;; ===== HELPERS =====

(defn- load-post [db id]
  (when-let [pid (parse-id id)]
    (let [e (d/entity db pid)]
      (when (:post/author e) e))))

(defn- viewer [db req] (some->> (me req) (user-e db)))

(defn- notify!
  "Notification to `recipient-e` unless they are the actor."
  [recipient-e actor-e type msg post-e]
  (when (and recipient-e (not= recipient-e actor-e))
    (create-notif! recipient-e type msg {:actor-e actor-e :post-e post-e})))

(defn- notify-mentions! [db post-e actor-e username mentioned where]
  (let [pe (d/entity db post-e)]
    (doseq [m mentioned]
      ;; only tell people who can actually open the post
      (when (visible? (viewer-ctx db m) pe)
        (notify! m actor-e :mention (str username " mentioned you in a " where) post-e)))))

(def layouts #{"single" "carousel" "compare"})
(def audiences #{"public" "followers" "close-friends"})
(def max-media 10)

(def reaction-emojis
  "Supportive reactions only — there are no dislikes, ever."
  ["🔥" "💪" "👏" "🙌" "💯"])

;; ===== FEED =====

(defn handle-get-feed
  "GET /api/feed?cursor=&limit= -> {items, nextCursor}: own + followed posts,
   newest first, archived excluded, privacy respected."
  [req]
  (let [db (ddb)
        u  (some->> (me req) (user-e db))]
    (if-not u
      (unauth)
      (let [ctx     (viewer-ctx db u)
            authors (remove (:hidden ctx) (conj (:follows ctx) u))]
        (ok (page-response db u (page-newest-first db (author-rows db authors) #(listable? ctx %)
                                                   (param req :cursor) (parse-limit req 10))))))))

(defn handle-get-user-posts
  "GET /api/users/:username/posts?cursor=&limit= -> {items, nextCursor, private?}"
  [req]
  (let [db  (ddb)
        a   (user-e db (get-in req [:path-params :username]))]
    (if-not a
      (not-found)
      (let [u   (viewer db req)
            ctx (viewer-ctx db u)]
        (if (and (not= a u) (or (contains? (:hidden ctx) a) (not ((:can-view ctx) a))))
          (ok {:items [] :nextCursor nil :private true})
          (ok (page-response db u (page-newest-first db (author-rows db [a]) #(listable? ctx %)
                                                     (param req :cursor) (parse-limit req 12)))))))))

(defn handle-get-archived [req]
  (if-let [username (me req)]
    (let [db (ddb)
          u  (user-e db username)]
      (ok (page-response db u (page-newest-first db (author-rows db [u]) #(boolean (:post/archived %))
                                                 (param req :cursor) (parse-limit req 12)))))
    (unauth)))

(defn handle-get-saved-posts
  "GET /api/saved-posts -> [Post] (array kept for existing callers)."
  [req]
  (if-let [username (me req)]
    (let [db   (ddb)
          u    (user-e db username)
          ctx  (viewer-ctx db u)
          rows (d/q '[:find ?p ?t :in $ ?u :where [?p :post/saved-by ?u] [?p :post/created-at ?t]] db u)]
      (ok (:items (page-response db u (page-newest-first db rows #(listable? ctx %) nil 50)))))
    (unauth)))

;; ===== EXPLORE =====

(defn explore-score
  "Engagement with time decay (gravity like HN): fresh posts with likes and
   comments rise, old ones sink. Posts without media rank lower in a grid."
  [{:keys [likes comments reactions age-hours has-media]}]
  (* (if has-media 1.0 0.35)
     (/ (+ 1.0 likes (* 2.0 comments) reactions)
        (Math/pow (+ (max 0.0 age-hours) 2.0) 1.5))))

(defn handle-explore
  "GET /api/explore?cursor=&limit= -> {items, nextCursor}: public posts from
   people the viewer doesn't follow, ranked by time-decayed engagement.
   cursor = offset into the ranking."
  [req]
  (let [db     (ddb)
        u      (viewer db req)
        ctx    (viewer-ctx db u)
        skip   (conj (:follows ctx) u)
        now    (System/currentTimeMillis)
        rows   (d/q '[:find ?p ?a ?t :where [?p :post/author ?a] [?p :post/created-at ?t]] db)
        cands  (->> rows
                    (remove (fn [[_ a _]] (contains? skip a)))
                    (filter (fn [[p _ _]] (let [e (d/entity db p)]
                                            (and (= :public (audience e)) (listable? ctx e))))))
        pids   (mapv first cands)
        st     (batch-stats db pids nil nil)
        scored (->> cands
                    (map (fn [[p _ ^Date t]]
                           (let [e (d/entity db p)]
                             [p (explore-score {:likes     (get-in st [:likes p] 0)
                                                :comments  (get-in st [:comments p] 0)
                                                :reactions (reduce + 0 (vals (get-in st [:reactions p])))
                                                :age-hours (/ (- now (.getTime t)) 3600000.0)
                                                :has-media (boolean (or (seq (:post/media e)) (:post/media-url e)))})])))
                    (sort-by (fn [[p sc]] [(- sc) (- p)]))
                    (map first))
        offset (or (some-> (param req :cursor) str parse-long) 0)
        limit  (parse-limit req 24)
        page   (take limit (drop offset scored))
        more?  (seq (drop (+ offset limit) scored))]
    (ok {:items (post-dtos db page u)
         :nextCursor (when more? (str (+ offset limit)))})))

;; ===== HASHTAGS / TRENDING =====

(defn handle-hashtag
  "GET /api/hashtags/:tag?cursor=&limit= -> {tag, count, items, nextCursor}"
  [req]
  (let [tag (normalize-tag (get-in req [:path-params :tag]))]
    (if (str/blank? tag)
      (bad "Invalid hashtag")
      (let [db   (ddb)
            u    (viewer db req)
            ctx  (viewer-ctx db u)
            rows (filter (fn [[p _]] (listable? ctx (d/entity db p)))
                         (d/q '[:find ?p ?t :in $ ?tag :where [?p :post/hashtags ?tag] [?p :post/created-at ?t]]
                              db tag))]
        (ok (assoc (page-response db u (page-newest-first db rows (constantly true)
                                                          (param req :cursor) (parse-limit req 24)))
                   :tag tag
                   :count (count rows)))))))

(defn handle-hashtag-search
  "GET /api/hashtags/search?q= -> [{tag, count}] (prefix match, most used first)"
  [req]
  (let [q (normalize-tag (param req :q))]
    (if (str/blank? q)
      (ok [])
      (let [rows (d/q '[:find ?tag (count ?p) :in $ ?q
                        :where [?p :post/hashtags ?tag]
                        [(clojure.string/starts-with? ?tag ?q)]]
                      (ddb) q)]
        (ok (->> rows
                 (sort-by (fn [[t c]] [(- c) t]))
                 (take 20)
                 (mapv (fn [[t c]] {:tag t :count c}))))))))

(defn handle-trending
  "GET /api/trending -> [{tag, count, kind: hashtag|activity}]: hashtags of the
   last 7 days, topped up with all-time activity tags."
  [_]
  (let [db       (ddb)
        week-ago (- (System/currentTimeMillis) (* 7 24 3600 1000))
        tags     (->> (d/q '[:find ?tag ?p ?t :where [?p :post/hashtags ?tag] [?p :post/created-at ?t]] db)
                      (filter (fn [[_ _ ^Date t]] (> (.getTime t) week-ago)))
                      (group-by first)
                      (map (fn [[tag rs]] {:tag tag :count (count rs) :kind "hashtag"}))
                      (sort-by (juxt (comp - :count) :tag))
                      (take 10))
        acts     (->> (d/q '[:find ?tag (count ?p) :where [?p :post/activity-tag ?tag]] db)
                      (map (fn [[tag c]] {:tag tag :count c :kind "activity"}))
                      (sort-by (juxt (comp - :count) :tag)))]
    (ok (vec (take 10 (concat tags acts))))))

;; ===== STREAKS =====

(defn user-days [db u]
  (get (author-days db [u]) u (sorted-set)))

(defn handle-my-streak
  "GET /api/me/streak -> {current, best, postedToday, totalDays, nextDayNumber, today}"
  [req]
  (let [db (ddb)
        u  (some->> (me req) (user-e db))]
    (if u
      (ok (streak-info (user-days db u) (today)))
      (unauth))))

(defn handle-user-streak [req]
  (let [db (ddb)
        a  (user-e db (get-in req [:path-params :username]))]
    (if a
      (ok (dissoc (streak-info (user-days db a) (today)) :today))
      (not-found))))

;; ===== POSTS =====

(defn- resolve-layout [layout n]
  (cond
    (and (= layout "compare") (= n 2)) :compare
    (> n 1)                            :carousel
    :else                              :single))

(defn handle-create-post
  "POST /api/posts CreatePostRequest {caption, mediaIds[], layout?, audience?,
   hideLikes?, commentsOff?, activityTag?} — legacy {mediaUrl} still accepted."
  [req]
  (if-let [username (me req)]
    (let [{:keys [caption mediaIds mediaUrl activityTag layout audience hideLikes commentsOff]} (parse-body req)
          db  (ddb)
          u   (user-e db username)
          ids (mapv parse-id (if (sequential? mediaIds) mediaIds []))]
      (cond
        (some nil? ids)                         (bad "Invalid media id")
        (> (count ids) max-media)               (bad (str "A post can have at most " max-media " photos or videos"))
        (not= (count ids) (count (distinct ids))) (bad "Duplicate media in post")
        (and (= layout "compare") (not= 2 (count ids))) (bad "A before/after post needs exactly 2 photos")
        (and audience (not (audiences audience))) (bad "Invalid audience")
        (not (every? #(let [e (d/entity db %)] (and (:media/url e) (= u (media-owner-e e)))) ids))
        (jresp 403 {:error "Media not found or not yours"})
        :else
        (let [tags     (parse-hashtags caption)
              mentions (mention-eids db caption u)
              slides   (vec (map-indexed (fn [i m] {:post-media/media m :post-media/position i}) ids))
              post     (cond-> {:db/id           "new-post"
                                :post/author     u
                                :post/created-at (Date.)
                                :post/layout     (resolve-layout layout (count ids))
                                :post/audience   (keyword (or audience "public"))}
                         (not (str/blank? caption))   (assoc :post/caption caption)
                         (and (empty? ids) (not (str/blank? mediaUrl))) (assoc :post/media-url mediaUrl)
                         (not (str/blank? activityTag)) (assoc :post/activity-tag activityTag)
                         (true? hideLikes)   (assoc :post/hide-likes true)
                         (true? commentsOff) (assoc :post/comments-off true)
                         (seq slides)        (assoc :post/media slides)
                         (seq tags)          (assoc :post/hashtags tags)
                         (seq mentions)      (assoc :post/mentions mentions))
              r        @(d/transact s/conn [post])
              db2      (:db-after r)
              pid      (get (:tempids r) "new-post")]
          (notify-mentions! db2 pid u username mentions "post")
          ;; Close-friends posts are not announced: other followers must not
          ;; learn that a post they can't see exists.
          (when-not (= "close-friends" audience)
            (realtime/notify-followers-new-post! u pid))
          (created (post-dto db2 pid u)))))
    (unauth)))

(defn handle-get-post [req]
  (let [db (ddb)
        e  (load-post db (get-in req [:path-params :id]))
        u  (viewer db req)]
    (if (and e (visible? (viewer-ctx db u) e))
      (ok (post-dto db (:db/id e) u))
      (not-found))))

(defn- with-own-post
  "Runs (f db u post-entity) when the caller owns the post."
  [req f]
  (if-let [username (me req)]
    (let [db (ddb)
          u  (user-e db username)
          e  (load-post db (get-in req [:path-params :id]))]
      (cond
        (nil? e)                          (not-found)
        (not= u (-> e :post/author :db/id)) (forbidden)
        :else                             (f db u e)))
    (unauth)))

(defn handle-update-post
  "PUT /api/posts/:id {caption?, audience?, hideLikes?, commentsOff?, activityTag?}"
  [req]
  (with-own-post req
    (fn [db u e]
      (let [body     (parse-body req)
            username (me req)
            pid      (:db/id e)
            aud      (:audience body)]
        (if (and (contains? body :audience) (not (audiences aud)))
          (bad "Invalid audience")
          (let [caption      (:caption body)
                cap?         (contains? body :caption)
                old-tags     (set (:post/hashtags e))
                new-tags     (set (parse-hashtags caption))
                old-mentions (set (map :db/id (:post/mentions e)))
                new-mentions (when cap? (mention-eids db caption u))
                added        (remove old-mentions new-mentions)
                tx (cond-> [[:db/add pid :post/edited-at (Date.)]]
                     (and cap? (not (str/blank? caption)))
                     (conj [:db/add pid :post/caption caption])
                     (and cap? (str/blank? caption) (:post/caption e))
                     (conj [:db/retract pid :post/caption (:post/caption e)])
                     cap? (into (concat (for [t old-tags :when (not (new-tags t))] [:db/retract pid :post/hashtags t])
                                        (for [t new-tags :when (not (old-tags t))] [:db/add pid :post/hashtags t])
                                        (for [m added] [:db/add pid :post/mentions m])))
                     (contains? body :audience)
                     (conj [:db/add pid :post/audience (keyword aud)])
                     (contains? body :hideLikes)
                     (conj [:db/add pid :post/hide-likes (true? (:hideLikes body))])
                     (contains? body :commentsOff)
                     (conj [:db/add pid :post/comments-off (true? (:commentsOff body))])
                     (and (contains? body :activityTag) (not (str/blank? (:activityTag body))))
                     (conj [:db/add pid :post/activity-tag (:activityTag body)])
                     (and (contains? body :activityTag) (str/blank? (:activityTag body)) (:post/activity-tag e))
                     (conj [:db/retract pid :post/activity-tag (:post/activity-tag e)]))
                db2 (:db-after @(d/transact s/conn tx))]
            (notify-mentions! db2 pid u username added "post")
            (ok (post-dto db2 pid u))))))))

(defn handle-archive-post
  "POST /api/posts/:id/archive — toggles; -> {archived}"
  [req]
  (with-own-post req
    (fn [_ _ e]
      (let [archived (not (:post/archived e))]
        @(d/transact s/conn [[:db/add (:db/id e) :post/archived archived]])
        (ok {:archived archived})))))

(defn handle-delete-post [req]
  (with-own-post req
    (fn [db _ e]
      (let [pid (:db/id e)
            cs  (d/q '[:find [?c ...] :in $ ?p :where [?c :comment/post ?p]] db pid)
            rs  (d/q '[:find [?r ...] :in $ ?p :where [?r :reaction/post ?p]] db pid)]
        @(d/transact s/conn (concat (for [x (concat cs rs)] [:db/retractEntity x])
                                    [[:db/retractEntity pid]]))
        (ok {:ok true})))))

(defn- with-visible-post
  "Runs (f db u username post-entity) for a logged-in viewer who can see the post."
  [req f]
  (if-let [username (me req)]
    (let [db (ddb)
          u  (user-e db username)
          e  (load-post db (get-in req [:path-params :id]))]
      (if (and e (visible? (viewer-ctx db u) e))
        (f db u username e)
        (not-found)))
    (unauth)))

(defn handle-like-post
  "POST /api/posts/:id/like — toggles; -> {likes, liked, likeCount}"
  [req]
  (with-visible-post req
    (fn [_ u username e]
      (let [pid    (:db/id e)
            liked? (boolean (some #(= (:db/id %) u) (:post/likes e)))
            db2    (:db-after @(d/transact s/conn [[(if liked? :db/retract :db/add) pid :post/likes u]]))
            likes  (vec (keep :user/username (:post/likes (d/entity db2 pid))))]
        (when-not liked?
          (notify! (-> e :post/author :db/id) u :like (str username " liked your post") pid))
        (ok {:likes likes :liked (not liked?) :likeCount (count likes)})))))

(defn handle-react-post
  "POST /api/posts/:id/react {emoji} — one supportive reaction per user;
   same emoji again removes it. -> {reactions, myReaction}"
  [req]
  (with-visible-post req
    (fn [db u username e]
      (let [emoji (:emoji (parse-body req))
            pid   (:db/id e)]
        (if-not (some #{emoji} reaction-emojis)
          (bad (str "Reaction must be one of " (str/join " " reaction-emojis)))
          (let [existing (d/q '[:find ?r . :in $ ?p ?u :where [?r :reaction/post ?p] [?r :reaction/user ?u]] db pid u)
                same?    (and existing (= emoji (:reaction/emoji (d/entity db existing))))
                tx       (cond
                           same?    [[:db/retractEntity existing]]
                           existing [[:db/add existing :reaction/emoji emoji]]
                           :else    [{:reaction/post pid :reaction/user u :reaction/emoji emoji
                                      :reaction/created-at (Date.)}])
                db2      (:db-after @(d/transact s/conn tx))
                dto      (post-dto db2 pid u)]
            (when-not existing
              (notify! (-> e :post/author :db/id) u :reaction (str username " reacted " emoji " to your post") pid))
            (ok {:reactions (:reactions dto) :myReaction (:myReaction dto)})))))))

(defn handle-save-post [req]
  (with-visible-post req
    (fn [_ u _ e]
      @(d/transact s/conn [[:db/add (:db/id e) :post/saved-by u]])
      (ok {:saved true}))))

(defn handle-unsave-post [req]
  (if-let [username (me req)]
    (let [db (ddb)
          e  (load-post db (get-in req [:path-params :id]))]
      (if e
        (do @(d/transact s/conn [[:db/retract (:db/id e) :post/saved-by (user-e db username)]])
            (ok {:saved false}))
        (not-found)))
    (unauth)))

;; ===== COMMENTS =====

(defn- comment-dtos
  "Comment DTOs with like/reply counts batched. Replies (if `with-replies?`)
   are nested under their top-level comment, oldest first."
  [db cids viewer-e post-owner-e hidden with-replies?]
  (let [cids    (vec cids)
        replies (if (and with-replies? (seq cids))
                  (->> (d/q '[:find ?r ?parent :in $ [?parent ...] :where [?r :comment/parent ?parent]] db cids)
                       (remove (fn [[r _]] (contains? hidden (-> (d/entity db r) :comment/author :db/id))))
                       (group-by second)
                       (reduce-kv (fn [m k v] (assoc m k (sort (map first v)))) {}))
                  {})
        all     (vec (concat cids (mapcat val replies)))
        likes   (if (seq all)
                  (into {} (d/q '[:find ?c (count ?u) :in $ [?c ...] :where [?c :comment/likes ?u]] db all))
                  {})
        one     (fn [cid]
                  (let [e        (d/entity db cid)
                        author-e (-> e :comment/author :db/id)]
                    (cond-> {:id        (str cid)
                             :author    (author-dto (:comment/author e))
                             :content   (:comment/content e)
                             :createdAt (instant->str (:comment/created-at e))
                             :parentId  (some-> e :comment/parent :db/id str)
                             :likeCount (get likes cid 0)
                             :liked     (boolean (and viewer-e (some #(= (:db/id %) viewer-e) (:comment/likes e))))
                             :canDelete (boolean (and viewer-e (or (= viewer-e author-e) (= viewer-e post-owner-e))))})))]
    (mapv (fn [cid]
            (let [rs (get replies cid)]
              (cond-> (one cid)
                with-replies? (assoc :replyCount (count rs) :replies (mapv one rs)))))
          cids)))

(defn handle-get-comments
  "GET /api/posts/:id/comments?cursor=&limit= -> {items, nextCursor, total}.
   Items are top-level comments (oldest first) with nested `replies`."
  [req]
  (let [db (ddb)
        e  (load-post db (get-in req [:path-params :id]))
        u  (viewer db req)
        ctx (viewer-ctx db u)]
    (if-not (and e (visible? ctx e))
      (not-found)
      (let [pid    (:db/id e)
            hidden (:hidden ctx)
            top    (->> (d/q '[:find [?c ...] :in $ ?p
                               :where [?c :comment/post ?p] (not [?c :comment/parent _])]
                             db pid)
                        (remove #(contains? hidden (-> (d/entity db %) :comment/author :db/id)))
                        sort)
            cur    (some-> (param req :cursor) str parse-long)
            limit  (parse-limit req 20)
            after  (if cur (drop-while #(<= % cur) top) top)
            page   (take limit after)
            total  (or (d/q '[:find (count ?c) . :in $ ?p :where [?c :comment/post ?p]] db pid) 0)]
        (ok {:items      (comment-dtos db page u (-> e :post/author :db/id) hidden true)
             :nextCursor (when (seq (drop limit after)) (str (last page)))
             :total      total})))))

(defn handle-add-comment
  "POST /api/posts/:id/comments {content, parentId?} -> Comment"
  [req]
  (with-visible-post req
    (fn [db u username e]
      (let [{:keys [content parentId]} (parse-body req)
            pid      (:db/id e)
            owner-e  (-> e :post/author :db/id)
            parent   (some->> parentId parse-id (d/entity db))
            root     (when parent (or (:comment/parent parent) parent))]
        (cond
          (:post/comments-off e)              (jresp 403 {:error "Comments are turned off for this post"})
          (str/blank? content)                (bad "Comment cannot be empty")
          (> (count content) 2200)            (bad "Comment is too long")
          (and parentId (not= pid (-> root :comment/post :db/id))) (bad "Invalid parent comment")
          :else
          (let [r   @(d/transact s/conn [(cond-> {:db/id "c" :comment/post pid :comment/author u
                                                  :comment/content content :comment/created-at (Date.)}
                                           root (assoc :comment/parent (:db/id root)))])
                cid (get (:tempids r) "c")
                db2 (:db-after r)
                parent-author (-> parent :comment/author :db/id)
                notified (atom #{u})]
            (when (and parent-author (not (@notified parent-author)))
              (notify! parent-author u :reply (str username " replied to your comment") pid)
              (swap! notified conj parent-author))
            (when-not (@notified owner-e)
              (notify! owner-e u :comment (str username " commented on your post") pid)
              (swap! notified conj owner-e))
            (notify-mentions! db2 pid u username (remove @notified (mention-eids db content u)) "comment")
            (created (first (comment-dtos db2 [cid] u owner-e #{} false)))))))))

(defn handle-delete-comment
  "DELETE /api/comments/:id — comment author or the post owner. Replies go too."
  [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u   (user-e db username)
          cid (parse-id (get-in req [:path-params :id]))
          c   (when cid (d/entity db cid))]
      (cond
        (not (:comment/content c)) (not-found)
        (not (#{(-> c :comment/author :db/id) (-> c :comment/post :post/author :db/id)} u)) (forbidden)
        :else
        (let [replies (d/q '[:find [?r ...] :in $ ?c :where [?r :comment/parent ?c]] db cid)]
          @(d/transact s/conn (for [x (conj (vec replies) cid)] [:db/retractEntity x]))
          (ok {:ok true}))))
    (unauth)))

(defn handle-like-comment
  "POST /api/comments/:id/like — toggles; -> {liked, likeCount}"
  [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u   (user-e db username)
          cid (parse-id (get-in req [:path-params :id]))
          c   (when cid (d/entity db cid))
          post (:comment/post c)]
      (if-not (and (:comment/content c) post (visible? (viewer-ctx db u) post))
        (not-found)
        (let [liked? (boolean (some #(= (:db/id %) u) (:comment/likes c)))
              db2    (:db-after @(d/transact s/conn [[(if liked? :db/retract :db/add) cid :comment/likes u]]))]
          (when-not liked?
            (notify! (-> c :comment/author :db/id) u :like (str username " liked your comment") (:db/id post)))
          (ok {:liked (not liked?) :likeCount (count (:comment/likes (d/entity db2 cid)))}))))
    (unauth)))

;; ===== ROUTES =====
;; Order matters for conflicting paths (static before :param).

(def routes
  [["/api/feed"                   {:get handle-get-feed}]
   ["/api/explore"                {:get handle-explore}]
   ["/api/trending"               {:get handle-trending}]
   ["/api/me/streak"              {:get handle-my-streak}]
   ["/api/users/:username/streak" {:get handle-user-streak}]
   ["/api/users/:username/posts"  {:get handle-get-user-posts}]
   ["/api/hashtags/search"        {:get handle-hashtag-search}]
   ["/api/hashtags/:tag"          {:get handle-hashtag}]
   ["/api/posts"                  {:post handle-create-post}]
   ["/api/posts/archived"         {:get handle-get-archived}]
   ["/api/posts/:id"              {:get handle-get-post :put handle-update-post :delete handle-delete-post}]
   ["/api/posts/:id/like"         {:post handle-like-post}]
   ["/api/posts/:id/react"        {:post handle-react-post}]
   ["/api/posts/:id/archive"      {:post handle-archive-post}]
   ["/api/posts/:id/save"         {:post handle-save-post}]
   ["/api/posts/:id/unsave"       {:post handle-unsave-post}]
   ["/api/posts/:id/comments"     {:get handle-get-comments :post handle-add-comment}]
   ["/api/comments/:id"           {:delete handle-delete-comment}]
   ["/api/comments/:id/like"      {:post handle-like-comment}]
   ["/api/saved-posts"            {:get handle-get-saved-posts}]])
