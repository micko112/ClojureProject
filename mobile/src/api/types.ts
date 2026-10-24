/**
 * TypeScript mirrors of the backend DTOs (see docs/ARCHITECTURE.md and
 * frontend/src/app/models/*.ts). IDs are strings (Datomic entity ids).
 * Dates are ISO-8601 strings.
 */

// ===== Users & accounts (web.accounts) =====

/** `author-dto`: compact user embedded in posts, comments, notifications. */
export interface UserSummary {
  username: string;
  displayName?: string | null;
  profilePic?: string | null;
}

export type FollowStatus = 'none' | 'requested' | 'following';
export type MessagesFrom = 'everyone' | 'followers';

/** `user-dto` */
export interface User extends UserSummary {
  bio?: string | null;
  website?: string | null;
  pronouns?: string | null;
  isPrivate?: boolean;
  xp?: number;
  followersCount?: number;
  followingCount?: number;
}

export interface NotificationPrefs {
  likes: boolean;
  comments: boolean;
  follows: boolean;
  mentions: boolean;
  messages: boolean;
  live: boolean;
}

/** `settings` of GET /api/me. */
export interface AccountSettings {
  email?: string | null;
  hasPassword: boolean;
  oauth: { google: boolean; facebook: boolean };
  isPrivate: boolean;
  hideActivity: boolean;
  messagesFrom: MessagesFrom;
  notifications: NotificationPrefs;
  followRequestCount: number;
  createdAt?: string;
}

/** GET /api/me (also the body of login/register, plus `token` in token mode). */
export interface Me extends User {
  settings?: AccountSettings;
}

export interface AuthResponse extends Me {
  token: string;
}

/** GET /api/users/:username */
export interface Profile extends User {
  postsCount?: number;
  isFollowing?: boolean;
  followStatus?: FollowStatus;
  followsYou?: boolean;
  isMe?: boolean;
  canViewPosts?: boolean;
  blocked?: boolean;
  muted?: boolean;
  restricted?: boolean;
  closeFriend?: boolean;
  mutualFollowers?: UserSummary[];
  mutualCount?: number;
}

/** Followers/following/blocked/suggested rows. */
export interface ListUser extends UserSummary {
  isPrivate?: boolean;
  isMe?: boolean;
  followStatus?: FollowStatus;
  followsYou?: boolean;
  /** suggested accounts only */
  reason?: string;
}

export interface FollowRequest {
  id: string;
  user: ListUser;
  createdAt?: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
  displayName?: string;
}

// ===== Media (web.media) =====

export interface MediaVariant {
  /** pixel width of this rendition */
  w: number;
  url: string;
}

export interface ActivitySuggestion {
  activity: string;
  label: string;
  emoji: string;
  score: number;
}

export interface Media {
  id: string;
  type: 'image' | 'video';
  /** original / largest rendition (may be relative: "/uploads/...") */
  url: string;
  width?: number | null;
  height?: number | null;
  /** ascending by width */
  variants?: MediaVariant[] | null;
  /** tiny blurred data: URI */
  placeholder?: string | null;
  posterUrl?: string | null;
  durationSec?: number | null;
  /** POST /api/media response only */
  suggestions?: ActivitySuggestion[];
}

// ===== Posts (web.posts) =====

export type PostLayout = 'single' | 'carousel' | 'compare';
export type PostAudience = 'public' | 'followers' | 'close-friends';

/** Supportive reactions only (no dislikes, ever). */
export const REACTION_EMOJIS = ['🔥', '💪', '👏', '🙌', '💯'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface Post {
  id: string;
  author: UserSummary;
  caption?: string | null;
  /** @deprecated legacy; use media[0] */
  mediaUrl?: string | null;
  media: Media[];
  layout: PostLayout;
  audience: PostAudience;
  /** When true and you're not the author, likes/likeCount/reactions are empty. */
  hideLikes: boolean;
  commentsOff: boolean;
  archived?: boolean;
  activityTag?: string | null;
  hashtags?: string[];
  /** usernames; empty when likes are hidden */
  likes: string[];
  /** null when likes are hidden from you */
  likeCount?: number | null;
  commentCount: number;
  /** { "🔥": 3, "💪": 1 } */
  reactions: Partial<Record<string, number>>;
  myReaction?: string | null;
  /** author's Nth day of posting progress */
  dayNumber?: number | null;
  createdAt: string;
  editedAt?: string | null;
  /** present when signed in */
  liked?: boolean;
  saved?: boolean;
}

/** Cursor page: feed, explore, hashtag, profile posts, archived, comments. */
export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface UserPostsPage extends Page<Post> {
  private?: boolean;
}

export interface HashtagPage extends Page<Post> {
  tag: string;
  count: number;
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

export interface UpdatePostRequest {
  caption?: string;
  audience?: PostAudience;
  hideLikes?: boolean;
  commentsOff?: boolean;
  activityTag?: string;
}

export interface LikeResponse {
  likes: string[];
  liked: boolean;
  likeCount: number;
}

export interface ReactResponse {
  reactions: Partial<Record<string, number>>;
  myReaction: string | null;
}

export interface Comment {
  id: string;
  author: UserSummary;
  content: string;
  createdAt: string;
  parentId?: string | null;
  likeCount: number;
  liked: boolean;
  canDelete: boolean;
  replyCount?: number;
  replies?: Comment[];
}

export interface CommentPage extends Page<Comment> {
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

// ===== Stories (web.server) =====

export interface Story {
  id: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  text?: string | null;
  bgColor?: string | null;
  createdAt: string;
  expiresAt: string;
  viewedByMe: boolean;
}

/** GET /api/stories: one group per user, own group first. */
export interface StoryGroup extends UserSummary {
  isMe: boolean;
  hasUnviewed: boolean;
  stories: Story[];
}

export interface CreateStoryRequest {
  mediaUrl?: string;
  mediaType?: string;
  text?: string;
  bgColor?: string;
}

// ===== Notifications (web.notifications) =====

export type NotificationType =
  | 'like'
  | 'comment'
  | 'follow'
  | 'follow-request'
  | 'mention'
  | 'reaction'
  | 'message'
  | 'live'
  | 'info'
  | (string & {});

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  read: boolean;
  createdAt: string;
  actor?: UserSummary;
  postId?: string;
  liveId?: string;
  /** Grouping ("ana and 3 others liked your post"): show only items where group.isLatest. */
  group?: {
    key: string;
    count: number;
    actors: UserSummary[];
    text: string;
    latestId: string;
    unread: number;
    isLatest: boolean;
  };
}

// ===== Direct messages (web.dm) =====

export interface DmUser extends UserSummary {
  online?: boolean;
  lastActive?: string;
}

export interface DmReaction {
  username: string;
  emoji: string;
}

export interface DmPostPreview {
  id: string;
  caption?: string;
  author?: DmUser;
  thumbnailUrl?: string;
  mediaType?: string;
  unavailable?: boolean;
}

export interface Message {
  id: string;
  conversationId?: string;
  sender: DmUser;
  content?: string;
  mediaUrl?: string;
  mediaType?: string;
  createdAt: string;
  reactions?: DmReaction[];
  readBy?: string[];
  replyTo?: { id: string; sender?: DmUser; content?: string; mediaType?: string };
  postId?: string;
  post?: DmPostPreview;
}

export interface Conversation {
  id: string;
  other: DmUser;
  lastMessage?: string;
  last?: { id: string; content?: string; mediaType?: string; mine?: boolean; createdAt?: string };
  lastMessageAt?: string;
  updatedAt?: string;
  seenBy: string[];
  isRequest: boolean;
  pending: boolean;
  unreadCount: number;
}

export interface SendMessageRequest {
  to?: string;
  conversationId?: string;
  content?: string;
  mediaUrl?: string;
  mediaType?: string;
  replyToId?: string;
  postId?: string;
}

// ===== Live (web.live) =====

export interface Live {
  id: string;
  host: UserSummary;
  title?: string | null;
  status: 'active' | 'ended';
  startedAt?: string;
  endedAt?: string | null;
  viewerCount: number;
  hearts: number;
}

// ===== Realtime events (GET /api/ws) =====

export type RealtimeEventMap = {
  /** synthetic, emitted by the client after every (re)connect */
  open: { type: 'open'; reconnect: boolean };
  /** synthetic, emitted by the client when the socket drops */
  close: { type: 'close' };
  hello: { type: 'hello'; username: string; connId: string; heartbeatSeconds: number };
  notification: { type: 'notification'; notification: AppNotification; unreadCount: number };
  'notifications:read': { type: 'notifications:read'; id?: string; unreadCount: number };
  'post:new': { type: 'post:new'; postId: string; author: UserSummary };
  message: { type: 'message'; conversationId: string; message: Message; conversation: Conversation };
  typing: { type: 'typing'; username: string; typing: boolean; conversationId?: string };
  'conversation:accepted': { type: 'conversation:accepted'; conversationId: string };
  'live:started': { type: 'live:started'; live: Live };
  'live:ended': { type: 'live:ended'; liveId: string };
  'live:viewers': { type: 'live:viewers'; liveId: string; viewerCount: number };
  'live:comment': { type: 'live:comment'; liveId: string; comment: unknown };
  'live:heart': { type: 'live:heart'; liveId: string; from: string; hearts: number };
  'live:signal': { type: 'live:signal'; liveId: string; from: string; data: unknown };
  'live:error': { type: 'live:error'; liveId: string; [k: string]: unknown };
};

export type RealtimeEventType = keyof RealtimeEventMap;
/** Any event from the server, including types not listed above. */
export type RealtimeEvent = { type: string; [k: string]: unknown };
