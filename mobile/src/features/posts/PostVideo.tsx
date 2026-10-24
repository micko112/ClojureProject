import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { resolveUrl } from '@/api/config';
import type { Media } from '@/api/types';
import { Icon } from '@/components';
import { toggleVideoMuted, useVideoMuted } from '@/hooks/useVideoMuted';
import { colors } from '@/theme';

export interface PostVideoProps {
  media: Media;
  width: number;
  height: number;
  /** Play while true (post visible and this slide selected). */
  active: boolean;
  /** Show the mute toggle (default true). */
  showMute?: boolean;
}

/**
 * Feed video: autoplays muted and looped while `active`, poster until the
 * first frame, global mute toggle bottom-right (tap media also toggles —
 * wire that in the parent's single-tap handler with toggleVideoMuted()).
 */
export function PostVideo({ media, width, height, active, showMute = true }: PostVideoProps) {
  const muted = useVideoMuted();
  const [firstFrame, setFirstFrame] = useState(false);
  const uri = resolveUrl(media.url);
  const player = useVideoPlayer(uri ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
  });

  useEffect(() => {
    // expo-video players are mutable native objects
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [player, active]);

  const poster = resolveUrl(media.posterUrl ?? undefined);

  return (
    <View style={{ width, height, backgroundColor: colors.surface }}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
        onFirstFrameRender={() => setFirstFrame(true)}
      />
      {!firstFrame && poster ? (
        <Image
          source={{ uri: poster }}
          placeholder={media.placeholder ? { uri: media.placeholder } : undefined}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
        />
      ) : null}
      {showMute ? (
        <Pressable
          onPress={toggleVideoMuted}
          hitSlop={12}
          style={styles.mute}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        >
          <Icon name={muted ? 'mute' : 'unmute'} size={14} color={colors.white} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mute: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
