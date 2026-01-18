(defproject ProjectV1 "0.1.0-SNAPSHOT"
  :description "Seminarski rad"
  :dependencies [[org.clojure/clojure "1.12.2"]
                 [com.datomic/datomic-pro "1.0.7469"]
                 [metosin/malli "0.20.0"]
                ]
  :profiles {:dev {:dependencies [[midje "1.10.10"]]}}
  :plugins [[lein-midje "3.2.1"]]
  :main project.core)


