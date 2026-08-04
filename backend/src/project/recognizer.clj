(ns project.recognizer
  (:require [clojure.string :as str]))

;; Keyword patterns ordered by specificity (more specific first)
(def ^:private patterns
  [{:kw ["deep work" "deep focus" "flow state" "focused session"]
    :a :deep-work :d 90 :i 4}
   {:kw ["cold shower" "cold bath" "ice bath" "cold plunge" "wim hof"]
    :a :cold-shower :d 5 :i 3}
   {:kw ["music practice" "practice instrument" "instrument practice"]
    :a :music :d 45 :i 2}
   {:kw ["yard work" "hobby" "garden" "gardening" "woodwork" "craft" "diy"]
    :a :hobby :d 60 :i 2}
   {:kw ["drawing" "illustration" "sketch" "illustrat"]
    :a :drawing :d 60 :i 2}
   {:kw ["martial arts" "boxing" "mma" "judo" "karate" "bjj" "jiu-jitsu"
         "wrestling" "kickbox" "muay thai" "taekwondo" "fight"]
    :a :martial-arts :d 60 :i 4}
   {:kw ["run" "running" "jog" "jogging" "sprint" "5k" "10k" "half marathon"
         "marathon" "km run" "miles run"
         ;; sr/bs
         "trcao" "trčao" "trcanje" "trčanje" "džogirao" "dzogirao" "sprint" "kros"]
    :a :running :d 30 :i 3}
   {:kw ["gym" "lift" "weight" "bench" "squat" "deadlift" "pull-up" "push-up"
         "dumbbell" "barbell" "workout" "training"
         ;; sr/bs
         "teretana" "trenirao" "trening" "vežbao" "vezbao" "fitnes" "fitness"
         "sklekovi" "zgibovi" "čučnjevi" "cucnjevi" "bench press"]
    :a :training :d 60 :i 3}
   {:kw ["swim" "swimming" "pool" "laps" "freestyle" "breaststroke"
         ;; sr/bs
         "plivao" "plivanje" "bazen"]
    :a :swimming :d 45 :i 3}
   {:kw ["bike" "cycling" "bicycle" "cycle" "rode bike" "biked"
         ;; sr/bs
         "bicikl" "vozio bicikl" "vožnja bicikla" "kolesanje"]
    :a :cycling :d 45 :i 2}
   {:kw ["hike" "hiking" "trail" "trekking" "trek"
         ;; sr/bs
         "planinarenje" "planinarile" "planina" "staza" "treking" "trekking"]
    :a :hiking :d 90 :i 2}
   {:kw ["walk" "walked" "walking" "stroll"
         ;; sr/bs
         "šetao" "setao" "šetnja" "setnja" "prošetao" "proseto"]
    :a :walking :d 30 :i 1}
   {:kw ["yoga" "asana" "vinyasa"
         ;; sr/bs
         "joga" "jogu"]
    :a :yoga :d 45 :i 1}
   {:kw ["stretch" "stretching" "flexibility" "mobility"
         ;; sr/bs
         "istezanje" "istezao" "fleksibilnost" "mobilnost"]
    :a :stretching :d 20 :i 1}
   {:kw ["climb" "climbing" "bouldering" "boulder"
         ;; sr/bs
         "penjanje" "penjao" "bouldering"]
    :a :climbing :d 60 :i 3}
   {:kw ["football" "soccer" "basketball" "tennis" "volleyball" "handball"
         "ping pong" "badminton" "sport"
         ;; sr/bs
         "fudbal" "košarka" "kosarka" "tenis" "odbojka" "rukomet"
         "igrao fudbal" "igrao košarku" "sport"]
    :a :sports :d 60 :i 3}
   {:kw ["coding" "programm" "code" "debug" "develop" "software" "github"
         "commit" "pull request"
         ;; sr/bs
         "kodirao" "programirao" "razvijao" "debugovao" "hakirao" "hakao"
         "pisao kod" "radio na kodu" "backend" "frontend"]
    :a :coding :d 90 :i 3}
   {:kw ["work" "office" "meeting" "email" "client" "project task"
         ;; sr/bs
         "radio" "posao" "poslovni" "sastanak" "mejlovi" "klijent" "projekat"
         "office" "kancelarija"]
    :a :work :d 60 :i 2}
   {:kw ["meditat" "mindful" "breath" "sat in silence" "zazen"
         ;; sr/bs
         "meditirao" "meditacija" "disanje" "svjesnost" "mindfulness"]
    :a :meditation :d 20 :i 1}
   {:kw ["course" "tutorial" "lecture" "online class" "elearning" "learn"
         ;; sr/bs
         "kurs" "tutorijal" "predavanje" "ucio" "učio" "učenje" "ucenje"
         "online kurs" "edukacija"]
    :a :learning :d 60 :i 2}
   {:kw ["study" "studying" "exam" "revision" "homework" "textbook"
         ;; sr/bs
         "ucio" "učio" "ispiti" "ispit" "zadatak" "domaći" "domaci"
         "repeticio" "revizija" "knjiga" "udžbenik" "udzbenicik"]
    :a :study :d 60 :i 2}
   {:kw ["read" "reading" "book" "novel" "article"
         ;; sr/bs
         "citao" "čitao" "čitanje" "citanje" "knjiga" "roman" "članak" "clanak"]
    :a :reading :d 30 :i 1}
   {:kw ["journal" "journaling" "diary" "wrote in journal"
         ;; sr/bs
         "pisao u dnevnik" "dnevnik" "pisao o sebi" "refleksija"]
    :a :journaling :d 20 :i 1}
   {:kw ["plan" "planning" "organize" "schedule" "goal setting"
         ;; sr/bs
         "planirao" "planiranje" "organizovao" "raspored" "ciljevi" "plan dana"]
    :a :planning :d 30 :i 2}
   {:kw ["write" "writing" "essay" "blog post" "wrote"
         ;; sr/bs
         "pisao" "pisanje" "esej" "blog" "clanak" "članak" "tekst"]
    :a :writing :d 45 :i 2}
   {:kw ["guitar" "piano" "violin" "drums" "bass" "sing" "singing" "music"
         ;; sr/bs
         "gitara" "svirao" "klavir" "violina" "bubnjevi" "pjevao" "pevao"
         "muzika" "instrument" "muzicirao"]
    :a :music :d 45 :i 2}
   {:kw ["draw" "paint" "painting" "art"
         ;; sr/bs
         "crtao" "crtanje" "slikao" "slika" "umetnost" "umjetnost" "art"]
    :a :drawing :d 60 :i 2}
   {:kw ["photo" "photograph" "camera" "shoot" "shot"
         ;; sr/bs
         "fotografisao" "foto" "kamera" "snimao" "fotografija"]
    :a :photography :d 60 :i 2}
   {:kw ["cook" "cooking" "meal prep" "bake" "baking" "recipe"
         ;; sr/bs
         "kuvao" "kuvanje" "jelo" "recept" "pekao" "pripremao hranu"
         "obrok" "sprema jelo"]
    :a :cooking :d 45 :i 1}
   {:kw ["clean" "cleaning" "vacuum" "sweep" "dishes" "laundry" "tidy"
         ;; sr/bs
         "cistio" "čistio" "čišćenje" "ciscenje" "pospremao" "usisao"
         "ribao" "sudove" "veš" "ves" "prao"]
    :a :cleaning :d 30 :i 1}
   {:kw ["sleep" "slept" "nap" "power nap" "rest"
         ;; sr/bs
         "spavao" "san" "odmorio" "odmor" "drijemao" "drjemao" "siesta"]
    :a :sleep :d 60 :i 1}
   {:kw ["volunteer" "volunteering" "charity" "helped out"
         ;; sr/bs
         "volontirao" "volontiranje" "pomogao" "humanitarno" "akcija"]
    :a :volunteering :d 120 :i 2}
   {:kw ["network" "networking" "conference" "meetup" "event"
         ;; sr/bs
         "mrežio" "konferencija" "meetup" "event" "dogadjaj" "događaj"]
    :a :networking :d 60 :i 2}
   {:kw ["social" "friends" "party" "hangout" "dinner with" "lunch with" "meet up"
         ;; sr/bs
         "drugarstvo" "sa drugarima" "družio" "druzio" "zabava" "žurka" "zurka"
         "izašao" "izasao" "kafica" "kafic" "ručao" "rucao" "vecera" "večera"]
    :a :socializing :d 120 :i 1}])

(defn- extract-duration [text]
  (or (when-let [[_ h m] (re-find #"(\d+)h\s*(\d+)(?:m|min)" text)]
        (+ (* 60 (Integer/parseInt h)) (Integer/parseInt m)))
      (when-let [[_ h] (re-find #"(\d+)[.,]5\s*(?:sat|hour|hr|h)\b" text)]
        (+ (* 60 (Integer/parseInt h)) 30))
      (when-let [[_ h] (re-find #"(\d+)\s*(?:hour|hr|sat[ai]?)s?" text)]
        (* 60 (Integer/parseInt h)))
      (when-let [[_ m] (re-find #"(\d+)\s*(?:minute|min|minut[ae]?)s?" text)]
        (Integer/parseInt m))
      (when-let [[_ h m] (re-find #"(\d+):(\d+)" text)]
        (+ (* 60 (Integer/parseInt h)) (Integer/parseInt m)))))

(defn- extract-intensity [text]
  (cond
    (re-find #"easy|light|gentle|casual|slow|relaxed|chill|lako|lagano|opusteno|sporo" text) 1
    (re-find #"moderate|medium|normal|average|steady|regular|umjereno|umjerena|srednje|normalno" text) 2
    (re-find #"hard|tough|challenging|intense|strong|heavy|tesko|teška|teško|intenzivno|zahtjevno|jako" text) 4
    (re-find #"max|extreme|brutal|exhausting|killer|all.out|beast|maksimalno|ekstremno|brutalno|iscrpljujuce|ubojito" text) 5))

(defn recognize
  "Analyzes free text and returns {activityType duration intensity} or nil."
  [text]
  (when (seq text)
    (let [lower (str/lower-case (str/trim text))
          match (first (filter #(some (fn [kw] (str/includes? lower kw)) (:kw %)) patterns))
          dur   (or (extract-duration lower) (:d match 30))
          inten (or (extract-intensity lower) (:i match 2))]
      (when match
        {:activityType (name (:a match))
         :duration     (max 1 (min 480 dur))
         :intensity    (max 1 (min 5 inten))}))))
