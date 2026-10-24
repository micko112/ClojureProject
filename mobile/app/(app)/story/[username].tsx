import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components';

/**
 * Story viewer: tap left/right, hold to pause, progress bars; POST /api/stories/:id/view.
 * Placeholder: replace this component, keep the file path.
 */
export default function StoryViewerScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return (
    <PlaceholderScreen
      title={`${username ?? ''} story`}
      route="mobile/app/(app)/story/[username].tsx"
      icon="time"
      note="Story viewer: tap left/right, hold to pause, progress bars; POST /api/stories/:id/view."
    />
  );
}
