(ns project.uredno-test
  (:require [midje.sweet :refer :all]
            [project.db :as db]
            [project.leaderboard :as lb]
            [datomic.api :as d]
            [database.schema :as schema]
            [database.seed :as seed])
  (:import (java.time.temporal TemporalAdjusters)
           (java.util Date)
           (java.time ZonedDateTime LocalDate ZoneId)
           (java.time Instant LocalDate DayOfWeek MonthDay YearMonth ZoneId)))

(def test-uri "datomic:mem://bebetter-test")

(defn fresh-conn []
  (let [uri test-uri]
    (d/delete-database uri)
    (d/create-database uri)
    (let [conn (d/connect uri)]
      @(d/transact conn schema/all-schemas)
      @(d/transact conn seed/initial-type-activities)
      @(d/transact conn db/get-all-tx-functions)
      conn)))

(fact "user get xp from activity"
      (let [conn (fresh-conn)
            db (d/db conn)]
        (db/create-user! conn "Test")
        (db/add-activity! conn "Test" :training 60 3)
        (reduce (fn [acc elm] (+ acc elm)) (map :user/xp (db/get-all-users (d/db conn))))
        => pos?))

(defn find-user [db username]
  (first
   (filter #(= (:user/username %) username)
           (db/get-all-users db))))

(fact "user gets xp from activity"
      (let [conn (fresh-conn)]
        (db/create-user! conn "Test")
        (db/add-activity! conn "Test" :training 60 3)
        (:user/xp (find-user (d/db conn) "Test"))
        => pos?))

(fact "leaderboard sort users by xp desc"
      (let [conn (fresh-conn)
            _ (db/create-user! conn "A")
            _ (db/create-user! conn "B")
            _ (db/create-user! conn "C")
            _ (db/add-activity! conn "A" :training 60 2)
            _ (db/add-activity! conn "B" :training 60 3)
            _ (db/add-activity! conn "C" :training 60 1)
            lb (lb/leaderboard (d/db conn) :daily (LocalDate/now))]
        (map :user/username lb))
      => ["B" "A" "C"])


























