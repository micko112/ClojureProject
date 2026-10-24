import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  { path: 'onboarding', loadComponent: () => import('./pages/onboarding/onboarding.component').then(m => m.OnboardingComponent) },
  { path: 'privacy', loadComponent: () => import('./pages/privacy/privacy.component').then(m => m.PrivacyComponent) },
  { path: 'terms', loadComponent: () => import('./pages/terms/terms.component').then(m => m.TermsComponent) },
  { path: 'forgot-password', loadComponent: () => import('./pages/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent) },
  { path: 'reset-password', loadComponent: () => import('./pages/reset-password/reset-password.component').then(m => m.ResetPasswordComponent) },
  {
    path: '',
    loadComponent: () => import('./layout/layout.component').then(m => m.LayoutComponent),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'feed', pathMatch: 'full' },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'feed', loadComponent: () => import('./pages/feed/feed.component').then(m => m.FeedComponent) },
      { path: 'leaderboard', loadComponent: () => import('./pages/leaderboard/leaderboard.component').then(m => m.LeaderboardComponent) },
      { path: 'profile/:username', loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent) },
      { path: 'chat', loadComponent: () => import('./pages/chat/chat.component').then(m => m.ChatComponent) },
      { path: 'groups', loadComponent: () => import('./pages/groups/groups.component').then(m => m.GroupsComponent) },
      { path: 'competitions', loadComponent: () => import('./pages/competitions/competitions.component').then(m => m.CompetitionsComponent) },
      { path: 'competitions/:id', loadComponent: () => import('./pages/competition-detail/competition-detail.component').then(m => m.CompetitionDetailComponent) },
      { path: 'search', loadComponent: () => import('./pages/search/search.component').then(m => m.SearchComponent) },
      { path: 'challenges', loadComponent: () => import('./pages/challenges/challenges.component').then(m => m.ChallengesComponent) },
      { path: 'recap', loadComponent: () => import('./pages/recap/recap.component').then(m => m.RecapComponent) },
      { path: 'stats', loadComponent: () => import('./pages/stats/stats.component').then(m => m.StatsComponent) },
      { path: 'journal', loadComponent: () => import('./pages/journal/journal.component').then(m => m.JournalComponent) },
      { path: 'post/:id', loadComponent: () => import('./pages/post-detail/post-detail.component').then(m => m.PostDetailComponent) },
      { path: 'explore', loadComponent: () => import('./pages/explore/explore.component').then(m => m.ExploreComponent) },
      { path: 'explore/tags/:tag', loadComponent: () => import('./pages/hashtag/hashtag.component').then(m => m.HashtagComponent) },
      { path: 'settings', loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent) },
      { path: 'settings/:section', loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent) },
      { path: 'reels', loadComponent: () => import('./pages/reels/reels.component').then(m => m.ReelsComponent) },
      { path: 'notifications', loadComponent: () => import('./pages/notifications/notifications.component').then(m => m.NotificationsComponent) },
      { path: 'live', loadComponent: () => import('./pages/live/go-live.component').then(m => m.GoLiveComponent) },
      { path: 'live/:id', loadComponent: () => import('./pages/live/watch-live.component').then(m => m.WatchLiveComponent) },
    ]
  },
  { path: '**', redirectTo: '' }
];
