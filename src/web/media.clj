(ns web.media
  "Media storage (S3-compatible cloud or local disk), image optimization and
   the /api/media upload endpoint. OWNER: media agent."
  (:require [datomic.api :as d]))

(defn media-dto
  "Shape (see docs/ARCHITECTURE.md): {:id :type :url :width :height
   :variants [{:w :url}] :placeholder :posterUrl :durationSec}"
  [db eid]
  (let [e (d/entity db eid)]
    (when (:media/url e)
      {:id   (str eid)
       :type (or (:media/type e) "image")
       :url  (:media/url e)})))

(def routes [])
