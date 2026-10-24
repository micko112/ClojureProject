(ns project.test-db
  "In-memory Datomic fixture for integration tests. Points project.system/conn
   at a fresh datomic:mem database with full schema, seed data and tx fns."
  (:require [datomic.api :as d]
            [cheshire.core :as json]
            [database.schema :as schema]
            [database.seed :as seed]
            [project.db :as db]
            [project.system :as s]
            [reitit.ring :as ring]
            [reitit.ring.middleware.parameters :as params]
            [ring.middleware.keyword-params :refer [wrap-keyword-params]])
  (:import (java.util UUID)
           (java.io ByteArrayInputStream)))

(defn fresh-conn []
  (let [uri (str "datomic:mem://test-" (UUID/randomUUID))]
    (d/create-database uri)
    (let [conn (d/connect uri)]
      @(d/transact conn schema/all-schemas)
      @(d/transact conn seed/all-seed-data)
      @(d/transact conn db/get-all-tx-functions)
      conn)))

(defn with-mem-db
  "clojure.test :each fixture."
  [f]
  (let [conn (fresh-conn)]
    (with-redefs [s/conn conn]
      (f))))

(defn request
  "Builds a ring request for web.server/app. `user` (optional) is put in the
   session as if logged in; `body` is JSON-encoded."
  ([method uri] (request method uri nil nil))
  ([method uri body] (request method uri body nil))
  ([method uri body user]
   (cond-> {:request-method method
            :uri uri
            :headers {"content-type" "application/json"}
            :body (ByteArrayInputStream. (.getBytes (json/generate-string (or body {})) "UTF-8"))}
     user (assoc :session {:username user}))))

(defn json-body [resp]
  (json/parse-string (:body resp) true))

(defn api
  "Calls the app's routes without cookie-session middleware, so the session set
   by `request` is used directly. Resolves web.server lazily to avoid a load
   cycle with fixtures."
  [req]
  (let [routes @(requiring-resolve 'web.server/routes)
        handler (ring/ring-handler
                 (ring/router routes {:conflicts nil
                                      :data {:middleware [params/parameters-middleware
                                                          wrap-keyword-params]}}))]
    (handler req)))
