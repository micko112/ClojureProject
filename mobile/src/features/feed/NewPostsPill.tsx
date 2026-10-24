import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import type { UserSummary } from '@/api/types';
import { Avatar, Icon, Text } from '@/components';
import { colors, radii } from '@/theme';

/**
 * Floating "New posts" pill (from `post:new` WebSocket events) with up to
 * three author avatars, like Instagram. Tap scrolls to top and refreshes.
 */
export function NewPostsPill({ authors, onPress, top }: { authors: UserSummary[]; onPress: () => void; top: number }) {
  if (authors.length === 0) return null;
  const shown = authors.slice(0, 3);
  return (
    <Animated.View entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)} style={[styles.wrap, { top }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Show new posts"
        style={({ pressed }) => [styles.pill, pressed && { backgroundColor: colors.accentPressed }]}
      >
        <Icon name="arrowUp" size={16} color={colors.white} />
        <View style={styles.avatars}>
          {shown.map((a, i) => (
            <View key={a.username} style={[styles.avatarWrap, { marginLeft: i === 0 ? 0 : -8, zIndex: 3 - i }]}>
              <Avatar uri={a.profilePic} size={20} />
            </View>
          ))}
        </View>
        <Text variant="bodyStrong" color={colors.white}>
          New posts
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignSelf: 'center', zIndex: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingLeft: 12,
    paddingRight: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  avatars: { flexDirection: 'row' },
  avatarWrap: { borderRadius: 12, borderWidth: 2, borderColor: colors.accent },
});
