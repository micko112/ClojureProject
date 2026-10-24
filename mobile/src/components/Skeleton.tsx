import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type DimensionValue, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  /** corner radius; ignored when `circle` */
  radius?: number;
  /** circle of diameter `width` (number) */
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}

const DURATION = 1300;

/**
 * Loading placeholder: #121212 block with a soft moving highlight.
 *   <Skeleton width={120} height={12} />   <Skeleton circle width={36} />
 */
export function Skeleton({ width = '100%', height = 12, radius = 4, circle, style }: SkeletonProps) {
  const [w, setW] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(withRepeat(withTiming(1, { duration: DURATION, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [progress]);

  const sheen = useAnimatedStyle(() => ({
    transform: [{ translateX: -w + progress.value * w * 2 }],
  }));

  const size = circle ? { width, height: width, borderRadius: typeof width === 'number' ? width / 2 : 999 } : null;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      style={[styles.base, { width, height, borderRadius: radius }, size, style]}
    >
      {w > 0 ? (
        <Animated.View style={[StyleSheet.absoluteFill, { width: w }, sheen]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.045)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.surface, overflow: 'hidden' },
});
