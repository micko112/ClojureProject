import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components';
import { colors, storyGradient } from '@/theme';

/** End-of-feed marker: "You're all caught up". */
export function CaughtUp() {
  return (
    <View style={styles.root}>
      <LinearGradient colors={storyGradient} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.ring}>
        <View style={styles.inner}>
          <Icon name="check" size={34} color={colors.text} />
        </View>
      </LinearGradient>
      <Text variant="title" align="center">
        You&apos;re all caught up
      </Text>
      <Text variant="meta" tone="secondary" align="center">
        You&apos;ve seen all the progress from people you follow.
      </Text>
    </View>
  );
}

const SIZE = 72;

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 32, gap: 6 },
  ring: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, padding: 2.5, marginBottom: 10 },
  inner: { flex: 1, borderRadius: SIZE / 2, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
