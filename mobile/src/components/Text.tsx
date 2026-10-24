import { forwardRef } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { colors, fontWeight, fonts, textVariants, type TextVariant } from '@/theme';

export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'link' | 'inverse';

const toneColor: Record<TextTone, string> = {
  primary: colors.text,
  secondary: colors.textSecondary,
  tertiary: colors.textTertiary,
  accent: colors.accent,
  danger: colors.danger,
  link: colors.link,
  inverse: colors.black,
};

export interface TextProps extends RNTextProps {
  /** Type scale (default "body" = 14/18). */
  variant?: TextVariant;
  /** Semantic colour (default "primary"). Use `color` for anything else. */
  tone?: TextTone;
  color?: string;
  weight?: keyof typeof fontWeight;
  align?: TextStyle['textAlign'];
}

/**
 * The only text component to use. System font, Instagram sizes:
 *   <Text variant="bodyStrong">micko</Text>
 *   <Text variant="caption" tone="secondary">2 hours ago</Text>
 */
export const Text = forwardRef<RNText, TextProps>(function Text(
  { variant = 'body', tone = 'primary', color, weight, align, style, ...rest },
  ref,
) {
  return (
    <RNText
      ref={ref}
      allowFontScaling
      maxFontSizeMultiplier={1.4}
      {...rest}
      style={[
        textVariants[variant],
        { color: color ?? toneColor[tone], fontFamily: fonts.system },
        weight ? { fontWeight: fontWeight[weight] } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
});
