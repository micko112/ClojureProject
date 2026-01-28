(ns project.validation
  (:require [malli.core :as m]
            [malli.generator :as mg]
            [malli.error :as me]))

(defn valid-username? [name]
  (boolean (and (re-matches #"^[a-zA-Z0-9._]+$" name)
                (not (re-matches #"^\d+$" name))
                (not (.startsWith name "."))
                (not (.endsWith name "."))
                (not (.contains name "..")))))
(def Username
  [:and
   [:string {:min 1 :max 30}]
   [:fn valid-username?]])

(def CreateUserInput
  [:map
   [:username Username]])

(def Type-key keyword?)

(def Duration
  [:int {:min 1}])

(def Intensity
  [:int {:min 1 :max 5}])

(def AddActivityInput
  [:map
   [:username Username]
   [:activity-type Type-key]
   [:duration Duration]
   [:intensity Intensity]])

(def Period
  [:enum
   :daily
   :weekly
   :monthly
   :all])

(def Report-input
  [:map
   [:username Username]])

(defn validate! [schema data]
  (when-not (m/validate schema data)
    (throw (ex-info "Validation failed" {:errors (me/humanize (m/explain schema data))})))
  data)


