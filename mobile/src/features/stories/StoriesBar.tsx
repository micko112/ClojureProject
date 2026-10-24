import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useMe, useStories } from '@/api/hooks/account';
import type { StoryGroup } from '@/api/types';
import { Avatar, avatarSizes, Skeleton, Text } from '@/components';
import { layout } from '@/theme';

const ITEM_W = 82;

/**
 * Instagram stories row: "Your story" first (with a blue + when you have
 * none), then people you follow — gradient ring while unseen, grey once seen.
 */
export function StoriesBar() {
  const { data: groups, isLoading } = useStories();
  const { data: me } = useMe();

  if (isLoading) {
    return (
      <View style={styles.row}>
        {Array.from({ length: 5 }, (_, i) => (
          <View key={i} style={styles.item}>
            <Skeleton circle width={avatarSizes.story + 10} />
            <Skeleton width={52} height={9} style={styles.skelLabel} />
          </View>
        ))}
      </View>
    );
  }

  const mine = groups?.find((g) => g.isMe);
  const others = (groups ?? []).filter((g) => !g.isMe);
  const data: (StoryGroup | 'me')[] = ['me', ...others];

  return (
    <FlatList
      horizontal
      data={data}
      keyExtractor={(g) => (g === 'me' ? '__me' : g.username)}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        if (item === 'me') {
          const hasStory = !!mine && mine.stories.length > 0;
          return (
            <StoryItem
              label="Your story"
              uri={me?.profilePic}
              ring={hasStory ? (mine?.hasUnviewed ? 'unseen' : 'seen') : 'none'}
              addBadge={!hasStory}
              dim
              onPress={() =>
                hasStory
                  ? router.push({ pathname: '/story/[username]', params: { username: me?.username ?? '' } })
                  : router.push('/create/story')
              }
            />
          );
        }
        return (
          <StoryItem
            label={item.username}
            uri={item.profilePic}
            ring={item.hasUnviewed ? 'unseen' : 'seen'}
            onPress={() => router.push({ pathname: '/story/[username]', params: { username: item.username } })}
          />
        );
      }}
    />
  );
}

function StoryItem({
  label,
  uri,
  ring,
  addBadge,
  dim,
  onPress,
}: {
  label: string;
  uri?: string | null;
  ring: 'unseen' | 'seen' | 'none';
  addBadge?: boolean;
  dim?: boolean;
  onPress: () => void;
}) {
  // keep every avatar the same outer size whether or not it has a ring
  const outer = avatarSizes.story + 2 * (2.5 + 3);
  return (
    <Pressable onPress={onPress} style={styles.item} accessibilityRole="button" accessibilityLabel={`${label} story`}>
      <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}>
        <Avatar uri={uri} size={avatarSizes.story} ring={ring} addBadge={addBadge} />
      </View>
      <Text variant="caption" tone={dim ? 'secondary' : 'primary'} numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: layout.gutter - 6, paddingTop: 4, paddingBottom: 10 },
  row: { flexDirection: 'row', paddingHorizontal: layout.gutter - 6, paddingTop: 4, paddingBottom: 10 },
  item: { width: ITEM_W, alignItems: 'center' },
  label: { marginTop: 5, maxWidth: ITEM_W - 8, fontSize: 12 },
  skelLabel: { marginTop: 8 },
});
