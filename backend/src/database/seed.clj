(ns database.seed
  (:require [datomic.api :as d]))

; ovako se update/insert nesto
#_{:db/id [:activity-type/key :work]
   :activity-type/name "Work"
   :activity-type/xp-per-minute 8}
(def users [{:user/username "Micko"
             :user/xp 0}
            {:user/username "Uros"
             :user/xp 0}
            {:user/username "Milan"
             :user/xp 0}
            {:user/username "Pavel"
             :user/xp 0}
            {:user/username "Toda"
             :user/xp 0}
            {:user/username "Vule"
             :user/xp 0}])

(def initial-type-activities
  [{:activity-type/key :training
    :activity-type/name "Training"
    :activity-type/xp-per-minute 10}
   {:activity-type/key :study
    :activity-type/name "Study"
    :activity-type/xp-per-minute 6}
   {:activity-type/key :coding
    :activity-type/name "Coding"
    :activity-type/xp-per-minute 8}
   {:activity-type/key :work
    :activity-type/name "Work"
    :activity-type/xp-per-minute 8}
   {:activity-type/key :hobby
    :activity-type/name "Hobby / Yard work"
    :activity-type/xp-per-minute 7}])

(def all-seed-data (concat users initial-type-activities))