import { PixelRatio } from 'react-native';

import { resolveUrl } from '@/api/config';
import type { Media } from '@/api/types';
import { layout } from '@/theme';

/** width / height of a media item, 1 when unknown. */
export function aspectOf(media: Media | undefined): number {
  if (!media?.width || !media?.height) return 1;
  return media.width / media.height;
}

/** Instagram feed rule: between 4:5 (portrait) and 1.91:1 (landscape). */
export function clampAspect(aspect: number): number {
  return Math.min(layout.maxAspect, Math.max(layout.minAspect, aspect || 1));
}

/**
 * Smallest rendition at least as wide as the displayed size × pixel ratio
 * (variants are 320/640/1080 wide). Falls back to the original.
 */
export function pickVariantUrl(media: Media, displayWidth: number): string | undefined {
  const needed = displayWidth * PixelRatio.get();
  const variants = media.variants ?? [];
  const best = variants.find((v) => v.w >= needed) ?? variants[variants.length - 1];
  return resolveUrl(best?.url ?? media.url);
}

/** Poster or image URL for grids/thumbnails. */
export function thumbnailUrl(media: Media | undefined, displayWidth = 200): string | undefined {
  if (!media) return undefined;
  if (media.type === 'video') return resolveUrl(media.posterUrl ?? undefined);
  return pickVariantUrl(media, displayWidth);
}
