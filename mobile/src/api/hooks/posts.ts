import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import { api } from '../client';
import { findPostInCache, removePostFromCache, updatePostInCache } from '../postCache';
import { queryKeys } from '../queryClient';
import type {
  CreatePostRequest,
  LikeResponse,
  Me,
  Page,
  Post,
  ReactResponse,
  UpdatePostRequest,
} from '../types';

const FEED_PAGE = 10;

/** Cursor param for infinite queries over `{items, nextCursor}` pages. */
export function nextCursorOf<T>(last: Page<T>): string | undefined {
  return last.nextCursor ?? undefined;
}

/** Flattens an infinite query's pages into one list. */
export function flattenPages<T>(data: InfiniteData<Page<T>> | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

/** GET /api/feed — own + followed posts, newest first. */
export function useFeed() {
  return useInfiniteQuery({
    queryKey: queryKeys.feed,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<Post>>('/api/feed', { query: { cursor: pageParam, limit: FEED_PAGE }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorOf,
  });
}

/** GET /api/posts/:id — renders instantly from any cached list. */
export function usePost(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery<Post>({
    queryKey: queryKeys.post(id ?? ''),
    queryFn: ({ signal }) => api.get<Post>(`/api/posts/${id}`, { signal }),
    enabled: !!id,
    placeholderData: () => (id ? findPostInCache(qc, id) : undefined),
  });
}

function myUsername(qc: ReturnType<typeof useQueryClient>): string | undefined {
  return qc.getQueryData<Me>(queryKeys.me)?.username;
}

/**
 * Toggle like (POST /api/posts/:id/like) with an optimistic update.
 *   const like = useLikePost();  like.mutate(post);
 * Double-tap should only like: `if (!post.liked) like.mutate(post)`.
 */
export function useLikePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (post: Post) => api.post<LikeResponse>(`/api/posts/${post.id}/like`),
    onMutate: (post) => {
      const me = myUsername(qc);
      const liked = !post.liked;
      const prev = { liked: post.liked, likeCount: post.likeCount, likes: post.likes };
      updatePostInCache(qc, post.id, (p) => ({
        ...p,
        liked,
        likeCount: p.likeCount == null ? p.likeCount : Math.max(0, p.likeCount + (liked ? 1 : -1)),
        likes: me ? (liked ? [...p.likes.filter((u) => u !== me), me] : p.likes.filter((u) => u !== me)) : p.likes,
      }));
      return prev;
    },
    onSuccess: (res, post) => {
      updatePostInCache(qc, post.id, (p) => ({
        ...p,
        liked: res.liked,
        // keep counts hidden if the server hides them from us
        likeCount: p.likeCount == null && p.hideLikes ? p.likeCount : res.likeCount,
        likes: p.hideLikes && p.likes.length === 0 ? p.likes : res.likes,
      }));
    },
    onError: (_e, post, prev) => {
      if (prev) updatePostInCache(qc, post.id, (p) => ({ ...p, ...prev }));
    },
  });
}

/**
 * Supportive reaction (POST /api/posts/:id/react {emoji}). Same emoji again
 * removes it; a different one replaces it.
 */
export function useReactToPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ post, emoji }: { post: Post; emoji: string }) =>
      api.post<ReactResponse>(`/api/posts/${post.id}/react`, { emoji }),
    onMutate: ({ post, emoji }) => {
      const prev = { reactions: post.reactions, myReaction: post.myReaction };
      updatePostInCache(qc, post.id, (p) => {
        const reactions = { ...p.reactions };
        const old = p.myReaction ?? null;
        if (old) {
          const n = (reactions[old] ?? 1) - 1;
          if (n > 0) reactions[old] = n;
          else delete reactions[old];
        }
        const next = old === emoji ? null : emoji;
        if (next) reactions[next] = (reactions[next] ?? 0) + 1;
        return { ...p, reactions, myReaction: next };
      });
      return prev;
    },
    onSuccess: (res, { post }) => {
      updatePostInCache(qc, post.id, (p) => ({ ...p, reactions: res.reactions, myReaction: res.myReaction }));
    },
    onError: (_e, { post }, prev) => {
      if (prev) updatePostInCache(qc, post.id, (p) => ({ ...p, ...prev }));
    },
  });
}

/** Save / unsave (bookmark). `save.mutate({ post, saved: !post.saved })` */
export function useSavePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ post, saved }: { post: Post; saved: boolean }) =>
      api.post<{ saved: boolean }>(`/api/posts/${post.id}/${saved ? 'save' : 'unsave'}`),
    onMutate: ({ post, saved }) => {
      const prev = post.saved;
      updatePostInCache(qc, post.id, (p) => ({ ...p, saved }));
      return prev;
    },
    onError: (_e, { post }, prev) => {
      updatePostInCache(qc, post.id, (p) => ({ ...p, saved: prev }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.savedPosts });
    },
  });
}

/** POST /api/posts → refreshes feed, streak and own profile. */
export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePostRequest) => api.post<Post>('/api/posts', body),
    onSuccess: (post) => {
      qc.setQueryData(queryKeys.post(post.id), post);
      void qc.invalidateQueries({ queryKey: queryKeys.feed });
      void qc.invalidateQueries({ queryKey: queryKeys.myStreak });
      void qc.invalidateQueries({ queryKey: queryKeys.userPosts(post.author.username) });
    },
  });
}

/** PUT /api/posts/:id */
export function useUpdatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePostRequest }) => api.put<Post>(`/api/posts/${id}`, body),
    onSuccess: (post) => updatePostInCache(qc, post.id, () => post),
  });
}

/** DELETE /api/posts/:id */
export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/posts/${id}`),
    onSuccess: (_r, id) => {
      removePostFromCache(qc, id);
      void qc.invalidateQueries({ queryKey: queryKeys.myStreak });
    },
  });
}
