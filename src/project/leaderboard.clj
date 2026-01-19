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
        sorted-users-with-xp (sort-by :user/xp > users-with-xp)
        ]
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

(defn leaderboard-delta [old-lb new-lb]
  (let [old-ranks (into {} (map (fn[{:user/keys [username] :keys [rank]}]
                               [username rank])
                             old-lb))
        new-ranks (into {} (map (fn [{:user/keys [username] :keys [rank]}]
                               [username rank])
                             new-lb))]
    (map (fn [username]
           (let [old-r (get old-ranks username)
                 new-r (get new-ranks username)]
             {:user/username username
              :delta (- old-r new-r)}))
         (keys new-ranks))))

(defn leaderboard [db period date]

  (let [
        previous-date (case period
                        :daily (.minusDays date 1)
                        :weekly (.minusWeeks date 1)
                        :monthly (.minusMonths date 1)
                        date)
        old-lb (leaderboard-rank-ties db period date)
        new-lb (leaderboard-rank-ties db period previous-date)
        delta (leaderboard-delta old-lb new-lb)
        delta-map (into {} (map (fn [{:user/keys [username] :keys [delta]}]
                                  [username delta])
                                delta))
        ]
    (map (fn [user-rank]
           (assoc user-rank :delta (get delta-map (:user/username user-rank) 0)))
         new-lb)))
















