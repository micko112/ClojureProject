(ns project.time
  (:import (java.time.temporal TemporalAdjusters)
           (java.util Date)
           (java.time ZonedDateTime LocalDate ZoneId)
           (java.time Instant LocalDate DayOfWeek MonthDay YearMonth ZoneId)))



(def zone (ZoneId/of "Europe/Belgrade"))

(defn day-interval [^LocalDate date]
  (let [start (.atStartOfDay date zone)
        end   (.plusDays start 1)]
    {:start-day (Date/from (.toInstant start))
     :end-day   (Date/from (.toInstant end))}))

(defn week-interval [^LocalDate date]
  (let [start (.with date (TemporalAdjusters/previousOrSame DayOfWeek/MONDAY))
        start-zdt (.atStartOfDay start  zone)
        end-zdt (.plusWeeks start-zdt 1)
        ]
    {:start-day (Date/from (.toInstant start-zdt))
     :end-day (Date/from (.toInstant end-zdt))}))

(defn month-interval [^LocalDate date]
  (let [ym (YearMonth/of(.getYear date) (.getMonthValue date))
        start (.atDay ym 1)
        start-zdt (.atStartOfDay start zone)
        end (.atDay ym (.lengthOfMonth ym))
        end-zdt (.plusDays (.atStartOfDay end zone) 1)]
    {:start-day (Date/from (.toInstant start-zdt))
     :end-day (Date/from (.toInstant end-zdt))}))
