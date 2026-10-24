(ns web.notifications
  "Notification creation + DTO. OWNER: realtime agent (adds live push)."
  (:require [datomic.api :as d]
            [project.system :as s]
            [web.http :refer [instant->str author-dto]])
  (:import (java.util Date)))

(defn notif-dto [db eid]
  (let [e     (d/entity db eid)
        actor (:notification/actor e)
        post  (:notification/post e)]
    (cond-> {:id        (str eid)
             :type      (name (or (:notification/type e) :info))
             :message   (:notification/message e)
             :read      (boolean (:notification/read e))
             :createdAt (instant->str (:notification/created-at e))}
      actor (assoc :actor (author-dto actor))
      post  (assoc :postId (str (:db/id post))))))

(defn create-notif!
  "opts: {:actor-e eid, :post-e eid} — both optional."
  ([recipient-e type msg] (create-notif! recipient-e type msg {}))
  ([recipient-e type msg {:keys [actor-e post-e]}]
   @(d/transact s/conn [(cond-> {:notification/recipient recipient-e
                                 :notification/type type
                                 :notification/message msg
                                 :notification/read false
                                 :notification/created-at (Date.)}
                          actor-e (assoc :notification/actor actor-e)
                          post-e  (assoc :notification/post post-e))])))
