import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components';
import { colors } from '@/theme';

/**
 * Big white heart that pops in the middle of the media on double-tap.
 * Bump `trigger` (e.g. a counter) to play it again.
 */
export function HeartBurst({ trigger, size = 96 }: { trigger: number; size?: number }) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (!trigger) return;
    rotate.set((Math.random() - 0.5) * 24);
    opacity.set(withSequence(withTiming(1, { duration: 80 }), withDelay(520, withTiming(0, { duration: 220 }))));
    scale.set(withSequence(
      withTiming(0, { duration: 0 }),
      withSpring(1.15, { damping: 9, stiffness: 320 }),
      withTiming(1, { duration: 120 }),
      withDelay(300, withTiming(0.4, { duration: 220, easing: Easing.in(Easing.quad) })),
    ));
  }, [trigger, opacity, scale, rotate]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, style]}>
      <Icon name="heart" active size={size} color={colors.white} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
