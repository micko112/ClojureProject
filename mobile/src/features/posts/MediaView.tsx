import { Image } from 'expo-image';
import { View } from 'react-native';

import type { Media } from '@/api/types';
import { pickVariantUrl } from '@/lib/media';
import { colors } from '@/theme';

import { PostVideo } from './PostVideo';

export interface MediaViewProps {
  media: Media;
  width: number;
  height: number;
  /** videos only: play while true */
  active?: boolean;
}

/** One photo (right-sized rendition, blur-up placeholder) or video. */
export function MediaView({ media, width, height, active = false }: MediaViewProps) {
  if (media.type === 'video') {
    return <PostVideo media={media} width={width} height={height} active={active} />;
  }
  const uri = pickVariantUrl(media, width);
  return (
    <View style={{ width, height, backgroundColor: colors.surface }}>
      <Image
        source={uri ? { uri } : undefined}
        placeholder={media.placeholder ? { uri: media.placeholder } : undefined}
        placeholderContentFit="cover"
        style={{ width, height }}
        contentFit="cover"
        transition={200}
        cachePolicy="memory-disk"
        recyclingKey={media.id}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
