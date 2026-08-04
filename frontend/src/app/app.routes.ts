import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  { path: 'privacy', loadComponent: () => import('./pages/privacy/privacy.component').then(m => m.PrivacyComponent) },
  { path: 'terms', loadComponent: () => import('./pages/terms/terms.component').then(m => m.TermsComponent) },
  {
    path: '',
    loadComponent: () => import('./layout/layout.component').then(m => m.LayoutComponent),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
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
      { path: 'post/:id', loadComponent: () => import('./pages/post-detail/post-detail.component').then(m => m.PostDetailComponent) },
    ]
  },
  { path: '**', redirectTo: '' }
];
