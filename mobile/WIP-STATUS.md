# Mobile app — work in progress

Stopped mid-way when the cloud session ended. State at handoff:

- Expo SDK 57 (react-native 0.86), expo-router, TypeScript strict; `npx tsc --noEmit` passes.
- Done (foundation): theme + base components (`src/components`), auth flow
  (login/register/forgot, server URL sheet, bearer token in SecureStore),
  tab layout and every route from the plan (most non-feed screens are
  placeholders), home feed pieces (`src/features/feed`, `src/features/posts`:
  PostCard, MediaCarousel, CompareSlider, HeartBurst, StreakBanner, NewPostsPill).
- Not done yet: verifying lint / `expo export`, design screenshots, README
  testing guide, app icon/splash, CI job; then the remaining screens
  (composer + camera + story, profile/settings/search/explore, DMs/reels/
  notifications/push, live viewer).

Backend auth for mobile: `X-Auth-Mode: token` on login/register → `token`;
then `Authorization: Bearer <token>`; WebSocket `/api/ws?access_token=`.
See src/web/tokens.clj.
