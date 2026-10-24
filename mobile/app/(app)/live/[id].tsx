import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components';

/**
 * Watch a live video: WebRTC via live:signal events, live:comment, live:heart.
 * Placeholder: replace this component, keep the file path.
 */
export default function LiveViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <PlaceholderScreen
      title={'Live'}
      route={`mobile/app/(app)/live/[id].tsx (id: ${id})`}
      icon="live"
      note="Watch a live video: WebRTC via live:signal events, live:comment, live:heart."
    />
  );
}
