import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { request } from '@/api/client';
import { DEFAULT_API_URL, isValidBaseUrl, normalizeBaseUrl } from '@/api/config';
import { Button, Sheet, Text, TextField } from '@/components';
import { colors } from '@/theme';

import { useAuth } from './AuthProvider';

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok' } | { kind: 'error'; message: string };

/**
 * Hidden developer setting on the login screen: point the app at another
 * backend (e.g. http://192.168.1.20:3000 on the local Wi-Fi).
 */
export function ServerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { serverUrl, changeServer } = useAuth();
  const [value, setValue] = useState(serverUrl);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [wasVisible, setWasVisible] = useState(visible);

  // reset the form each time the sheet opens
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setValue(serverUrl);
      setTest({ kind: 'idle' });
    }
  }

  const valid = isValidBaseUrl(value);

  const runTest = async () => {
    if (!valid) return;
    setTest({ kind: 'testing' });
    const base = normalizeBaseUrl(value);
    try {
      await request(`${base}/api/me`, { anonymous: true, timeoutMs: 6000 });
      setTest({ kind: 'ok' });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      // 401 means the BeBetter API answered: that's a success here.
      if (status === 401) setTest({ kind: 'ok' });
      else
        setTest({
          kind: 'error',
          message:
            status === 0
              ? "Can't reach this address. Same Wi-Fi? Is the backend running? Firewall?"
              : `The server answered with HTTP ${status}. Is this a BeBetter API?`,
        });
    }
  };

  const save = async () => {
    if (!valid) return;
    await changeServer(value);
    onClose();
  };

  const reset = async () => {
    await changeServer(null);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Server">
      <View style={styles.body}>
        <Text variant="meta" tone="secondary" style={styles.help}>
          For local testing, enter your computer&apos;s address on the same Wi-Fi, for example
          http://192.168.1.20:3000
        </Text>
        <TextField
          label="Server URL"
          value={value}
          onChangeText={(t) => {
            setValue(t);
            setTest({ kind: 'idle' });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={save}
          error={value && !valid ? 'Enter a URL like http://192.168.1.20:3000' : null}
        />
        {test.kind === 'ok' ? (
          <Text variant="caption" color={colors.success} style={styles.status}>
            Connected to BeBetter.
          </Text>
        ) : test.kind === 'error' ? (
          <Text variant="caption" tone="danger" style={styles.status}>
            {test.message}
          </Text>
        ) : null}
        <View style={styles.row}>
          <Button
            title="Test"
            variant="secondary"
            size="lg"
            onPress={runTest}
            loading={test.kind === 'testing'}
            disabled={!valid}
            style={styles.flex}
          />
          <Button title="Save" size="lg" onPress={save} disabled={!valid} style={styles.flex} />
        </View>
        <Button
          title={`Use default (${DEFAULT_API_URL.replace(/^https?:\/\//, '')})`}
          variant="text"
          onPress={reset}
          style={styles.reset}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },
  help: { marginBottom: 2 },
  status: { marginTop: -4 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
  reset: { alignSelf: 'center' },
});
