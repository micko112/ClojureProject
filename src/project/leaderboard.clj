(ns project.leaderboard
  (:require [project.db :as db]
            [datomic.api :as d]
            [project.connection :refer [conn]]
            [project.time :as t]
            [clojure.pprint :refer [print-table]])
  (:import (java.time.temporal TemporalAdjusters)
           (java.util Date)
           (java.time ZonedDateTime LocalDate ZoneId)
           (java.time Instant LocalDate DayOfWeek MonthDay YearMonth ZoneId)))

(defn desc [a b] ; nasao sam na guglu kako se sortira od najveceg ka najmanjem.
  (compare b a))

(defn leaderboard-rank-ties [db period date]
  (let [users (db/get-all-users db)
        users-with-xp (map (fn [user]
                             {:user/username (:user/username user)
                              :user/xp (db/xp-per-user db (:user/username user) period date)})
                           users)
        sorted-users-with-xp (sort-by :user/xp > users-with-xp)]
    (loop [users-left sorted-users-with-xp
           result []
           current-rank 1
           prev-xp nil
           same-count 0]
      (if (empty? users-left)
        result
        (let [user (first users-left)
              user-xp (:user/xp user)]
          (if (= user-xp prev-xp)
            (recur (rest users-left)
                   (conj result (assoc user :rank current-rank))
                   current-rank
                   user-xp
                   (inc same-count))
            (let [new-rank (+ current-rank same-count)]
              (recur (rest users-left)
                     (conj result (assoc user :rank new-rank))
                     new-rank
                     user-xp
                     1))))))))

; leaderboard delta pokazuje koliko je koji user promenio rank
(defn get-all-names [lb]
  (let [names (map (fn [{:user/keys [username]}]
                     username) lb)]
    names))
(defn new-user-check [old-lb new-lb]
  (let [old-names (set (get-all-names old-lb)) new-names (set (get-all-names new-lb))]
    (filter (complement old-names) new-names)))

(defn leaderboard-delta-edge-case [old-lb new-lb]
  (let [old-ranks (into {} (map (fn [{:user/keys [username] :keys [rank]}]
                                  [username rank])
                                old-lb))
        new-ranks (into {} (map (fn [{:user/keys [username] :keys [rank]}]
                                  [username rank])
                                new-lb))
        new-users (set (new-user-check old-lb new-lb))
        last-old-rank (if (seq old-ranks)
                        (apply max (vals old-ranks))
                        0)]
    (map (fn [username]
           (let [old-r (get old-ranks username)
                 new-r (get new-ranks username)]
             (cond
               (new-users username)
               {:user/username username
                :delta (- (inc last-old-rank) new-r)}

               (and old-r new-r)
               {:user/username username
                :delta (- old-r new-r)}

               :else
               {:user/username username
                :delta 0})))
         (keys new-ranks))))

(defn leaderboard [db period date]

  (let [previous-date (case period
                        :daily (.minusDays date 1)
                        :weekly (.minusWeeks date 1)
                        :monthly (.minusMonths date 1)
                        date)
        old-lb (leaderboard-rank-ties db period previous-date)
        new-lb (leaderboard-rank-ties db period date)
        delta (leaderboard-delta-edge-case old-lb new-lb)
        delta-map (into {} (map (fn [{:user/keys [username] :keys [delta]}]
                                  [username delta])
                                delta))]
    (map (fn [user-rank]
           (assoc user-rank :delta (get delta-map (:user/username user-rank) 0)))
         new-lb)))
















