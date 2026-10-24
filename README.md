# BeBetter

Post your progress. Every day.

## About

BeBetter is an Instagram-style social app built around one habit: share a photo or video of your progress every day, without shame. No filters needed — only your effort counts. Every post shows which day of your journey it is ("Day 37"), your streak keeps you going, and people can only react with support (🔥 💪 👏 🙌 💯 — there are no dislikes).

The original BeBetter tools — daily planner, XP, leaderboard, competitions, challenges, groups, journal, stats and recap — are still there under **More → Your progress tools**.

## Features

### Posting progress
- Composer with up to 10 photos/videos, crop (1:1, 4:5, original), reorder, Before/After compare layout.
- Audience per post: public, followers, or close friends; hide like count; turn off comments.
- "Day N" label on every post, daily streak, a gentle "post today" prompt.

### Feed & discovery
- Infinite feed with carousel and Before/After sliders, double-tap to like, supportive reactions.
- Explore grid, hashtag pages, @mentions, threaded comments, Reels, stories.

### Accounts
- Private accounts with follow requests, block, mute, restrict, close friends.
- Settings: edit profile, username/email/password, privacy, notification preferences, log out of all devices, password reset by email.

### Live & messages
- Realtime notifications, DMs with typing indicators, "Seen", reactions, replies, message requests and shared posts.
- Live video (WebRTC) with live comments and hearts.

### Media
- Cloud storage on Cloudflare R2 / AWS S3 / MinIO (local disk fallback).
- Optimized images (320/640/1080 renditions, blur-up placeholders), EXIF/GPS stripped for privacy.

### Progress tools (original BeBetter)
- Daily planner, XP system (`XP = Duration(min) × Activity-Type × Intensity`), leaderboard with rank ties and deltas, competitions, challenges, groups, journal, stats, recap.

## Usage

### Run with Docker (recommended)
```bash
docker compose up --build
```
Frontend: http://localhost:4200 · API: http://localhost:3000. Set `BEBETTER_SEED=true` on the first start to create demo users (password `password123`).

### Run locally
1. Start the Datomic transactor (in the unzipped Datomic Pro directory):
   ```bash
   bin/transactor config/dev-transactor.properties
   ```
2. Backend:
   ```bash
   lein clean
   lein run
   ```
3. Frontend:
   ```bash
   cd frontend
   npm ci
   npx ng serve   # proxies /api and /uploads to localhost:3000
   ```

Without a transactor you can run the backend on an in-memory database:
```bash
DATOMIC_URI="datomic:mem://dev" BEBETTER_SEED=true lein run
```

### Tests
```bash
lein test                                        # backend, in-memory Datomic, no transactor needed
cd frontend && npx ng build --configuration production
```

Deployment, cloud storage (R2), email and Live/TURN setup: see [DEPLOYMENT.md](DEPLOYMENT.md). Configuration variables: [.env.example](.env.example).

## Development

### Technology
- **Backend:** Clojure (Leiningen), Ring 1.12 + Jetty 11 (WebSockets), Reitit, Datomic, Malli
- **Frontend:** Angular 19 (standalone components, signals), PWA
- **Media:** AWS SDK v2 (S3/R2), Thumbnailator, metadata-extractor
- **Testing:** clojure.test with an in-memory Datomic fixture

### File Structure
```text
src/
  database/        schema.clj + schema_<area>.clj, seed.clj
  project/         planner, XP, leaderboard logic (original BeBetter)
  web/
    server.clj     app, middleware, core routes, combines area routes
    http.clj       shared JSON/session helpers
    posts.clj      posts, feed, explore, hashtags, comments, reactions, streaks
    media.clj      uploads, storage (media/storage.clj), image/video pipeline
    accounts.clj   auth, profiles, privacy, settings, sessions
    realtime.clj   WebSocket, presence;  dm.clj  messages;  live.clj  Live video
    notifications.clj
frontend/src/app/
  layout/          Instagram-style shell (sidebar / bottom tabs)
  pages/           feed, explore, reels, profile, settings, chat, live, ...
  components/      post-card, media, media-carousel, compare-slider, composer, ...
  core/brand.ts    the app name — rename the app here
docs/
  ARCHITECTURE.md  areas, ownership and contracts
```

## Authors

#### Dimitrije Mitić

**Master Student of Faculty of Organizational Sciences**

*Software Engineering and Artificial Intelligence*
