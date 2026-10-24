(ns web.accounts
  "Accounts: auth (login/register/password reset/sessions), profile header,
   follow + follow requests, privacy (private accounts, block, mute, restrict,
   close friends), account settings and suggested accounts.
   OWNER: accounts agent.

   Contract functions other namespaces call (see docs/ARCHITECTURE.md):
     hidden-author-ids, can-view-posts?, close-friend?, notification-enabled?,
     can-message?, activity-status-visible?, restricted?, user-dto,
     wrap-session-version (ring middleware, installed in web.server/app).

   Deliberately does NOT require web.notifications / web.posts / web.realtime
   statically (they may require this namespace); notifications are created via
   requiring-resolve."
  (:require [clojure.string :as str]
            [datomic.api :as d]
            [buddy.hashers :as hashers]
            [project.system :as s]
            [web.http :refer [jresp parse-body me ok created bad unauth forbidden
                              not-found instant->str ddb user-e author-dto]]
            [web.accounts.mail :as mail])
  (:import (java.util Date Base64)
           (java.security SecureRandom MessageDigest)
           (java.nio.charset StandardCharsets)))

;; ===== BASIC LOOKUPS =====

(defn- ref-ids [ent attr] (set (map :db/id (get ent attr))))

(defn- entity [db eid] (when eid (d/entity db eid)))

(defn- active-user? [u] (and u (:user/username u) (not (:user/deactivated? u))))

(defn find-user
  "Exact username, then case-insensitive username."
  [db username]
  (let [un (str/trim (str username))]
    (when-not (str/blank? un)
      (or (user-e db un)
          (d/q '[:find ?e . :in $ ?l
                 :where [?e :user/username ?u]
                 [(clojure.string/lower-case ?u) ?ul]
                 [(= ?ul ?l)]]
               db (str/lower-case un))))))

(defn find-user-by-email [db email]
  (let [m (str/lower-case (str/trim (str email)))]
    (when-not (str/blank? m)
      (d/q '[:find ?e . :in $ ?l
             :where [?e :user/email ?m]
             [(clojure.string/lower-case ?m) ?ml]
             [(= ?ml ?l)]]
           db m))))

(defn find-user-by-login
  "Login identifier: username (case-insensitive) or email."
  [db ident]
  (let [ident (str/trim (str ident))]
    (or (find-user db ident)
        (when (str/includes? ident "@") (find-user-by-email db ident)))))

(defn follows? [db a b]
  (and a b (contains? (ref-ids (d/entity db a) :user/follows) b)))

(defn blocks? "Does `a` block `b`?" [db a b]
  (and a b (contains? (ref-ids (d/entity db a) :user/blocks) b)))

(defn blocked-either? [db a b] (or (blocks? db a b) (blocks? db b a)))

(defn- request-key [from to] (str from "-" to))

(defn- request-id [db from to]
  (d/q '[:find ?r . :in $ ?k :where [?r :follow-request/key ?k]] db (request-key from to)))

(defn requested? [db from to] (some? (and from to (request-id db from to))))

(defn- deactivated-ids [db]
  (set (d/q '[:find [?u ...] :where [?u :user/deactivated? true]] db)))

;; ===== PRIVACY CONTRACT =====

(defn hidden-author-ids
  "Set of user eids whose content must never be shown to `viewer-e`
   (blocked in either direction, muted by viewer, deactivated accounts).
   Muted users stay visible on their own profile (use can-view-posts? there)."
  [db viewer-e]
  (let [base (disj (deactivated-ids db) viewer-e)]
    (if-not viewer-e
      base
      (let [v (d/entity db viewer-e)]
        (-> base
            (into (ref-ids v :user/blocks))
            (into (ref-ids v :user/mutes))
            (into (d/q '[:find [?u ...] :in $ ?v :where [?u :user/blocks ?v]] db viewer-e)))))))

(defn unreachable-ids
  "Users `viewer-e` must not be able to find at all (search, leaderboards,
   badges...): deactivated accounts and blocks in either direction. Unlike
   hidden-author-ids, muted accounts are still reachable."
  [db viewer-e]
  (let [base (disj (deactivated-ids db) viewer-e)]
    (if-not viewer-e
      base
      (-> base
          (into (ref-ids (d/entity db viewer-e) :user/blocks))
          (into (d/q '[:find [?u ...] :in $ ?v :where [?u :user/blocks ?v]] db viewer-e))))))

(defn can-view-posts?
  "Can `viewer-e` (may be nil = logged out) see posts of `author-e`?
   False for private accounts the viewer doesn't follow, and for blocks."
  [db viewer-e author-e]
  (let [a (entity db author-e)]
    (cond
      (nil? (:user/username a))                     false
      (and viewer-e (= viewer-e author-e))          true
      (:user/deactivated? a)                        false
      (and viewer-e (blocked-either? db viewer-e author-e)) false
      (not (:user/private? a))                      true
      (nil? viewer-e)                               false
      :else (follows? db viewer-e author-e))))

(defn close-friend?
  "Is `viewer-e` on `owner-e`'s close-friends list?"
  [db owner-e viewer-e]
  (boolean (and owner-e viewer-e
                (contains? (ref-ids (d/entity db owner-e) :user/close-friends) viewer-e))))

(defn restricted?
  "Has `owner-e` restricted `other-e`? (Optional for comments: show a restricted
   user's comments only to themselves.)"
  [db owner-e other-e]
  (boolean (and owner-e other-e
                (contains? (ref-ids (d/entity db owner-e) :user/restricts) other-e))))

(defn muted? [db viewer-e other-e]
  (boolean (and viewer-e other-e
                (contains? (ref-ids (d/entity db viewer-e) :user/mutes) other-e))))

(defn can-message?
  "May `sender-e` start/continue a DM with `recipient-e`? Respects blocks and
   the recipient's \"who can message me\" setting (:followers = only people
   who follow the recipient, or whom the recipient follows)."
  [db sender-e recipient-e]
  (let [r (entity db recipient-e)]
    (boolean
     (and (:user/username r)
          (not (:user/deactivated? r))
          (not (blocked-either? db sender-e recipient-e))
          (or (not= :followers (:user/message-policy r))
              (follows? db sender-e recipient-e)
              (follows? db recipient-e sender-e))))))

(defn activity-status-visible?
  "False when the user chose to hide their online/activity status."
  [db user-e]
  (not (:user/hide-activity? (entity db user-e))))

;; ===== NOTIFICATION PREFERENCES =====

(def notification-pref-keys [:likes :comments :follows :mentions :messages :live])

(def ^:private type->pref
  {:like :likes :likes :likes :story-like :likes :reaction :likes
   :comment :comments :comments :comments :reply :comments :comment-like :likes
   :follow :follows :follows :follows :follow-request :follows :follow-accept :follows
   :mention :mentions :mentions :mentions :tag :mentions
   :message :messages :messages :messages :dm :messages
   :live :live})

(defn notification-enabled?
  "Has `recipient-e` left notifications of `type` (keyword or string, e.g.
   :like, :comment, :follow, :mention, :message, :live) switched on?
   Unknown types are always enabled."
  [db recipient-e type]
  (let [k    (when type (keyword (name type)))
        pref (get type->pref k)]
    (not (and pref recipient-e
              (contains? (set (:user/notif-off (d/entity db recipient-e))) pref)))))

(defn- notify!
  "Creates a notification if the recipient's preferences allow it."
  [recipient-e type msg opts]
  (try
    (when (notification-enabled? (ddb) recipient-e type)
      ((requiring-resolve 'web.notifications/create-notif!) recipient-e type msg opts))
    (catch Exception e
      (println "[accounts] notification failed:" (.getMessage e)))))

;; ===== DTOs =====

(defn user-dto [u]
  (when (and u (:user/username u))
    {:username    (:user/username u)
     :displayName (:user/display-name u)
     :profilePic  (:user/profile-pic u)
     :bio         (:user/bio u)
     :website     (:user/website u)
     :pronouns    (:user/pronouns u)
     :isPrivate   (boolean (:user/private? u))
     :xp          (or (:user/xp u) 0)}))

(defn- pending-request-ids [db to-e]
  (d/q '[:find [?r ...] :in $ ?to :where [?r :follow-request/to ?to]] db to-e))

(defn settings-dto [db u]
  (let [off (set (:user/notif-off u))]
    {:email         (:user/email u)
     :hasPassword   (boolean (seq (:user/password-hash u)))
     :oauth         {:google   (boolean (:user/google-id u))
                     :facebook (boolean (:user/facebook-id u))}
     :isPrivate     (boolean (:user/private? u))
     :hideActivity  (boolean (:user/hide-activity? u))
     :messagesFrom  (name (or (:user/message-policy u) :everyone))
     :notifications (into {} (map (fn [k] [k (not (contains? off k))]) notification-pref-keys))
     :followRequestCount (count (pending-request-ids db (:db/id u)))
     :createdAt     (instant->str (:user/created-at u))}))

(defn me-dto [db eid]
  (let [u (d/entity db eid)]
    (when (:user/username u)
      (assoc (user-dto u) :settings (settings-dto db u)))))

(defn follow-status [db viewer-e target-e]
  (cond
    (follows? db viewer-e target-e)   "following"
    (requested? db viewer-e target-e) "requested"
    :else                             "none"))

(defn- list-user-dto
  "Compact user for lists/modals, with relationship to the viewer."
  [db viewer-e eid]
  (let [u (d/entity db eid)]
    (assoc (author-dto u)
           :isPrivate (boolean (:user/private? u))
           :isMe (= viewer-e eid)
           :followStatus (if viewer-e (follow-status db viewer-e eid) "none")
           :followsYou (boolean (and viewer-e (follows? db eid viewer-e))))))

;; ===== SESSIONS =====

(defn session-for
  "Session map for user `eid`: username, eid and the current session version."
  [db eid]
  (let [u (d/entity db eid)]
    {:username (:user/username u)
     :uid      eid
     :sv       (or (:user/session-version u) 0)}))

(defn validate-session
  "Returns the (possibly refreshed) session if still valid, nil if it must be
   dropped (user gone, deactivated, or older session version)."
  [db {:keys [username uid sv] :as session}]
  (let [eid (if uid uid (user-e db username))
        u   (entity db eid)]
    (when (and (:user/username u)
               (not (:user/deactivated? u))
               (= (or sv 0) (or (:user/session-version u) 0)))
      (cond-> session
        (not= username (:user/username u)) (assoc :username (:user/username u))
        (nil? uid) (assoc :uid eid)))))

(defn wrap-session-version
  "Ring middleware, must sit INSIDE wrap-session. Rejects sessions whose
   version is older than the user's (log out of all devices / password
   change), whose user was deleted/deactivated, and follows username changes."
  [handler]
  (fn [req]
    (let [sess (:session req)]
      (if-not (:username sess)
        (handler req)
        (let [valid (try (validate-session (ddb) sess)
                         (catch Exception _ ::error))]
          (cond
            (or (= valid ::error) (= valid sess))
            (handler req)

            (nil? valid)
            (let [resp (handler (assoc req :session {}))]
              (if (and resp (not (contains? resp :session))) (assoc resp :session nil) resp))

            :else
            (let [resp (handler (assoc req :session valid))]
              (if (and resp (not (contains? resp :session))) (assoc resp :session valid) resp))))))))

(defn- drop-realtime!
  "Closes the open WebSockets of `username` (see web.realtime/disconnect-user!).
   Resolved at runtime: this namespace must not require web.realtime."
  [username]
  (when username
    (try ((requiring-resolve 'web.realtime/disconnect-user!) username)
         (catch Throwable e
           (println "[accounts] closing sockets failed:" (.getMessage e))))))

(defn- bump-session-version-tx [u]
  [:db/add (:db/id u) :user/session-version (inc (or (:user/session-version u) 0))])

;; ===== VALIDATION =====

(def username-re #"^[A-Za-z0-9._]{3,30}$")
(def email-re #"^[^\s@]+@[^\s@]+\.[^\s@]+$")
(def min-password 6)

(defn username-error
  "nil when `un` is a valid, available username for `self-e` (nil for new users)."
  [db un self-e]
  (let [taken (find-user db un)]
    (cond
      (not (re-matches username-re (str un)))
      "Usernames must be 3-30 characters and can only contain letters, numbers, periods and underscores."
      (and taken (not= taken self-e))
      "This username isn't available. Please try another."
      :else nil)))

(defn email-error [db email self-e]
  (let [taken (find-user-by-email db email)]
    (cond
      (not (re-matches email-re (str email))) "Enter a valid email address."
      (and taken (not= taken self-e)) "Another account is using this email."
      :else nil)))

(defn- check-password [password hash]
  (boolean (and (seq hash)
                (try (hashers/check (str password) hash)
                     (catch Exception _ false)))))

(defn- blank->nil [s] (let [s (some-> s str str/trim)] (when-not (str/blank? s) s)))

(defn- normalize-website [s]
  (when-let [s (blank->nil s)]
    (if (re-find #"^(?i)https?://" s) s (str "https://" s))))

(defn- set-or-retract
  "Tx ops to set attr to v, or retract the current value when v is nil."
  [u attr v]
  (let [cur (get u attr)]
    (cond
      (some? v)   (when (not= v cur) [[:db/add (:db/id u) attr v]])
      (some? cur) [[:db/retract (:db/id u) attr cur]]
      :else       nil)))

;; ===== HELPERS =====

(defn- with-me
  "Calls (f db me-e) when logged in, else 401."
  [req f]
  (if-let [un (me req)]
    (let [db (ddb) e (user-e db un)]
      (if e (f db e) (unauth)))
    (unauth)))

(defn- path-user [db req]
  (find-user db (get-in req [:path-params :username])))

(defn- tx! [tx] (when (seq tx) @(d/transact s/conn (vec tx))))

;; ===== LOGIN RATE LIMIT =====

(defonce login-attempts (atom {}))
(def ^:private window-ms (* 15 60 1000))
(def ^:private limits {:user 10 :ip 50 :forgot 10 :forgot-user 5})

(defn- client-ip
  "The address our own proxy saw. nginx appends $remote_addr to whatever
   X-Forwarded-For the client sent, so only the LAST entry is trustworthy;
   the first one is attacker-controlled and would let every request use a
   fresh rate-limit bucket."
  [req]
  (or (some-> (get-in req [:headers "x-forwarded-for"]) (str/split #",") last str/trim blank->nil)
      (some-> (get-in req [:headers "x-real-ip"]) str/trim blank->nil)
      (:remote-addr req)
      "unknown"))

(defn- limited? [[kind :as k]]
  (let [{:keys [n at]} (get @login-attempts k)]
    (boolean (and n (< (- (System/currentTimeMillis) at) window-ms)
                  (>= n (get limits kind 10))))))

(defn- record-attempt! [k]
  (let [now (System/currentTimeMillis)]
    (swap! login-attempts
           (fn [m]
             (let [m (if (> (count m) 10000)
                       (into {} (filter (fn [[_ {:keys [at]}]] (< (- now at) window-ms))) m)
                       m)
                   {:keys [n at]} (get m k)]
               (assoc m k (if (and n (< (- now at) window-ms))
                            {:n (inc n) :at at}
                            {:n 1 :at now})))))))

(defn reset-rate-limits! [] (reset! login-attempts {}))

;; ===== AUTH =====

(defn handle-me [req]
  (if-let [un (me req)]
    (let [db (ddb)
          e  (user-e db un)]
      (if e (ok (me-dto db e)) (unauth)))
    (unauth)))

(defn login-session
  "Session for a fresh login. ^:recreate makes wrap-session issue a NEW
   session id (and drop the old one), so a session id planted in the
   victim's browser before login (session fixation) never becomes theirs."
  [db eid]
  (with-meta (session-for db eid) {:recreate true}))

(defn- login-ok [eid status]
  (let [db   (ddb)
        u    (d/entity db eid)
        db   (if (:user/deactivated? u)
               (:db-after @(d/transact s/conn [[:db/retract eid :user/deactivated? true]]))
               db)]
    (-> (jresp status (me-dto db eid))
        (assoc :session (login-session db eid)))))

(defn handle-login [req]
  (let [{:keys [username email login password]} (parse-body req)
        ident (str/trim (str (or login username email "")))
        db    (ddb)
        eid   (when-not (str/blank? ident) (find-user-by-login db ident))
        ;; one bucket per account, whether it's addressed by username
        ;; (any case) or by email
        ukey  [:user (or eid (str/lower-case ident))]
        ikey  [:ip (client-ip req)]
        fail! (fn [msg & [extra]]
                (record-attempt! ukey)
                (record-attempt! ikey)
                (jresp 401 (merge {:error msg} extra)))]
    (cond
      (str/blank? ident)
      (bad "Enter your username or email.")

      (or (limited? ukey) (limited? ikey))
      (jresp 429 {:error "Too many login attempts. Please wait a few minutes and try again."})

      :else
      (let [hash (:user/password-hash (entity db eid))]
        (cond
          (nil? eid)
          (fail! "User not found")

          ;; Accounts without a password hash were created with Google/Facebook:
          ;; they must never be able to log in with a password.
          (str/blank? hash)
          (fail! "This account uses Google or Facebook sign-in. Continue with that, or use \"Forgot password?\" to set a password."
                 {:code "oauth-only"})

          (not (check-password password hash))
          (fail! "Wrong password")

          :else
          (do (swap! login-attempts dissoc ukey)
              (login-ok eid 200)))))))

(defn handle-register [req]
  (let [{:keys [username password displayName email]} (parse-body req)
        un    (str/trim (str username))
        email (some-> email blank->nil str/lower-case)
        db    (ddb)]
    (if-let [err (or (username-error db un nil)
                     (when (< (count (str password)) min-password)
                       (str "Password must be at least " min-password " characters."))
                     (when email (email-error db email nil)))]
      (bad err)
      (let [tid "new-user"
            r   @(d/transact s/conn [(cond-> {:db/id tid
                                              :user/username un
                                              :user/xp 0
                                              :user/display-name (or (blank->nil displayName) un)
                                              :user/password-hash (hashers/derive (str password))
                                              :user/session-version 0
                                              :user/created-at (Date.)}
                                       email (assoc :user/email email))])
            eid (d/resolve-tempid (:db-after r) (:tempids r) tid)]
        (login-ok eid 201)))))

(defn handle-logout [_]
  (-> (ok {:ok true}) (assoc :session nil)))

(defn handle-logout-all
  "POST /api/account/logout-all {keepCurrent?} — invalidates every session.
   With keepCurrent=true this device gets a fresh session."
  [req]
  (with-me req
    (fn [db me-e]
      (let [{:keys [keepCurrent]} (parse-body req)
            r (tx! [(bump-session-version-tx (d/entity db me-e))])]
        (drop-realtime! (:user/username (d/entity db me-e)))
        (if keepCurrent
          (-> (ok {:ok true}) (assoc :session (session-for (:db-after r) me-e)))
          (-> (ok {:ok true}) (assoc :session nil)))))))

;; ===== PASSWORD RESET =====

(def reset-token-ttl-ms (* 60 60 1000))

(defn- random-token []
  (let [b (byte-array 32)]
    (.nextBytes (SecureRandom.) b)
    (.encodeToString (.withoutPadding (Base64/getUrlEncoder)) b)))

(defn- sha256 [^String s]
  (let [md (MessageDigest/getInstance "SHA-256")]
    (apply str (map #(format "%02x" (bit-and % 0xff))
                    (.digest md (.getBytes s StandardCharsets/UTF_8))))))

(defn- app-base-url []
  (let [u (or (System/getenv "APP_BASE_URL") "http://localhost:4200")]
    (str/replace u #"/+$" "")))

(defn deliver-reset!
  "Sends the reset link by SMTP when configured, otherwise logs it to stdout."
  [to username link]
  (cond
    ;; Production (SMTP configured) but the account has no email: there is
    ;; nobody to send it to, and the link must not end up in the server logs
    ;; (anyone who can read them could take the account over).
    (and (nil? to) (mail/configured?))
    (println "[password-reset] no email on file for" username "- nothing sent")

    (and to (mail/configured?))
    (future
      (try
        (mail/send! {:to to
                     :subject "Reset your password"
                     :body (str "Hi " username ",\n\n"
                                "We got a request to reset your password. "
                                "Open this link to choose a new one (valid for 1 hour):\n\n"
                                link "\n\n"
                                "If you didn't ask for this, you can ignore this email.\n")})
        (println "[password-reset] email sent to" to)
        (catch Exception e
          (println "[password-reset] SMTP send failed for" username ":" (.getMessage e)))))

    :else
    (println (str "[password-reset] SMTP not configured — reset link for " username ": " link))))

(defn create-reset-token!
  "Creates a single-use reset token for `eid`, returns the raw token."
  [eid]
  (let [token (random-token)]
    @(d/transact s/conn [{:reset-token/hash (sha256 token)
                          :reset-token/user eid
                          :reset-token/expires-at (Date. (+ (System/currentTimeMillis) reset-token-ttl-ms))}])
    token))

(defn handle-forgot-password
  "POST /api/password/forgot {email} (a username is accepted too). Always
   answers 200 so it can't be used to discover accounts."
  [req]
  (let [{:keys [email username]} (parse-body req)
        ident (str/trim (str (or email username "")))
        k     [:forgot (client-ip req)]
        done  (ok {:ok true
                   :message "If an account exists for that email, we've sent a link to reset your password."})]
    (cond
      (str/blank? ident) (bad "Enter your email.")
      (limited? k) (jresp 429 {:error "Too many requests. Please try again later."})
      :else
      (do (record-attempt! k)
          (let [db  (ddb)
                eid (find-user-by-login db ident)
                u   (entity db eid)
                uk  [:forgot-user eid]]
            ;; per-account cap too, so one inbox can't be flooded from many
            ;; IPs (the response stays the same either way)
            (when (and (:user/username u) (not (limited? uk)))
              (record-attempt! uk)
              (let [token (create-reset-token! eid)]
                (deliver-reset! (:user/email u) (:user/username u)
                                (str (app-base-url) "/reset-password?token=" token)))))
          done))))

(defn handle-reset-password
  "POST /api/password/reset {token, password}. Token is single-use and
   expires after an hour; all existing sessions are invalidated and this
   device is logged in."
  [req]
  (let [{:keys [token password]} (parse-body req)
        db (ddb)
        t  (when-not (str/blank? (str token))
             (entity db (d/q '[:find ?t . :in $ ?h :where [?t :reset-token/hash ?h]]
                             db (sha256 (str token)))))
        u  (some->> t :reset-token/user :db/id (d/entity db))
        invalid (bad "This link is invalid or has expired. Request a new one.")]
    (cond
      (< (count (str password)) min-password)
      (bad (str "Password must be at least " min-password " characters."))

      (or (nil? t) (nil? (:user/username u)) (:reset-token/used-at t)
          (not (.after ^Date (:reset-token/expires-at t) (Date.))))
      invalid

      :else
      (let [r (try @(d/transact s/conn [[:db/cas (:db/id t) :reset-token/used-at nil (Date.)]
                                        [:db/add (:db/id u) :user/password-hash (hashers/derive (str password))]
                                        (bump-session-version-tx u)])
                   (catch Exception _ nil))]
        (if r
          (do (drop-realtime! (:user/username u))
              (login-ok (:db/id u) 200))
          invalid)))))

;; ===== ACCOUNT SETTINGS =====

(defn- change-username-tx [db u new-un]
  (let [new-un (str/trim (str new-un))]
    (if (= new-un (:user/username u))
      {:tx []}
      (if-let [err (username-error db new-un (:db/id u))]
        {:error err}
        {:tx [[:db/add (:db/id u) :user/username new-un]]}))))

(defn- profile-tx
  "Validates profile fields present in `body`; {:error msg} or {:tx [...]}."
  [db u body]
  (let [has? #(contains? body %)
        {:keys [displayName bio website pronouns profilePic username]} body
        bio  (blank->nil bio)
        web  (normalize-website website)
        un   (when (and (has? :username) (not (str/blank? (str username))))
               (change-username-tx db u username))]
    (cond
      (:error un) un
      (> (count (str displayName)) 64) {:error "Name can be at most 64 characters."}
      (> (count (str bio)) 150) {:error "Bio can be at most 150 characters."}
      (> (count (str pronouns)) 30) {:error "Pronouns can be at most 30 characters."}
      (and web (or (> (count web) 200) (not (re-matches #"(?i)^https?://[^\s]+\.[^\s]+$" web))))
      {:error "Enter a valid website."}
      :else
      {:tx (concat (:tx un)
                   (when (has? :displayName) (set-or-retract u :user/display-name (blank->nil displayName)))
                   (when (has? :bio) (set-or-retract u :user/bio bio))
                   (when (has? :website) (set-or-retract u :user/website web))
                   (when (has? :pronouns) (set-or-retract u :user/pronouns (blank->nil pronouns)))
                   (when (has? :profilePic) (set-or-retract u :user/profile-pic (blank->nil profilePic))))})))

(defn- respond-me
  "200 with the fresh me-dto; refreshes the session (username may change).
   When the username changed, sockets registered under the old name are
   closed (the realtime registry is keyed by username, and the old name may
   be claimed by someone else)."
  [req eid]
  (let [db  (ddb)
        old (me req)]
    (when (and old (not= old (:user/username (d/entity db eid))))
      (drop-realtime! old))
    (-> (ok (me-dto db eid))
        (assoc :session (merge (:session req) (session-for db eid))))))

(defn handle-update-profile
  "PUT /api/profile {displayName, username, bio, website, pronouns, profilePic}"
  [req]
  (with-me req
    (fn [db me-e]
      (let [{:keys [error tx]} (profile-tx db (d/entity db me-e) (parse-body req))]
        (if error
          (bad error)
          (do (tx! tx) (respond-me req me-e)))))))

(defn handle-change-username [req]
  (with-me req
    (fn [db me-e]
      (let [{:keys [error tx]} (change-username-tx db (d/entity db me-e) (:username (parse-body req)))]
        (if error (bad error) (do (tx! tx) (respond-me req me-e)))))))

(defn handle-change-email [req]
  (with-me req
    (fn [db me-e]
      (let [email (some-> (:email (parse-body req)) blank->nil str/lower-case)
            u     (d/entity db me-e)]
        (if-let [err (email-error db email me-e)]
          (bad err)
          (do (tx! (set-or-retract u :user/email email))
              (respond-me req me-e)))))))

(defn handle-change-password
  "PUT /api/account/password {currentPassword, newPassword}. Accounts created
   with Google/Facebook (no password yet) can set one without currentPassword.
   Other devices are logged out; this one stays logged in."
  [req]
  (with-me req
    (fn [db me-e]
      (let [{:keys [currentPassword newPassword]} (parse-body req)
            u    (d/entity db me-e)
            hash (:user/password-hash u)]
        (cond
          (and (seq hash) (not (check-password currentPassword hash)))
          (bad "Your current password is incorrect.")

          (< (count (str newPassword)) min-password)
          (bad (str "New password must be at least " min-password " characters."))

          :else
          (do (tx! [[:db/add me-e :user/password-hash (hashers/derive (str newPassword))]
                    (bump-session-version-tx u)])
              (drop-realtime! (:user/username u))
              (respond-me req me-e)))))))

(defn- confirm-identity
  "Password accounts confirm with their password; OAuth-only accounts type
   their username."
  [u {:keys [password confirm]}]
  (if (seq (:user/password-hash u))
    (check-password password (:user/password-hash u))
    (= (str/lower-case (str/trim (str (or confirm password))))
       (str/lower-case (:user/username u)))))

(defn handle-privacy-settings
  "PUT /api/settings/privacy {isPrivate, hideActivity, messagesFrom}"
  [req]
  (with-me req
    (fn [db me-e]
      (let [body (parse-body req)
            u    (d/entity db me-e)
            mf   (:messagesFrom body)]
        (if (and (contains? body :messagesFrom) (not (#{"everyone" "followers"} mf)))
          (bad "messagesFrom must be everyone or followers")
          (let [going-public? (and (contains? body :isPrivate) (not (:isPrivate body)))
                pending (when going-public? (pending-request-ids db me-e))]
            (tx! (concat
                  (when (contains? body :isPrivate)
                    [[:db/add me-e :user/private? (boolean (:isPrivate body))]])
                  (when (contains? body :hideActivity)
                    [[:db/add me-e :user/hide-activity? (boolean (:hideActivity body))]])
                  (when (contains? body :messagesFrom)
                    [[:db/add me-e :user/message-policy (keyword mf)]])
                  ;; going public accepts every pending follow request
                  (mapcat (fn [r]
                            [[:db/add (-> (d/entity db r) :follow-request/from :db/id) :user/follows me-e]
                             [:db/retractEntity r]])
                          pending)))
            (respond-me req me-e)))))))

(defn handle-notification-settings
  "PUT /api/settings/notifications {likes, comments, follows, mentions, messages, live}"
  [req]
  (with-me req
    (fn [db me-e]
      (let [body (parse-body req)
            u    (d/entity db me-e)
            off  (set (:user/notif-off u))
            new-off (reduce (fn [acc k]
                              (if (contains? body k)
                                (if (get body k) (disj acc k) (conj acc k))
                                acc))
                            off notification-pref-keys)]
        (tx! (concat (for [k (remove new-off off)] [:db/retract me-e :user/notif-off k])
                     (for [k (remove off new-off)] [:db/add me-e :user/notif-off k])))
        (respond-me req me-e)))))

(defn handle-deactivate
  "POST /api/account/deactivate {password | confirm} — hides the account
   until the next login."
  [req]
  (with-me req
    (fn [db me-e]
      (let [u (d/entity db me-e)]
        (if-not (confirm-identity u (parse-body req))
          (bad (if (seq (:user/password-hash u)) "Incorrect password." "Type your username to confirm."))
          (do (tx! [[:db/add me-e :user/deactivated? true] (bump-session-version-tx u)])
              (drop-realtime! (:user/username u))
              (-> (ok {:ok true}) (assoc :session nil))))))))

(defn- owned-media-ids [db eid]
  (d/q '[:find [?m ...] :in $ ?u :where [?m :media/owner ?u]] db eid))

(defn delete-user-tx
  "Tx data removing a user and the content they own: posts (with their
   comments and notifications), comments, stories, notifications, activities,
   tracking entries, DMs, challenges, follow requests, reset tokens, auth
   tokens, uploaded media, post reactions, vision labels and lives. Likes,
   saves, follows, blocks etc. pointing at the user disappear with
   :db/retractEntity."
  [db eid]
  (let [by   (fn [attr v] (d/q '[:find [?x ...] :in $ ?a ?v :where [?x ?a ?v]] db attr v))
        posts (by :post/author eid)
        convs (by :conversation/participants eid)
        media (owned-media-ids db eid)
        lives (by :live/host eid)]
    (->> (concat posts
                 (mapcat #(by :comment/post %) posts)
                 (mapcat #(by :notification/post %) posts)
                 ;; reactions/labels would otherwise survive as orphans with
                 ;; their user/post ref retracted
                 (mapcat #(by :reaction/post %) posts)
                 (by :reaction/user eid)
                 (mapcat #(by :vision-label/post %) posts)
                 (mapcat #(by :vision-label/media %) media)
                 (by :vision-label/user eid)
                 media
                 (by :auth-token/user eid)
                 lives
                 (mapcat #(by :notification/live %) lives)
                 (by :comment/author eid)
                 (by :story/creator eid)
                 (by :notification/recipient eid)
                 (by :notification/actor eid)
                 (by :activity/user eid)
                 (by :tracking/user eid)
                 convs
                 (mapcat #(by :message/conversation %) convs)
                 (by :message/sender eid)
                 (by :group-message/sender eid)
                 (by :challenge/challenger eid)
                 (by :challenge/target eid)
                 (by :follow-request/from eid)
                 (by :follow-request/to eid)
                 (by :reset-token/user eid)
                 [eid])
         distinct
         (mapv (fn [x] [:db/retractEntity x])))))

(defn handle-delete-account
  "POST /api/account/delete {password | confirm} (also DELETE /api/users/:username)."
  [req]
  (with-me req
    (fn [db me-e]
      (let [u        (d/entity db me-e)
            param-un (get-in req [:path-params :username])]
        (cond
          (and param-un (not= param-un (:user/username u))) (forbidden)
          (not (confirm-identity u (parse-body req)))
          (bad (if (seq (:user/password-hash u)) "Incorrect password." "Type your username to confirm."))
          :else
          (do (doseq [l (d/q '[:find [?l ...] :in $ ?h :where [?l :live/host ?h] [?l :live/status :active]] db me-e)]
                (try ((requiring-resolve 'web.live/end-live!) l)
                     (catch Throwable e (println "[accounts] ending live failed:" (.getMessage e)))))
              (let [db    (ddb)
                    media (owned-media-ids db me-e)]
                (tx! (delete-user-tx db me-e))
                ;; uploaded files (local disk / S3) go too; read keys from
                ;; the db value from before the retraction
                (try ((requiring-resolve 'web.media/delete-stored-files!) db media)
                     (catch Throwable e (println "[accounts] deleting media files failed:" (.getMessage e)))))
              (drop-realtime! (:user/username u))
              (-> (ok {:ok true}) (assoc :session nil))))))))

;; ===== PROFILE =====

(defn- follower-ids [db eid]
  (d/q '[:find [?f ...] :in $ ?u :where [?f :user/follows ?u]] db eid))

(defn- visible-ids
  "Drops deactivated users and users in a block relationship with the viewer."
  [db viewer-e ids]
  (let [deact (deactivated-ids db)]
    (remove #(or (and (contains? deact %) (not= % viewer-e))
                 (and viewer-e (blocked-either? db viewer-e %)))
            ids)))

(defn handle-get-profile [req]
  (let [db    (ddb)
        eid   (path-user db req)
        u     (entity db eid)
        me-e  (some->> (me req) (user-e db))
        mine? (and me-e (= me-e eid))]
    (if (or (nil? (:user/username u))
            (and (not mine?) (:user/deactivated? u))
            (and me-e (blocks? db eid me-e)))
      (not-found)
      (let [followers (visible-ids db me-e (follower-ids db eid))
            following (visible-ids db me-e (ref-ids u :user/follows))
            my-follows (if me-e (ref-ids (d/entity db me-e) :user/follows) #{})
            mutual    (if (and me-e (not mine?)) (filter my-follows followers) [])
            status    (if me-e (follow-status db me-e eid) "none")
            ;; archived posts are hidden from the grid, so they don't count
            posts     (or (d/q '[:find (count ?p) . :in $ ?u
                                 :where [?p :post/author ?u]
                                 (not [?p :post/archived true])]
                               db eid) 0)]
        (ok (merge (user-dto u)
                   {:followersCount  (count followers)
                    :followingCount  (count following)
                    :postsCount      posts
                    :isFollowing     (= status "following")
                    :followStatus    status
                    :followsYou      (boolean (and me-e (follows? db eid me-e)))
                    :isMe            (boolean mine?)
                    :canViewPosts    (can-view-posts? db me-e eid)
                    :blocked         (boolean (blocks? db me-e eid))
                    :muted           (muted? db me-e eid)
                    :restricted      (restricted? db me-e eid)
                    :closeFriend     (close-friend? db me-e eid)
                    :mutualFollowers (mapv #(author-dto (d/entity db %)) (take 3 mutual))
                    :mutualCount     (count mutual)}))))))

;; ===== FOLLOW =====

(defn- follow!
  "Follows `t-e`, or sends a follow request when the account is private.
   Returns the new follow status."
  [db me-e t-e]
  (let [me-un (:user/username (d/entity db me-e))]
    (if (:user/private? (d/entity db t-e))
      (do (when-not (requested? db me-e t-e)
            (tx! [{:follow-request/key (request-key me-e t-e)
                   :follow-request/from me-e
                   :follow-request/to t-e
                   :follow-request/created-at (Date.)}])
            (notify! t-e :follow-request (str me-un " requested to follow you") {:actor-e me-e}))
          "requested")
      (do (tx! [[:db/add me-e :user/follows t-e]])
          (notify! t-e :follow (str me-un " started following you") {:actor-e me-e})
          "following"))))

(defn- unfollow! [db me-e t-e]
  (tx! (concat (when (follows? db me-e t-e) [[:db/retract me-e :user/follows t-e]])
               (when-let [r (request-id db me-e t-e)] [[:db/retractEntity r]])))
  "none")

(defn handle-toggle-follow
  "POST /api/follow {username} — follow / unfollow / request / cancel request.
   Response: {action: followed|unfollowed|requested|cancelled, followStatus}."
  [req]
  (with-me req
    (fn [db me-e]
      (let [t-e (find-user db (:username (parse-body req)))
            t   (entity db t-e)]
        (cond
          (or (not (active-user? t)) (blocks? db t-e me-e)) (not-found)
          (= t-e me-e) (bad "You can't follow yourself.")
          (blocks? db me-e t-e) (bad "Unblock this account to follow it.")
          :else
          (let [before (follow-status db me-e t-e)]
            (if (= before "none")
              (let [st (follow! db me-e t-e)]
                (ok {:action (if (= st "requested") "requested" "followed") :followStatus st}))
              (do (unfollow! db me-e t-e)
                  (ok {:action (if (= before "requested") "cancelled" "unfollowed")
                       :followStatus "none"})))))))))

(defn- relationship-list [req ids-fn]
  (let [db   (ddb)
        eid  (path-user db req)
        me-e (some->> (me req) (user-e db))
        q    (str/lower-case (str/trim (str (get-in req [:query-params "q"] ""))))]
    (cond
      (or (nil? eid) (and me-e (blocks? db eid me-e))) (not-found)
      (not (can-view-posts? db me-e eid)) (forbidden)
      :else
      (let [ids  (visible-ids db me-e (ids-fn db eid))
            dtos (->> ids
                      (map #(list-user-dto db me-e %))
                      (filter #(or (str/blank? q)
                                   (str/includes? (str/lower-case (str (:username %))) q)
                                   (str/includes? (str/lower-case (str (:displayName %))) q)))
                      (sort-by (juxt (comp not :isMe) #(str/lower-case (str (:username %))))))]
        (ok (vec (take 500 dtos)))))))

(defn handle-user-followers "GET /api/users/:username/followers?q=" [req]
  (relationship-list req follower-ids))

(defn handle-user-following "GET /api/users/:username/following?q=" [req]
  (relationship-list req (fn [db e] (ref-ids (d/entity db e) :user/follows))))

(defn- legacy-names [req ids-fn]
  (let [db   (ddb)
        eid  (path-user db req)
        me-e (some->> (me req) (user-e db))]
    (ok (if (and eid (can-view-posts? db me-e eid))
          (mapv #(:user/username (d/entity db %)) (visible-ids db me-e (ids-fn db eid)))
          []))))

(defn handle-get-followers "Legacy: GET /api/followers/:username → [username]" [req]
  (legacy-names req follower-ids))

(defn handle-get-following "Legacy: GET /api/following/:username → [username]" [req]
  (legacy-names req (fn [db e] (ref-ids (d/entity db e) :user/follows))))

(defn handle-remove-follower "POST /api/followers/:username/remove" [req]
  (with-me req
    (fn [db me-e]
      (if-let [f-e (path-user db req)]
        (do (tx! (when (follows? db f-e me-e) [[:db/retract f-e :user/follows me-e]]))
            (ok {:ok true}))
        (not-found)))))

;; ===== FOLLOW REQUESTS =====

(defn handle-follow-requests "GET /api/follow-requests" [req]
  (with-me req
    (fn [db me-e]
      (ok (->> (pending-request-ids db me-e)
               (map #(d/entity db %))
               (filter #(active-user? (:follow-request/from %)))
               (sort-by #(:follow-request/created-at %) #(compare %2 %1))
               (mapv (fn [r]
                       {:id        (str (:db/id r))
                        :user      (list-user-dto db me-e (-> r :follow-request/from :db/id))
                        :createdAt (instant->str (:follow-request/created-at r))})))))))

(defn- respond-request [req accept?]
  (with-me req
    (fn [db me-e]
      (let [from-e (path-user db req)
            r      (when from-e (request-id db from-e me-e))]
        (if-not r
          (not-found)
          (do (tx! (cond-> [[:db/retractEntity r]]
                     accept? (conj [:db/add from-e :user/follows me-e])))
              (when accept?
                (notify! from-e :follow-accept
                         (str (:user/username (d/entity db me-e)) " accepted your follow request")
                         {:actor-e me-e}))
              (ok {:ok true :accepted accept?})))))))

(defn handle-accept-request "POST /api/follow-requests/:username/accept" [req]
  (respond-request req true))

(defn handle-decline-request "POST /api/follow-requests/:username/decline" [req]
  (respond-request req false))

;; ===== BLOCK / MUTE / RESTRICT / CLOSE FRIENDS =====

(defn- relation-list-handler [attr]
  (fn [req]
    (with-me req
      (fn [db me-e]
        (ok (->> (ref-ids (d/entity db me-e) attr)
                 (filter #(:user/username (d/entity db %)))
                 (map #(list-user-dto db me-e %))
                 (sort-by #(str/lower-case (str (:username %))))
                 vec))))))

(defn- block-tx [db me-e t-e]
  (let [r1 (request-id db me-e t-e)
        r2 (request-id db t-e me-e)]
    (cond-> [[:db/add me-e :user/blocks t-e]]
      (follows? db me-e t-e) (conj [:db/retract me-e :user/follows t-e])
      (follows? db t-e me-e) (conj [:db/retract t-e :user/follows me-e])
      (close-friend? db me-e t-e) (conj [:db/retract me-e :user/close-friends t-e])
      (close-friend? db t-e me-e) (conj [:db/retract t-e :user/close-friends me-e])
      r1 (conj [:db/retractEntity r1])
      r2 (conj [:db/retractEntity r2]))))

(defn- relation-add-handler [attr]
  (fn [req]
    (with-me req
      (fn [db me-e]
        (let [t-e (path-user db req)]
          (cond
            (nil? t-e) (not-found)
            (= t-e me-e) (bad "You can't do that to yourself.")
            (and (not= attr :user/blocks) (blocked-either? db me-e t-e)) (not-found)
            :else
            (do (tx! (if (= attr :user/blocks)
                       (block-tx db me-e t-e)
                       [[:db/add me-e attr t-e]]))
                (when (= attr :user/blocks)
                  ;; a blocked viewer must not keep watching my live (or I theirs)
                  (try ((requiring-resolve 'web.live/enforce-access!) (:user/username (d/entity db me-e)))
                       (catch Throwable e (println "[accounts] live access check failed:" (.getMessage e)))))
                (ok {:ok true}))))))))

(defn- relation-remove-handler [attr]
  (fn [req]
    (with-me req
      (fn [db me-e]
        (if-let [t-e (path-user db req)]
          (do (tx! (when (contains? (ref-ids (d/entity db me-e) attr) t-e)
                     [[:db/retract me-e attr t-e]]))
              (ok {:ok true}))
          (not-found))))))

;; ===== SUGGESTED =====

(defn handle-suggested
  "GET /api/users/suggested?limit= — friends of friends (most mutual first),
   then popular accounts. Excludes self, followed/requested, blocked, muted,
   deactivated."
  [req]
  (with-me req
    (fn [db me-e]
      (let [limit    (min 50 (max 1 (or (some-> (get-in req [:query-params "limit"]) parse-long) 20)))
            me-ent   (d/entity db me-e)
            follows  (ref-ids me-ent :user/follows)
            requested (set (d/q '[:find [?t ...] :in $ ?me
                                  :where [?r :follow-request/from ?me] [?r :follow-request/to ?t]]
                                db me-e))
            excluded (-> (hidden-author-ids db me-e) (into follows) (into requested) (conj me-e))
            fof      (->> (d/q '[:find ?c (count-distinct ?f) :in $ ?me
                                 :where [?me :user/follows ?f] [?f :user/follows ?c]]
                               db me-e)
                          (remove (comp excluded first))
                          (sort-by (comp - second)))
            popular  (->> (d/q '[:find ?u (count ?f) :where [?f :user/follows ?u]] db)
                          (remove (comp excluded first))
                          (sort-by (comp - second))
                          (map first))
            rest-all (->> (d/q '[:find ?u ?xp :where [?u :user/username] [(get-else $ ?u :user/xp 0) ?xp]] db)
                          (remove (comp excluded first))
                          (sort-by (comp - second))
                          (map first))
            fof-ids  (set (map first fof))
            ordered  (distinct (concat (map first fof) popular rest-all))
            reason   (fn [c]
                       (if (fof-ids c)
                         (let [via (d/q '[:find [?f ...] :in $ ?me ?c
                                          :where [?me :user/follows ?f] [?f :user/follows ?c]]
                                        db me-e c)
                               n   (count via)]
                           (str "Followed by " (:user/username (d/entity db (first via)))
                                (when (> n 1) (str " + " (dec n) " more"))))
                         (if (follows? db c me-e) "Follows you" "Popular")))]
        (ok (mapv (fn [c] (assoc (list-user-dto db me-e c) :reason (reason c)))
                  (take limit ordered)))))))

;; ===== ROUTES =====

(def routes
  [["/api/me"                  {:get handle-me}]
   ["/api/login"               {:post handle-login}]
   ["/api/register"            {:post handle-register}]
   ["/api/logout"              {:post handle-logout}]
   ["/api/password/forgot"     {:post handle-forgot-password}]
   ["/api/password/reset"      {:post handle-reset-password}]

   ["/api/profile"             {:put handle-update-profile}]
   ["/api/account/username"    {:put handle-change-username}]
   ["/api/account/email"       {:put handle-change-email}]
   ["/api/account/password"    {:put handle-change-password}]
   ["/api/account/deactivate"  {:post handle-deactivate}]
   ["/api/account/delete"      {:post handle-delete-account}]
   ["/api/account/logout-all"  {:post handle-logout-all}]
   ["/api/settings/privacy"    {:put handle-privacy-settings}]
   ["/api/settings/notifications" {:put handle-notification-settings}]

   ;; must precede /api/users/:username (conflicting routes match in order)
   ["/api/users/suggested"     {:get handle-suggested}]
   ["/api/users/:username"     {:get handle-get-profile :delete handle-delete-account}]
   ["/api/users/:username/followers" {:get handle-user-followers}]
   ["/api/users/:username/following" {:get handle-user-following}]

   ["/api/follow"              {:post handle-toggle-follow}]
   ["/api/followers/:username" {:get handle-get-followers}]
   ["/api/followers/:username/remove" {:post handle-remove-follower}]
   ["/api/following/:username" {:get handle-get-following}]
   ["/api/follow-requests"     {:get handle-follow-requests}]
   ["/api/follow-requests/:username/accept"  {:post handle-accept-request}]
   ["/api/follow-requests/:username/decline" {:post handle-decline-request}]

   ["/api/blocks"              {:get (relation-list-handler :user/blocks)}]
   ["/api/blocks/:username"    {:post (relation-add-handler :user/blocks)
                                :delete (relation-remove-handler :user/blocks)}]
   ["/api/mutes"               {:get (relation-list-handler :user/mutes)}]
   ["/api/mutes/:username"     {:post (relation-add-handler :user/mutes)
                                :delete (relation-remove-handler :user/mutes)}]
   ["/api/restricts"           {:get (relation-list-handler :user/restricts)}]
   ["/api/restricts/:username" {:post (relation-add-handler :user/restricts)
                                :delete (relation-remove-handler :user/restricts)}]
   ["/api/close-friends"       {:get (relation-list-handler :user/close-friends)}]
   ["/api/close-friends/:username" {:post (relation-add-handler :user/close-friends)
                                    :delete (relation-remove-handler :user/close-friends)}]])
