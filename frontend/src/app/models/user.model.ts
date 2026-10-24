export type FollowStatus = 'none' | 'requested' | 'following';
export type MessagesFrom = 'everyone' | 'followers';

export interface User {
  username: string;
  displayName?: string;
  profilePic?: string;
  bio?: string;
  website?: string;
  pronouns?: string;
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

/** `settings` object returned by GET /api/me (only for the current user). */
export interface AccountSettings {
  email?: string;
  hasPassword: boolean;
  oauth: { google: boolean; facebook: boolean };
  isPrivate: boolean;
  hideActivity: boolean;
  messagesFrom: MessagesFrom;
  notifications: NotificationPrefs;
  followRequestCount: number;
  createdAt?: string;
}

/** GET /api/users/:username */
export interface Profile extends User {
  postsCount?: number;
  isFollowing?: boolean;     // legacy, = followStatus === 'following'
  followStatus?: FollowStatus;
  followsYou?: boolean;
  isMe?: boolean;
  canViewPosts?: boolean;
  blocked?: boolean;         // the viewer blocked this account
  muted?: boolean;
  restricted?: boolean;
  closeFriend?: boolean;
  mutualFollowers?: { username: string; displayName?: string; profilePic?: string }[];
  mutualCount?: number;
}

/** Compact user in followers/following/blocked/suggested lists. */
export interface ListUser {
  username: string;
  displayName?: string;
  profilePic?: string;
  isPrivate?: boolean;
  isMe?: boolean;
  followStatus?: FollowStatus;
  followsYou?: boolean;
  reason?: string;           // suggested accounts only
}

export interface FollowRequest {
  id: string;
  user: ListUser;
  createdAt?: string;
}
