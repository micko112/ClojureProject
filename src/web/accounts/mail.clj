(ns web.accounts.mail
  "Tiny dependency-free SMTP client (EHLO, STARTTLS or implicit TLS, AUTH LOGIN)
   used for password-reset emails. Configured with env vars:
     SMTP_HOST (required to enable), SMTP_PORT (default 587),
     SMTP_USER, SMTP_PASS, SMTP_FROM (defaults to SMTP_USER),
     SMTP_SSL=true for implicit TLS (default when port is 465)."
  (:require [clojure.string :as str])
  (:import (java.net Socket InetSocketAddress)
           (javax.net.ssl SSLSocket SSLSocketFactory)
           (java.io BufferedReader InputStreamReader OutputStream)
           (java.nio.charset StandardCharsets)
           (java.util Base64)
           (java.time ZonedDateTime)
           (java.time.format DateTimeFormatter)))

(defn config []
  (let [env  #(let [v (System/getenv %)] (when-not (str/blank? v) v))
        host (env "SMTP_HOST")]
    (when host
      (let [port (or (some-> (env "SMTP_PORT") Integer/parseInt) 587)]
        {:host host
         :port port
         :user (env "SMTP_USER")
         :pass (env "SMTP_PASS")
         :from (or (env "SMTP_FROM") (env "SMTP_USER") (str "no-reply@" host))
         :ssl? (or (= "true" (env "SMTP_SSL")) (= 465 port))}))))

(defn configured? [] (some? (config)))

(defn- b64 [^String s]
  (.encodeToString (Base64/getEncoder) (.getBytes s StandardCharsets/UTF_8)))

(defn- open-streams [^Socket sock]
  (.setSoTimeout sock 20000)
  {:sock sock
   :in   (BufferedReader. (InputStreamReader. (.getInputStream sock) StandardCharsets/UTF_8))
   :out  (.getOutputStream sock)})

(defn- read-reply [{:keys [^BufferedReader in]}]
  (loop [lines []]
    (let [l (.readLine in)]
      (when (nil? l) (throw (ex-info "SMTP connection closed" {:lines lines})))
      (let [lines (conj lines l)]
        (if (and (>= (count l) 4) (= \- (.charAt ^String l 3)))
          (recur lines)
          {:code (Integer/parseInt (subs l 0 3)) :lines lines})))))

(defn- write! [{:keys [^OutputStream out]} ^String s]
  (.write out (.getBytes s StandardCharsets/UTF_8))
  (.flush out))

(defn- cmd! [conn line ok-codes]
  (when line (write! conn (str line "\r\n")))
  (let [r (read-reply conn)]
    (when-not (contains? ok-codes (:code r))
      (throw (ex-info (str "SMTP error: " (str/join " " (:lines r)))
                      {:command (if (str/starts-with? (str line) "AUTH") "AUTH" line) :reply r})))
    r))

(defn- encode-header [^String s]
  (if (every? #(< (int %) 128) s) s (str "=?UTF-8?B?" (b64 s) "?=")))

(defn- message [{:keys [from to subject body]}]
  (let [body (-> (str body)
                 (str/replace #"\r?\n" "\r\n")
                 ;; dot-stuffing
                 (str/replace #"(?m)^\." ".."))]
    (str "From: " from "\r\n"
         "To: " to "\r\n"
         "Subject: " (encode-header subject) "\r\n"
         "Date: " (.format DateTimeFormatter/RFC_1123_DATE_TIME (ZonedDateTime/now)) "\r\n"
         "MIME-Version: 1.0\r\n"
         "Content-Type: text/plain; charset=UTF-8\r\n"
         "Content-Transfer-Encoding: 8bit\r\n"
         "\r\n"
         body "\r\n.\r\n")))

(defn send!
  "Sends a plain-text email synchronously. Throws on failure."
  [{:keys [to subject body]}]
  (let [{:keys [host port user pass from ssl?]} (or (config) (throw (ex-info "SMTP not configured" {})))
        ^SSLSocketFactory sf (SSLSocketFactory/getDefault)
        sock (if ssl?
               (doto ^SSLSocket (.createSocket sf ^String host (int port)) (.startHandshake))
               (doto (Socket.) (.connect (InetSocketAddress. ^String host (int port)) 15000)))
        conn (volatile! (open-streams sock))]
    (try
      (cmd! @conn nil #{220})
      (let [ehlo (cmd! @conn "EHLO bebetter" #{250})]
        (when (and (not ssl?) (some #(str/includes? (str/upper-case %) "STARTTLS") (:lines ehlo)))
          (cmd! @conn "STARTTLS" #{220})
          (let [tls (doto ^SSLSocket (.createSocket sf ^Socket (:sock @conn) ^String host (int port) true)
                      (.startHandshake))]
            (vreset! conn (open-streams tls))
            (cmd! @conn "EHLO bebetter" #{250}))))
      (when user
        (cmd! @conn "AUTH LOGIN" #{334})
        (cmd! @conn (b64 user) #{334})
        (cmd! @conn (b64 (str pass)) #{235}))
      (cmd! @conn (str "MAIL FROM:<" (second (re-find #"<?([^<>\s]+@[^<>\s]+)>?" from)) ">") #{250})
      (cmd! @conn (str "RCPT TO:<" to ">") #{250 251})
      (cmd! @conn "DATA" #{354})
      (write! @conn (message {:from from :to to :subject subject :body body}))
      (cmd! @conn nil #{250})
      (try (cmd! @conn "QUIT" #{221}) (catch Exception _ nil))
      true
      (finally
        (try (.close ^Socket (:sock @conn)) (catch Exception _ nil))
        (try (.close ^Socket sock) (catch Exception _ nil))))))
