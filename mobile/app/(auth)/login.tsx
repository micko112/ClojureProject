import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { ApiError } from '@/api/client';
import { isCustomBaseUrl } from '@/api/config';
import { Button, IconButton, Text, TextField, Wordmark } from '@/components';
import { AuthScaffold } from '@/features/auth/AuthScaffold';
import { useAuth } from '@/features/auth/AuthProvider';
import { ServerSheet } from '@/features/auth/ServerSheet';
import { colors } from '@/theme';

export default function LoginScreen() {
  const { signIn, serverUrl } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const canSubmit = login.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(login, password);
      // the root layout swaps to the app once signed in
    } catch (e) {
      setError(friendlyLoginError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScaffold
      top={
        <View style={styles.topBar}>
          <IconButton
            name="settings"
            size={20}
            color={colors.textTertiary}
            accessibilityLabel="Server settings"
            onPress={() => setServerOpen(true)}
          />
        </View>
      }
      footer={
        <View style={styles.footer}>
          <Button
            title="Create new account"
            variant="outline"
            size="lg"
            block
            onPress={() => router.push('/register')}
          />
          {isCustomBaseUrl() ? (
            <Pressable onPress={() => setServerOpen(true)} hitSlop={6}>
              <Text variant="caption" tone="tertiary" align="center" style={styles.server}>
                Server: {serverUrl.replace(/^https?:\/\//, '')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      <Pressable
        onLongPress={() => setServerOpen(true)}
        delayLongPress={600}
        style={styles.brand}
        accessibilityHint="Long-press to change the server"
      >
        <Wordmark size={52} />
        <Text variant="body" tone="secondary" align="center" style={styles.tagline}>
          Post your progress. Every day.
        </Text>
      </Pressable>

      <View style={styles.form}>
        <TextField
          label="Username or email"
          value={login}
          onChangeText={(t) => {
            setLogin(t);
            setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          submitBehavior="submit"
        />
        <TextField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            setError(null);
          }}
          secureToggle
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {error ? (
          <Text variant="meta" tone="danger" align="center" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Button title="Log in" size="lg" block onPress={submit} loading={busy} disabled={!canSubmit} />
        <Link href="/forgot-password" asChild>
          <Pressable hitSlop={8} style={styles.forgot}>
            <Text variant="bodyStrong" align="center">
              Forgot password?
            </Text>
          </Pressable>
        </Link>
      </View>

      <ServerSheet visible={serverOpen} onClose={() => setServerOpen(false)} />
    </AuthScaffold>
  );
}

function friendlyLoginError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.isNetworkError) return "Can't reach the server. Check your connection or the server address.";
    if (e.message === 'User not found') return "We couldn't find an account with that username or email.";
    if (e.message === 'Wrong password') return 'Wrong password. Try again or reset it.';
    return e.message;
  }
  return 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  topBar: { height: 44, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16 },
  brand: { alignItems: 'center', marginBottom: 36 },
  tagline: { marginTop: 4 },
  form: { gap: 12 },
  error: { marginVertical: 2 },
  forgot: { alignSelf: 'center', paddingVertical: 10, marginTop: 2 },
  footer: { gap: 12 },
  server: { marginTop: 2 },
});
