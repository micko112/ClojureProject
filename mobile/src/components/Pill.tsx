import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, hairline } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type PillTone = 'neutral' | 'outline' | 'accent' | 'scrim' | 'brand';

export interface PillProps {
  label: string;
  tone?: PillTone;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

/**
 * Small rounded label: "Day 37", "1/5" media counter, "Before"/"After".
 *   <Pill label="Day 37" tone="brand" />
 */
export function Pill({ label, tone = 'neutral', icon, style }: PillProps) {
  const t = tones[tone];
  return (
    <View style={[styles.pill, t.box, style]}>
      {icon ? <Icon name={icon} active size={10} color={t.text} /> : null}
      <Text variant="tiny" color={t.text} style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const tones: Record<PillTone, { box: ViewStyle; text: string }> = {
  neutral: { box: { backgroundColor: colors.fill }, text: colors.text },
  outline: { box: { borderWidth: hairline * 2, borderColor: colors.border }, text: colors.textSecondary },
  accent: { box: { backgroundColor: colors.accent }, text: colors.white },
  scrim: { box: { backgroundColor: colors.scrim }, text: colors.white },
  // Day N: warm text on a quiet fill, the one place the brand colour shows in the feed
  brand: { box: { backgroundColor: 'rgba(255,181,71,0.12)' }, text: colors.amber },
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 9,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 11, lineHeight: 13 },
});
