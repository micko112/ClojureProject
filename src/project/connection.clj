(ns project.connection
  (:require [datomic.api :as d]))

(def db-uri "datomic:dev://localhost:4334/bebetter")

(defonce conn
  (d/connect db-uri))
