import { Ionicons } from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type ColorValue, type StyleProp, type TextStyle } from 'react-native';

import { colors } from '@/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * One icon set for the whole app: Ionicons (@react-native-vector-icons).
 * Instagram convention: outline when inactive, filled when `active`.
 * Use semantic names; add new ones here instead of using raw names in screens.
 */
const ICONS = {
  home: ['home-outline', 'home'],
  search: ['search-outline', 'search'],
  reels: ['film-outline', 'film'],
  heart: ['heart-outline', 'heart'],
  comment: ['chatbubble-outline', 'chatbubble'],
  share: ['paper-plane-outline', 'paper-plane'],
  messages: ['paper-plane-outline', 'paper-plane'],
  bookmark: ['bookmark-outline', 'bookmark'],
  more: ['ellipsis-horizontal', 'ellipsis-horizontal'],
  moreVertical: ['ellipsis-vertical', 'ellipsis-vertical'],
  back: ['chevron-back', 'chevron-back'],
  forward: ['chevron-forward', 'chevron-forward'],
  down: ['chevron-down', 'chevron-down'],
  close: ['close', 'close'],
  add: ['add', 'add'],
  settings: ['settings-outline', 'settings'],
  menu: ['menu-outline', 'menu'],
  camera: ['camera-outline', 'camera'],
  images: ['images-outline', 'images'],
  grid: ['grid-outline', 'grid'],
  person: ['person-outline', 'person'],
  people: ['people-outline', 'people'],
  lock: ['lock-closed-outline', 'lock-closed'],
  mute: ['volume-mute', 'volume-mute'],
  unmute: ['volume-high', 'volume-high'],
  play: ['play', 'play'],
  flame: ['flame-outline', 'flame'],
  live: ['radio-outline', 'radio'],
  server: ['server-outline', 'server'],
  eye: ['eye-outline', 'eye'],
  eyeOff: ['eye-off-outline', 'eye-off'],
  check: ['checkmark', 'checkmark'],
  checkCircle: ['checkmark-circle-outline', 'checkmark-circle'],
  alert: ['alert-circle-outline', 'alert-circle'],
  offline: ['cloud-offline-outline', 'cloud-offline'],
  trash: ['trash-outline', 'trash'],
  link: ['link-outline', 'link'],
  refresh: ['refresh-outline', 'refresh'],
  arrowUp: ['arrow-up', 'arrow-up'],
  mail: ['mail-outline', 'mail'],
  star: ['star-outline', 'star'],
  time: ['time-outline', 'time'],
  archive: ['archive-outline', 'archive'],
  logout: ['log-out-outline', 'log-out'],
  edit: ['create-outline', 'create'],
} as const satisfies Record<string, readonly [IoniconName, IoniconName]>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  /** filled variant (selected tab, liked heart, saved bookmark) */
  active?: boolean;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export function Icon({ name, active = false, size = 24, color = colors.text, style, accessibilityLabel }: IconProps) {
  const [outline, filled] = ICONS[name];
  return (
    <Ionicons
      name={active ? filled : outline}
      size={size}
      color={color}
      style={style}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    />
  );
}

/**
 * Instagram's "create" glyph: a rounded square with a plus. Built from the
 * same Ionicons "add" glyph so stroke weight matches the other tab icons.
 */
export function CreateIcon({ size = 24, color = colors.text, active = false }: Omit<IconProps, 'name'>) {
  const box = size * 0.86;
  return (
    <View
      style={[
        styles.createBox,
        {
          width: box,
          height: box,
          borderRadius: box * 0.28,
          borderColor: color,
          borderWidth: active ? 2.2 : 1.8,
          backgroundColor: active ? color : 'transparent',
        },
      ]}
    >
      <Ionicons name="add" size={size * 0.72} color={active ? colors.bg : color} />
    </View>
  );
}

const styles = StyleSheet.create({
  createBox: { alignItems: 'center', justifyContent: 'center' },
});
