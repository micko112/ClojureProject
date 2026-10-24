import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import type { Media } from '@/api/types';
import { Icon, Pill } from '@/components';
import { colors } from '@/theme';

import { MediaView } from './MediaView';

export interface CompareSliderProps {
  before: Media;
  after: Media;
  width: number;
  height: number;
  active?: boolean;
  /** starting divider position 0..1 (default 0.5) */
  initial?: number;
}

const HANDLE = 38;

/**
 * Before/After post (`layout: "compare"`): the "before" photo is revealed
 * left of a draggable divider. Horizontal drags move the divider; vertical
 * drags still scroll the feed.
 */
export function CompareSlider({ before, after, width, height, active = false, initial = 0.5 }: CompareSliderProps) {
  const x = useSharedValue(width * initial);
  const start = useSharedValue(0);
  const dragging = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onBegin((e) => {
      start.set(x.value);
      dragging.set(withSpring(1));
      // tapping/dragging from anywhere jumps the divider under the finger
      if (Math.abs(e.x - x.value) > HANDLE) start.set(e.x);
    })
    .onUpdate((e) => {
      x.set(Math.min(width, Math.max(0, start.value + e.translationX)));
    })
    .onFinalize(() => {
      dragging.set(withSpring(0));
    });

  const clipStyle = useAnimatedStyle(() => ({ width: x.value }));
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - 1 }] }));
  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - HANDLE / 2 }, { scale: 1 + dragging.value * 0.08 }],
  }));
  const beforeLabel = useAnimatedStyle(() => ({ opacity: x.value < 70 ? x.value / 70 : 1 }));
  const afterLabel = useAnimatedStyle(() => ({ opacity: width - x.value < 70 ? (width - x.value) / 70 : 1 }));

  return (
    <GestureDetector gesture={pan}>
      <View style={{ width, height, overflow: 'hidden', backgroundColor: colors.surface }}>
        <MediaView media={after} width={width} height={height} active={active} />
        <Animated.View style={[styles.clip, { height }, clipStyle]}>
          <MediaView media={before} width={width} height={height} active={active} />
        </Animated.View>

        <Animated.View pointerEvents="none" style={[styles.line, { height }, lineStyle]} />
        <Animated.View pointerEvents="none" style={[styles.handle, { top: height / 2 - HANDLE / 2 }, handleStyle]}>
          <Icon name="back" size={13} color={colors.white} />
          <Icon name="forward" size={13} color={colors.white} />
        </Animated.View>

        <Animated.View pointerEvents="none" style={[styles.labelLeft, beforeLabel]}>
          <Pill label="Before" tone="scrim" style={styles.label} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.labelRight, afterLabel]}>
          <Pill label="After" tone="scrim" style={styles.label} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  line: { position: 'absolute', top: 0, left: 0, width: 2, backgroundColor: colors.white },
  handle: {
    position: 'absolute',
    left: 0,
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: 'rgba(0,0,0,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelLeft: { position: 'absolute', top: 14, left: 14 },
  labelRight: { position: 'absolute', top: 14, right: 14 },
  label: { height: 24, borderRadius: 12, paddingHorizontal: 9 },
});
