import { StyleSheet } from 'react-native';

export * from './colors';
export * from './typography';

/** 4-pt spacing scale. Feed rows use 12 horizontal padding like Instagram. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/** Hairline used for every separator. */
export const hairline = StyleSheet.hairlineWidth;

export const layout = {
  /** Horizontal padding of feed rows, headers and lists. */
  gutter: 12,
  headerHeight: 48,
  tabBarHeight: 50,
  /** Post media aspect clamps (width / height). */
  minAspect: 4 / 5,
  maxAspect: 1.91,
} as const;

/** Durations (ms) for small UI animations. */
export const motion = {
  fast: 150,
  normal: 220,
  slow: 320,
} as const;
