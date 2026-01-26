(ns web.server
  (:require [ring.adapter.jetty :as jetty]
            [reitit.ring :as ring]
            [reitit.ring.middleware.parameters :as parameters]
            [hiccup.page :refer [html5]]
            [project.api :as api]
            [datomic.api :as d]
            [project.system :as sys]
            [clojure.string :as str])
  (:import (java.time LocalDate LocalTime Duration ZoneId)
           (java.time.format DateTimeFormatter)))

(def port 3000)
(defn parse-date [date-str]
  (if (or (empty? date-str) (= "today" date-str))
    (LocalDate/now)
    (try (LocalDate/parse date-str)
         (catch Exception _ (LocalDate/now)))))

(defn format-date [date]
  (.format date (DateTimeFormatter/ofPattern "yyyy-MM-dd")))

(defn nice-date [date]
  (.format date (DateTimeFormatter/ofPattern "EEEE, dd. MMMM yyyy.")))

(defn get-next-day [date]
   (.plusDays date 1))
(defn get-previous-day [date]
  (.minusDays date 1))

(defn insant->minutes-from-midnight [inst]
  (let [zdt (.atZone (.toInsant inst) (project.time/zone))
        hour (.getHour zdt)
        minute (.getMinute zdt)
        (+ (* hour 60) minute)]))

(defn common-layout [& content]
  (html5
    [:head
     [:title "BeBetter"]
     [:meta {:charset "UTF-8"}]
     [:script {:src "https://unpkg.com/htmx.org@1.9.10"}]
     [:style "
       { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: sans-serif; min-height: 100vh; display: flex; flex-direction: column; }
      .header { background: #2c3e50; color: white; padding: 1rem; }
      .main { flex: 1; padding: 2rem; max-width: 1200px; margin: 0 auto; width: 100%; }
      .footer { background: #34495e; color: white; padding: 1rem; text-align: center; }
      .nav a { color: white; margin-right: 1rem; text-decoration: none; }
      .nav a:hover { text-decoration: underline; }
      .htmx-indicator { display: none; }
      .htmx-request .htmx-indicator { display: inline-block; }"]]
    [:body
     [:nav-sidebar
      [:div.logo "BeBetter"]
      [:a.nav-link {:hx-get "/planner" }] [:span "Planner"]]
     [:main.main-content
      content]
     [:footer.footer
      [:p "© 2024 BeBetter - Clojure + HTMX"]]]

    ))
(defn home-page [request]

  {:status 200
   :headers {"Content-Type" "text/html"}
   :body
           (common-layout
             [:div
              [:div "Nista se ne desava"
              [:button {:hx-post "/klik"
                        :hx-target "this"
                        :hx-swap "innerHTML"
                        :hx-indicator ".spinner"
                      }
               [:span.btn-text "BUTTON"]
               [:span.spinner.htmx-indicator
                {:style "margin-left:10px"}
                "Loading..."]]
              ]
             ])
           })

(defn click-handler [request]
  {:status 200
   :headers {"Content-Type" "text/html"}
   :body
   (html5 [:p {:style "color: blue; font-weight: bold;"}
    "click done"])
   })

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



(defn stop-server []
  (when-some [s @server] ;; check if there is an object in the atom
    (.close s)
    (reset! server nil)))     ; https://ericnormand.me/guide/clojure-web-tutorial

(defn stop-server []
  (when-some [s @server] ;; check if there is an object in the atom
    (.interrupt s)
    (reset! server nil)))