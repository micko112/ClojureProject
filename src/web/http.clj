(ns web.http
  "Shared HTTP/JSON helpers used by every web.* namespace."
  (:require [cheshire.core :as json]
            [clojure.java.io :as io]
            [datomic.api :as d]
            [project.system :as s]))

(defn jresp [status body]
  {:status status
   :headers {"Content-Type" "application/json"}
   :body (json/generate-string body)})

(defn parse-body [req]
  (try (json/parse-stream (io/reader (:body req)) true)
       (catch Exception _ {})))

(defn me [req] (get-in req [:session :username]))

(defn ok [body]  (jresp 200 body))
(defn created [body] (jresp 201 body))
(defn bad [msg]  (jresp 400 {:error msg}))
(defn unauth []  (jresp 401 {:error "Unauthorized"}))
(defn forbidden [] (jresp 403 {:error "Forbidden"}))
(defn not-found [] (jresp 404 {:error "Not found"}))

(defn parse-id
  "Parses a Datomic entity id from a path/query string, nil when invalid."
  [s]
  (try (Long/parseLong (str s)) (catch Exception _ nil)))

(defn instant->str [d]
  (when d (.toString (.toInstant d))))

(defn ddb [] (d/db s/conn))

(defn user-e [db username]
  (d/q '[:find ?e . :in $ ?u :where [?e :user/username ?u]] db username))

(defn author-dto [u]
  (when u {:username    (:user/username u)
           :displayName (:user/display-name u)
           :profilePic  (:user/profile-pic u)}))
