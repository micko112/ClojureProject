import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useMe } from '@/api/hooks/account';
import { Avatar, avatarSizes, EmptyState, Header, IconButton, Screen, Text } from '@/components';

/**
 * Your own profile tab. Placeholder: header + avatar only. Build the real
 * profile in a shared component (also used by profile/[username]) and render
 * it here; keep the header menu → /settings.
 */
export default function MyProfileTab() {
  const { data: me } = useMe();
  return (
    <Screen>
      <Header
        back={false}
        titleAlign="left"
        title={me?.username ?? ''}
        right={<IconButton name="menu" size={28} accessibilityLabel="Settings" onPress={() => router.push('/settings')} />}
      />
      <View style={styles.top}>
        <Avatar uri={me?.profilePic} size={avatarSizes.profile} />
        <Text variant="bodyStrong" style={styles.name}>
          {me?.displayName ?? me?.username}
        </Text>
        {me?.bio ? <Text variant="body">{me.bio}</Text> : null}
      </View>
      <EmptyState
        icon="grid"
        title="Profile coming soon"
        message="mobile/app/(app)/(tabs)/profile.tsx"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingTop: 8, gap: 4 },
  name: { marginTop: 10 },
});
