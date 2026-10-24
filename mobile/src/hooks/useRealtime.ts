import { useEffect, useRef, useState } from 'react';

import { realtime } from '@/api/realtime';
import type { RealtimeEvent, RealtimeEventMap, RealtimeEventType } from '@/api/types';

/**
 * Subscribe to a realtime event while the component is mounted. The latest
 * callback is always used, so inline arrow functions are fine.
 *
 *   useRealtime('notification', (e) => setUnread(e.unreadCount));
 *   useRealtime('*', (e) => console.log(e.type));
 */
export function useRealtime<K extends RealtimeEventType>(type: K, cb: (event: RealtimeEventMap[K]) => void): void;
export function useRealtime(type: string, cb: (event: RealtimeEvent) => void): void;
export function useRealtime(type: string, cb: (event: RealtimeEvent) => void): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => realtime.on(type, (e: RealtimeEvent) => ref.current(e)), [type]);
}

/** True while the WebSocket is open. */
export function useRealtimeStatus(): boolean {
  const [connected, setConnected] = useState(realtime.connected);
  useEffect(() => realtime.onStatus(setConnected), []);
  return connected;
}
