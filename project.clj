(defproject ProjectV1 "0.1.0-SNAPSHOT"
  :description "Seminarski rad"
  :dependencies [[org.clojure/clojure "1.12.2"]
                 [com.datomic/datomic-pro "1.0.7469"]
                 [metosin/malli "0.20.0"]

                 [ring/ring-core "1.9.6"]
                 [ring/ring-jetty-adapter "1.9.6"]
                 [ring/ring-defaults "0.3.4"]
                 [hiccup "2.0.0-RC2"]
                 [metosin/reitit "0.7.1"]
                ]

  :profiles {:dev {:dependencies [[midje "1.10.10"]]}}
  :plugins [[lein-midje "3.2.1"]
            [dev.weavejester/lein-cljfmt "0.15.6"]]
  :main project.core)


