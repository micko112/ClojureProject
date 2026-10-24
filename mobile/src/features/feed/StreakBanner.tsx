import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useMyStreak } from '@/api/hooks/account';
import type { Streak } from '@/api/types';
import { Button, Icon, Text } from '@/components';
import { colors, hairline, layout, storyGradient } from '@/theme';

/**
 * Gentle "post today" prompt under the stories row. Hidden once you've
 * posted today (GET /api/me/streak → postedToday).
 */
export function StreakBanner() {
  const { data: streak } = useMyStreak();
  if (!streak || streak.postedToday) return null;
  const { title, message } = copyFor(streak);

  return (
    <View style={styles.root}>
      <LinearGradient colors={storyGradient} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.ring}>
        <View style={styles.ringInner}>
          <Icon name="flame" active size={22} color={colors.amber} />
        </View>
      </LinearGradient>
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="meta" tone="secondary" numberOfLines={2}>
          {message}
        </Text>
      </View>
      <Button title="Post" size="sm" onPress={() => router.push('/create')} />
    </View>
  );
}

function copyFor(s: Streak): { title: string; message: string } {
  if (s.totalDays === 0) {
    return { title: 'Your Day 1 starts here', message: 'Share a photo or video of where you are today.' };
  }
  if (s.current > 0) {
    return {
      title: `Day ${s.nextDayNumber} is waiting`,
      message: `Keep your ${s.current}-day streak going. Share today's progress.`,
    };
  }
  return { title: `Day ${s.nextDayNumber}, whenever you're ready`, message: 'Every day counts. Share where you are today.' };
}

const RING = 46;

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: layout.gutter,
    paddingVertical: 12,
    borderTopWidth: hairline,
    borderBottomWidth: hairline,
    borderColor: colors.separator,
  },
  ring: { width: RING, height: RING, borderRadius: RING / 2, padding: 2 },
  ringInner: {
    flex: 1,
    borderRadius: RING / 2,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 1 },
});
