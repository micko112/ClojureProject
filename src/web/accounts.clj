(ns web.accounts
  "Account settings, privacy, blocking, muting, close friends, follow requests.
   OWNER: accounts agent. The predicate functions below are the contract other
   namespaces (feed, explore, profile) call; defaults allow everything.")

(defn hidden-author-ids
  "Set of user eids whose content must never be shown to `viewer-e`
   (blocked in either direction, muted by viewer)."
  [_db _viewer-e]
  #{})

(defn can-view-posts?
  "Can `viewer-e` (may be nil = logged out) see posts of `author-e`?
   False for private accounts the viewer doesn't follow, and for blocks."
  [_db _viewer-e _author-e]
  true)

(defn close-friend?
  "Is `viewer-e` on `owner-e`'s close-friends list?"
  [_db _owner-e _viewer-e]
  false)

(def routes [])
