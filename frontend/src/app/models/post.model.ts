import { Media } from './media.model';

export type PostLayout = 'single' | 'carousel' | 'compare';
export type PostAudience = 'public' | 'followers' | 'close-friends';

export interface Post {
  id: string;
  author: { username: string; displayName?: string; profilePic?: string };
  caption?: string;
  /** @deprecated legacy single-media posts; use media[0] */
  mediaUrl?: string;
  media?: Media[];
  layout?: PostLayout;
  audience?: PostAudience;
  hideLikes?: boolean;
  commentsOff?: boolean;
  likes: string[];
  likeCount?: number;
  commentCount?: number;
  createdAt: string;
  editedAt?: string;
  activityTag?: string;
  dayNumber?: number;   // author's Nth day of posting progress
  liked?: boolean;
  saved?: boolean;
}

export interface CreatePostRequest {
  caption?: string;
  mediaIds: string[];
  layout?: PostLayout;
  audience?: PostAudience;
  hideLikes?: boolean;
  commentsOff?: boolean;
  activityTag?: string;
}
