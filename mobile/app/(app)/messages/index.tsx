import { PlaceholderScreen } from '@/components';

/**
 * Inbox: GET /api/conversations?folder=primary|requests, realtime message events.
 * Placeholder: replace this component, keep the file path.
 */
export default function InboxScreen() {
  return (
    <PlaceholderScreen
      title="Messages"
      route="mobile/app/(app)/messages/index.tsx"
      icon="messages"
      note="Inbox: GET /api/conversations?folder=primary|requests, realtime message events."
    />
  );
}
