// Contract with backend web.media/media-dto (see docs/ARCHITECTURE.md).
export interface MediaVariant {
  w: number;     // pixel width of this rendition
  url: string;
}

export interface Media {
  id: string;
  type: 'image' | 'video';
  url: string;               // original / largest rendition
  width?: number;
  height?: number;
  variants?: MediaVariant[]; // ascending by width, used for srcset
  placeholder?: string;      // tiny blurred data: URI shown while loading
  posterUrl?: string;        // video only
  durationSec?: number;      // video only
}
