import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components';

/**
 * Followers / following lists (?tab=following): GET /api/users/:username/followers|following.
 * Placeholder: replace this component, keep the file path.
 */
export default function ConnectionsScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return (
    <PlaceholderScreen
      title={'Followers'}
      route={`mobile/app/(app)/profile/[username]/followers.tsx (username: ${username})`}
      icon="people"
      note="Followers / following lists (?tab=following): GET /api/users/:username/followers|following."
    />
  );
}
