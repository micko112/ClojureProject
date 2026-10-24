import { router } from 'expo-router';
import { memo, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { getBaseUrl } from '@/api/config';
import { useDeletePost, useLikePost, useReactToPost, useSavePost } from '@/api/hooks/posts';
import type { Post } from '@/api/types';
import { Avatar, avatarSizes, Icon, IconButton, Pill, Sheet, SheetOption, Text, toast } from '@/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { useStoryRing } from '@/features/stories/useStoryRing';
import { toggleVideoMuted } from '@/hooks/useVideoMuted';
import { activityLabel, formatNumber, timeAgo } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { aspectOf, clampAspect } from '@/lib/media';
import { colors, layout } from '@/theme';

import { Caption } from './Caption';
import { CompareSlider } from './CompareSlider';
import { HeartBurst } from './HeartBurst';
import { CarouselDots, MediaCarousel } from './MediaCarousel';
import { MediaView } from './MediaView';
import { ReactionPicker } from './ReactionPicker';

export interface PostCardProps {
  post: Post;
  /** On screen: videos autoplay only while true. */
  visible?: boolean;
}

type Anchor = { x: number; y: number; width: number; height: number };

/**
 * Edge-to-edge Instagram post: header, media (single / carousel / compare /
 * video), actions, likes + reactions, caption, comments link, time.
 * Double-tap likes, long-press the heart for supportive reactions.
 */
export const PostCard = memo(function PostCard({ post, visible = false }: PostCardProps) {
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const like = useLikePost();
  const react = useReactToPost();
  const save = useSavePost();
  const del = useDeletePost();
  const ring = useStoryRing(post.author.username);

  const [index, setIndex] = useState(0);
  const [burst, setBurst] = useState(0);
  const [picker, setPicker] = useState<Anchor | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const heartRef = useRef<View>(null);
  const heartScale = useSharedValue(1);

  const media = post.media;
  const isCompare = post.layout === 'compare' && media.length === 2;
  const aspect = clampAspect(aspectOf(media[0]));
  const mediaHeight = Math.round(width / aspect);
  const isMine = user?.username === post.author.username;

  // keep latest values for gesture callbacks
  const latest = useRef({ post, index });
  latest.current = { post, index };

  const popHeart = () => {
    heartScale.set(withSequence(withTiming(0.8, { duration: 70 }), withSpring(1, { damping: 6, stiffness: 400 })));
  };

  const toggleLike = () => {
    haptics.light();
    popHeart();
    like.mutate(post);
  };

  const gesture = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(250)
      .runOnJS(true)
      .onEnd((_e, ok) => {
        if (!ok) return;
        const p = latest.current.post;
        setBurst((b) => b + 1);
        haptics.light();
        if (!p.liked) {
          popHeart();
          like.mutate(p);
        }
      });
    const singleTap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((_e, ok) => {
        if (!ok) return;
        const { post: p, index: i } = latest.current;
        if (p.media[i]?.type === 'video' || (p.layout === 'compare' && p.media.some((m) => m.type === 'video'))) {
          toggleVideoMuted();
        }
      });
    return Gesture.Exclusive(doubleTap, singleTap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openReactions = () => {
    haptics.medium();
    heartRef.current?.measureInWindow((x, y, w, h) => setPicker({ x, y, width: w, height: h }));
  };

  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));

  const goProfile = () => router.push({ pathname: '/profile/[username]', params: { username: post.author.username } });
  const goAvatar = () =>
    ring === 'none' ? goProfile() : router.push({ pathname: '/story/[username]', params: { username: post.author.username } });
  const goComments = () => router.push({ pathname: '/comments/[postId]', params: { postId: post.id } });

  const share = async () => {
    try {
      await Share.share({ message: `${getBaseUrl()}/post/${post.id}` });
    } catch {
      // dismissed
    }
  };

  const confirmDelete = () => {
    setMenuOpen(false);
    Alert.alert('Delete post?', "You won't be able to restore it.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          del.mutate(post.id, {
            onSuccess: () => toast('Post deleted'),
            onError: (e) => toast(e.message, { icon: 'alert' }),
          }),
      },
    ]);
  };

  const reactions = useMemo(() => summarizeReactions(post.reactions), [post.reactions]);
  const likeCount = post.likeCount;

  return (
    <View style={styles.card}>
      {/* header */}
      <View style={styles.header}>
        <Avatar
          uri={post.author.profilePic}
          size={avatarSizes.post - (ring === 'none' ? 0 : 6)}
          ring={ring}
          onPress={goAvatar}
          accessibilityLabel={`${post.author.username}'s ${ring === 'none' ? 'profile' : 'story'}`}
        />
        <View style={styles.headerText}>
          <View style={styles.nameRow}>
            <Text variant="bodyStrong" numberOfLines={1} onPress={goProfile} style={styles.username}>
              {post.author.username}
            </Text>
            {post.dayNumber ? <Pill label={`Day ${post.dayNumber}`} tone="brand" /> : null}
            {post.audience === 'close-friends' ? (
              <View style={styles.closeFriends}>
                <Icon name="star" active size={9} color={colors.white} />
              </View>
            ) : null}
          </View>
          {post.activityTag ? (
            <Text variant="caption" numberOfLines={1}>
              {activityLabel(post.activityTag)}
            </Text>
          ) : null}
        </View>
        <IconButton name="more" size={20} accessibilityLabel="More options" onPress={() => setMenuOpen(true)} style={styles.more} />
      </View>

      {/* media */}
      {media.length > 0 ? (
        <GestureDetector gesture={gesture}>
          <View style={{ width, height: mediaHeight }}>
            {isCompare ? (
              <CompareSlider before={media[0]!} after={media[1]!} width={width} height={mediaHeight} active={visible} />
            ) : media.length > 1 ? (
              <MediaCarousel media={media} width={width} height={mediaHeight} active={visible} onIndexChange={setIndex} />
            ) : (
              <MediaView media={media[0]!} width={width} height={mediaHeight} active={visible} />
            )}
            <HeartBurst trigger={burst} />
          </View>
        </GestureDetector>
      ) : null}

      {/* actions */}
      <View style={styles.actions}>
        <View style={styles.actionsLeft}>
          <Pressable
            ref={heartRef}
            onPress={toggleLike}
            onLongPress={openReactions}
            delayLongPress={300}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={post.liked ? 'Unlike' : 'Like'}
            accessibilityHint="Long-press for reactions"
          >
            <Animated.View style={heartStyle}>
              <Icon name="heart" active={!!post.liked} size={26} color={post.liked ? colors.like : colors.text} />
            </Animated.View>
          </Pressable>
          {!post.commentsOff ? (
            <IconButton name="comment" size={24} accessibilityLabel="Comment" onPress={goComments} style={styles.flipX} />
          ) : null}
          <IconButton name="share" size={24} accessibilityLabel="Share" onPress={share} />
        </View>
        {media.length > 1 && !isCompare ? (
          <View style={styles.dots} pointerEvents="none">
            <CarouselDots count={media.length} index={index} />
          </View>
        ) : null}
        <IconButton
          name="bookmark"
          active={!!post.saved}
          size={25}
          accessibilityLabel={post.saved ? 'Remove from saved' : 'Save'}
          onPress={() => {
            haptics.selection();
            save.mutate({ post, saved: !post.saved });
          }}
        />
      </View>

      {/* likes + reactions */}
      {(likeCount ?? 0) > 0 || reactions.total > 0 ? (
        <View style={styles.row}>
          <Text variant="bodyStrong">
            {(likeCount ?? 0) > 0 ? `${formatNumber(likeCount ?? 0)} ${likeCount === 1 ? 'like' : 'likes'}` : ''}
            {reactions.total > 0 ? (
              <Text variant="body" tone="secondary" onPress={openReactions}>
                {(likeCount ?? 0) > 0 ? '  ·  ' : ''}
                <RNText style={styles.reactionEmojis}>{reactions.top.join('')}</RNText> {formatNumber(reactions.total)}
              </Text>
            ) : null}
          </Text>
        </View>
      ) : null}

      {/* caption */}
      {post.caption ? (
        <View style={styles.row}>
          <Caption username={post.author.username} text={post.caption} />
        </View>
      ) : null}

      {/* comments link */}
      {!post.commentsOff && post.commentCount > 0 ? (
        <Pressable onPress={goComments} style={styles.row} hitSlop={4}>
          <Text variant="body" tone="secondary">
            {post.commentCount === 1 ? 'View 1 comment' : `View all ${formatNumber(post.commentCount)} comments`}
          </Text>
        </Pressable>
      ) : null}

      <Text variant="caption" tone="secondary" style={[styles.row, styles.time]}>
        {timeAgo(post.createdAt)}
        {post.editedAt ? ' · Edited' : ''}
      </Text>

      <ReactionPicker
        visible={!!picker}
        anchor={picker}
        selected={post.myReaction}
        onClose={() => setPicker(null)}
        onSelect={(emoji) => {
          haptics.selection();
          setPicker(null);
          react.mutate({ post, emoji });
        }}
      />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <SheetOption
          icon="bookmark"
          label={post.saved ? 'Remove from saved' : 'Save'}
          onPress={() => {
            setMenuOpen(false);
            save.mutate({ post, saved: !post.saved });
          }}
        />
        <SheetOption
          icon="link"
          label="Go to post"
          onPress={() => {
            setMenuOpen(false);
            router.push({ pathname: '/post/[id]', params: { id: post.id } });
          }}
        />
        <SheetOption
          icon="person"
          label="About this account"
          onPress={() => {
            setMenuOpen(false);
            goProfile();
          }}
        />
        <SheetOption icon="share" label="Share" onPress={() => { setMenuOpen(false); void share(); }} />
        {isMine ? <SheetOption icon="trash" label="Delete" destructive onPress={confirmDelete} /> : null}
      </Sheet>
    </View>
  );
});

function summarizeReactions(r: Post['reactions']): { top: string[]; total: number } {
  const entries = Object.entries(r ?? {}).filter((e): e is [string, number] => (e[1] ?? 0) > 0);
  entries.sort((a, b) => b[1] - a[1]);
  return { top: entries.slice(0, 3).map(([e]) => e), total: entries.reduce((n, [, c]) => n + c, 0) };
}

const styles = StyleSheet.create({
  card: { paddingBottom: 14 },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: layout.gutter,
    paddingRight: 4,
  },
  headerText: { flex: 1, marginLeft: 10, justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  username: { flexShrink: 1 },
  closeFriends: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1CD14F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: { width: 40, height: 40 },
  actions: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter,
  },
  actionsLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  dots: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  flipX: { transform: [{ scaleX: -1 }] },
  row: { paddingHorizontal: layout.gutter, marginBottom: 4 },
  reactionEmojis: { fontSize: 13, letterSpacing: 1 },
  time: { marginTop: 2, marginBottom: 0 },
});
