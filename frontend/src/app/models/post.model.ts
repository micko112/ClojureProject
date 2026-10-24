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
  archived?: boolean;
  hashtags?: string[];
  /** supportive reactions only: { "🔥": 3, "💪": 1 } */
  reactions?: Record<string, number>;
  myReaction?: string | null;
}

/** Fixed set accepted by POST /api/posts/:id/react (no dislikes, ever). */
export const REACTION_EMOJIS = ['🔥', '💪', '👏', '🙌', '💯'] as const;

/** Cursor page returned by feed, explore, hashtag, profile and archived lists. */
export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface HashtagPage extends Page<Post> {
  tag: string;
  count: number;
}

export interface UpdatePostRequest {
  caption?: string;
  audience?: PostAudience;
  hideLikes?: boolean;
  commentsOff?: boolean;
  activityTag?: string;
}

export interface PostComment {
  id: string;
  author: { username: string; displayName?: string; profilePic?: string };
  content: string;
  createdAt: string;
  parentId?: string | null;
  likeCount: number;
  liked: boolean;
  canDelete: boolean;
  replyCount?: number;
  replies?: PostComment[];
}

export interface CommentPage extends Page<PostComment> {
  total: number;
}

/** GET /api/me/streak — days are Europe/Belgrade calendar days. */
export interface Streak {
  current: number;
  best: number;
  postedToday: boolean;
  totalDays: number;
  nextDayNumber: number;
  today?: string;
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
