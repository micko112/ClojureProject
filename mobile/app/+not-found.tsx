import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { EmptyState, Header, Screen } from '@/components';

export default function NotFound() {
  return (
    <Screen>
      <Header back />
      <View style={styles.body}>
        <EmptyState
          icon="alert"
          title="Page not found"
          message="The link you followed may be broken, or the page may have been removed."
          actionLabel="Go home"
          onAction={() => router.replace('/')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1, justifyContent: 'center' } });
