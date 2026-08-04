(defproject ProjectV1 "0.1.0-SNAPSHOT"
  :description "BeBetter - Gamified Productivity Social Network"

  :dependencies [[org.clojure/clojure "1.12.2"]
                 [com.datomic/peer "1.0.7387"]
                 [metosin/malli "0.20.0"]

                 [ring/ring-core "1.9.6"]
                 [ring/ring-jetty-adapter "1.9.6"]
                 [ring/ring-defaults "0.3.4"]
                 [metosin/reitit "0.7.1"]
                 [cheshire "5.11.0"]

                 [clj-http "3.13.0"]
                 [buddy/buddy-hashers "2.0.167"]

                 [org.clojure/tools.logging "1.3.0"]
                 [ch.qos.logback/logback-classic "1.5.16"]]

  :source-paths ["src"]
  :test-paths ["test"]
  :resource-paths ["resources"]

  :main web.server
  :aot [web.server project.core]

  :jvm-opts ["-Xmx512m"]

  :profiles {:dev  {:dependencies [[midje "1.10.10"]]}
             :uberjar {:uberjar-name "bebetter-standalone.jar"}}

  :plugins [[lein-midje "3.2.1"]
            [dev.weavejester/lein-cljfmt "0.15.6"]])
