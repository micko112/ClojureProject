import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { ApiError } from '@/api/client';
import { Button, Header, Text, TextField } from '@/components';
import { AuthScaffold } from '@/features/auth/AuthScaffold';
import { useAuth } from '@/features/auth/AuthProvider';

type Field = 'email' | 'username' | 'password' | 'displayName' | 'form';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const validate = (): Partial<Record<Field, string>> => {
    const e: Partial<Record<Field, string>> = {};
    if (email && !EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    if (!username.trim()) e.username = 'Choose a username.';
    if (password.length < 6) e.password = 'Use at least 6 characters.';
    if (username.trim() && !/^[A-Za-z0-9._]{3,30}$/.test(username.trim()))
      e.username = 'Use 3-30 letters, numbers, periods or underscores.';
    return e;
  };

  const submit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await register({
        username: username.trim(),
        password,
        email: email.trim() || undefined,
        displayName: displayName.trim() || undefined,
      });
    } catch (err) {
      setErrors(mapServerError(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = (f: Field) => setErrors((e) => ({ ...e, [f]: undefined, form: undefined }));

  return (
    <AuthScaffold
      top={<Header back />}
      footer={
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.footer}>
          <Text variant="meta" tone="secondary" align="center">
            Already have an account? <Text variant="meta" weight="semibold">Log in</Text>
          </Text>
        </Pressable>
      }
    >
      <Text variant="display" style={styles.title}>
        Create your account
      </Text>
      <Text variant="body" tone="secondary" style={styles.subtitle}>
        Share your progress every day. Only support here, no dislikes.
      </Text>

      <View style={styles.form}>
        <TextField
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            clear('email');
          }}
          error={errors.email}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => usernameRef.current?.focus()}
          submitBehavior="submit"
        />
        <TextField
          ref={usernameRef}
          label="Username"
          value={username}
          onChangeText={(t) => {
            setUsername(t.replace(/\s/g, ''));
            clear('username');
          }}
          error={errors.username}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => nameRef.current?.focus()}
          submitBehavior="submit"
        />
        <TextField
          ref={nameRef}
          label="Full name (optional)"
          value={displayName}
          onChangeText={(t) => {
            setDisplayName(t);
            clear('displayName');
          }}
          error={errors.displayName}
          autoComplete="name"
          textContentType="name"
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
            clear('password');
          }}
          error={errors.password}
          secureToggle
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {errors.form ? (
          <Text variant="meta" tone="danger" align="center">
            {errors.form}
          </Text>
        ) : null}
        <Button
          title="Sign up"
          size="lg"
          block
          onPress={submit}
          loading={busy}
          disabled={!username.trim() || !password}
          style={styles.submit}
        />
      </View>
    </AuthScaffold>
  );
}

/** The backend returns one message; route it to the field it's about. */
function mapServerError(err: unknown): Partial<Record<Field, string>> {
  if (!(err instanceof ApiError)) return { form: 'Something went wrong. Try again.' };
  if (err.isNetworkError) return { form: err.message };
  const m = err.message.toLowerCase();
  if (m.includes('username')) return { username: err.message };
  if (m.includes('password')) return { password: err.message };
  if (m.includes('email')) return { email: err.message };
  return { form: err.message };
}

const styles = StyleSheet.create({
  title: { marginBottom: 6 },
  subtitle: { marginBottom: 24 },
  form: { gap: 12 },
  submit: { marginTop: 6 },
  footer: { paddingVertical: 12 },
});
