import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components';

/**
 * Hashtag page: GET /api/hashtags/:tag (HashtagPage) as a grid.
 * Placeholder: replace this component, keep the file path.
 */
export default function HashtagScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  return (
    <PlaceholderScreen
      title={`#${tag ?? ''}`}
      route="mobile/app/(app)/hashtag/[tag].tsx"
      icon="grid"
      note="Hashtag page: GET /api/hashtags/:tag (HashtagPage) as a grid."
    />
  );
}
