(ns project.connection
  (:require [datomic.api :as d]
            [project.system :as s]))

(def db-uri s/db-uri)

(def conn s/conn)
