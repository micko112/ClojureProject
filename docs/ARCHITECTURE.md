# BeBetter v2 — Instagram-style progress posting

Goal: people post their progress every day without feeling ashamed. The app
looks and works like Instagram (feed, carousel posts, stories, reels, explore,
profiles, DMs, live, notifications, full account settings). Existing features
(planner, XP, leaderboard, competitions, groups, journal, stats, recap) stay,
but move behind a secondary "Progress tools" menu. The product name lives only
in `frontend/src/app/core/brand.ts` so it can be renamed in one place.

## Feature areas and ownership

| Area | Backend namespace | Schema file | Frontend |
|------|-------------------|-------------|----------|
| Media & cloud | `web.media` | `database/schema_media.clj` | `components/media`, composer (create post), upload service |
| Posts & feed | `web.posts` (+ post handlers in `web.server`) | `database/schema_posts.clj` | feed, post card, carousel/compare slider, explore, hashtag, post detail, comments |
| Accounts | `web.accounts` (+ auth/profile handlers in `web.server`) | `database/schema_accounts.clj` | profile page, settings pages, follow requests, login/register/reset |
| Realtime & live | `web.realtime`, `web.notifications` | `database/schema_realtime.clj` | `services/realtime.service.ts`, chat live features, live broadcast pages |
| Shell & UX | — (small read-only endpoints allowed) | — | layout/navigation, reels page, notifications page, progress streak UX, design system |
| Activity classifier | `web.vision` (+ Python service in `ml/`) | `database/schema_vision.clj` | `services/vision.service.ts`, "Looks like" chips in the composer |

Shared, everyone may use, nobody restructures: `web.http` (JSON helpers),
`project.test-db` (in-memory Datomic fixture for tests).

Routes: each area exports `routes` (a reitit vector); `web.server/routes`
concatenates them. Schema: each area exports `schema`; `database.schema/all-schemas`
concatenates them. Schema changes must be additive (new attributes only) because
production data already exists — never change the type of an existing attribute.

## Contracts between areas

### Media DTO (`web.media/media-dto`, `models/media.model.ts`)
```
{id, type: "image"|"video", url, width, height,
 variants: [{w, url}] (ascending), placeholder: "data:image/...", posterUrl, durationSec}
```
`POST /api/media` (multipart `file`, optional `poster` for video) → Media DTO.
The upload response (only) may also carry
`suggestions: [{activity, label, emoji, score}]` from the activity classifier.
`POST /api/upload` stays working for legacy callers (returns `{url}`).

### Post DTO and creation (`models/post.model.ts`)
Post DTO = previous fields + `media: Media[]`, `layout: single|carousel|compare`,
`audience: public|followers|close-friends`, `hideLikes`, `commentsOff`,
`likeCount`, `dayNumber`, `editedAt`. Legacy posts with only `mediaUrl` are
returned with a one-item `media` array.
`POST /api/posts {caption, mediaIds[], layout?, audience?, hideLikes?, commentsOff?, activityTag?}`.

### Activity classifier (`web.vision`, `ml/`)
Optional: everything works without `ML_URL`. After an upload, `web.media`
calls `(web.vision/classify bytes {:embedding? true})` (2 s timeout, circuit
breaker) and stores `:media/predictions`, `:media/embedding`.
`web.posts` calls `(web.vision/sync-labels! post-id)` after create/update so
the post's activity tag (normalized with `web.vision/normalize-activity`)
becomes a `:vision-label/*` training example. Activity keys are shared
between `web.vision/activities` and `ml/app/activities.py`.
Endpoints: `POST /api/vision/classify` (composer preview, stores nothing),
admin-only `GET /api/vision/status`, `POST /api/vision/retrain`,
`GET /api/vision/export` (`ADMIN_USERNAMES`).

### Privacy (`web.accounts`)
`(hidden-author-ids db viewer-e)`, `(can-view-posts? db viewer-e author-e)`,
`(close-friend? db owner-e viewer-e)` — every endpoint that lists posts/stories
must respect them.

### Notifications & realtime
`(web.notifications/create-notif! recipient-e type msg {:actor-e :post-e})`.
Notification DTO: `{id, type, message, read, createdAt, actor?, postId?}`.
`(web.realtime/publish! username {:type ...})` pushes to a user's open sockets.
Frontend: `RealtimeService.on('notification' | 'message' | ...)`.

## Running locally
Backend tests: `lein test` (uses in-memory Datomic, no transactor needed).
ML service: `cd ml && python scripts/download_model.py && python -m unittest discover -s tests -t .`.
Frontend: `cd frontend && npm ci && npx ng build --configuration production`.
