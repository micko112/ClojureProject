import { Modal, Pressable, StyleSheet, Text as RNText, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { REACTION_EMOJIS } from '@/api/types';
import { colors, radii } from '@/theme';

export interface ReactionPickerProps {
  visible: boolean;
  /** Window coordinates of the element it pops from (e.g. the heart icon). */
  anchor: { x: number; y: number; width: number; height: number } | null;
  selected?: string | null;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const ITEM = 44;
const PAD = 6;

/**
 * Supportive-reactions popover (🔥 💪 👏 🙌 💯) shown on long-press of the
 * heart. Selected reaction is highlighted; picking it again removes it.
 */
export function ReactionPicker({ visible, anchor, selected, onSelect, onClose }: ReactionPickerProps) {
  const { width: screenW } = useWindowDimensions();
  if (!visible || !anchor) return null;

  const w = REACTION_EMOJIS.length * ITEM + PAD * 2;
  const left = Math.min(Math.max(8, anchor.x - 8), screenW - w - 8);
  const top = Math.max(8, anchor.y - ITEM - PAD * 2 - 10);

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close reactions" />
      <Animated.View
        entering={ZoomIn.springify().damping(16).stiffness(260)}
        exiting={FadeOut.duration(120)}
        style={[styles.bar, { left, top, width: w }]}
      >
        {REACTION_EMOJIS.map((emoji, i) => {
          const isSel = selected === emoji;
          return (
            <Animated.View key={emoji} entering={FadeIn.delay(30 * i).duration(160)}>
              <Pressable
                onPress={() => onSelect(emoji)}
                accessibilityRole="button"
                accessibilityLabel={`React ${emoji}`}
                accessibilityState={{ selected: isSel }}
                style={({ pressed }) => [styles.item, isSel && styles.selected, pressed && styles.pressed]}
              >
                <RNText style={styles.emoji}>{emoji}</RNText>
              </Pressable>
            </Animated.View>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    height: ITEM + PAD * 2,
    paddingHorizontal: PAD,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: { width: ITEM, height: ITEM, borderRadius: ITEM / 2, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: colors.fillPressed },
  pressed: { transform: [{ scale: 1.25 }] },
  emoji: { fontSize: 28, lineHeight: 34 },
});
