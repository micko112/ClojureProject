(ns web.realtime
  "Realtime push to connected clients (WebSocket) + Live broadcasting signaling.
   OWNER: realtime agent. Until implemented, publish! is a no-op so other
   namespaces can already call it.")

(defn publish!
  "Push `event` (a map with at least :type) to every open connection of the
   user identified by `username`. Safe to call when the user is offline."
  [_username _event]
  nil)

(def routes [])
