(ns project.validation
  (:require [malli.core :as m]
            [malli.generator :as mg]
            [malli.error :as me]))


(def Username
  [:and
   [:string {:min 1 :max 30}]
   [:fn (fn [word] (boolean (and (re-matches #"^[a-zA-Z0-9._]+$" word)
                        (not (re-matches #"^\d+$" word))
                                 (not (.startsWith word "."))
                                 (not (.endsWith word "."))
                                 (not (.contains word "..")))))]])

(def CreateUserInput
  [:map
   :username Username])

(def Type-key keyword?)

(def Duration
  [:int {:min 1}]
  )

(def Intensity
  [:int {:min 1 :max 5}])

(def AddActivityInput
  [:map
   [:username Username]
   [:activity-type Type-key]
   [:duration Duration]
   [:intensity Intensity]])

(mg/generate AddActivityInput)


