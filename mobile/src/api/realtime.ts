import { AppState, type AppStateStatus } from 'react-native';

import { realtimeUrl } from './config';
import type { RealtimeEvent, RealtimeEventMap, RealtimeEventType } from './types';

type Listener = (event: RealtimeEvent) => void;

/**
 * WebSocket client for GET /api/ws (token in `?access_token=`).
 *
 * - `realtime.start()` / `stop()` are called by AuthProvider on sign-in/out.
 * - Reconnects with exponential backoff + jitter (max 30s), immediately when
 *   the app returns to the foreground.
 * - Heartbeat: {"type":"ping"} every 20s; nothing received for 60s → recycle.
 * - Emits synthetic `open` ({reconnect}) and `close` events so screens can
 *   refetch what they may have missed.
 *
 * Use `useRealtime('notification', cb)` in components (src/hooks/useRealtime.ts).
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private wanted = false;
  private everConnected = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeen = 0;
  private queue: RealtimeEvent[] = [];
  private listeners = new Map<string, Set<Listener>>();
  private appStateSub: { remove: () => void } | null = null;
  private connectedState = false;
  private statusListeners = new Set<(connected: boolean) => void>();

  private static readonly PING_MS = 20_000;
  private static readonly DEAD_MS = 60_000;
  private static readonly MAX_BACKOFF_MS = 30_000;
  /** Not worth delivering late: never queued while offline. */
  private static readonly VOLATILE = new Set(['typing', 'ping', 'live:heart', 'live:signal']);

  get connected(): boolean {
    return this.connectedState;
  }

  /** Subscribe to one event type ("*" for every event). Returns unsubscribe. */
  on<K extends RealtimeEventType>(type: K, cb: (event: RealtimeEventMap[K]) => void): () => void;
  on(type: string, cb: Listener): () => void;
  on(type: string, cb: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  onStatus(cb: (connected: boolean) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /** Send a client event (typing, live:heart, ...). Queued while offline. */
  send(event: RealtimeEvent): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(event));
        return;
      } catch {
        // fall through to queue
      }
    }
    if (!RealtimeClient.VOLATILE.has(event.type) && this.queue.length < 50) this.queue.push(event);
  }

  start(): void {
    this.wanted = true;
    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener('change', this.onAppState);
    }
    if (!this.ws) this.open();
  }

  stop(): void {
    this.wanted = false;
    this.queue = [];
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1000, 'logout');
      } catch {
        // ignore
      }
    }
    this.setConnected(false);
    this.everConnected = false;
    this.attempts = 0;
  }

  /** Reconnect now (e.g. after the server URL or token changed). */
  restart(): void {
    if (!this.wanted) return;
    this.stop();
    this.start();
  }

  private onAppState = (state: AppStateStatus) => {
    if (state === 'active') this.kick();
  };

  private kick(): void {
    if (!this.wanted) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.attempts = 0;
      this.open();
    } else if (this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastSeen > RealtimeClient.DEAD_MS) {
      this.recycle();
    }
  }

  private emit(event: RealtimeEvent): void {
    for (const key of [event.type, '*']) {
      const set = this.listeners.get(key);
      if (!set) continue;
      for (const cb of Array.from(set)) {
        try {
          cb(event);
        } catch (e) {
          console.warn('[realtime] listener failed', e);
        }
      }
    }
  }

  private setConnected(value: boolean): void {
    if (this.connectedState === value) return;
    this.connectedState = value;
    this.statusListeners.forEach((cb) => cb(value));
  }

  private open(): void {
    const url = realtimeUrl();
    if (!this.wanted || !url) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempts = 0;
      this.lastSeen = Date.now();
      this.setConnected(true);
      this.startHeartbeat();
      const pending = this.queue;
      this.queue = [];
      pending.forEach((e) => this.send(e));
      this.emit({ type: 'open', reconnect: this.everConnected });
      this.everConnected = true;
    };

    ws.onmessage = (msg) => {
      if (this.ws !== ws) return;
      this.lastSeen = Date.now();
      let event: RealtimeEvent | null = null;
      try {
        event = JSON.parse(String(msg.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (event && typeof event.type === 'string' && event.type !== 'pong') this.emit(event);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      if (this.connectedState) {
        this.setConnected(false);
        this.emit({ type: 'close' });
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows
    };
  }

  private recycle(): void {
    try {
      this.ws?.close(4000, 'heartbeat timeout');
    } catch {
      // ignore
    }
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer) return;
    const base = Math.min(RealtimeClient.MAX_BACKOFF_MS, 1000 * 2 ** this.attempts);
    const delay = base / 2 + (Math.random() * base) / 2;
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastSeen > RealtimeClient.DEAD_MS) {
        this.recycle();
        return;
      }
      this.send({ type: 'ping' });
    }, RealtimeClient.PING_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

export const realtime = new RealtimeClient();
