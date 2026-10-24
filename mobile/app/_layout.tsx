import { Courgette_400Regular, useFonts } from '@expo-google-fonts/courgette';
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, SplashScreen, Stack, ThemeProvider, type Theme } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/api/queryClient';
import { ToastProvider } from '@/components/Toast';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync();
void SystemUI.setBackgroundColorAsync(colors.bg);

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.separator,
    notification: colors.like,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Courgette_400Regular });

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider style={styles.root}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemeProvider value={navTheme}>
              <ToastProvider>
                <StatusBar style="light" />
                {Platform.OS === 'android' ? <NavigationBar style="light" /> : null}
                <RootNavigator ready={fontsLoaded || !!fontError} />
              </ToastProvider>
            </ThemeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Auth gate: (auth) screens when signed out, (app) when signed in. The
 * router redirects automatically when `status` changes (login, logout, 401).
 */
function RootNavigator({ ready }: { ready: boolean }) {
  const { status } = useAuth();
  const loading = status === 'loading' || !ready;

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  const signedIn = status === 'signedIn';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
      </Stack.Protected>
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
