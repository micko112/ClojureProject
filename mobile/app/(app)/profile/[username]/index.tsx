import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components';

/**
 * Profile of another user: GET /api/users/:username, /api/users/:username/posts, follow button.
 * Placeholder: replace this component, keep the file path.
 */
export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return (
    <PlaceholderScreen
      title={username ?? 'Profile'}
      route="mobile/app/(app)/profile/[username]/index.tsx"
      icon="person"
      note="Profile of another user: GET /api/users/:username, /api/users/:username/posts, follow button."
    />
  );
}
