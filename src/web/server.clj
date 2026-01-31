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
            [ring.middleware.session :refer [wrap-session]]
            [cheshire.core :refer :all]
            )
  (:import (java.time LocalDate LocalTime Duration ZoneId)
           (java.time.format DateTimeFormatter)
           (java.util UUID)))

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
     [:style
      "
         /* RESET & BASE */
         * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }
         body { background-color: #f8f9fa; color: #333; display: flex; height: 100vh; overflow: hidden; }

         /* SIDEBAR */
         .sidebar { width: 260px; background: white; border-right: 1px solid #e0e0e0; display: flex; flex-direction: column; padding: 20px; flex-shrink: 0; z-index: 50; }
         .logo { font-size: 24px; font-weight: 800; color: #2c3e50; margin-bottom: 40px; padding-left: 10px; }
         .nav-link { display: flex; align-items: center; padding: 12px 15px; color: #555; text-decoration: none; border-radius: 8px; margin-bottom: 5px; font-weight: 500; transition: all 0.2s; }
         .nav-link:hover { background-color: #f0f4f8; color: #2c3e50; }
         .nav-link span { margin-right: 12px; font-size: 1.1em; }

         /* MAIN CONTENT */
         .main-content { flex: 1; padding: 30px; overflow-y: auto; display: flex; flex-direction: column; }
         h2 { font-size: 28px; margin-bottom: 20px; color: #2c3e50; font-weight: 600; }

         /* DAY SELECTOR */
         #days-nav { display: flex; gap: 10px; margin-bottom: 20px; background: white; padding: 10px; border-radius: 12px; border: 1px solid #e0e0e0; width: fit-content; }
         .day-column { padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; color: #777; transition: all 0.2s; border: 1px solid transparent; }
         .day-column:hover { background-color: #f8f9fa; color: #333; }
         .day-column.selected { background-color: #2c3e50; color: white; box-shadow: 0 4px 6px rgba(44, 62, 80, 0.2); }

         /* KALENDAR GRID */
         .calendar-wrapper { position: relative; background: white; border-radius: 12px; border: 1px solid #e0e0e0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
         .calendar-scroll { height: 70vh; overflow-y: auto; position: relative; } /* Skroluje samo kalendar */

         .hour-row { height: 60px; border-bottom: 1px solid #f0f0f0; position: relative; display: flex; align-items: center; z-index: 1; }
         .hour-label { width: 60px; text-align: right; padding-right: 15px; color: #999; font-size: 12px; font-weight: 500; user-select: none;}
         .hour-slot { flex: 1; height: 100%; cursor: pointer; transition: background 0.1s; position: relative; border-left: 1px solid #f0f0f0; z-index: 1; }
         .hour-slot:hover { background-color: #fcfcfc; }

         /* FORMA U SLOTU */
         .slot-form-container { padding: 10px; background: white; border-radius: 6px; z-index: 10000;
         box-shadow: 0 4px 15px rgba(0,0,0,0.15); border: 1px solid #e0e0e0; position: absolute;
         top: 5px; left: 5px; width: 600px; animation: fadeIn 0.2s; pointer-events: auto;
         isolation: isolate; transform: translateZ(0); }
         .slot-form { display: flex; gap: 8px; flex-wrap: wrap; }
         .slot-form-row { display: flex; gap: 8px; width: 100%; }
         .slot-form select { padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #fff; flex: 1; font-size: 13px; }
         .slot-form button { padding: 8px 15px; background: #2c3e50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 13px; }
         .slot-form button:hover { background: #34495e; }

         /* AKTIVNOST BLOK */
         .activity-block {
             position: absolute; left: 125px; right: 10px;
             background: #e3f2fd; border-left: 4px solid #2196f3;
             color: #1565c0; padding: 8px 12px; border-radius: 4px;
             font-size: 13px; font-weight: 500;
             box-shadow: 0 2px 4px rgba(0,0,0,0.05);
             cursor: pointer; transition: transform 0.1s;
             z-index: 30; pointer-events: auto;
             display: flex; align-items: center; justify-content: space-between;
         }
         .activity-block:hover { transform: scale(1.01); box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
         .activity-actions button { background: none; border: none; cursor: pointer; color: #d32f2f; font-size: 12px; font-weight: bold; }

         @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
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
       :hx-vals (generate-string {:day d})
       :hx-target "#calendar-view"
       :hx-swap "outerHTML"}
      d])])

(defn activity->block [{:keys [id title intensity duration hour]}]
  (let [top (* 60 hour)
        height (* duration 60)]
    [:div.activity-block
     {:id id
      :hx-get "/activity-edit"
      :hx-target "this"
      :hx-swap "outerHTML"
      :hx-vals (generate-string {:id id})
      :style (str "position:absolute;"
                  "top:" top "px;"
                  "left:60px;"
                  "right:0;"
                  "height:" height "px;"
                  "background:#2c3e50;"
                  "color:white;"
                  "border-radius:6px;"
                  "padding:6px;"
                  "pointer-events: auto;"
                  )}
     (str title " [" intensity "]")]))

(defn calendar-view [day activities]
  [:div#calendar-view.calendar
   [:h3 (str "Day: " (or day "Monday"))]
   [:div.calendar-wrapper
    [:div.calendar-scroll
     [:div#slots-layer
      (for [hour (range 24)]
       [:div.hour-row
        [:div.hour-label (str hour ":00")]
        [:div.hour-slot
         {:hx-get "/slot-form"
          :hx-vals (generate-string {:hour hour})
          :hx-target "this"
          :hx-swap "innerHTML"
          :hx-trigger "click once"

          }]])]
     [:div#calendar-form-layer {:style "position:absolute;
          top:0;
          left:0;
          right:0;
          height:1440px;
          z-index:20;
          pointer-events: none"}
      (for [a activities]
        (activity->block a))]
     ]
    ]])


(defn slot-form [hour]
  [:div.slot-form-container  {:style "position:absolute; top:5px; left:5px; z-index:1000;"
                              :onclick "event.stopPropagation()"}
   [:form.slot-form
    {:hx-post "/add-activity"
     :hx-target "#calendar-form-layer"
     :hx-swap "beforeend"
     :hx-on:after-request "this.closest('.slot-form-container').remove()"
     :onsubmit "this.querySelector('button[type=submit]').disabled = true;"
     :style "display: flex; gap: 10px; align-items: center;"
    }

    [:input {:type "hidden" :name "hour" :value hour}]

    [:select {:name "title" :required true }
     [:option {:value "" :selected true :disabled true :hidden true} "Choose Activity"]
     [:option {:value "training"} "Training"]
     [:option {:value "study"} "Study"]
     [:option {:value "work"} "Work"]]

    [:select {:name "intensity" :required true }
     [:option {:value "" :selected true :disabled true :hidden true} "Choose Intensity"]
     [:option {:value "low"} "Low"]
     [:option {:value "mid"} "Mid"]
     [:option {:value "high"} "High"]]

    [:select {:name "duration"}
     [:option {:value "1"} "1h"]
     [:option {:value "2"} "2h"]
     [:option {:value "3"} "3h"]
     [:option {:value "4"} "4h"]]

    [:button {:type "submit" } "Save"]
    [:button {:type "button"
              :onclick "this.closest('.slot-form-container').remove()"
              :style "background: #ccc; color: black;"} "X"]]])

(defn activity-edit-view [id]
  [:div {:style "background:#fff; border:1px solid #ccc; padding:6px; border-radius:6px;"}
   [:button {:hx-delete "/activity"
             :hx-vals (generate-string {:id id})
             :hx-target "closest .activity-block"
             :hx-swap "outerHTML"}
    "Delete"]])

(defn home-page [{:keys [session]}]
  (let [selected-day (:select-day session "Mon")
        activities (get-in session [:activities selected-day] [])]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :body
     (common-layout
       [:div
        [:h2 "Calendar"]
        (day-column selected-day)
        (calendar-view selected-day activities)])}))

(defn select-day-handler [{:keys [params session]}]
  (let [day (:day params)
        activities (get-in session [:activities day] [])]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :session (assoc session :select-day day)
     :body (str (str (h/html (calendar-view day activities)))
                (str (h/html [:div {:id "days-nav" :hx-swap-oob "true"}
                              (for [d days]
                                [:div.day-column
                                 {:class (when (= d day) "selected")
                                  :hx-post "/select-day"
                                  :hx-vals (generate-string {:day d})
                                  :hx-target "#calendar-view"
                                  :hx-swap "outerHTML"}
                                 d])])))}))

(defn slot-form-handler [{:keys [params]}]
  (let [hour (:hour params)]
    {:status  200
     :headers {"Content-Type" "text/html"}
     :body    (str (h/html (slot-form hour)))
     }))

(defn add-activity-handler [{:keys [params session]}]
  (println "PARAMS:" params)
  (let [day (:select-day session "Mon")
        id (str (UUID/randomUUID))
        new-activity {:id id
                      :title (:title params)
                      :duration (Integer/parseInt (:duration params))
                      :intensity (:intensity params)
                      :hour (Integer/parseInt (:hour params)  )}
        new-session (update-in session [:activities day] (fnil conj []) new-activity)
        ]


    {:status 200
     :headers {"Content-Type" "text/html"}
     :session new-session
     :body
     (str
       (h/html (activity->block new-activity)))}))

(defn activity-edit-handler [{:keys [params]}]
  (let [id (:id params)]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :body (str (h/html (activity-edit-view id)))})
  )

(defn activity-delete-handler [_]
  {:status 200
   :headers {"Content-Type" "text/html"}
   :body ""})

(def app
  (wrap-session
    (ring/ring-handler
      (ring/router [["/" {:get home-page}]
                    ["/select-day" {:post select-day-handler}]
                    ["/slot-form" {:get slot-form-handler}]
                    ["/add-activity" {:post add-activity-handler}]
                    ["/activity-edit" {:get activity-edit-handler}]
                    ["/activity" {:delete activity-delete-handler}]
                    ["/favicon.ico" {:get (fn [_] {:status 204 :body ""})}]
                    ]
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