import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, hairline, layout } from '@/theme';

import { IconButton } from './IconButton';
import { Text } from './Text';

export interface HeaderProps {
  /** Centered (stack screens) or left-aligned (`titleAlign="left"`, tab screens) title. */
  title?: string;
  /** Replace the title with arbitrary content (e.g. a username + chevron). */
  titleNode?: ReactNode;
  titleAlign?: 'center' | 'left';
  /** Show a back chevron. Default: true when the router can go back. */
  back?: boolean;
  onBack?: () => void;
  left?: ReactNode;
  /** Right-side actions, usually <IconButton>s. */
  right?: ReactNode;
  /** Hairline under the header. */
  border?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * 48pt top bar. Put it inside <Screen> (which handles the safe area).
 *   <Header title="Settings" />
 *   <Header titleAlign="left" titleNode={<Wordmark />} right={<IconButton .../>} />
 */
export function Header({
  title,
  titleNode,
  titleAlign = 'center',
  back,
  onBack,
  left,
  right,
  border = false,
  style,
}: HeaderProps) {
  const showBack = back ?? router.canGoBack();
  const leftContent =
    left ??
    (showBack ? (
      <IconButton
        name="back"
        size={28}
        accessibilityLabel="Back"
        onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
        style={styles.backBtn}
      />
    ) : null);

  const titleContent =
    titleNode ??
    (title ? (
      <Text variant="title" numberOfLines={1}>
        {title}
      </Text>
    ) : null);

  return (
    <View style={[styles.bar, border && styles.border, style]}>
      {titleAlign === 'center' ? (
        <>
          <View style={styles.side}>{leftContent}</View>
          <View style={styles.center}>{titleContent}</View>
          <View style={[styles.side, styles.right]}>{right}</View>
        </>
      ) : (
        <>
          {leftContent ? <View style={styles.leftInline}>{leftContent}</View> : null}
          <View style={styles.leftTitle}>{titleContent}</View>
          <View style={styles.right}>{right}</View>
        </>
      )}
    </View>
  );
}

/** "BeBetter" in the Courgette display face — home header only. */
export function Wordmark({ size = 28, onPress }: { size?: number; onPress?: () => void }) {
  const text = (
    <Text
      accessibilityRole="header"
      style={{ fontFamily: fonts.wordmark, fontSize: size, lineHeight: size * 1.3, color: colors.text }}
      allowFontScaling={false}
    >
      BeBetter
    </Text>
  );
  if (!onPress) return text;
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      {text}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.gutter,
    backgroundColor: colors.bg,
  },
  border: { borderBottomWidth: hairline, borderBottomColor: colors.separator },
  side: { width: 88, flexDirection: 'row', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center' },
  right: { justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 22 },
  leftInline: { marginRight: 8 },
  leftTitle: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  backBtn: { marginLeft: -6 },
});
