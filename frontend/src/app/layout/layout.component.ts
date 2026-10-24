import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';
import { BadgesService } from '../services/badges.service';
import { ComposerService } from '../services/composer.service';
import { ComposerComponent } from '../components/composer/composer.component';
import { ThemeService } from '../services/theme.service';
import { BRAND } from '../core/brand';
import { NotificationsComponent } from '../pages/notifications/notifications.component';
import { StreakBadgeComponent } from '../components/streak-badge/streak-badge.component';

type Panel = 'search' | 'notifications' | null;
type MoreView = 'main' | 'tools' | 'appearance';

interface RecentSearch { username: string; displayName?: string; profilePic?: string; }

const RECENT_KEY = 'bb-recent-searches';

/** Secondary "Your progress tools" — every pre-v2 page stays reachable from here. */
export const PROGRESS_TOOLS = [
  { path: '/dashboard', icon: 'event_note', label: 'Dashboard & planner' },
  { path: '/stats', icon: 'insights', label: 'Stats' },
  { path: '/journal', icon: 'menu_book', label: 'Journal' },
  { path: '/recap', icon: 'auto_graph', label: 'Recap' },
  { path: '/leaderboard', icon: 'emoji_events', label: 'Leaderboard' },
  { path: '/competitions', icon: 'bolt', label: 'Competitions' },
  { path: '/challenges', icon: 'flag', label: 'Challenges' },
  { path: '/groups', icon: 'groups', label: 'Groups' },
];

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, NotificationsComponent, StreakBadgeComponent, ComposerComponent],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css']
})
export class LayoutComponent implements OnInit, OnDestroy {
  readonly brand = BRAND;
  readonly tools = PROGRESS_TOOLS;

  auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);
  badges = inject(BadgesService);
  composer = inject(ComposerService);
  theme = inject(ThemeService);

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  // Shell state
  readonly url = signal(this.router.url);
  readonly panel = signal<Panel>(null);
  readonly moreOpen = signal(false);
  readonly moreView = signal<MoreView>('main');
  readonly isReels = computed(() => this.url().startsWith('/reels'));

  // Search panel
  searchQuery = '';
  searchResults: any[] = [];
  searching = false;
  showSearchDrop = false;
  readonly recent = signal<RecentSearch[]>(this.readRecent());

  // Badges (kept as aliases for older code that used these names)
  readonly unreadNotifCount = this.badges.unreadNotifications;
  readonly unreadMsgCount = this.badges.unreadMessages;

  // Notifications panel (legacy API kept: toggleNotifPanel / showNotifPanel)
  notifications: any[] = [];
  get showNotifPanel(): boolean { return this.panel() === 'notifications'; }
  set showNotifPanel(v: boolean) { this.panel.set(v ? 'notifications' : null); }

  private searchTimer: any;
  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
      const u = (e as NavigationEnd).urlAfterRedirects;
      this.url.set(u);
      this.moreOpen.set(false);
      // PWA shortcut / deep link: any URL with ?create=1 opens the composer
      const tree = this.router.parseUrl(u);
      if (tree.queryParams['create'] === '1') {
        this.composer.open();
        const { create, ...rest } = tree.queryParams;
        tree.queryParams = rest;
        this.router.navigateByUrl(tree, { replaceUrl: true });
      }
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  get user() { return this.auth.currentUser(); }
  get isDark(): boolean { return this.theme.isDark; }

  profileUrl(): string { return this.user ? `/profile/${this.user.username}` : '/login'; }
  isProfileActive(): boolean { return !!this.user && this.url().startsWith(`/profile/${this.user.username}`); }
  isToolActive(): boolean { return this.tools.some(t => this.url().startsWith(t.path)); }

  // ---------- Panels / menus ----------
  togglePanel(p: Exclude<Panel, null>): void {
    this.moreOpen.set(false);
    this.panel.set(this.panel() === p ? null : p);
    if (this.panel() === 'search') setTimeout(() => this.searchInput?.nativeElement.focus(), 60);
  }
  closePanel(): void { this.panel.set(null); }

  toggleNotifPanel(): void { this.togglePanel('notifications'); }

  toggleMore(): void {
    this.moreView.set('main');
    this.panel.set(null);
    this.moreOpen.update(v => !v);
  }
  closeMore(): void { this.moreOpen.set(false); }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.moreOpen()) this.moreOpen.set(false);
    else if (this.panel()) this.panel.set(null);
  }

  // ---------- Search ----------
  onSearchInput(): void {
    clearTimeout(this.searchTimer);
    const q = this.searchQuery.trim();
    if (!q) { this.searchResults = []; this.showSearchDrop = false; this.searching = false; return; }
    this.searching = true;
    this.searchTimer = setTimeout(() => {
      this.api.searchUsers(q).subscribe({
        next: r => { this.searchResults = (r || []).slice(0, 20); this.showSearchDrop = true; this.searching = false; },
        error: () => { this.searchResults = []; this.showSearchDrop = true; this.searching = false; }
      });
    }, 250);
  }

  onSearchEnter(): void {
    const q = this.searchQuery.trim();
    if (!q) return;
    this.showSearchDrop = false;
    this.panel.set(null);
    this.router.navigate(['/search'], { queryParams: { q } });
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.showSearchDrop = false;
    this.searchInput?.nativeElement.focus();
  }

  selectResult(user: any): void {
    this.addRecent(user);
    this.showSearchDrop = false;
    this.searchQuery = '';
    this.searchResults = [];
    this.panel.set(null);
    this.router.navigate(['/profile', user.username]);
  }

  closeSearchDrop(): void { setTimeout(() => { this.showSearchDrop = false; }, 150); }

  private readRecent(): RecentSearch[] {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 15); } catch { return []; }
  }
  private writeRecent(list: RecentSearch[]): void {
    this.recent.set(list);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
  }
  addRecent(u: any): void {
    const item: RecentSearch = { username: u.username, displayName: u.displayName, profilePic: u.profilePic };
    this.writeRecent([item, ...this.recent().filter(r => r.username !== u.username)].slice(0, 15));
  }
  removeRecent(username: string, e: Event): void {
    e.stopPropagation();
    this.writeRecent(this.recent().filter(r => r.username !== username));
  }
  clearRecent(): void { this.writeRecent([]); }

  // ---------- Legacy notification helpers (kept for compatibility) ----------
  notifIcon(type: string): string {
    const icons: Record<string, string> = {
      like: 'favorite', comment: 'chat_bubble', follow: 'person_add', mention: 'campaign', live: 'sensors'
    };
    return icons[type] || 'notifications';
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // ---------- Create ----------
  /** New entry point for every Create button. */
  create(): void {
    this.panel.set(null);
    this.moreOpen.set(false);
    this.composer.open();
  }

  // ---------- Appearance / account ----------
  toggleTheme(): void { this.theme.toggle(); }

  logout(): void {
    this.moreOpen.set(false);
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }

  avatar(): string { return this.user?.profilePic || ''; }
  initials(u?: { displayName?: string; username?: string } | null): string {
    const n = (u ?? this.user)?.displayName || (u ?? this.user)?.username || '?';
    return n.charAt(0).toUpperCase();
  }

  badgeText(n: number): string { return n > 99 ? '99+' : String(n); }
}
