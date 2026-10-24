import { Stack } from 'expo-router';

import { colors } from '@/theme';

/**
 * Signed-in stack. Tabs are the root; every other screen is pushed on top
 * (full screen, tab bar hidden) like Instagram. Add new screens as files —
 * only list them here when they need non-default options.
 */
export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'default',
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="create" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen
        name="story/[username]"
        options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: colors.black } }}
      />
      <Stack.Screen name="live/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="comments/[postId]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
