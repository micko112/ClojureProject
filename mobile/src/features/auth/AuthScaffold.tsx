import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components';

/**
 * Layout shared by the auth screens: keyboard-aware scroll, content
 * centred, footer pinned to the bottom.
 */
export function AuthScaffold({ top, children, footer }: { top?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Screen edges={['top', 'bottom']}>
      {top}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 16 },
  content: { flex: 1, justifyContent: 'center', paddingVertical: 24, width: '100%', maxWidth: 420, alignSelf: 'center' },
  footer: { paddingBottom: 12, width: '100%', maxWidth: 420, alignSelf: 'center' },
});
