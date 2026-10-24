import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { ApiError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (count, error) => {
        // never retry auth/permission/not-found errors
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return count < 2;
      },
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});

// Refetch stale queries when the app comes back to the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
  // Without NetInfo we treat the app as always online; failed requests still retry.
  onlineManager.setOnline(true);
}

/**
 * Query keys. Every query whose data contains Post objects MUST live under
 * the `['posts', ...]` root so `updatePostInCache` (optimistic likes, saves,
 * reactions) reaches it. Data shapes it understands: Post, Post[],
 * Page<Post>, InfiniteData<Page<Post>>.
 */
export const queryKeys = {
  me: ['me'] as const,
  feed: ['posts', 'feed'] as const,
  post: (id: string) => ['posts', 'detail', id] as const,
  explore: ['posts', 'explore'] as const,
  hashtag: (tag: string) => ['posts', 'hashtag', tag.toLowerCase()] as const,
  userPosts: (username: string) => ['posts', 'user', username] as const,
  savedPosts: ['posts', 'saved'] as const,
  archivedPosts: ['posts', 'archived'] as const,
  comments: (postId: string) => ['comments', postId] as const,
  stories: ['stories'] as const,
  myStreak: ['streak', 'me'] as const,
  userStreak: (username: string) => ['streak', 'user', username] as const,
  profile: (username: string) => ['profile', username] as const,
  notifications: ['notifications'] as const,
  notificationsUnread: ['notifications', 'unread'] as const,
  conversations: (folder: 'primary' | 'requests' = 'primary') => ['conversations', folder] as const,
  messages: (conversationId: string) => ['messages', conversationId] as const,
  messagesUnread: ['messages', 'unread'] as const,
  lives: ['live'] as const,
};
