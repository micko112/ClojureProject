import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { resolveUrl } from '@/api/config';
import { closeFriendsColor, colors, liveGradient, storyGradient } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type AvatarRing = 'none' | 'unseen' | 'seen' | 'closeFriends' | 'live';

export interface AvatarProps {
  uri?: string | null;
  /** Diameter of the photo itself (ring is drawn outside it). */
  size?: number;
  ring?: AvatarRing;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Blue "+" badge (Your story). */
  addBadge?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Common sizes, Instagram-like. */
export const avatarSizes = {
  xs: 24,
  sm: 32,
  post: 36,
  md: 44,
  lg: 56,
  story: 66,
  profile: 86,
} as const;

function ringMetrics(size: number) {
  // thin rings for small avatars, slightly thicker for stories/profile
  const width = size >= 56 ? 2.5 : size >= 32 ? 2 : 1.5;
  const gap = size >= 56 ? 3 : 2;
  return { width, gap };
}

/**
 * Round profile photo with optional story/live ring.
 *   <Avatar uri={user.profilePic} size={avatarSizes.post} ring={hasStory ? 'unseen' : 'none'} />
 * The outer box grows by the ring, so align rows by the returned outer size.
 */
export function Avatar({
  uri,
  size = avatarSizes.post,
  ring = 'none',
  onPress,
  onLongPress,
  addBadge,
  accessibilityLabel,
  style,
}: AvatarProps) {
  const { width: rw, gap } = ringMetrics(size);
  const hasRing = ring !== 'none';
  const outer = hasRing ? size + 2 * (rw + gap) : size;
  const src = resolveUrl(uri);

  const photo = src ? (
    <Image
      source={{ uri: src }}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.fill }}
      contentFit="cover"
      transition={150}
      cachePolicy="memory-disk"
      recyclingKey={src}
    />
  ) : (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Icon name="person" active size={size * 0.62} color={colors.textTertiary} style={{ marginTop: size * 0.14 }} />
    </View>
  );

  const inner = (
    <View
      style={{
        width: size + gap * 2,
        height: size + gap * 2,
        borderRadius: (size + gap * 2) / 2,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {photo}
    </View>
  );

  let content: ReactNode;
  if (ring === 'unseen' || ring === 'live') {
    content = (
      <LinearGradient
        colors={ring === 'live' ? liveGradient : storyGradient}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={[styles.center, { width: outer, height: outer, borderRadius: outer / 2 }]}
      >
        {inner}
      </LinearGradient>
    );
  } else if (ring === 'seen' || ring === 'closeFriends') {
    const seen = ring === 'seen';
    content = (
      <View
        style={[
          styles.center,
          {
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            // seen ring is a thin grey hairline-ish ring, like Instagram
            borderWidth: seen ? Math.max(1, rw - 1) : rw,
            borderColor: seen ? colors.border : closeFriendsColor,
          },
        ]}
      >
        {photo}
      </View>
    );
  } else {
    content = photo;
  }

  const body = (
    <View style={[{ width: outer, height: outer }, style]}>
      {content}
      {ring === 'live' ? (
        <View style={[styles.liveBadge, { bottom: -4 }]}>
          <LinearGradient colors={liveGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.liveInner}>
            <Text variant="tiny" color={colors.white} style={styles.liveText}>
              LIVE
            </Text>
          </LinearGradient>
        </View>
      ) : null}
      {addBadge ? (
        <View style={[styles.addBadge, { width: size * 0.36, height: size * 0.36, borderRadius: size * 0.18 }]}>
          <Icon name="add" size={size * 0.26} color={colors.white} />
        </View>
      ) : null}
    </View>
  );

  if (!onPress && !onLongPress) return body;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  fallback: {
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  liveBadge: {
    position: 'absolute',
    alignSelf: 'center',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.bg,
    overflow: 'hidden',
  },
  liveInner: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  liveText: { fontSize: 9, lineHeight: 11, fontWeight: '700', letterSpacing: 0.4 },
  addBadge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
