(ns project.system
  (:require [datomic.api :as d]
            [database.schema :as schema]
            [database.seed :as seed-db]))

(def db-uri
  (or (System/getenv "DATOMIC_URI")
      "datomic:dev://localhost:4334/bebetter"))

(defn- connect-with-retry
  "Try to connect to Datomic, retrying with backoff. In production the
   transactor container may take a few seconds to become ready."
  ([uri] (connect-with-retry uri 30 2000))
  ([uri max-attempts delay-ms]
   (loop [attempt 1]
     (let [result (try
                    (d/create-database uri)
                    (d/connect uri)
                    (catch Throwable t
                      (if (< attempt max-attempts)
                        (do (println (format "[datomic] connect attempt %d/%d failed: %s — retrying in %dms"
                                             attempt max-attempts (.getMessage t) delay-ms))
                            (Thread/sleep delay-ms)
                            ::retry)
                        (throw t))))]
       (if (= result ::retry)
         (recur (inc attempt))
         (do (println (format "[datomic] connected to %s" uri))
             result))))))

(defonce conn (connect-with-retry db-uri))

(defn reset-db! [all-tx-functions]
  (d/delete-database db-uri)
  (d/create-database db-uri)
  (let [new-conn (d/connect db-uri)]
    @(d/transact new-conn schema/all-schemas)
    @(d/transact new-conn seed-db/all-seed-data)
    @(d/transact new-conn all-tx-functions)
    (alter-var-root #'conn (constantly new-conn))
    new-conn))
