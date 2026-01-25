(ns web.server
  (:require [project.api :as api]
            [ring.adapter.jetty :as jetty]
            [reitit.ring :as ring]
            [hiccup.page :refer [html5]
             ]
            )
  (:import (java.time LocalDate)))

(def port 3000)
(defn common-layout [content]
  (html5
    [:head
     [:title "BeBetter"]
     [:meta {:charset "UTF-8"}]
     [:script {:src "https://unpkg.com/htmx.org@1.9.10"}]
     [:style "body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
              table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background-color: #f2f2f2; }
              .btn { padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; }"]]
    [:body
     [:h1 "BeBetter"]
     [:hr]
     content]
    ))
(defn leaderboard-table [data]
  [:div
   [:h2 "Rank list "]
   [:table
    [:thead
     [:tr
      [:th "Rank"]
      [:th "Username"]
      [:th "XP"]
      [:th "Delta"]]]
    [:tbody
     (for [user data]
       [:tr
        [:td (:rank user)]
        [:td (:user/username user)]
        [:td (:user/xp user)]
        [:td (let [d (:delta user)]
               (cond
                 (pos? d) [:span {:style "color:green"} (str "▲ " d)]
                 (neg? d) [:span {:style "color:red"} (str "▼ " (Math/abs d))]
                 :else    [:span {:style "color:gray"} "-"]))]

        ])]
    ]]
  )
(defn home-page [request]

  (let [leaderboard-data (api/get-leaderboard :weekly (LocalDate/now))]
  {:status 200
   :headers {"Content-Type" "text/html"}
   :body (common-layout (leaderboard-table leaderboard-data))}))

(defn click-handler [request]
  {:status 200
   :headers {"Content-Type" "text/html"}
   :body (html5 [:div [:h2 {:style "color: blue"} "Server radi"]])})

(def app
  (ring/ring-handler
    (ring/router [
                  ["/" {:get home-page}]
                  ["/klik" {:post click-handler}]
                                   ])
    (ring/create-default-handler)))


(defonce server (atom nil))

(defn start-server []
  (when-not @server
    (reset! server (jetty/run-jetty #'app {:port port :join? false}))
    (println "server pokrenut na http://localhost:3000")))

(defn start-server []
  (reset! server (jetty/run-jetty (fn [req] {:status 200 :body "Hello" :headers {}})  ;; a really basic handler
                   {:port 3000      ;; listen on port 3001
                    :join? false})))

(defn stop-server []
  (when-some [s @server] ;; check if there is an object in the atom
    (.close s)
    (reset! server nil)))     ; https://ericnormand.me/guide/clojure-web-tutorial

(defn stop-server []
  (when-some [s @server] ;; check if there is an object in the atom
    (.interrupt s)
    (reset! server nil)))