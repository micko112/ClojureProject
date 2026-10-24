import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/features/auth/AuthProvider';

import { api } from '../client';
import { queryKeys } from '../queryClient';
import type { Me, Profile, Streak, StoryGroup } from '../types';

/** GET /api/me — the signed-in user (seeded at login, so usually instant). */
export function useMe() {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => api.get<Me>('/api/me', { signal }),
    enabled: status === 'signedIn',
    staleTime: 5 * 60_000,
  });
}

/** GET /api/users/:username */
export function useProfile(username: string | undefined) {
  return useQuery({
    queryKey: queryKeys.profile(username ?? ''),
    queryFn: ({ signal }) => api.get<Profile>(`/api/users/${encodeURIComponent(username ?? '')}`, { signal }),
    enabled: !!username,
  });
}

/** GET /api/me/streak */
export function useMyStreak() {
  return useQuery({
    queryKey: queryKeys.myStreak,
    queryFn: ({ signal }) => api.get<Streak>('/api/me/streak', { signal }),
  });
}

/** GET /api/stories — own group first, then unseen, then seen. */
export function useStories() {
  return useQuery({
    queryKey: queryKeys.stories,
    queryFn: ({ signal }) => api.get<StoryGroup[]>('/api/stories', { signal }),
  });
}

/** Unread notifications count (header heart dot). Live-updated over the WebSocket. */
export function useUnreadNotifications() {
  const qc = useQueryClient();
  useRealtime('notification', (e) => qc.setQueryData(queryKeys.notificationsUnread, e.unreadCount));
  useRealtime('notifications:read', (e) => qc.setQueryData(queryKeys.notificationsUnread, e.unreadCount));
  return useQuery({
    queryKey: queryKeys.notificationsUnread,
    queryFn: async ({ signal }) => (await api.get<{ count: number }>('/api/notifications/unread-count', { signal })).count,
  });
}

/** Unread DMs ({count, requests}) for the header messages badge. */
export function useUnreadMessages() {
  const qc = useQueryClient();
  useRealtime('message', () => void qc.invalidateQueries({ queryKey: queryKeys.messagesUnread }));
  return useQuery({
    queryKey: queryKeys.messagesUnread,
    queryFn: ({ signal }) => api.get<{ count: number; requests: number }>('/api/messages/unread', { signal }),
  });
}
