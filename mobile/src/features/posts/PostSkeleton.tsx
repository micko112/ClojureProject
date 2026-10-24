import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Skeleton } from '@/components';
import { layout } from '@/theme';

/** Loading placeholder shaped like a PostCard. */
export function PostSkeleton() {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Skeleton circle width={36} />
        <View style={styles.lines}>
          <Skeleton width={110} height={11} />
          <Skeleton width={70} height={9} />
        </View>
      </View>
      <Skeleton width={width} height={width} radius={0} />
      <View style={styles.actions}>
        <Skeleton width={26} height={24} radius={6} />
        <Skeleton width={26} height={24} radius={6} />
        <Skeleton width={26} height={24} radius={6} />
      </View>
      <View style={styles.text}>
        <Skeleton width={90} height={11} />
        <Skeleton width={width * 0.7} height={11} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingBottom: 16 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.gutter, gap: 10 },
  lines: { gap: 6 },
  actions: { flexDirection: 'row', gap: 16, paddingHorizontal: layout.gutter, paddingVertical: 11 },
  text: { gap: 8, paddingHorizontal: layout.gutter },
});
