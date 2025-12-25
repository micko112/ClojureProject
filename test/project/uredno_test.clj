(ns project.uredno-test
  (:require [midje.sweet :refer :all]
            [project.uredno :as u]))


(def sample-users [{:name "Uros" :xp 130 :level 1}
                   {:name "Micko" :xp 70 :level 1}
                   {:name "Milan" :xp 40 :level 0}
                   {:name "Trener" :xp 2400 :level 9}])
(facts "filter by level"
       (fact "return user with defined level"
             (map :name (u/filter-by-level sample-users 1))
             => ["Uros" "Micko"])
       )

