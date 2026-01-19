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
  (lb/leaderboard-rank-ties (d/db conn) period (LocalDate/now)))

(defn get-daily-report [username date]
  (v/validate! v/Report-input {:username username})
  (db/report-daily-in-period (d/db conn) username date))

; HOCU DA DODAM FN KOJA RADI REPORT ALI PO DANIMA, STAVIM PERIOD I STAVI MI PO DANIMA
; STA JE KORISNIK RADIO, AKTIVNOSTI I DAILY-XP I NA KRAJU UKUPNO XP

; vraca mapu: VREME (odnosno dan kad je aktivnost), A-NAME, DURATION, INTENSITY, XP-TOTAL-FOR-DAY
; (xp-per-user vraca total xp za period sto je super jer moze da vrati daily xp)

