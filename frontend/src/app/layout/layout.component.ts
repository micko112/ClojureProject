import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css']
})
export class LayoutComponent implements OnInit, OnDestroy {
  searchQuery = '';
  searchResults: any[] = [];
  showSearchDrop = false;
  notifications: any[] = [];
  showNotifPanel = false;
  unreadNotifCount = signal(0);
  unreadMsgCount = signal(0);
  showCreatePost = false;
  createCaption = '';
  createActivityTag = '';
  createMediaFile: File | null = null;
  createMediaPreview = '';
  creating = false;
  isDark = true;

  private searchTimer: any;
  private notifTimer: any;
  private msgTimer: any;

  constructor(
    public auth: AuthService,
    private api: ApiService,
    private router: Router
  ) {
    const saved = localStorage.getItem('bb-theme');
    this.isDark = saved !== 'light';
    this.applyTheme();
  }

  ngOnInit(): void {
    this.loadNotifications();
    this.loadUnreadMessages();
    this.notifTimer = setInterval(() => this.loadNotifications(), 30000);
    this.msgTimer = setInterval(() => this.loadUnreadMessages(), 5000);
  }

  ngOnDestroy(): void {
    clearInterval(this.notifTimer);
    clearInterval(this.msgTimer);
  }

  get user() { return this.auth.currentUser(); }

  profileUrl(): string {
    return this.user ? `/profile/${this.user.username}` : '/login';
  }

  onSearchInput(): void {
    clearTimeout(this.searchTimer);
    const q = this.searchQuery.trim();
    if (!q) { this.searchResults = []; this.showSearchDrop = false; return; }
    this.searchTimer = setTimeout(() => {
      this.api.searchUsers(q).subscribe({
        next: r => { this.searchResults = r.slice(0, 6); this.showSearchDrop = true; },
        error: () => {}
      });
    }, 250);
  }

  onSearchEnter(): void {
    const q = this.searchQuery.trim();
    if (!q) return;
    this.showSearchDrop = false;
    this.router.navigate(['/search'], { queryParams: { q } });
  }

  selectResult(user: any): void {
    this.showSearchDrop = false;
    this.searchQuery = '';
    this.router.navigate(['/profile', user.username]);
  }

  closeSearchDrop(): void {
    setTimeout(() => { this.showSearchDrop = false; }, 150);
  }

  private loadNotifications(): void {
    this.api.getNotifications().subscribe({
      next: n => {
        this.notifications = n;
        this.unreadNotifCount.set(n.filter((x: any) => !x.read).length);
      },
      error: () => {}
    });
  }

  private loadUnreadMessages(): void {
    this.api.getUnreadMessages().subscribe({
      next: r => this.unreadMsgCount.set(r.count || 0),
      error: () => {}
    });
  }

  toggleNotifPanel(): void {
    this.showNotifPanel = !this.showNotifPanel;
    if (this.showNotifPanel && this.unreadNotifCount() > 0) {
      this.api.markNotificationsRead().subscribe(() => {
        this.unreadNotifCount.set(0);
        this.notifications = this.notifications.map(n => ({ ...n, read: true }));
      });
    }
  }

  notifIcon(type: string): string {
    const icons: Record<string, string> = {
      like: 'favorite', comment: 'chat_bubble', follow: 'person_add', mention: 'campaign'
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

  openCreate(): void { this.showCreatePost = true; }
  closeCreate(): void {
    this.showCreatePost = false;
    this.createCaption = '';
    this.createActivityTag = '';
    this.createMediaFile = null;
    this.createMediaPreview = '';
  }

  onMediaSelect(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.createMediaFile = f;
    const reader = new FileReader();
    reader.onload = ev => { this.createMediaPreview = ev.target?.result as string; };
    reader.readAsDataURL(f);
  }

  submitPost(): void {
    if (this.creating) return;
    this.creating = true;
    const doCreate = (mediaUrl?: string) => {
      this.api.createPost({
        caption: this.createCaption,
        activityTag: this.createActivityTag,
        mediaUrl
      }).subscribe({
        next: () => { this.creating = false; this.closeCreate(); },
        error: () => { this.creating = false; }
      });
    };
    if (this.createMediaFile) {
      this.api.uploadFile(this.createMediaFile).subscribe({
        next: r => doCreate(r.url),
        error: () => { this.creating = false; }
      });
    } else {
      doCreate();
    }
  }

  toggleTheme(): void {
    this.isDark = !this.isDark;
    localStorage.setItem('bb-theme', this.isDark ? 'dark' : 'light');
    this.applyTheme();
  }

  private applyTheme(): void {
    document.documentElement.setAttribute('data-theme', this.isDark ? 'dark' : 'light');
  }

  logout(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }

  avatar(): string { return this.user?.profilePic || ''; }
  initials(): string {
    const n = this.user?.displayName || this.user?.username || '?';
    return n.charAt(0).toUpperCase();
  }
}
