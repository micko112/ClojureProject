(ns web.calendar-tutorial
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
            [cheshire.core :refer :all])
  (:import (java.time LocalDate LocalTime Duration ZoneId)
           (java.time.format DateTimeFormatter)
           (java.util UUID)))

(def css-styles
  (str/trim "
    * { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 0; box-sizing: border-box; }
    body { font-size: 16px; line-height: 1.5; color: var(--color-text-dark); }
    :root {    --font-size-sm: 0.875rem;  --font-size-md: 1rem;  --font-size-lg: 1.125rem;  --line-height-sm: 1.25rem;  --line-height-md: 1.5rem;  --line-height-lg: 1.75rem;  --border-radius-md: 0.25rem;  --duration-sm: 100ms;  --color-blue-500: #3b82f6;  --color-blue-600: #2563eb;  --color-gray-100: #f3f4f6;  --color-gray-300: #d1d5db;  --color-white: #ffffff;  --color-text-light: #f9fafb;  --color-text-dark: #030712; }
    .app { display: grid; grid-template-columns: auto 1fr; height: 100vh; }
    .main { display: flex; flex-direction: column; height: 100%; }
    .sidebar { border-right: 1px solid var(--color-gray-300); width: 17rem; }
    .button { font-size: var(--font-size-sm); line-height: var(--line-height-sm); font-weight: 400; border-radius: var(--border-radius-md); border: none; padding: 0 1rem; height: 2.125rem; cursor: pointer; transition: background-color var(--duration-sm) ease-out; }
    .button--secondary { background-color: var(--color-white); border: 1px solid var(--color-gray-300); color: var(--color-text-dark); }
    .button--secondary:hover { background-color: var(--color-gray-100); }
    .button--icon { display: flex; align-items: center; justify-content: center; width: 2.125rem; padding: 0; border: none; }
    .button__icon { width: 1rem; }
    .nav { border-bottom: 1px solid var(--color-gray-300); display: flex; padding: 0.5rem 1rem; gap: 1rem; }
    .nav__date-info { flex: 1; display: flex; align-items: center; justify-content: space-between; flex-direction: row-reverse; }
    .nav__controls { display: flex; gap: 0.125rem; }
    .nav__arrows { display: flex; gap: 0.125rem; }
    .nav__date { font-size: var(--font-size-lg); line-height: var(--line-height-lg); }
    @media (min-width: 768px) { .nav { justify-content: space-between; gap: 0; padding: 0.5rem; } .nav__date-info { flex-direction: row; justify-content: flex-start; gap: 1rem; } .nav__controls { gap: 0.5rem; } }
    .select { position: relative; color: var(--color-text-dark); }
    .select__select { font-size: var(--font-size-sm); line-height: var(--line-height-sm); font-weight: 400; color: var(--color-text-dark); background-color: transparent; border-radius: var(--border-radius-md); border: 1px solid var(--color-gray-300); padding: 0 2rem 0 0.75rem; height: 2.125rem; cursor: pointer; appearance: none; }
    .select__icon { position: absolute; top: 50%; right: 0.5rem; transform: translateY(-50%); width: 1.125rem; pointer-events: none; }
    .calendar { height: 100%; }
    @media (min-width: 768px) { .mobile-only { display: none; } }
    @media (max-width: 767px) { .desktop-only { display: none; } }

    .month-calendar { display: flex; flex-direction: column; height: 100%; }
    .calendar {height: 100%;}
   /* Zaglavlje (Mon, Tue...) */
   .month-calendar__day-of-week-list {
     list-style: none;
     display: grid;
     grid-template-columns: repeat(7, minmax(0, 1fr));
     border-bottom: 1px solid #d1d5db;
     padding: 0.75rem 0;
   }

   .month-calendar__day-of-week {
     font-size: 0.875rem;
     text-align: center;
     font-weight: 500;
   }

   /* Mreža sa danima */
   .month-calendar__day-list-wrapper { position: relative; flex: 1; }

   .month-calendar__day-list {
     list-style: none;
     position: absolute;
     inset: 0;
     display: grid;
     grid-template-columns: repeat(7, minmax(0, 1fr));
     grid-template-rows: repeat(5, minmax(auto, 1fr)); /* Za 5 nedelja */
     overflow-y: auto;
   }

   /* Jedna kockica (dan) */
   .month-calendar__day {
     display: flex;
     flex-direction: column;
     border-right: 1px solid #d1d5db;
     border-bottom: 1px solid #d1d5db;
   }

   /* Uklanjamo desni border za nedelju (poslednji dan) */
   .month-calendar__day:nth-child(7n) { border-right: 0; }

   /* Broj dana */
   .month-calendar__day-label {
     color: #030712;
     width: 100%;
     padding: 0.5rem 0;
     background-color: transparent;
     border: 0;
     cursor: pointer;
     text-align: center;
     font-weight: bold;
   }

   /* Prostor za aktivnosti unutar dana */
   .month-calendar__event-list-wrapper {
     flex-grow: 1;
     padding-bottom: 1.5rem;
   }
 "))

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

(defn hamburger-btn []
  [:button.button.button--icon.button--secondary.mobile-only
   [:svg {:xmlns        "http://www.w3.org/2000/svg"
          :width        24 :height 24 :viewBox "0 0 24 24"
          :fill "none" :stroke "currentColor"
          :stroke-width 2 :stroke-linecap "round" :stroke-linejoin "round"}
    [:line {:x1 4 :x2 20 :y1 12 :y2 12}]
    [:line {:x1 4 :x2 20 :y1 6 :y2 6}]
    [:line {:x1 4 :x2 20 :y1 18 :y2 18}]]])

(defn nav-arrows []
  [:div.nav__arrows
   [:button.button.button--icon.button--secondary "←"]
   [:button.button.button--icon.button--secondary "→"]])

(defn nav-date-info [date]
  [:div.nav__date-info
   [:div.nav__controls
    [:button.button.button--secondary.desktop-only
     {:hx-get "/today"}
     "Today"]
    (nav-arrows)]
   [:time.nav__date date]])
(defn view-select [current]
  [:div.select.desktop-only
   [:select.select__select
    {:hx-get "/change-view"}
    (for [v ["day" "week" "month"]]
      [:option {:value v :selected (= v current)}
       (clojure.string/capitalize v)])]])

(defn nav [{:keys [date view]}]
  [:div.nav
   (hamburger-btn)
   (nav-date-info date)
   (view-select view)])
(def days-of-the-week
  ["Monday" "Tuesday" "Wednesday" "Thursday" "Friday" "Saturday" "Sunday"])

(defn calendar []
  [:div.month-calendar

   [:ul.month-calendar__day-of-week-list
    (for [d days-of-the-week]
      [:li.month-calendar__day-of-week d])]
   [:div.month-calendar__day-list-wrapper
    [:ul.month-calendar__day-list
     (for [num (range 31)]
       [:li.month-calendar__day
        [:button.month-calendar__day-label (inc num)]
        [:div.month-calendar__event-list-wrapper
         [:ul.event-list]]])
     (for [num (range 4)]
       [:li.month-calendar__day
        [:button.month-calendar__day-label (inc num)]
        [:div.month-calendar__event-list-wrapper
         [:ul.event-list]]])]]])

(defn common-layout [& content]
  (html5
   [:head
    [:title "BeBetter"]
    [:meta {:charset "UTF-8"}]
    [:script {:src "https://unpkg.com/htmx.org@1.9.10"}]
    [:style css-styles]]
   [:body
    [:div.app
     [:div (sidebar)]
     [:main.main
      [:div (nav {:date (LocalDate/now) :view "week"})]
      content]]]))

(defn home-page [{:keys [session]}]
  {:status 200
   :headers {"Content-Type" "text/html"}
   :body
   (common-layout
    (calendar))})

(defn nav-handler [request]
  {:status 200
   :headers {"Content-Type" "text/html"}
   :body (h/html (nav {:date (LocalDate/now) :view "week"}))})

(def app
  (wrap-session
   (ring/ring-handler
    (ring/router [["/" {:get home-page}]]
                 {:data {:middleware [parameters/parameters-middleware
                                      wrap-keyword-params]}}))))

(defonce server (atom nil))

(defn start-server []
  (when-not @server
    (reset! server (jetty/run-jetty #'app {:port 3000 :join? false}))
    (println "server pokrenut na http://localhost:3000")))

(defn stop-server []
  (when-some [s @server] ;; check if there is an object in the atom
    (.stop s)
    (reset! server nil)))

(defn hx
  [{:keys [get post delete target swap trigger vals on oob]}]
  (cond-> {}
    get     (assoc :hx-get get)
    post    (assoc :hx-post post)
    delete  (assoc :hx-delete delete)
    target  (assoc :hx-target target)
    swap    (assoc :hx-swap (name swap))
    trigger (assoc :hx-trigger trigger)
    vals    (assoc :hx-vals (generate-string vals))
    oob     (assoc :hx-swap-oob "true")
    (and on (map? on))
    (merge (reduce-kv (fn [m k v]
                        (assoc m
                               (keyword (str "hx-on:" (name k)))
                               v))
                      {}
                      on))))