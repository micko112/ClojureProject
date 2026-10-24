import { useSyncExternalStore } from 'react';

/**
 * App-wide "videos are muted" switch, like Instagram: feed videos start
 * muted; unmuting one unmutes all until the user mutes again.
 */
let muted = true;
const listeners = new Set<() => void>();

export function setVideoMuted(value: boolean): void {
  if (value === muted) return;
  muted = value;
  listeners.forEach((l) => l());
}

export function toggleVideoMuted(): void {
  setVideoMuted(!muted);
}

export function useVideoMuted(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => muted,
    () => muted,
  );
}
