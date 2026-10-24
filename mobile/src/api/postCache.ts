import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { Page, Post } from './types';

/**
 * Helpers that apply one change to a post everywhere it is cached (feed,
 * detail, profile grid, explore, hashtag, saved...). See queryKeys in
 * queryClient.ts: only queries under ['posts', ...] are visited.
 */

type PostUpdater = (post: Post) => Post | null;

function isPost(v: unknown): v is Post {
  return !!v && typeof v === 'object' && 'id' in v && 'author' in v && 'media' in v;
}

function isPage(v: unknown): v is Page<unknown> {
  return !!v && typeof v === 'object' && Array.isArray((v as Page<unknown>).items);
}

function isInfinite(v: unknown): v is InfiniteData<unknown> {
  return !!v && typeof v === 'object' && Array.isArray((v as InfiniteData<unknown>).pages);
}

/** Returns the same reference when nothing changed (keeps renders cheap). */
function mapPosts(data: unknown, id: string, fn: PostUpdater): unknown {
  if (isPost(data)) {
    if (data.id !== id) return data;
    return fn(data) ?? data;
  }
  if (Array.isArray(data)) {
    let changed = false;
    const out: unknown[] = [];
    for (const item of data) {
      if (isPost(item) && item.id === id) {
        changed = true;
        const next = fn(item);
        if (next) out.push(next);
      } else {
        out.push(item);
      }
    }
    return changed ? out : data;
  }
  if (isInfinite(data)) {
    let changed = false;
    const pages = data.pages.map((p) => {
      const next = mapPosts(p, id, fn);
      if (next !== p) changed = true;
      return next;
    });
    return changed ? { ...data, pages } : data;
  }
  if (isPage(data)) {
    const items = mapPosts(data.items, id, fn);
    return items === data.items ? data : { ...data, items };
  }
  return data;
}

/** Apply `fn` to the post with `id` in every cached post list. Return null from fn to remove it. */
export function updatePostInCache(qc: QueryClient, id: string, fn: PostUpdater): void {
  qc.setQueriesData({ queryKey: ['posts'] }, (data: unknown) => mapPosts(data, id, fn));
}

export function removePostFromCache(qc: QueryClient, id: string): void {
  updatePostInCache(qc, id, () => null);
}

/** First cached copy of a post (for instant detail screens). */
export function findPostInCache(qc: QueryClient, id: string): Post | undefined {
  let found: Post | undefined;
  for (const [, data] of qc.getQueriesData({ queryKey: ['posts'] })) {
    if (found) break;
    mapPosts(data, id, (p) => {
      found = p;
      return p;
    });
  }
  return found;
}
