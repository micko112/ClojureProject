(defproject ProjectV1 "0.1.0-SNAPSHOT"
  :description "BeBetter - Gamified Productivity Social Network"

  :dependencies [[org.clojure/clojure "1.12.2"]
                 [com.datomic/peer "1.0.7387"]
                 [metosin/malli "0.20.0"]

                 [ring/ring-core "1.12.2"]
                 [ring/ring-jetty-adapter "1.12.2"]
                 [ring/ring-defaults "0.3.4"]
                 [metosin/reitit "0.7.1"]
                 [cheshire "5.11.0"]

                 [clj-http "3.13.0"]
                 [buddy/buddy-hashers "2.0.167"]

                 [org.clojure/tools.logging "1.3.0"]
                 [ch.qos.logback/logback-classic "1.5.16"]

                 ;; Media pipeline: S3-compatible storage (Cloudflare R2 / AWS S3 / MinIO)
                 [software.amazon.awssdk/s3 "2.31.78" :exclusions [software.amazon.awssdk/netty-nio-client
                                                                   software.amazon.awssdk/apache-client]]
                 [software.amazon.awssdk/url-connection-client "2.31.78"]
                 ;; Media pipeline: image decoding/resizing/EXIF
                 [net.coobird/thumbnailator "0.4.20"]
                 [com.drewnoakes/metadata-extractor "2.19.0"]
                 [com.twelvemonkeys.imageio/imageio-jpeg "3.12.0"]
                 [com.twelvemonkeys.imageio/imageio-webp "3.12.0"]]

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
