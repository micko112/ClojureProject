(ns web.dm
  "Direct messages (1:1 conversations): live push, typing, seen receipts,
   reactions, replies, unsend, shared posts and message requests.
   Moved here from web.server. OWNER: realtime agent.

   Events pushed over the WebSocket (see web.realtime):
     {:type \"message\"          :conversationId :message <msg-dto> :conversation <conv-dto>}
     {:type \"message:unsent\"   :conversationId :messageId}
     {:type \"message:reaction\" :conversationId :messageId :reactions [...]}
     {:type \"seen\"             :conversationId :by :at :messageId}
     {:type \"typing\"           :conversationId :username :typing}
     {:type \"conversation:accepted\" :conversationId}
   Client -> server: {\"type\":\"typing\",\"conversationId\":\"..\",\"typing\":true}"
  (:require [clojure.string :as str]
            [datomic.api :as d]
            [project.system :as s]
            [web.http :refer [jresp parse-body me ok created bad unauth forbidden not-found
                              parse-id instant->str ddb user-e author-dto]]
            [web.accounts :as accounts]
            [web.realtime :as rt])
  (:import (java.util Date)))

;; ===== HELPERS =====

(defn participants [db conv-e]
  (set (map :db/id (:conversation/participants (d/entity db conv-e)))))

(defn participant? [db conv-e u-e]
  (contains? (participants db conv-e) u-e))

(defn follows? [db a-e b-e]
  (boolean (some #(= (:db/id %) b-e) (:user/follows (d/entity db a-e)))))

(defn- resolve-optional [sym]
  (try (requiring-resolve sym) (catch Throwable _ nil)))

(defn blocked-between?
  "True when a-e may not message b-e: blocks/mutes in either direction, or
   `(web.accounts/can-message? db a-e b-e)` (resolved at runtime) says no."
  [db a-e b-e]
  (if-let [can? (resolve-optional 'web.accounts/can-message?)]
    (try (not (can? db a-e b-e)) (catch Throwable _ false))
    (or (contains? (set (accounts/hidden-author-ids db a-e)) b-e)
        (contains? (set (accounts/hidden-author-ids db b-e)) a-e))))

(defn find-conv [db a-e b-e]
  (d/q '[:find ?c . :in $ ?a ?b
         :where [?c :conversation/participants ?a] [?c :conversation/participants ?b]]
       db a-e b-e))

(defn find-or-create-conv!
  "Returns conv eid. A new conversation becomes a message request for the
   recipient when the recipient does not follow the sender."
  [me-e other-e]
  (let [db (ddb)]
    (or (find-conv db me-e other-e)
        (let [tid (d/tempid :db.part/user)
              now (Date.)
              res @(d/transact s/conn [(cond-> {:db/id tid
                                                :conversation/participants #{me-e other-e}
                                                :conversation/created-at now
                                                :conversation/last-message-at now}
                                         (not (follows? db other-e me-e))
                                         (assoc :conversation/request-to other-e))])]
          (d/resolve-tempid (:db-after res) (:tempids res) tid)))))

(defn- entity? [x] (instance? datomic.Entity x))

(defn- post-media
  "Best-effort thumbnail of a post: legacy :post/media-url, else the first
   referenced entity carrying :media/url (media area)."
  [p]
  (if-let [u (:post/media-url p)]
    {:thumbnailUrl u :mediaType (if (re-find #"(?i)\.(mp4|webm|mov)$" u) "video" "image")}
    (some (fn [[_ v]]
            (some (fn [m]
                    (when (and (entity? m) (:media/url m))
                      {:thumbnailUrl (or (:media/poster-url m) (:media/url m))
                       :mediaType    (or (some-> (:media/type m) name) "image")}))
                  (if (coll? v) v [v])))
          (seq p))))

(defn post-preview [db post viewer-e]
  (when post
    (let [author (:post/author post)]
      (if (and author (accounts/can-view-posts? db viewer-e (:db/id author))
               (not (contains? (set (accounts/hidden-author-ids db viewer-e)) (:db/id author))))
        (merge {:id (str (:db/id post)) :caption (:post/caption post) :author (author-dto author)}
               (post-media post))
        {:id (str (:db/id post)) :unavailable true}))))

(defn- media-label [e]
  (case (:message/media-type e)
    "image" "Photo"
    "audio" "Voice message"
    "video" "Video"
    nil))

(defn preview-text [e]
  (let [c (:message/content e)]
    (cond
      (seq c) c
      (:message/post e) "Shared a post"
      (media-label e) (media-label e)
      :else "")))

(defn reactions-dto [e]
  (->> (:message/reactions e)
       (keep (fn [r] (when-let [u (:message-reaction/user r)]
                       {:username (:user/username u) :emoji (:message-reaction/emoji r)})))
       (sort-by :username)
       vec))

(defn msg-dto [db eid viewer-e]
  (let [e      (d/entity db eid)
        sender (:message/sender e)
        reply  (:message/reply-to e)
        post   (:message/post e)]
    (cond-> {:id             (str eid)
             :conversationId (some-> e :message/conversation :db/id str)
             :sender         (author-dto sender)
             :content        (:message/content e)
             :mediaUrl       (:message/media-url e)
             :mediaType      (:message/media-type e)
             :createdAt      (instant->str (:message/created-at e))
             :reactions      (reactions-dto e)
             :readBy         (vec (keep :user/username (:message/read-by e)))}
      reply (assoc :replyTo {:id        (str (:db/id reply))
                             :sender    (author-dto (:message/sender reply))
                             :content   (preview-text reply)
                             :mediaType (:message/media-type reply)})
      post  (assoc :postId (str (:db/id post))
                   :post (post-preview db post viewer-e)))))

(defn- message-ids [db conv-e]
  (sort (d/q '[:find [?m ...] :in $ ?c :where [?m :message/conversation ?c]] db conv-e)))

(defn conv-dto [db me-e conv-e]
  (let [c        (d/entity db conv-e)
        parts    (map :db/id (:conversation/participants c))
        other-e  (first (remove #(= % me-e) parts))
        other    (when other-e (d/entity db other-e))
        last-id  (last (message-ids db conv-e))
        last-e   (when last-id (d/entity db last-id))
        req-to   (some-> c :conversation/request-to :db/id)
        mine?    (= me-e (some-> last-e :message/sender :db/id))
        seen-by  (when (and last-e mine?)
                   (vec (keep (fn [u] (when (not= (:db/id u) me-e) (:user/username u)))
                              (:message/read-by last-e))))]
    {:id            (str conv-e)
     :other         (rt/with-presence db me-e (author-dto other) other)
     :lastMessage   (when last-e (preview-text last-e))
     :last          (when last-e {:id        (str last-id)
                                  :content   (preview-text last-e)
                                  :mediaType (:message/media-type last-e)
                                  :mine      mine?
                                  :createdAt (instant->str (:message/created-at last-e))})
     :lastMessageAt (instant->str (:conversation/last-message-at c))
     :updatedAt     (instant->str (:conversation/last-message-at c))
     :seenBy        (or seen-by [])
     :isRequest     (= req-to me-e)
     :pending       (boolean (and req-to (not= req-to me-e)))
     :unreadCount   (or (d/q '[:find (count ?m) . :in $ ?c ?me
                               :where [?m :message/conversation ?c]
                               (not [?m :message/sender ?me])
                               (not [?m :message/read-by ?me])]
                             db conv-e me-e) 0)}))

(defn- push-participants!
  "Calls (event-fn username u-e) for each participant and publishes the result."
  [db conv-e event-fn & {:keys [except]}]
  (doseq [u-e (participants db conv-e)
          :when (not= u-e except)
          :let [un (:user/username (d/entity db u-e))]]
    (when-let [ev (event-fn un u-e)]
      (rt/publish! un ev))))

(defn- with-conv-access
  "Runs (f db u-e conv-e) when the session user participates in path :id."
  [req f]
  (if-let [username (me req)]
    (let [conv-e (parse-id (get-in req [:path-params :id]))
          db     (ddb)
          u-e    (user-e db username)]
      (if (and conv-e (participant? db conv-e u-e))
        (f db u-e conv-e)
        (forbidden)))
    (unauth)))

;; ===== CORE OPERATIONS =====

(defn send-message!
  "Validates and stores a message from `me-e` in `conv-e`, pushes it live to
   all participants and returns the sender's message DTO (or {:error msg})."
  [me-e conv-e {:keys [content mediaUrl mediaType replyToId postId]}]
  (let [db       (ddb)
        content  (str (or content ""))
        reply-e  (parse-id replyToId)
        post-e   (parse-id postId)
        others   (disj (participants db conv-e) me-e)]
    (cond
      (and (str/blank? content) (str/blank? mediaUrl) (not post-e))
      {:error "Message is empty"}

      (some #(blocked-between? db me-e %) others)
      {:error "You can't message this account" :status 403}

      (and reply-e (not= conv-e (some-> (d/entity db reply-e) :message/conversation :db/id)))
      {:error "Reply target not found"}

      (and post-e (not (:post/author (d/entity db post-e))))
      {:error "Post not found"}

      :else
      (let [now    (Date.)
            msg-id (d/tempid :db.part/user)
            conv   (d/entity db conv-e)
            tx     (cond-> [(cond-> {:db/id                msg-id
                                     :message/conversation conv-e
                                     :message/sender       me-e
                                     :message/content      content
                                     :message/created-at   now
                                     :message/read-by      #{me-e}}
                              (seq mediaUrl)  (assoc :message/media-url mediaUrl)
                              (seq mediaType) (assoc :message/media-type mediaType)
                              reply-e         (assoc :message/reply-to reply-e)
                              post-e          (assoc :message/post post-e))
                            [:db/add conv-e :conversation/last-message-at now]]
                     ;; replying to a request accepts it
                     (= me-e (some-> conv :conversation/request-to :db/id))
                     (conj [:db/retract conv-e :conversation/request-to me-e])
                     ;; a new message brings a hidden/declined thread back
                     :always
                     (into (map (fn [h] [:db/retract conv-e :conversation/hidden-for (:db/id h)])
                                (:conversation/hidden-for conv))))
            res    @(d/transact s/conn tx)
            db2    (:db-after res)
            new-id (d/resolve-tempid db2 (:tempids res) msg-id)]
        (push-participants! db2 conv-e
                            (fn [_un u-e]
                              {:type           "message"
                               :conversationId (str conv-e)
                               :message        (msg-dto db2 new-id u-e)
                               :conversation   (conv-dto db2 u-e conv-e)}))
        (msg-dto db2 new-id me-e)))))

(defn- respond-send [result]
  (if-let [err (:error result)]
    (jresp (or (:status result) 400) {:error err})
    (created result)))

(defn mark-read!
  "Marks all messages of conv as read by u-e; pushes a \"seen\" event to the
   other participants when anything changed."
  [u-e conv-e]
  (let [db   (ddb)
        mids (d/q '[:find [?m ...] :in $ ?c ?u
                    :where [?m :message/conversation ?c]
                    (not [?m :message/read-by ?u])]
                  db conv-e u-e)]
    (when (seq mids)
      (let [db2 (:db-after @(d/transact s/conn (mapv #(vector :db/add % :message/read-by u-e) mids)))
            un  (:user/username (d/entity db2 u-e))]
        (push-participants! db2 conv-e
                            (fn [_ _] {:type           "seen"
                                       :conversationId (str conv-e)
                                       :by             un
                                       :messageId      (str (apply max mids))
                                       :at             (instant->str (Date.))})
                            :except u-e)))
    (count mids)))

(defn unsend!
  "Sender removes a message for everyone. Returns :ok, :forbidden or :not-found."
  [u-e msg-e]
  (let [db (ddb)
        e  (d/entity db msg-e)]
    (cond
      (not (:message/conversation e)) :not-found
      (not= u-e (some-> e :message/sender :db/id)) :forbidden
      :else
      (let [conv-e (-> e :message/conversation :db/id)
            db2    (:db-after @(d/transact s/conn [[:db/retractEntity msg-e]]))]
        (push-participants! db2 conv-e
                            (fn [_ u-e2] {:type           "message:unsent"
                                          :conversationId (str conv-e)
                                          :messageId      (str msg-e)
                                          :conversation   (conv-dto db2 u-e2 conv-e)}))
        :ok))))

(defn react!
  "Instagram-style: one reaction per user per message. Same emoji again (or
   blank emoji) removes it; a different one replaces it."
  [u-e msg-e emoji]
  (let [db       (ddb)
        e        (d/entity db msg-e)
        conv-e   (some-> e :message/conversation :db/id)
        existing (some #(when (= u-e (some-> % :message-reaction/user :db/id)) %) (:message/reactions e))
        emoji    (let [em (str/trim (str (or emoji "")))] (subs em 0 (min 16 (count em))))
        tx       (cond
                   (and existing (or (str/blank? emoji) (= emoji (:message-reaction/emoji existing))))
                   [[:db/retractEntity (:db/id existing)]]
                   existing [[:db/add (:db/id existing) :message-reaction/emoji emoji]]
                   (str/blank? emoji) []
                   :else [{:db/id msg-e
                           :message/reactions [{:message-reaction/user u-e
                                                :message-reaction/emoji emoji}]}])
        db2      (if (seq tx) (:db-after @(d/transact s/conn tx)) db)
        rs       (reactions-dto (d/entity db2 msg-e))]
    (push-participants! db2 conv-e
                        (fn [_ _] {:type           "message:reaction"
                                   :conversationId (str conv-e)
                                   :messageId      (str msg-e)
                                   :reactions      rs}))
    rs))

;; ===== HANDLERS =====

(defn- visible-conversations [db u-e folder]
  (let [cids (d/q '[:find [?c ...] :in $ ?u :where [?c :conversation/participants ?u]] db u-e)]
    (->> cids
         (remove (fn [c] (some #(= u-e (:db/id %)) (:conversation/hidden-for (d/entity db c)))))
         (filter (fn [c]
                   (let [req? (= u-e (some-> (d/entity db c) :conversation/request-to :db/id))]
                     (if (= folder "requests") req? (not req?)))))
         (sort-by #(or (:conversation/last-message-at (d/entity db %)) (Date. 0)) #(compare %2 %1)))))

(defn handle-get-conversations
  "GET /api/conversations?folder=primary|requests (default primary)."
  [req]
  (if-let [username (me req)]
    (let [db     (ddb)
          u-e    (user-e db username)
          folder (or (get-in req [:query-params "folder"]) "primary")]
      (ok (mapv #(conv-dto db u-e %) (visible-conversations db u-e folder))))
    (unauth)))

(defn handle-get-requests [req]
  (handle-get-conversations (assoc-in req [:query-params "folder"] "requests")))

(defn handle-get-conversation [req]
  (with-conv-access req (fn [db u-e conv-e] (ok (conv-dto db u-e conv-e)))))

(defn handle-send-message
  "POST /api/messages {to | conversationId, content, mediaUrl, mediaType, replyToId, postId}"
  [req]
  (if-let [username (me req)]
    (let [{:keys [to conversationId] :as body} (parse-body req)
          db      (ddb)
          me-e    (user-e db username)
          conv-id (parse-id conversationId)
          other-e (when (seq to) (user-e db to))]
      (cond
        conv-id (if (participant? db conv-id me-e)
                  (respond-send (send-message! me-e conv-id body))
                  (forbidden))
        (not other-e) (not-found)
        (= other-e me-e) (bad "You can't message yourself")
        (blocked-between? db me-e other-e) (jresp 403 {:error "You can't message this account"})
        :else (respond-send (send-message! me-e (find-or-create-conv! me-e other-e) body))))
    (unauth)))

(defn handle-share-post
  "POST /api/messages/share {postId, to: [usernames], content?} -> {sent, conversations}"
  [req]
  (if-let [username (me req)]
    (let [{:keys [postId to content]} (parse-body req)
          db     (ddb)
          me-e   (user-e db username)
          post-e (parse-id postId)
          tos    (->> (if (string? to) [to] to) (map str) distinct (take 20))]
      (cond
        (not (and post-e (:post/author (d/entity db post-e)))) (not-found)
        (empty? tos) (bad "No recipients")
        :else
        (let [results (for [un tos
                            :let [o (user-e db un)]
                            :when (and o (not= o me-e) (not (blocked-between? db me-e o)))]
                        (let [c (find-or-create-conv! me-e o)
                              r (send-message! me-e c {:content content :postId (str post-e)})]
                          (when-not (:error r) (str c))))
              convs (vec (remove nil? results))]
          (ok {:sent (count convs) :conversations convs}))))
    (unauth)))

(defn handle-get-messages
  "GET /api/conversations/:id/messages?limit=100&before=<msgId>, oldest first."
  [req]
  (with-conv-access req
    (fn [db u-e conv-e]
      (let [limit  (-> (or (parse-id (get-in req [:query-params "limit"])) 100) (max 1) (min 500))
            before (parse-id (get-in req [:query-params "before"]))
            mids   (cond->> (message-ids db conv-e) before (filter #(< % before)))]
        (ok (mapv #(msg-dto db % u-e) (take-last limit mids)))))))

(defn handle-mark-conv-read [req]
  (with-conv-access req (fn [_ u-e conv-e] (ok {:ok true :marked (mark-read! u-e conv-e)}))))

(defn handle-accept-request [req]
  (with-conv-access req
    (fn [db u-e conv-e]
      (if (= u-e (some-> (d/entity db conv-e) :conversation/request-to :db/id))
        (let [db2 (:db-after @(d/transact s/conn [[:db/retract conv-e :conversation/request-to u-e]]))]
          (push-participants! db2 conv-e
                              (fn [_ _] {:type "conversation:accepted" :conversationId (str conv-e)}))
          (ok (conv-dto db2 u-e conv-e)))
        (bad "Not a message request")))))

(defn handle-decline-request
  "Hides the request for the recipient. The sender is not told."
  [req]
  (with-conv-access req
    (fn [db u-e conv-e]
      (if (= u-e (some-> (d/entity db conv-e) :conversation/request-to :db/id))
        (do @(d/transact s/conn [[:db/add conv-e :conversation/hidden-for u-e]])
            (ok {:ok true}))
        (bad "Not a message request")))))

(defn- with-message [req f]
  (if-let [username (me req)]
    (let [db    (ddb)
          u-e   (user-e db username)
          msg-e (parse-id (get-in req [:path-params :id]))
          conv  (some-> (when msg-e (d/entity db msg-e)) :message/conversation :db/id)]
      (cond
        (not conv) (not-found)
        (not (participant? db conv u-e)) (forbidden)
        :else (f db u-e msg-e)))
    (unauth)))

(defn handle-react [req]
  (with-message req
    (fn [_ u-e msg-e]
      (let [emoji (if (= :delete (:request-method req)) "" (or (:emoji (parse-body req)) "❤️"))]
        (ok {:reactions (react! u-e msg-e emoji)})))))

(defn handle-unsend [req]
  (with-message req
    (fn [_ u-e msg-e]
      (case (unsend! u-e msg-e)
        :ok (ok {:ok true})
        :forbidden (forbidden)
        (not-found)))))

(defn handle-unread-messages
  "{:count unread messages in primary inbox, :requests pending request threads}"
  [req]
  (if-let [username (me req)]
    (let [db  (ddb)
          u-e (user-e db username)
          cnt (or (d/q '[:find (count ?m) .
                         :in $ ?u
                         :where
                         [?c :conversation/participants ?u]
                         (not [?c :conversation/request-to ?u])
                         (not [?c :conversation/hidden-for ?u])
                         [?m :message/conversation ?c]
                         (not [?m :message/sender ?u])
                         (not [?m :message/read-by ?u])]
                       db u-e) 0)
          reqs (count (visible-conversations db u-e "requests"))]
      (ok {:count cnt :requests reqs}))
    (unauth)))

;; ===== TYPING (WebSocket) =====

(defmethod rt/handle-client-event "typing" [{:keys [username]} {:keys [conversationId groupId typing]}]
  (let [db  (ddb)
        u-e (user-e db username)
        ev  (cond-> {:type "typing" :username username :typing (if (nil? typing) true (boolean typing))}
              conversationId (assoc :conversationId (str conversationId))
              groupId        (assoc :groupId (str groupId)))]
    (cond
      (and conversationId (parse-id conversationId) (participant? db (parse-id conversationId) u-e))
      (rt/publish-all! (keep #(when (not= % u-e) (:user/username (d/entity db %)))
                             (participants db (parse-id conversationId)))
                       ev)

      (and groupId (parse-id groupId))
      (let [members (set (map :db/id (:group/members (d/entity db (parse-id groupId)))))]
        (when (contains? members u-e)
          (rt/publish-all! (keep #(when (not= % u-e) (:user/username (d/entity db %))) members) ev))))))

(def routes
  [["/api/conversations"               {:get handle-get-conversations}]
   ["/api/conversations/requests"      {:get handle-get-requests}]
   ["/api/conversations/:id"           {:get handle-get-conversation}]
   ["/api/conversations/:id/messages"  {:get handle-get-messages}]
   ["/api/conversations/:id/read"      {:post handle-mark-conv-read}]
   ["/api/conversations/:id/accept"    {:post handle-accept-request}]
   ["/api/conversations/:id/decline"   {:post handle-decline-request}]
   ["/api/messages"                    {:post handle-send-message}]
   ["/api/messages/unread"             {:get handle-unread-messages}]
   ["/api/messages/share"              {:post handle-share-post}]
   ["/api/messages/:id"                {:delete handle-unsend}]
   ["/api/messages/:id/react"          {:post handle-react :delete handle-react}]])
