(ns project.system
  (:require [datomic.api :as d]
            [database.schema :as schema]
            [database.seed :as seed-db]
            ))

(def db-uri "datomic:dev://localhost:4334/bebetter")

(defn reset-db! [all-tx-functions]
    (d/delete-database db-uri)
    (d/create-database db-uri)
    (let [conn (d/connect db-uri)]
      @(d/transact conn schema/all-schemas)
      @(d/transact conn seed-db/all-seed-data)
      @(d/transact conn all-tx-functions)
      conn))