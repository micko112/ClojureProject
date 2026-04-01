# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**BeBetter** — a gamified productivity social network. Users log activities (training, studying, coding, etc.), earn XP, and compete on leaderboards. The core philosophy: make effort visible and measurable.

Implemented: Activities (Google Calendar week/month view), Feed (Instagram-style with stories), Leaderboard (podium + ranked list), Profile (stats + XP breakdown), Login/Register. Search not implemented.

## Commands

### Backend (Clojure)

```bash
# Start REPL
lein repl

# Run all tests
lein test
lein midje           # run Midje tests specifically

# Run a single test namespace
lein test project.api-test

# Format code
lein cljfmt fix

# Build uberjar
lein uberjar

# Run app
lein run
```

### Frontend (Angular)

```bash
cd frontend
npm install
ng serve             # dev server on localhost:4200
ng build             # production build to dist/
```

### Datomic

Datomic Pro transactor must be running before the app starts:
```bash
# Start transactor (path depends on Datomic install location)
bin/transactor config/samples/dev-transactor-template.properties
```

Database URI: `datomic:dev://localhost:4334/bebetter`

Reset/seed database from REPL:
```clojure
(require '[project.system :as sys])
(sys/reset-db!)   ; drops and recreates with schema + seed data
(sys/migrate!)    ; safe migration (adds reaction support without data loss)
```

## Architecture

### Backend layers

```
src/project/
├── core.clj        — entry point, starts server after validating DB connection
├── system.clj      — DB initialization, reset-db!, migrate!
├── connection.clj  — Datomic connection singleton (defonce conn)
├── api.clj         — public API functions called by HTTP handlers
├── db.clj          — all Datomic queries and transaction functions
├── leaderboard.clj — pure ranking logic (tie handling, rank deltas)
├── validation.clj  — Malli schemas for all inputs
└── time.clj        — timezone-aware interval helpers (Europe/Belgrade)

src/web/
└── server.clj      — Ring + Reitit HTTP server, all routes, CORS

src/database/
├── schema.clj      — Datomic schema (4 entity types)
└── seed.clj        — initial users and activity types
```

### Call chain

HTTP request → `server.clj` handler → `api.clj` function → `db.clj` query/transaction → Datomic

`leaderboard.clj` contains pure functions; `api.clj` calls `db.clj` to get data and passes it to leaderboard functions.

### Data model (Datomic schema)

- **User**: `:user/username` (unique), `:user/xp`
- **Activity**: `:activity/user` (ref), `:activity/type` (ref), `:activity/duration` (minutes), `:activity/intensity` (1–5), `:activity/start-time` (instant, indexed)
- **Activity-Type**: `:activity-type/key` (unique keyword), `:activity-type/name`, `:activity-type/xp-per-minute`
- **Reaction**: `:reaction/from-user`, `:reaction/to-user`, `:reaction/date` (ISO string), `:reaction/emoji`

XP formula: `duration × intensity × xp-per-minute`

### HTTP API (port 3000)

CORS is open for `localhost:4200`. Session-based auth via Ring sessions.

Key endpoints:
- `POST /api/activities` — log activity (triggers XP update atomically via Datomic transaction function)
- `DELETE /api/activities/:id` — delete and refund XP
- `GET /api/leaderboard?period=weekly&date=2025-01-01` — ranked list with tie handling and rank deltas
- `GET /api/users/:username/stats` — streak, XP by type, active days
- `POST /api/reactions` — toggle emoji reaction (idempotent)

### Frontend (Angular 19, `frontend/`)

Standalone components, signal-based state. Services: `api.service.ts` (HTTP), `auth.service.ts` (session). Auth guard protects all routes except `/login`.

**Design system**: full dark theme via CSS custom properties in `styles.css`. All pages import from `--bg`, `--accent`, `--text`, `--border` etc. No external icon or UI library — SVG icons are inline in templates.

**Pages:**
- `dashboard` — Google Calendar-style week/month view. `forkJoin` loads 7 (week) or ~30 (month) day-requests in parallel. Activities rendered as absolute-positioned colored blocks (64px/hour). Click empty slot → add modal; click block → delete popup at bottom. Current time red line.
- `feed` — Instagram layout. Stories bar built from feed data (users with activities = story ring). Story overlay with progress bars, tap-left/right navigation, keyboard arrows. Posts have emoji reactions via `POST /api/reactions`.
- `leaderboard` — Podium (top 3) + ranked list. Four period tabs (today/week/month/all-time).
- `profile` — Stats cards (streak, weekly XP, active days, monthly XP), XP-by-activity horizontal bars, day navigator with activity list.
- `login` — Split-screen: hero branding left, auth card right. Two tabs: Sign In (user card list) / Create Account.

## Key behaviors

**Leaderboard tie logic**: users with equal XP get the same rank; `leaderboard.clj` handles this and new-user edge cases for delta calculation.

**Activity types**: seeded at startup — Training (10 XP/min), Coding (8 XP/min), Work (8 XP/min), Hobby/Yard (7 XP/min), Study (6 XP/min).

**Validation**: all inputs go through Malli schemas in `validation.clj` before reaching `db.clj`. Username: alphanumeric + dots/underscores, 1–30 chars.

**Datomic transaction functions**: `add-xp-tx` and `add-activity-tx` are stored database functions ensuring XP updates are atomic.

## Testing

- `test/project/api_test.clj` — unit tests for leaderboard ranking (pure functions, no DB)
- `test/project/uredno_test.clj` — Midje integration tests using in-memory Datomic (`fresh-conn` fixture)
