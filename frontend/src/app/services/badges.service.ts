import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';

/**
 * Live unread counters for the navigation badges. The layout (owned by the
 * shell agent) reads these signals; they are kept up to date from realtime
 * events, with an HTTP refresh on login / reconnect / tab focus.
 * OWNER: realtime agent.
 */
@Injectable({ providedIn: 'root' })
export class BadgesService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private rt = inject(RealtimeService);

  /** Unread notifications (activity). */
  readonly unreadNotifications = signal(0);
  /** Unread DM messages in the primary inbox. */
  readonly unreadMessages = signal(0);
  /** Pending message requests. */
  readonly messageRequests = signal(0);
  /** Conversation currently open in the chat page (suppresses toasts/badges). */
  readonly activeConversationId = signal<string | null>(null);

  private msgTimer: any = null;

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      untracked(() => {
        if (user) this.refresh();
        else { this.unreadNotifications.set(0); this.unreadMessages.set(0); this.messageRequests.set(0); }
      });
    });

    this.rt.on('open').subscribe(() => this.refresh());
    this.rt.on('notification').subscribe(e => {
      if (typeof e['unreadCount'] === 'number') this.unreadNotifications.set(e['unreadCount']);
      else this.unreadNotifications.update(n => n + 1);
    });
    this.rt.on('notifications:read').subscribe(e => {
      this.unreadNotifications.set(typeof e['unreadCount'] === 'number' ? e['unreadCount'] : 0);
    });
    for (const t of ['message', 'message:unsent', 'conversation:accepted']) {
      this.rt.on(t).subscribe(() => this.refreshMessagesSoon());
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.auth.currentUser()) this.refresh();
      });
    }
  }

  refresh(): void {
    this.refreshNotifications();
    this.refreshMessages();
  }

  refreshNotifications(): void {
    this.http.get<{ count: number }>('/api/notifications/unread-count').subscribe({
      next: r => this.unreadNotifications.set(r.count || 0),
      error: () => {}
    });
  }

  refreshMessages(): void {
    this.http.get<{ count: number; requests?: number }>('/api/messages/unread').subscribe({
      next: r => { this.unreadMessages.set(r.count || 0); this.messageRequests.set(r.requests || 0); },
      error: () => {}
    });
  }

  /** Coalesces bursts of message events into one request. */
  refreshMessagesSoon(): void {
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => this.refreshMessages(), 400);
  }

  /** Call after marking all notifications read. */
  clearNotifications(): void { this.unreadNotifications.set(0); }
}
