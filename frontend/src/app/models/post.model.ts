export interface Post {
  id: number;
  username: string;
  content: string;
  activityTag?: string;
  createdAt: string;
  likes: string[];
}
