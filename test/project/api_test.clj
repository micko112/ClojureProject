(ns project.api-test
  (:require [midje.sweet :refer :all]
            [project.db :as db]
            [project.leaderboard :as lb]
            [datomic.api :as d]
            [database.schema :as schema]
            [database.seed :as seed]
            [project.api :as api]
            )
  (:import (java.time.temporal TemporalAdjusters)
           (java.util Date)
           (java.time ZonedDateTime LocalDate ZoneId)
           (java.time Instant LocalDate DayOfWeek MonthDay YearMonth ZoneId)))

(def old-lb
  [{:user/username "A" :rank 1}
   {:user/username "B" :rank 2}
    {:user/username "C" :rank 3}
   ])
(def new-lb
  [{:user/username "A" :rank 2}
   {:user/username "B" :rank 4}
    {:user/username "C" :rank 3}
   {:user/username "D" :rank 1}
   ])
(def users
  [{:user/username "A" :user/xp 300}
   {:user/username "B" :user/xp 200}
    {:user/username "C" :user/xp 150}

   ])
()
(fact "test delta funkcije"
  (let [delta (lb/leaderboard-delta-edge-case old-lb new-lb)]
    delta)
  => [{:user/username "A" :delta -1 }
      {:user/username "B" :delta -2 }
      {:user/username "C" :delta 0 }
      {:user/username "D" :delta 3 }]
)

(fact "New user check"
      (lb/new-user-check old-lb new-lb)
      => )

(defn new-user-check [old-lb new-lb]
  (let [old-names (set(lb/get-all-names old-lb)) new-names (set(lb/get-all-names new-lb))]
    (filter (complement old-names) new-names))

)

(fact "test leaderboard unit fn"
      (let []))



