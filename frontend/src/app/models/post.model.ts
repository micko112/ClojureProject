export interface Post {
  id: string;
  author: { username: string; displayName?: string; profilePic?: string };
  caption?: string;
  mediaUrl?: string;
  likes: string[];
  commentCount?: number;
  createdAt: string;
  activityTag?: string;
  liked?: boolean;
}
