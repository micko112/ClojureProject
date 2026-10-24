import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radii } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'text' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: ButtonVariant;
  /** sm = 32 (profile actions), md = 40, lg = 48 (auth screens) */
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconName;
  /** Stretch to the parent's width. */
  block?: boolean;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const heights: Record<ButtonSize, number> = { sm: 32, md: 40, lg: 48 };

/**
 * Instagram buttons: solid blue primary, #262626 secondary, hairline outline, plain text.
 * No gradients, no shadows.
 */
export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  icon,
  block,
  right,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const fg =
    variant === 'primary' || variant === 'danger'
      ? colors.white
      : variant === 'text'
        ? colors.accent
        : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height: heights[size],
          paddingHorizontal: variant === 'text' ? 4 : size === 'sm' ? 14 : 18,
          borderRadius: size === 'lg' ? radii.md : radii.sm,
          backgroundColor: background(variant, pressed, !!isDisabled),
        },
        variant === 'outline' && styles.outline,
        block && styles.block,
        variant === 'text' && pressed && { opacity: 0.5 },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={fg} /> : null}
          <Text
            variant="bodyStrong"
            color={variant === 'primary' && isDisabled ? 'rgba(255,255,255,0.6)' : fg}
            style={size === 'sm' ? styles.smText : null}
            numberOfLines={1}
          >
            {title}
          </Text>
          {right}
        </View>
      )}
    </Pressable>
  );
}

function background(variant: ButtonVariant, pressed: boolean, disabled: boolean): string {
  switch (variant) {
    case 'primary':
      return disabled ? colors.accentDisabled : pressed ? colors.accentPressed : colors.accent;
    case 'danger':
      return pressed ? '#C9303D' : colors.danger;
    case 'secondary':
      return pressed ? colors.fillPressed : colors.fill;
    case 'outline':
      return pressed ? colors.surface : colors.transparent;
    case 'text':
      return colors.transparent;
  }
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  block: { alignSelf: 'stretch' },
  outline: { borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smText: { fontSize: 13 },
});
