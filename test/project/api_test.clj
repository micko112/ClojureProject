(ns project.api-test
  (:require
   [project.db :as db]
   [project.leaderboard :as lb]
   [datomic.api :as d]
   [database.schema :as schema]
   [database.seed :as seed]
   [project.api :as api]
   [clojure.test :refer :all])

  (:import (java.time.temporal TemporalAdjusters)
           (java.util Date)
           (java.time ZonedDateTime LocalDate ZoneId)
           (java.time Instant LocalDate DayOfWeek MonthDay YearMonth ZoneId)))

(def old-lb
  [{:user/username "A" :rank 1}
   {:user/username "B" :rank 2}
   {:user/username "C" :rank 3}])
(def new-lb
  [{:user/username "A" :rank 2}
   {:user/username "B" :rank 4}
   {:user/username "C" :rank 3}
   {:user/username "D" :rank 1}])
(def users
  [{:user/username "A" :user/xp 300}
   {:user/username "B" :user/xp 200}
   {:user/username "C" :user/xp 150}])

(def fake-db
  {:users
   users})

(deftest leaderboard-rank-ties-test
  (with-redefs
   [project.db/get-all-users
    (fn [_]
      [{:user/username "A"}
       {:user/username "B"}
       {:user/username "C"}])

    project.db/xp-per-user
    (fn [_ username _ _]
      ({"A" 300 "B" 200 "C" 150} username))]

    (is (= (lb/leaderboard-rank-ties ::db :daily ::date)
           [{:user/username "A" :user/xp 300 :rank 1}
            {:user/username "B" :user/xp 200 :rank 2}
            {:user/username "C" :user/xp 150 :rank 3}]))))
(deftest leaderboard-rank-ties-test
  (with-redefs
   [project.db/get-all-users
    (fn [_]
      [{:user/username "A"}
       {:user/username "B"}
       {:user/username "C"}])

    project.db/xp-per-user
    (fn [_ username _ _]
      ({"A" 300 "B" 300 "C" 150} username))]

    (is (= (lb/leaderboard-rank-ties ::db :daily ::date)
           [{:user/username "A" :user/xp 300 :rank 1}
            {:user/username "B" :user/xp 300 :rank 1}
            {:user/username "C" :user/xp 150 :rank 3}]))))

(deftest delta-test
  (is (= (lb/leaderboard-delta-edge-case old-lb new-lb)
         [{:user/username "A" :delta -1}
          {:user/username "B" :delta -2}
          {:user/username "C" :delta 0}
          {:user/username "D" :delta 3}])))


