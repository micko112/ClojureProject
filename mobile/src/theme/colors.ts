/**
 * BeBetter is black-only (like Instagram's dark mode). Use these tokens,
 * never raw hex values in components.
 */
export const colors = {
  /** App background, full-bleed behind everything. */
  bg: '#000000',
  /** Inputs, skeletons, grouped rows. */
  surface: '#121212',
  /** Sheets, popovers, toasts, secondary buttons. */
  elevated: '#1C1C1E',
  /** Secondary button / pill fill (Instagram "Edit profile" grey). */
  fill: '#262626',
  /** Pressed state for `fill`. */
  fillPressed: '#363636',
  /** Hairline separators, input borders. */
  separator: '#262626',
  /** Slightly stronger border (inputs, seen story ring). */
  border: '#363636',

  text: '#F5F5F5',
  textSecondary: '#A8A8A8',
  textTertiary: '#737373',
  /** Mentions and hashtags inside captions/comments. */
  link: '#E0F1FF',

  accent: '#0095F6',
  accentPressed: '#1877F2',
  accentDisabled: '#0B4F7F',

  like: '#FF3040',
  danger: '#ED4956',
  success: '#5BD16E',
  /** Brand warm tone used sparingly (Day pill, streak). */
  amber: '#FFB547',

  white: '#FFFFFF',
  black: '#000000',
  /** Scrims over media (carousel counter, mute button). */
  scrim: 'rgba(0,0,0,0.6)',
  backdrop: 'rgba(0,0,0,0.55)',
  transparent: 'transparent',
} as const;

/**
 * Story ring: BeBetter's warm sunrise gradient (amber -> orange -> magenta).
 * Start bottom-left, end top-right.
 */
export const storyGradient = ['#FFC24B', '#FF7A1F', '#F0386B', '#D3157A'] as const;
/** Live ring/badge: hotter, shorter gradient. */
export const liveGradient = ['#FF3A6E', '#E4136B'] as const;
/** Close friends ring. */
export const closeFriendsColor = '#1CD14F';

export type ColorName = keyof typeof colors;
