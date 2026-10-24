import { View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, hairline } from '@/theme';

export interface DividerProps {
  vertical?: boolean;
  /** left/right inset for horizontal dividers */
  inset?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/** Hairline separator (#262626). */
export function Divider({ vertical, inset = 0, color = colors.separator, style }: DividerProps) {
  return (
    <View
      style={[
        vertical
          ? { width: hairline, alignSelf: 'stretch', backgroundColor: color }
          : { height: hairline, marginHorizontal: inset, backgroundColor: color },
        style,
      ]}
    />
  );
}
