import { Injectable, effect, inject, signal } from '@angular/core';
import { Observable, Subject, filter } from 'rxjs';
import { AuthService } from './auth.service';

export interface RealtimeEvent { type: string; [k: string]: any; }

/**
 * WebSocket client for GET /api/ws (cookie-session authenticated).
 * OWNER: realtime agent. Other features subscribe via on(type) and push
 * client events with send(event).
 *
 * - Connects automatically while a user is logged in, disconnects on logout.
 * - Auto-reconnects with exponential backoff (+ jitter), immediately when the
 *   tab becomes visible again or the device comes back online.
 * - Heartbeat: sends {"type":"ping"} every 20s; if nothing arrives for 60s
 *   the socket is considered dead and recycled.
 * - Emits a synthetic {type: 'open', reconnect: boolean} event after every
 *   (re)connect so pages can refetch anything they may have missed.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private auth = inject(AuthService);
  private events$ = new Subject<RealtimeEvent>();
  private ws: WebSocket | null = null;
  private wanted = false;
  private everConnected = false;
  private attempts = 0;
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private lastSeen = 0;
  private queue: RealtimeEvent[] = [];

  /** True while the socket is open. */
  readonly connected = signal(false);

  private static readonly PING_MS = 20_000;
  private static readonly DEAD_MS = 60_000;
  private static readonly MAX_BACKOFF_MS = 30_000;
  /** Events that are worthless when delivered late are not queued offline. */
  private static readonly VOLATILE = new Set(['typing', 'ping', 'live:heart', 'live:signal']);

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      if (user) this.start(); else this.stop();
    });
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.kick();
      });
      window.addEventListener('online', () => this.kick());
    }
  }

  on<T extends RealtimeEvent = RealtimeEvent>(type: string): Observable<T> {
    return this.events$.pipe(filter((e): e is T => e.type === type));
  }

  /** All events (useful for debugging or generic listeners). */
  all(): Observable<RealtimeEvent> {
    return this.events$.asObservable();
  }

  send(event: RealtimeEvent): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(event)); return; } catch { /* fall through to queue */ }
    }
    if (!RealtimeService.VOLATILE.has(event.type) && this.queue.length < 50) {
      this.queue.push(event);
    }
  }

  // ----- lifecycle -----

  private start(): void {
    this.wanted = true;
    if (!this.ws) this.open();
  }

  private stop(): void {
    this.wanted = false;
    this.queue = [];
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(1000, 'logout'); } catch { /* ignore */ }
    }
    this.connected.set(false);
    this.everConnected = false;
  }

  /** Reconnect right away if we should be connected but aren't. */
  private kick(): void {
    if (!this.wanted) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.attempts = 0;
      this.open();
    } else if (this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastSeen > RealtimeService.DEAD_MS) {
      this.recycle();
    }
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/api/ws`;
  }

  private open(): void {
    if (!this.wanted || typeof WebSocket === 'undefined') return;
    let ws: WebSocket;
    try { ws = new WebSocket(this.url()); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempts = 0;
      this.lastSeen = Date.now();
      this.connected.set(true);
      this.startHeartbeat();
      const pending = this.queue;
      this.queue = [];
      pending.forEach(e => this.send(e));
      this.events$.next({ type: 'open', reconnect: this.everConnected });
      this.everConnected = true;
    };

    ws.onmessage = (msg: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastSeen = Date.now();
      let event: RealtimeEvent | null = null;
      try { event = JSON.parse(msg.data); } catch { return; }
      if (event && typeof event.type === 'string' && event.type !== 'pong') {
        this.events$.next(event);
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      if (this.connected()) {
        this.connected.set(false);
        this.events$.next({ type: 'close' });
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => { /* onclose follows */ };
  }

  private recycle(): void {
    const ws = this.ws;
    if (ws) { try { ws.close(4000, 'heartbeat timeout'); } catch { /* ignore */ } }
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer) return;
    const base = Math.min(RealtimeService.MAX_BACKOFF_MS, 1000 * 2 ** this.attempts);
    const delay = base / 2 + Math.random() * base / 2;
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // a 401 on the upgrade (expired session) also lands here; refresh auth
      // state every few failures so a logged-out user stops reconnecting
      if (this.attempts % 4 === 0) this.auth.refresh();
      this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastSeen > RealtimeService.DEAD_MS) { this.recycle(); return; }
      this.send({ type: 'ping' });
    }, RealtimeService.PING_MS);
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
