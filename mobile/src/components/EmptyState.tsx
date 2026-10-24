import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Instagram-style empty state: outlined circle icon, bold title, grey
 * message, optional text action.
 */
export function EmptyState({ icon = 'images', title, message, actionLabel, onAction, style }: EmptyStateProps) {
  return (
    <View style={[styles.root, style]}>
      <View style={styles.circle}>
        <Icon name={icon} size={34} color={colors.text} />
      </View>
      <Text variant="headline" align="center" style={styles.title}>
        {title}
      </Text>
      {message ? (
        <Text variant="body" tone="secondary" align="center" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button title={actionLabel} variant="text" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 48 },
  circle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { marginBottom: 6 },
  message: { marginBottom: 10, maxWidth: 300 },
});
