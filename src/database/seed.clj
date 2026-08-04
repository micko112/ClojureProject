(ns database.seed
  (:require [buddy.hashers :as hashers]))

(def default-pw (hashers/derive "password123"))

(def users
  [{:user/username "Micko"  :user/xp 0 :user/display-name "Micko"  :user/password-hash default-pw}
   {:user/username "Uros"   :user/xp 0 :user/display-name "Uros"   :user/password-hash default-pw}
   {:user/username "Milan"  :user/xp 0 :user/display-name "Milan"  :user/password-hash default-pw}
   {:user/username "Pavel"  :user/xp 0 :user/display-name "Pavel"  :user/password-hash default-pw}
   {:user/username "Toda"   :user/xp 0 :user/display-name "Toda"   :user/password-hash default-pw}
   {:user/username "Vule"   :user/xp 0 :user/display-name "Vule"   :user/password-hash default-pw}])

(def initial-type-activities
  [{:activity-type/key :running     :activity-type/name "Running"     :activity-type/xp-per-minute 2.0}
   {:activity-type/key :gym         :activity-type/name "Gym"         :activity-type/xp-per-minute 2.0}
   {:activity-type/key :cycling     :activity-type/name "Cycling"     :activity-type/xp-per-minute 2.0}
   {:activity-type/key :swimming    :activity-type/name "Swimming"    :activity-type/xp-per-minute 2.0}
   {:activity-type/key :yoga        :activity-type/name "Yoga"        :activity-type/xp-per-minute 1.5}
   {:activity-type/key :reading     :activity-type/name "Reading"     :activity-type/xp-per-minute 1.5}
   {:activity-type/key :coding      :activity-type/name "Coding"      :activity-type/xp-per-minute 2.0}
   {:activity-type/key :studying    :activity-type/name "Studying"    :activity-type/xp-per-minute 1.5}
   {:activity-type/key :meditation  :activity-type/name "Meditation"  :activity-type/xp-per-minute 1.5}
   {:activity-type/key :cooking     :activity-type/name "Cooking"     :activity-type/xp-per-minute 1.0}
   {:activity-type/key :drawing     :activity-type/name "Drawing"     :activity-type/xp-per-minute 1.5}
   {:activity-type/key :writing     :activity-type/name "Writing"     :activity-type/xp-per-minute 1.5}
   {:activity-type/key :music       :activity-type/name "Music"       :activity-type/xp-per-minute 1.5}
   {:activity-type/key :walking     :activity-type/name "Walking"     :activity-type/xp-per-minute 1.0}
   {:activity-type/key :socializing :activity-type/name "Socializing" :activity-type/xp-per-minute 1.0}])

(def all-seed-data (concat users initial-type-activities))
