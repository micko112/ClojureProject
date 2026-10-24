import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { Media } from '@/api/types';
import { Pill } from '@/components';
import { colors } from '@/theme';

import { MediaView } from './MediaView';

export interface MediaCarouselProps {
  media: Media[];
  width: number;
  height: number;
  /** post is on screen (videos play only then) */
  active: boolean;
  onIndexChange?: (index: number) => void;
}

/**
 * Horizontal paging carousel with Instagram's "1/5" counter (fades out
 * after a few seconds). Dots are rendered separately (<CarouselDots>) in
 * the action row, like Instagram.
 */
export function MediaCarousel({ media, width, height, active, onIndexChange }: MediaCarouselProps) {
  const [index, setIndex] = useState(0);
  const counterOpacity = useSharedValue(1);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCounter = useCallback(() => {
    counterOpacity.set(withTiming(1, { duration: 120 }));
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      counterOpacity.set(withTiming(0, { duration: 400 }));
    }, 3000);
  }, [counterOpacity]);

  useEffect(() => {
    if (active) showCounter();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [active, showCounter]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index && i >= 0 && i < media.length) {
      setIndex(i);
      onIndexChange?.(i);
      showCounter();
    }
  };

  const counterStyle = useAnimatedStyle(() => ({ opacity: counterOpacity.value }));

  return (
    <View style={{ width, height }}>
      <FlatList
        data={media}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(m) => m.id}
        onScroll={onScroll}
        scrollEventThrottle={32}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={2}
        windowSize={3}
        renderItem={({ item, index: i }) => (
          <MediaView media={item} width={width} height={height} active={active && i === index} />
        )}
      />
      <Animated.View pointerEvents="none" style={[styles.counter, counterStyle]}>
        <Pill label={`${index + 1}/${media.length}`} tone="scrim" style={styles.counterPill} />
      </Animated.View>
    </View>
  );
}

/** Instagram carousel dots: active blue, others grey; shrinks dots far from the active one. */
export function CarouselDots({ count, index }: { count: number; index: number }) {
  if (count < 2) return null;
  return (
    <View style={styles.dots} pointerEvents="none">
      {Array.from({ length: count }, (_, i) => {
        const dist = Math.abs(i - index);
        const size = dist <= 2 ? 6 : dist === 3 ? 4.5 : 3;
        if (count > 7 && dist > 4) return null;
        return (
          <View
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              marginHorizontal: 2,
              backgroundColor: i === index ? colors.accent : colors.textTertiary,
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  counter: { position: 'absolute', top: 14, right: 14 },
  counterPill: { height: 26, borderRadius: 13, paddingHorizontal: 9 },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
