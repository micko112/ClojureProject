(ns project.api
  (:require [project.system :refer [conn]]
            [project.db :as db]
            [project.leaderboard :as lb]
            [datomic.api :as d]
            [project.time :as t]
            [project.validation :as v])
  (:import (java.time LocalDate)))

(defn log-activity! [username a-key duration intensity]
  (db/add-activity! conn username a-key duration intensity))

(defn register-user! [username]
  (v/validate! v/Username username)
  (db/create-user! conn username))

(defn get-user-profile [username]
  (v/validate! v/Username username)
  (db/get-user-by-name (d/db conn) username))

(defn get-leaderboard
  "Leaderboard prima :daily, :weekly, :monthly, :all"
  [period]
  (v/validate! v/Period period)
  (lb/leaderboard (d/db conn) period (LocalDate/now)))

(defn get-daily-report [username]
  #_(v/validate! v/Report-input {:username username
                               :period period})
  (let [db (d/db conn)
        today (LocalDate/now)]
    (db/get-activities-in-interval db username (:start-day (t/day-interval today))
                                                (:end-day (t/day-interval today)))))

; HOCU DA DODAM FN KOJA RADI REPORT ALI PO DANIMA, STAVIM PERIOD I STAVI MI PO DANIMA
; STA JE KORISNIK RADIO, AKTIVNOSTI I DAILY-XP I NA KRAJU UKUPNO XP


