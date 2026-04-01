(ns project.system
  (:require [datomic.api :as d]
            [database.schema :as schema]
            [database.seed :as seed-db]))

(def db-uri "datomic:dev://localhost:4334/bebetter")

(defonce conn (d/connect db-uri))

(defn reset-db! [all-tx-functions]
  (d/delete-database db-uri)
  (d/create-database db-uri)
  (let [new-conn (d/connect db-uri)]
    @(d/transact new-conn schema/all-schemas)
    @(d/transact new-conn seed-db/all-seed-data)
    @(d/transact new-conn all-tx-functions)
    (alter-var-root #'conn (constantly new-conn))
    new-conn))

(defn migrate!
  "Dodaje nove schema atribute bez brisanja baze. Sigurno za pokretati vise puta."
  []
  @(d/transact conn schema/reaction-schema)
  @(d/transact conn schema/post-schema)
  (println "Migracija zavrsena."))
