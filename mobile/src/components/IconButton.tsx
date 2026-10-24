import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  name?: IconName;
  /** Custom content instead of an icon name. */
  children?: ReactNode;
  active?: boolean;
  size?: number;
  color?: string;
  /** Red dot (no count) or a number badge. */
  badge?: boolean | number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/** Bare icon with a 44pt touch target, dimmed while pressed (no ripple, no background). */
export function IconButton({
  name,
  children,
  active,
  size = 24,
  color = colors.text,
  badge,
  style,
  hitSlop = 10,
  ...rest
}: IconButtonProps) {
  return (
    <Pressable
      hitSlop={hitSlop}
      accessibilityRole="button"
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.5 : 1 }, style]}
      {...rest}
    >
      {children ?? (name ? <Icon name={name} active={active} size={size} color={color} /> : null)}
      {badge ? (
        typeof badge === 'number' ? (
          <View style={styles.countBadge}>
            <Text variant="tiny" color={colors.white} style={styles.countText}>
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        ) : (
          <View style={styles.dot} />
        )
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.like,
  },
  countBadge: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.like,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontSize: 10, lineHeight: 12, fontWeight: '700' },
});
