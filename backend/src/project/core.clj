(ns project.core (:gen-class)
  (:require [project.system :as sys]
            [web.server :as server]))

(defn -main
  [& args]
  (println "app is starting")
  (try
    (println "Connecting to Datomic...")
    (if sys/conn
      (println "Database connected.")
      (throw (Exception. "Database not available, check transactor")))

    (println "Starting web server...")
    (server/start-server)

    (catch Exception e
      (println "Error:" (.getMessage e))
      (System/exit 1))))
