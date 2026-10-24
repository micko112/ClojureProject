import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { queryKeys } from '@/api/queryClient';
import type { StoryGroup } from '@/api/types';
import type { AvatarRing } from '@/components';

/**
 * Story ring state for any username, from the cached GET /api/stories
 * (shares the query with the stories bar, so no extra request).
 *   <Avatar ring={useStoryRing(post.author.username)} />
 */
export function useStoryRing(username: string | undefined): AvatarRing {
  const { data } = useQuery({
    queryKey: queryKeys.stories,
    queryFn: ({ signal }) => api.get<StoryGroup[]>('/api/stories', { signal }),
    select: (groups) => {
      const g = groups.find((x) => x.username === username);
      if (!g || g.stories.length === 0) return 'none' as const;
      return g.hasUnviewed ? ('unseen' as const) : ('seen' as const);
    },
    enabled: !!username,
    staleTime: 60_000,
  });
  return data ?? 'none';
}
