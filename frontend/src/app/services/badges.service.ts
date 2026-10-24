import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';

/**
 * Unread counters for the navigation badges.
 *
 * Public API (keep it exactly this — the realtime agent may replace the
 * implementation with live updates):
 *   unreadNotifications: WritableSignal<number>
 *   unreadMessages:      WritableSignal<number>
 *
 * Fallback implementation: polls GET /api/notifications and
 * GET /api/messages/unread while the tab is visible.
 */
@Injectable({ providedIn: 'root' })
export class BadgesService {
  readonly unreadNotifications = signal(0);
  readonly unreadMessages = signal(0);

  private http = inject(HttpClient);
  private auth = inject(AuthService);

  constructor() {
    const poll = () => {
      if (document.hidden || !this.auth.isLoggedIn()) return;
      this.http.get<any>('/api/notifications').subscribe({
        next: r => {
          const list: any[] = Array.isArray(r) ? r : (r?.items ?? []);
          this.unreadNotifications.set(list.filter(n => !n?.read).length);
        },
        error: () => {}
      });
      this.http.get<{ count?: number }>('/api/messages/unread').subscribe({
        next: r => this.unreadMessages.set(r?.count || 0),
        error: () => {}
      });
    };
    poll();
    setInterval(poll, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  }
}
