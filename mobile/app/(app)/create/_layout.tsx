import { Stack } from 'expo-router';

import { colors } from '@/theme';

/** Composer flow, presented full screen over the tabs (see app/(app)/_layout.tsx). */
export default function CreateLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
