import { Platform, type TextStyle } from 'react-native';

/**
 * System font everywhere (SF Pro on iOS, Roboto on Android), sized like
 * Instagram. The only custom font is the "BeBetter" wordmark.
 */
export const fonts = {
  /** Loaded in app/_layout.tsx with @expo-google-fonts/courgette. */
  wordmark: 'Courgette_400Regular',
  /** Leave fontFamily unset for the platform default; this is for web parity only. */
  system: Platform.select({
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    default: undefined,
  }),
} as const;

export const fontSize = {
  xxs: 10,
  xs: 11,
  sm: 12,
  md: 13,
  body: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  display: 28,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;

/**
 * Text variants for <Text variant="...">. Keep the list short; prefer
 * composing (`variant="body" weight="semibold"`) over adding variants.
 */
export const textVariants = {
  /** 14 — captions, comments, list rows. */
  body: { fontSize: fontSize.body, lineHeight: 18, fontWeight: fontWeight.regular },
  /** 14 semibold — usernames, buttons. */
  bodyStrong: { fontSize: fontSize.body, lineHeight: 18, fontWeight: fontWeight.semibold },
  /** 13 — secondary lines ("View all 12 comments"). */
  meta: { fontSize: fontSize.md, lineHeight: 17, fontWeight: fontWeight.regular },
  /** 12 — timestamps, story labels. */
  caption: { fontSize: fontSize.sm, lineHeight: 16, fontWeight: fontWeight.regular },
  /** 11 — pills, badges. */
  tiny: { fontSize: fontSize.xs, lineHeight: 13, fontWeight: fontWeight.semibold },
  /** 16 semibold — screen/header titles. */
  title: { fontSize: fontSize.lg, lineHeight: 20, fontWeight: fontWeight.bold },
  /** 20 bold — profile names, empty-state titles. */
  headline: { fontSize: fontSize.xl, lineHeight: 24, fontWeight: fontWeight.bold },
  /** 24 bold — auth screen headings. */
  display: { fontSize: fontSize.xxl, lineHeight: 30, fontWeight: fontWeight.bold },
} as const satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof textVariants;
