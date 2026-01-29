  (ns web.server
    (:require [ring.adapter.jetty :as jetty]
              [reitit.ring :as ring]
              [reitit.ring.middleware.parameters :as parameters]
              [ring.middleware.keyword-params :refer [wrap-keyword-params]]
              [hiccup.page :refer [html5]]
              [hiccup2.core :as h]
              [project.api :as api]
              [datomic.api :as d]
              [project.system :as sys]
              [clojure.string :as str]
              [ring.middleware.session :refer [wrap-session]])
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
    ""
    [:style
     "
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; min-height: 100vh; background-color: #fafafa; }

          /* SIDEBAR  */
          .sidebar {
            width: 245px;
            background-color: #ffffff;
            padding: 35px 20px 20px 20px;
            position: fixed;
            height: 100vh;
            top: 0; left: 0;
            z-index: 999;
            border-right: 1px solid #dbdbdb;
            display: flex;
            flex-direction: column;
          }
          .logo-wrapper { width: 100%; margin-bottom: 30px; padding-left: 10px; }
          .logo { font-size: 24px; font-weight: bold; font-family: cursive; } /* Tvoj font ovde */

          .sidebar-menu { list-style-type: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }

          /* LINK */
          .nav-link {
            display: flex;
            align-items: center;
            padding: 12px;
            color: #000;
            text-decoration: none;
            border-radius: 8px;
            font-size: 16px;
            transition: background 0.2s;
          }
          .nav-link:hover { background-color: #f2f2f2; }
          .nav-link.active { font-weight: bold; }
          .nav-link span { margin-left: 15px; }

          /* MAIN CONTENT (Pomeren desno zbog sidebara) */
          .main-content {
            margin-left: 245px;
            padding: 40px;
            width: calc(100% - 245px);
          }

          /* KALENDAR STILOVI */
          .day-column { border: 1px solid #ccc; padding: 1rem; cursor: pointer; transition: background 0.2s; flex: 1; text-align: center; }
          .day-column:hover { background: #f0f0f0; }
          .day-column.selected { background: #2c3e50; color: white; border-color: #2c3e50; }

          .calendar-container { border: 10px solid #dbdbdb; background: black; border-radius: 3px; }

          .hour-slot:hover { background: #f7f7f7;}
       "]]

   [:body
    [:div.sidebar
     [:div.logo-wrapper
      [:div.logo "BeBetter"]]
     [:ul.sidebar-menu
      [:li [:a.nav-link {:href "#"} [:span "\uD83C\uDFE0"] [:span "Feed"]]]
      [:li [:a.nav-link {:href "#"} [:span "⚡"] [:span "Aktivnost"]]]
      [:li [:a.nav-link {:href "#"} [:span "🏆"] [:span "Rang Lista"]]]
      [:li [:a.nav-link {:href "#"} [:span "🔍"] [:span "Pretraga"]]]
      [:li [:a.nav-link {:href "#"} [:span "👤"] [:span "Moj Profil"]]]]]
    [:main.main-content
     content]]))

(defn sidebar []
  [:div.sidebar
   [:div.logo-wrapper
    [:span "BeBetter"]]
   [:ul.sidebar-menu
    [:a.nav-link
     [:li [:span "Activity"]]]
    [:a.nav-link
     [:li [:span "Feed"]]]
    [:a.nav-link
     [:li [:span "Leaderboard"]]]
    [:a.nav-link
     [:li [:span "Search"]]]
    [:a.nav-link
     [:li [:span "My Profile"]]]]])

(def days ["Mon" "Tue" "Wed" "Thu" "Fri" "Sat" "Sun"])

(defn day-column [selected-day]
  [:div {:id "days-nav"
         :style "display: flex; gap: 1rem; margin-bottom: 20px;"}
   (for [d days]
     [:div.day-column
      {:class (when (= d selected-day) "selected")
       :hx-post "/select-day"
       :hx-vals (str "{\"day\": \"" d "\"}")
       :hx-target "#calendar-view"
       :hx-swap "outerHTML"}
      d])])

(defn calendar-view [day]
  [:div#calendar-view.calendar
   [:h3 (str "Day: " (or day "none"))]
   [:div {:style "position:relative; height:1440px; border:1px solid #ccc;"}
    (for [hour (range 24)]
      [:div.hour-slot
       {:style (str "position:absolute; top:" (* hour 60) "px; left: 0; right: 0;
       height:60px; border-top:1px solid #eee; cursor:pointer;")
        :hx-get "/slot-form"
        :hx-vals (str "{\"hour\": " hour "}")
        :hx-target "this"
        :hx-swap "innerHTML"
        }
       (str hour ":00")])]])

(defn slot-form [day-time]
  [:form {:hx-post "/add-activity"
          :hx-target "closest .hour-slot"
          :hx-swap "innerHTML"
          :hx-indicator ".spinner"}
   [:input {:type "hidden"
            :name "day-time"
            :value day-time}]

   [:select {:name "title"}
    [:option {:value "" :disabled true :selected true} "Choose intensity"]
    [:option {:value "training"} "Training"]
    [:option {:value "study"} "Study"]
    [:option {:value "work"} "Work"]]

   [:select {:name "intensity" :id "intensity"}
    [:option {:value "" :disabled true :selected true} "Choose intensity"]
    [:option {:value "low"} "Low"]
    [:option {:value "mid"} "Mid"]
    [:option {:value "high"} "High"]]

   [:button {:type "submit"} "Save"]])

(defn home-page [{:keys [session]}]
  (let [selected-day (:select-day session)]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :body
     (common-layout
       [:div
        [:h2 "Calendar"]
        (day-column selected-day)
        (calendar-view selected-day)])}))

(defn select-day-handler [{:keys [params session]}]
  (let [day (:day params)]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :session (assoc session :select-day day)
     :body (str (h/html (calendar-view day))
                (h/html [:div {:id "day-nav" :hx-swap-oob "true"}
                         (h/html (day-column day))]))}))

(defn slot-form-handler [{:keys [params]}]
  (let [hour (:hour params)]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :body (str (h/html (slot-form hour)))
     }))

(defn add-activity-handler [{:keys [params]}]
  (println "PARAMS:" params)
  (let [title (:title params)
        intensity (:intensity params)
        hour  (:day-time params)]

    {:status 200
     :headers {"Content-Type" "text/html"}
     :body
     (str
       (h/html
         [:div {:style "background:#2c3e50; color:white; padding:4px; border-radius:4px;"}
          (str title " @ " hour " [" intensity "]")]))}))



(def app
  (wrap-session
   (ring/ring-handler
    (ring/router [["/" {:get home-page}]
                  ["/select-day" {:post select-day-handler}]
                  ["/slot-form" {:get slot-form-handler}]
                  ["/add-activity" {:post add-activity-handler}]]
                 {:data {:middleware [parameters/parameters-middleware
                                      wrap-keyword-params]}}))))

(defonce server (atom nil))

(defn start-server []
  (when-not @server
    (reset! server (jetty/run-jetty #'app {:port port :join? false}))
    (println "server pokrenut na http://localhost:3000")))

(defn stop-server []
  (when-some [s @server] ;; check if there is an object in the atom
    (.stop s)
    (reset! server nil)))     ; https://ericnormand.me/guide/clojure-web-tutorial

(defn stop-server []
  (when-some [s @server] ;; check if there is an object in the atom
    (.interrupt s)
    (reset! server nil)))