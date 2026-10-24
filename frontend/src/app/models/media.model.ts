// Contract with backend web.media/media-dto (see docs/ARCHITECTURE.md).
export interface MediaVariant {
  w: number;     // pixel width of this rendition
  url: string;
}

/** "Looks like: Running 87%" — from the activity classifier (web.vision). */
export interface ActivitySuggestion {
  activity: string;          // class key, also used as the post's activity tag ("running", "cold-shower")
  label: string;             // display name ("Running")
  emoji: string;
  score: number;             // confidence 0..1
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
  suggestions?: ActivitySuggestion[]; // POST /api/media response only; best first, may be empty
}
