import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { getBaseUrl } from '@/api/config';
import { Divider, Header, Icon, Screen, Text, type IconName } from '@/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { colors } from '@/theme';

/**
 * Settings root. Only "Log out" works for now; add sub-pages as files in
 * app/(app)/settings/ (e.g. account.tsx, privacy.tsx) and link them here.
 */
export default function SettingsScreen() {
  const { signOut, user } = useAuth();
  const [busy, setBusy] = useState(false);

  return (
    <Screen>
      <Header title="Settings and activity" border />
      <ScrollView>
        <Row icon="person" label="Account" note="Coming soon" />
        <Row icon="lock" label="Account privacy" note="Coming soon" />
        <Row icon="star" label="Close friends" note="Coming soon" />
        <Row icon="bookmark" label="Saved" note="Coming soon" />
        <Row icon="archive" label="Archive" note="Coming soon" />
        <Divider style={styles.gap} />
        <Text variant="caption" tone="tertiary" style={styles.section}>
          Login
        </Text>
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            await signOut();
          }}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Text variant="body" tone="danger">
            {busy ? 'Logging out…' : `Log out ${user?.username ?? ''}`}
          </Text>
        </Pressable>
        <Text variant="caption" tone="tertiary" style={styles.server}>
          Server: {getBaseUrl()}
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Row({ icon, label, note }: { icon: IconName; label: string; note?: string }) {
  return (
    <View style={styles.row}>
      <Icon name={icon} size={24} />
      <Text variant="body" style={styles.label}>
        {label}
      </Text>
      {note ? (
        <Text variant="caption" tone="tertiary">
          {note}
        </Text>
      ) : null}
      <Icon name="forward" size={18} color={colors.textTertiary} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 16 },
  pressed: { backgroundColor: colors.surface },
  label: { flex: 1, fontSize: 15 },
  gap: { marginVertical: 8 },
  section: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  server: { paddingHorizontal: 16, paddingTop: 16 },
});
