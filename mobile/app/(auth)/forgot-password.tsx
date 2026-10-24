import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { Button, Header, Icon, Text, TextField } from '@/components';
import { AuthScaffold } from '@/features/auth/AuthScaffold';
import { useAuth } from '@/features/auth/AuthProvider';
import { colors } from '@/theme';

export default function ForgotPasswordScreen() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setSent(await forgotPassword(email));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScaffold top={<Header back />}>
      <View style={styles.lockCircle}>
        <Icon name="lock" size={40} color={colors.text} />
      </View>
      <Text variant="headline" align="center" style={styles.title}>
        Trouble logging in?
      </Text>
      {sent ? (
        <>
          <Text variant="body" tone="secondary" align="center" style={styles.subtitle}>
            {sent}
          </Text>
          <Text variant="caption" tone="tertiary" align="center" style={styles.subtitle}>
            Open the link on this phone or on the web to choose a new password, then log in here.
          </Text>
          <Button title="Back to log in" size="lg" block onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Text variant="body" tone="secondary" align="center" style={styles.subtitle}>
            Enter your email or username and we&apos;ll send you a link to get back into your account.
          </Text>
          <View style={styles.form}>
            <TextField
              label="Email or username"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setError(null);
              }}
              error={error}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="send"
              onSubmitEditing={submit}
            />
            <Button title="Send login link" size="lg" block onPress={submit} loading={busy} disabled={!email.trim()} />
          </View>
        </>
      )}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  lockCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2.5,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { marginBottom: 8 },
  subtitle: { marginBottom: 20, paddingHorizontal: 8 },
  form: { gap: 12 },
});
