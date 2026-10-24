import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { usePost } from '@/api/hooks/posts';
import { EmptyState, Header, Screen } from '@/components';
import { PostCard, PostSkeleton } from '@/features/posts';

/**
 * Single post ("Posts" in Instagram). Renders instantly from any cached
 * list, then refreshes. TODO (posts engineer): inline comments below.
 */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: post, isPending, error, refetch } = usePost(id);

  return (
    <Screen>
      <Header title="Post" />
      <ScrollView contentContainerStyle={styles.content}>
        {post ? (
          <PostCard post={post} visible />
        ) : isPending ? (
          <PostSkeleton />
        ) : (
          <View style={styles.error}>
            <EmptyState
              icon={error instanceof ApiError && error.status === 404 ? 'alert' : 'offline'}
              title={error instanceof ApiError && error.status === 404 ? "This post isn't available" : "Couldn't load post"}
              message={
                error instanceof ApiError && error.status === 404
                  ? 'The link may be broken, or the post may have been removed.'
                  : error?.message
              }
              actionLabel="Try again"
              onAction={() => void refetch()}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  error: { paddingTop: 80 },
});
