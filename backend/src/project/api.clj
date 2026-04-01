(ns project.api
  (:require [project.system :refer [conn]]
            [project.db :as db]
            [project.leaderboard :as lb]
            [datomic.api :as d]
            [project.time :as t]
            [project.validation :as v])
  (:import (java.time LocalDate)))

;; ── Activities ───────────────────────────────────────────────────────────────

(defn log-activity! [username a-key duration intensity start-time]
  (db/add-activity! conn username a-key duration intensity start-time))

(defn get-daily-report [username date]
  (v/validate! v/Report-input {:username username})
  (db/report-daily-in-period (d/db conn) username date))

(defn delete-activity! [activity-id]
  (db/delete-activity! conn (d/db conn) activity-id))

(defn get-activity-types []
  (db/get-activity-types (d/db conn)))

;; ── Users ────────────────────────────────────────────────────────────────────

(defn register-user! [username]
  (v/validate! v/Username username)
  (db/create-user! conn username))

(defn get-user-profile [username]
  (v/validate! v/Username username)
  (db/get-user-by-name (d/db conn) username))

(defn get-all-users []
  (map (fn [u] {:username (:user/username u) :xp (:user/xp u)})
       (db/get-all-users (d/db conn))))

;; ── Leaderboard ──────────────────────────────────────────────────────────────

(defn get-leaderboard [period date]
  (v/validate! v/Period period)
  (lb/leaderboard (d/db conn) period date))

;; ── Feed ─────────────────────────────────────────────────────────────────────

(defn- row->feed-item [[username start-time type-name dur int xpm]]
  {:username username
   :date     (str (.toLocalDate (t/instant->local start-time)))
   :time     (str (.toLocalTime (t/instant->local start-time)))
   :type     type-name
   :duration dur
   :intensity int
   :xp       (* dur int xpm)})

(defn get-feed
  "Vraca feed za period. period moze biti :daily ili :weekly."
  [date period]
  (let [{:keys [start-day end-day]} (case period
                                      :weekly  (t/week-interval date)
                                      (t/day-interval date))
        rows (db/get-feed-activities (d/db conn) start-day end-day)]
    (mapv row->feed-item rows)))

;; ── Reactions ────────────────────────────────────────────────────────────────

(defn toggle-reaction! [from-username to-username date-str emoji]
  (db/toggle-reaction! conn (d/db conn) from-username to-username date-str emoji))

(defn get-reactions-for-date [date-str]
  "Vraca map: {to-username {emoji #{from-usernames}}}"
  (let [rows (db/get-reactions-for-date (d/db conn) date-str)]
    (reduce (fn [acc [from-name to-name emoji]]
              (update-in acc [to-name emoji] (fnil conj #{}) from-name))
            {}
            rows)))

(defn get-reactions-for-period [start-date-str end-date-str]
  "Vraca map: {to-username {date {emoji #{from-usernames}}}}"
  (let [rows (db/get-reactions-for-period (d/db conn) start-date-str end-date-str)]
    (reduce (fn [acc [from-name to-name date emoji]]
              (update-in acc [to-name date emoji] (fnil conj #{}) from-name))
            {}
            rows)))

;; ── Posts ────────────────────────────────────────────────────────────────────

(defn create-post! [username content activity-tag]
  (db/create-post! conn (d/db conn) username content activity-tag))

(defn get-posts
  ([limit] (get-posts limit nil))
  ([limit username]
   (mapv (fn [p]
           {:id          (:db/id p)
            :username    (get-in p [:post/author :user/username])
            :content     (:post/content p)
            :activityTag (:post/activity-tag p)
            :createdAt   (str (:post/created-at p))
            :likes       (mapv #(get-in % [:user/username]) (:post/liked-by p))})
         (db/get-recent-posts (d/db conn) (or limit 30) username))))

(defn toggle-post-like! [post-id username]
  (db/toggle-post-like! conn (d/db conn) post-id username))

;; ── Stats ─────────────────────────────────────────────────────────────────────

(defn get-user-stats [username]
  (let [db    (d/db conn)
        today (LocalDate/now)
        week  (t/week-interval today)
        month (t/month-interval today)
        week-rows  (db/get-activities-in-interval db username (:start-day week)  (:end-day week))
        month-rows (db/get-activities-in-interval db username (:start-day month) (:end-day month))]
    {:streak              (db/calculate-streak db username)
     :totalXp             (:user/xp (db/get-user-by-name db username))
     :weeklyXp            (db/calculate-xp-from-rows week-rows)
     :monthlyXp           (db/calculate-xp-from-rows month-rows)
     :activeDaysThisWeek  (db/count-active-days db username (:start-day week)  (:end-day week))
     :activeDaysThisMonth (db/count-active-days db username (:start-day month) (:end-day month))
     :xpByType            (db/get-xp-by-type db username (:start-day month) (:end-day month))}))
