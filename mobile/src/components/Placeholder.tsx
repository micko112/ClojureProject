import { StyleSheet, View } from 'react-native';

import { EmptyState } from './EmptyState';
import { Header } from './Header';
import type { IconName } from './Icon';
import { Screen } from './Screen';
import { Text } from './Text';

export interface PlaceholderScreenProps {
  title: string;
  /** The route file, shown so it's obvious where to build the screen. */
  route: string;
  icon?: IconName;
  note?: string;
  /** Hide the header (tab roots that render their own). */
  header?: boolean;
}

/**
 * Temporary screen for routes that exist in the router but are not built
 * yet. Replace the route file's content; keep the file path.
 */
export function PlaceholderScreen({ title, route, icon = 'time', note, header = true }: PlaceholderScreenProps) {
  return (
    <Screen>
      {header ? <Header title={title} border /> : null}
      <View style={styles.body}>
        <EmptyState icon={icon} title={title} message={note ?? 'This screen is on its way.'} />
        <Text variant="caption" tone="tertiary" align="center">
          {route}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', paddingBottom: 60 },
});
