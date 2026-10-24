import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { BadgesService } from '../../services/badges.service';
import { ToastService } from '../../services/toast.service';

/** Notification DTO: {id, type, message, read, createdAt, actor?, postId?} (docs/ARCHITECTURE.md) */
export interface NotificationItem {
  id: string;
  type: string;
  message?: string;
  read?: boolean;
  createdAt?: string;
  actor?: { username: string; displayName?: string; profilePic?: string };
  postId?: string;
  liveId?: string;
  post?: { mediaUrl?: string; thumbnailUrl?: string; media?: { url?: string; posterUrl?: string; type?: string }[] };
  thumbnailUrl?: string;
  /** client-only state for follow requests */
  _req?: 'pending' | 'accepted' | 'declined' | 'busy';
  _unread?: boolean;
}

interface Group { label: string; items: NotificationItem[]; }

const REQUEST_TYPES = new Set(['follow_request', 'follow-request', 'followrequest', 'request']);

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.css']
})
export class NotificationsComponent implements OnInit {
  /** 'page' for the /notifications route (mobile), 'panel' for the desktop slide-out. */
  @Input() variant: 'page' | 'panel' = 'page';
  @Output() closed = new EventEmitter<void>();
  @Output() navigated = new EventEmitter<void>();

  private api = inject(ApiService);
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private badges = inject(BadgesService);
  private toast = inject(ToastService);
  private router = inject(Router);

  readonly loading = signal(true);
  readonly items = signal<NotificationItem[]>([]);
  readonly following = signal<Set<string>>(new Set());
  readonly busyFollow = signal<Set<string>>(new Set());

  readonly requests = computed(() => this.items().filter(n => this.isRequest(n) && n._req !== 'declined'));
  readonly groups = computed<Group[]>(() => {
    const rest = this.items().filter(n => !this.isRequest(n));
    const buckets: Record<string, NotificationItem[]> = { today: [], week: [], month: [], earlier: [] };
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (const n of rest) {
      const t = n.createdAt ? new Date(n.createdAt).getTime() : 0;
      if (t >= startOfToday) buckets['today'].push(n);
      else if (t >= startOfToday - 6 * 86400_000) buckets['week'].push(n);
      else if (t >= startOfToday - 29 * 86400_000) buckets['month'].push(n);
      else buckets['earlier'].push(n);
    }
    return [
      { label: 'Today', items: buckets['today'] },
      { label: 'This week', items: buckets['week'] },
      { label: 'This month', items: buckets['month'] },
      { label: 'Earlier', items: buckets['earlier'] },
    ].filter(g => g.items.length);
  });

  readonly skeletonRows = [0, 1, 2, 3, 4, 5];

  ngOnInit(): void {
    this.load();
    const me = this.auth.currentUser()?.username;
    if (me) {
      this.api.getFollowing(me).subscribe({
        next: list => this.following.set(new Set((list as any[]).map(u => typeof u === 'string' ? u : u?.username))),
        error: () => {}
      });
    }
  }

  load(): void {
    this.loading.set(true);
    this.api.getNotifications().subscribe({
      next: r => {
        const list: NotificationItem[] = Array.isArray(r) ? r : ((r as any)?.items ?? []);
        const hadUnread = list.some(n => !n.read);
        this.items.set(list.map(n => ({ ...n, _unread: !n.read, _req: this.isRequest(n) ? 'pending' : undefined })));
        this.loading.set(false);
        if (hadUnread) this.markRead();
        else this.badges.unreadNotifications.set(0);
      },
      error: () => { this.items.set([]); this.loading.set(false); }
    });
  }

  private markRead(): void {
    this.api.markNotificationsRead().subscribe({
      next: () => this.badges.unreadNotifications.set(0),
      error: () => {}
    });
  }

  isRequest(n: NotificationItem): boolean { return REQUEST_TYPES.has((n.type || '').toLowerCase()); }
  isFollow(n: NotificationItem): boolean { return (n.type || '').toLowerCase() === 'follow'; }
  isFollowing(username?: string): boolean { return !!username && this.following().has(username); }

  icon(type: string): string {
    const icons: Record<string, string> = {
      like: 'favorite', 'comment-like': 'favorite', comment: 'chat_bubble', follow: 'person_add', mention: 'alternate_email',
      follow_request: 'person_add', challenge: 'flag', competition: 'bolt', live: 'sensors',
      story: 'auto_awesome', streak: 'local_fire_department', badge: 'military_tech', message: 'send'
    };
    return icons[(type || '').toLowerCase()] || 'notifications';
  }

  /** Split "alice liked your post" into a bold actor name and the rest. */
  parts(n: NotificationItem): { name: string; rest: string } {
    const msg = (n.message || '').trim();
    const u = n.actor?.username;
    if (u) {
      for (const prefix of [u, '@' + u, n.actor?.displayName || '\u0000']) {
        if (msg.toLowerCase().startsWith(prefix.toLowerCase())) {
          return { name: u, rest: msg.slice(prefix.length).trim() };
        }
      }
      return { name: u, rest: msg || this.defaultText(n.type) };
    }
    return { name: '', rest: msg || this.defaultText(n.type) };
  }

  private defaultText(type: string): string {
    switch ((type || '').toLowerCase()) {
      case 'like': return 'liked your progress.';
      case 'comment': return 'commented on your post.';
      case 'follow': return 'started following you.';
      case 'mention': return 'mentioned you.';
      case 'live': return 'started a live video.';
      default: return REQUEST_TYPES.has(type) ? 'requested to follow you.' : 'New activity';
    }
  }

  thumb(n: NotificationItem): string {
    const m = n.post?.media?.[0];
    return n.thumbnailUrl || n.post?.thumbnailUrl || m?.posterUrl || (m?.type !== 'video' ? m?.url : '') || n.post?.mediaUrl || '';
  }

  initials(n: NotificationItem): string {
    return (n.actor?.displayName || n.actor?.username || '?').charAt(0).toUpperCase();
  }

  timeShort(dateStr?: string): string {
    if (!dateStr) return '';
    const diff = Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    if (diff < 7 * 86400) return Math.floor(diff / 86400) + 'd';
    return Math.floor(diff / (7 * 86400)) + 'w';
  }

  open(n: NotificationItem): void {
    if (n.liveId) this.go(['/live', n.liveId]);
    else if (n.postId) this.go(['/post', n.postId]);
    else if (n.actor?.username) this.go(['/profile', n.actor.username]);
  }

  openProfile(n: NotificationItem, e?: Event): void {
    e?.stopPropagation();
    if (n.actor?.username) this.go(['/profile', n.actor.username]);
  }

  private go(cmd: any[]): void {
    this.navigated.emit();
    this.router.navigate(cmd);
  }

  toggleFollow(n: NotificationItem, e: Event): void {
    e.stopPropagation();
    const u = n.actor?.username;
    if (!u || this.busyFollow().has(u)) return;
    this.busyFollow.update(s => new Set(s).add(u));
    this.api.toggleFollow(u).subscribe({
      next: (r: any) => {
        this.following.update(s => {
          const next = new Set(s);
          if (r?.action === 'unfollowed') next.delete(u); else next.add(u);
          return next;
        });
        if (r?.action === 'requested') this.toast.info('Follow request sent');
        this.clearBusy(u);
      },
      error: () => { this.toast.error("Couldn't follow right now. Please try again."); this.clearBusy(u); }
    });
  }

  private clearBusy(u: string): void {
    this.busyFollow.update(s => { const next = new Set(s); next.delete(u); return next; });
  }

  respond(n: NotificationItem, action: 'accept' | 'decline', e: Event): void {
    e.stopPropagation();
    const u = n.actor?.username;
    if (!u || n._req === 'busy') return;
    const prev = this.items().find(x => x.id === n.id)?._req ?? 'pending';
    this.patch(n, { _req: 'busy' });
    this.http.post(`/api/follow-requests/${encodeURIComponent(u)}/${action}`, {}).subscribe({
      next: () => {
        this.patch(n, { _req: action === 'accept' ? 'accepted' : 'declined' });
        if (action === 'accept') this.toast.success(`${u} can now see your progress`);
      },
      error: () => {
        this.patch(n, { _req: prev });
        this.toast.error("Couldn't update this request right now. Please try again later.");
      }
    });
  }

  private patch(n: NotificationItem, change: Partial<NotificationItem>): void {
    this.items.update(list => list.map(x => x.id === n.id ? { ...x, ...change } : x));
  }

  close(): void { this.closed.emit(); }
}
