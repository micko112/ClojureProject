import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { api } from '../client';
import { updatePostInCache } from '../postCache';
import { queryKeys } from '../queryClient';
import type { Comment, CommentPage } from '../types';
import { nextCursorOf } from './posts';

/** GET /api/posts/:id/comments — top-level comments with nested `replies`. */
export function useComments(postId: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.comments(postId ?? ''),
    queryFn: ({ pageParam, signal }) =>
      api.get<CommentPage>(`/api/posts/${postId}/comments`, { query: { cursor: pageParam, limit: 20 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorOf,
    enabled: !!postId,
  });
}

/** POST /api/posts/:id/comments {content, parentId?} */
export function useAddComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ content, parentId }: { content: string; parentId?: string | null }) =>
      api.post<Comment>(`/api/posts/${postId}/comments`, { content, parentId: parentId || undefined }),
    onSuccess: () => {
      updatePostInCache(qc, postId, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
      void qc.invalidateQueries({ queryKey: queryKeys.comments(postId) });
    },
  });
}

/** DELETE /api/comments/:id */
export function useDeleteComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.delete(`/api/comments/${commentId}`),
    onSuccess: () => {
      updatePostInCache(qc, postId, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount - 1) }));
      void qc.invalidateQueries({ queryKey: queryKeys.comments(postId) });
    },
  });
}

/** POST /api/comments/:id/like (toggle) with optimistic update. */
export function useLikeComment(postId: string) {
  const qc = useQueryClient();
  const key = queryKeys.comments(postId);
  const patch = (id: string, fn: (c: Comment) => Comment) =>
    qc.setQueryData<InfiniteData<CommentPage>>(key, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((pg) => ({
              ...pg,
              items: pg.items.map((c) =>
                c.id === id
                  ? fn(c)
                  : c.replies
                    ? { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) }
                    : c,
              ),
            })),
          }
        : data,
    );
  return useMutation({
    mutationFn: (comment: Comment) =>
      api.post<{ liked: boolean; likeCount: number }>(`/api/comments/${comment.id}/like`),
    onMutate: (comment) => {
      patch(comment.id, (c) => ({ ...c, liked: !c.liked, likeCount: c.likeCount + (c.liked ? -1 : 1) }));
      return comment;
    },
    onSuccess: (res, comment) => patch(comment.id, (c) => ({ ...c, ...res })),
    onError: (_e, comment) => patch(comment.id, (c) => ({ ...c, liked: comment.liked, likeCount: comment.likeCount })),
  });
}
