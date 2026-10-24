import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, hairline, radii } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Max height as a fraction of the screen (default 0.9). Content sizes itself below that. */
  maxHeight?: number;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Bottom sheet modal with grabber, backdrop tap and swipe-down to dismiss.
 *
 *   const [open, setOpen] = useState(false);
 *   <Sheet visible={open} onClose={() => setOpen(false)} title="Server">
 *     <SheetOption icon="link" label="Copy link" onPress={...} />
 *   </Sheet>
 */
export function Sheet({ visible, onClose, title, children, maxHeight = 0.9, contentStyle }: SheetProps) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(screenH);
  const backdrop = useSharedValue(0);

  // mount immediately when opened; unmount after the close animation
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      translateY.set(screenH);
      translateY.set(withSpring(0, { damping: 28, stiffness: 260, mass: 0.9 }));
      backdrop.set(withTiming(1, { duration: 220 }));
    } else {
      backdrop.set(withTiming(0, { duration: 180 }));
      translateY.set(
        withTiming(screenH, { duration: 220, easing: Easing.in(Easing.quad) }, (done) => {
          if (done) runOnJS(setMounted)(false);
        }),
      );
    }
  }, [visible, screenH, translateY, backdrop]);

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      translateY.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 900) {
        runOnJS(onClose)();
      } else {
        translateY.set(withSpring(0, { damping: 28, stiffness: 260 }));
      }
    });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              styles.panel,
              { maxHeight: screenH * maxHeight, paddingBottom: Math.max(insets.bottom, 16) },
              panelStyle,
            ]}
          >
            <View style={styles.grabberWrap}>
              <View style={styles.grabber} />
            </View>
            {title ? (
              <View style={styles.titleRow}>
                <Text variant="title" align="center">
                  {title}
                </Text>
              </View>
            ) : null}
            <View style={contentStyle}>{children}</View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

export interface SheetOptionProps {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
  disabled?: boolean;
}

/** A tappable row inside a Sheet. */
export function SheetOption({ label, icon, destructive, onPress, disabled }: SheetOptionProps) {
  const color = destructive ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.fillPressed }, disabled && { opacity: 0.4 }]}
    >
      {icon ? <Icon name={icon} size={24} color={color} /> : null}
      <Text variant="body" color={color} style={styles.optionLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: colors.backdrop },
  panel: {
    backgroundColor: colors.fill,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    overflow: 'hidden',
  },
  grabberWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#5C5C5C' },
  titleRow: {
    paddingVertical: 10,
    borderBottomWidth: hairline,
    borderBottomColor: colors.fillPressed,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  optionLabel: { fontSize: 15 },
});
