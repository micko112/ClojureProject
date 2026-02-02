(ns web.server
  (:require [ring.adapter.jetty :as jetty]
            [reitit.ring :as ring]
            [reitit.ring.middleware.parameters :as parameters]
            [ring.middleware.keyword-params :refer [wrap-keyword-params]]
            [hiccup.page :refer [html5]]
            [hiccup2.core :as h]
            [project.api :as api]
            [datomic.api :as d]
            [project.system :as s]
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

#_(defn instant->minutes-from-midnight [inst]
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

         .calendar-scroll { height: 75vh; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 8px; background: white; position: relative; }
         .calendar-grid { display: flex; min-height: 1440px; position: relative; }
         .time-labels { width: 60px; border-right: 1px solid #f0f0f0; background: #fafafa; flex-shrink: 0; }
         .hour-label { height: 60px; border-bottom: 1px solid #eee; text-align: right; padding-right: 10px; color: #999; font-size: 12px; padding-top: 5px; }
         .time-label { height: 60px; border-bottom: 1px solid #eee; text-align: right; padding-right: 10px; color: #999; font-size: 12px; padding-top: 5px; }
         .day-grid { flex-grow: 1; position: relative; }
         .hour-slot { height: 60px; border-bottom: 1px solid #f5f5f5; cursor: pointer; position: relative; z-index: 1; }
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
         .activity-block {position: absolute; left: 5px; right: 10px; background-color: #e3f2fd; border-left: 4px solid #2196f3; color: #1565c0; padding: 5px 10px; border-radius: 4px; font-size: 13px; font-weight: 500; z-index: 20; pointer-events: auto; display: flex; align-items: center; justify-content: space-between; overflow: hidden;}
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
  [:div {:id "days-nav"}
   (for [d days]
     [:div.day-column
      {:class (when (= d selected-day) "selected")
       :hx-post "/select-day"
       :hx-vals (generate-string {:day d})
       :hx-target "#calendar-view"
       :hx-swap "outerHTML"}
      d])])
; DOBRO
(defn get-hour-from-instant [inst]
  (if inst
    (let [zdt (.atZone (.toInstant inst) (ZoneId/of "Europe/Belgrade"))]
      (.getHour zdt))
    0))

(defn db-activity->view-model [db-activity]
  {:id (:db/id db-activity)
   :title (if (:activity/type db-activity)
            (name (:activity/type db-activity)) "unknown")
   :intensity (:activity/intensity db-activity)
   :duration (:activity/duration db-activity)
   :hour (get-hour-from-instant (:activity/start-time db-activity))})

(defn get-activities-for-date [username date-str]
  (let [date (parse-date date-str)
        report (project.api/get-daily-report username date)
        db-activities (:activities report)]
    (map db-activity->view-model db-activities)))
;------
(defn activity->block [{:keys [id title intensity duration hour]}]
  (let [top (+ (* hour 60) 1)    ;; Sat * 60px = Pozicija
        height (- duration 3)]   ;; Trajanje (u minutima) = Visina u px. ODUZMI 3px za marginu/border.

    [:div.activity-block
     {:id (str "activity-" id)
      :hx-get "/activity-edit"
      :hx-target (str "#activity-" id)
      :hx-swap "innerHTML"
      :hx-vals (generate-string {:id id})
      :style (str "position:absolute;"
                  "top:" top "px;"
                  "left:0;"
                  "right:0;"
                  "height:" height "px;"
                  "background:#2c3e50;"
                  "color:white;"
                  "border-radius:6px;"
                  "padding:6px;"
                  "pointer-events: auto;"
                  )}
     [:div.activity-content
      (str title "  " intensity "  " duration "min")] ;; Promenio sam "h" u "min" jer prikazujes minute
     [:button {:hx-delete "/activity"
               :hx-vals (generate-string {:id id})
               :hx-target (str "#act-" id)
               :hx-swap "outerHTML"
               :style "background:none; border:none; cursor:pointer; color:red;"}
      "✕"]]))

(defn calendar-view [day activities]
  [:div#calendar-view.calendar
   [:h3 (str "Day: " (or day "Monday"))]
   [:div.calendar-scroll
    [:div.calendar-grid
     ; leva kolona za vreme
     [:div.time-labels
      (for [hour (range 24)]
        [:div.hour-label (str hour ":00")])]
     ;desna kolona
     [:div.day-grid
      (for [hour (range 24)]
        [:div.hour-slot
         {:hx-get "slot-form"
          :hx-vals (generate-string {:hour hour})
          :hx-target "this"
          :hx-swap "innerHTML"
          :hx-trigger "click once"}
         ])

      [:div#calendar-layer {:style "position: absolute; inset: 0; pointer-events: none; z-index: 10;"}
       (for [a activities]
        (activity->block a))]]]]])

(defn slot-form [hour]
  [:div.slot-form-container  {:style "position:absolute; top:5px; left:5px; z-index:1000;"
                              :onclick "event.stopPropagation()"}
   [:form.slot-form
    {:hx-post "/add-activity"
     :hx-target "#calendar-layer"
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
     [:option {:value "1"} "Low"]
     [:option {:value "3"} "Mid"]
     [:option {:value "5"} "High"]]

    [:select {:name "duration"}
     [:option {:value "30"} "30min"]
     [:option {:value "60"} "1h"]
     [:option {:value "120"} "2h"]
     [:option {:value "180"} "3h"]
     [:option {:value "240"} "4h"]]

    [:button {:type "submit" } "Save"]
    [:button {:type "button"
              :onclick "this.closest('.slot-form-container').remove()"
              :style "background: #ccc; color: black;"} "X"]]])

(defn activity-edit-view [id]
  [:div.activity-edit
   {:style "background:#fff; border:1px solid #ccc; padding:6px; border-radius:6px;"}
   [:span "Edit mode"]
   [:div.activity-actions
    [:button {:hx-delete "/activity"
              :hx-vals (generate-string {:id id})
              :hx-target (str "#activity-" id)
              :hx-swap "delete"}]
    "Delete"]
   [:button
    {:hx-get "/activity-view"
     :hx-vals (generate-string {:id id})
     :hx-target "closest .activity-block"
     :hx-swap "innerHTML"}
    "Cancel"]])

(defn home-page [request]
  (let [today-str (format-date (LocalDate/now))
        activities (get-activities-for-date "Micko" today-str)]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :body
     (common-layout
       [:div
        [:h2 "Calendar"]
        (day-column today-str)
        (calendar-view today-str activities)])}))

(defn select-day-handler [{:keys [params]}]
  (let [day (:day params)
        today-str (format-date (LocalDate/now))
        activities (get-activities-for-date "Micko" day)]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :body (str (str (h/html (calendar-view day activities)))
                (str (h/html (day-column day))))}))

(defn slot-form-handler [{:keys [params]}]
  (let [hour (:hour params)]
    {:status  200
     :headers {"Content-Type" "text/html"}
     :body    (str (h/html (slot-form hour)))
     }))

(defn add-activity-handler [{:keys [params]}]
  (println "UPISUJEM U BAZU: " params)
  (let [username "Micko"
        title (keyword (:title params))
        intensity (Integer/parseInt (:intensity params))
        duration (Integer/parseInt (:duration params))
        hour (Integer/parseInt (:hour params))
        date-str (or (:date params (format-date (LocalDate/now))))

        local-date (parse-date date-str)
        local-time (LocalTime/of hour 0)
        start-time (java.util.Date/from (.toInstant (.atZone (.atTime local-date local-time) (ZoneId/of "Europe/Belgrade"))))]


    @(d/transact s/conn
                 [[:activity/add username title duration intensity start-time]])

    (let [new-activity-view {:id "temp-id"
                             :title (name title)
                             :intensity intensity
                             :duration duration
                             :hour hour}]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :body
     (str
       (h/html (activity->block new-activity-view)))})))

(defn activity-edit-handler [{:keys [params]}]
  (let [id (:id params)]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :body (str (h/html (activity-edit-view id)))})
  )

(defn activity-view-handler [{:keys [params session]}]
  (let [id (:id params)
        day (:select-day session)
        activity (first (filter #(= (:id %) id)
                                (get-in session [:activities day])))]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :body (str (h/html [:div {:hx-get "/activity-edit"
                               :hx-vals (generate-string {:id id})
                               :hx-target (str "#activity-" id)
                               :hx-swap "innerHTML"
                               :style "height:100%; cursor:pointer;"}
                         (str (:title activity) "  "
                              (:intensity activity) "  "
                              (:duration activity) "h")]) )}))

(defn activity-delete-handler [{:keys [params session]}]
  (let [id (:id params)
        day (:select-day session)]
    {:status 200
     :headers {"Content-Type" "text/html"}
     :session (update-in session [:activities day]
                         (fn [acts]
                           (vec (remove #(= (:id %) id) acts))))
     :body ""}
    )
  )

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
                    ["/activity-view" {:get activity-view-handler}]
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
