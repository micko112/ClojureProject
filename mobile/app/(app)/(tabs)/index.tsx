import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { router, useScrollToTop } from 'expo-router';
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, View, type ViewToken } from 'react-native';

import { useUnreadMessages, useUnreadNotifications } from '@/api/hooks/account';
import { flattenPages, useFeed } from '@/api/hooks/posts';
import { queryKeys } from '@/api/queryClient';
import type { Page, Post, UserSummary } from '@/api/types';
import { EmptyState, Header, IconButton, Screen, Wordmark } from '@/components';
import { CaughtUp } from '@/features/feed/CaughtUp';
import { NewPostsPill } from '@/features/feed/NewPostsPill';
import { StreakBanner } from '@/features/feed/StreakBanner';
import { PostCard, PostSkeleton } from '@/features/posts';
import { StoriesBar } from '@/features/stories/StoriesBar';
import { useRealtime } from '@/hooks/useRealtime';
import { colors, layout } from '@/theme';

export default function HomeScreen() {
  const qc = useQueryClient();
  const feed = useFeed();
  const posts = flattenPages(feed.data);
  const listRef = useRef<FlatList<Post>>(null);
  useScrollToTop(listRef);

  const { data: unreadNotifications = 0 } = useUnreadNotifications();
  const { data: unreadMessages } = useUnreadMessages();

  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(new Set());
  const [newAuthors, setNewAuthors] = useState<UserSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useRealtime('post:new', (e) => {
    setNewAuthors((prev) => [e.author, ...prev.filter((a) => a.username !== e.author.username)].slice(0, 3));
  });

  const refresh = useCallback(async () => {
    setNewAuthors([]);
    // keep only the first page so a refresh is one request, not one per loaded page
    qc.setQueryData<InfiniteData<Page<Post>>>(queryKeys.feed, (d) =>
      d ? { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) } : d,
    );
    await Promise.all([
      feed.refetch(),
      qc.invalidateQueries({ queryKey: queryKeys.stories }),
      qc.invalidateQueries({ queryKey: queryKeys.myStreak }),
    ]);
  }, [qc, feed]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const showNewPosts = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    void refresh();
  };

  // FlatList requires both to be stable for the component's lifetime
  const [viewabilityConfig] = useState({ itemVisiblePercentThreshold: 60, minimumViewTime: 120 });
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Post>[] }) => {
    setVisibleIds(new Set(viewableItems.filter((v) => v.isViewable).map((v) => v.item.id)));
  }, []);

  const header = (
    <Header
      back={false}
      titleAlign="left"
      titleNode={<Wordmark onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} />}
      right={
        <>
          <IconButton
            name="heart"
            size={26}
            badge={unreadNotifications > 0}
            accessibilityLabel="Notifications"
            onPress={() => router.push('/notifications')}
          />
          <IconButton
            name="messages"
            size={25}
            badge={unreadMessages?.count ? unreadMessages.count : undefined}
            accessibilityLabel="Messages"
            onPress={() => router.push('/messages')}
          />
        </>
      }
    />
  );

  const listHeader = (
    <View>
      <StoriesBar />
      <StreakBanner />
      {feed.isSuccess && posts.length > 0 ? <View style={styles.headerGap} /> : null}
    </View>
  );

  let empty: ReactElement | null = null;
  if (feed.isPending) {
    empty = (
      <View>
        <PostSkeleton />
        <PostSkeleton />
      </View>
    );
  } else if (feed.isError) {
    empty = (
      <EmptyState
        icon="offline"
        title="Couldn't load your feed"
        message={feed.error.message}
        actionLabel="Try again"
        onAction={() => void feed.refetch()}
      />
    );
  } else {
    empty = (
      <EmptyState
        icon="people"
        title="Welcome to BeBetter"
        message="Follow people to see their daily progress here, or share your own Day 1."
        actionLabel="Find people to follow"
        onAction={() => router.push('/search')}
      />
    );
  }

  return (
    <Screen>
      {header}
      <View style={styles.flex}>
        <FlatList
          ref={listRef}
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <PostCard post={item} visible={visibleIds.has(item.id)} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={empty}
          ListFooterComponent={
            feed.isFetchingNextPage ? <PostSkeleton /> : posts.length > 0 && !feed.hasNextPage ? <CaughtUp /> : null
          }
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          onEndReachedThreshold={1.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullRefresh}
              tintColor={colors.textSecondary}
              colors={[colors.text]}
              progressBackgroundColor={colors.fill}
            />
          }
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          showsVerticalScrollIndicator={false}
          initialNumToRender={3}
          maxToRenderPerBatch={4}
          windowSize={7}
          removeClippedSubviews={false}
        />
        <NewPostsPill authors={newAuthors} onPress={showNewPosts} top={layout.gutter} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerGap: { height: 0 },
});
