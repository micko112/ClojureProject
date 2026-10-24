import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components';

/**
 * Chat thread: GET /api/conversations/:id/messages, POST /api/messages, typing, seen.
 * Placeholder: replace this component, keep the file path.
 */
export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  return (
    <PlaceholderScreen
      title={'Chat'}
      route={`mobile/app/(app)/messages/[conversationId].tsx (conversationId: ${conversationId})`}
      icon="messages"
      note="Chat thread: GET /api/conversations/:id/messages, POST /api/messages, typing, seen."
    />
  );
}
