export interface FeedItem {
  username: string;
  date: string;
  time: string;
  type: string;
  duration: number;
  intensity: number;
  xp: number;
}

// reactions[toUser][date][emoji] = string[] of from-usernames
export type Reactions = Record<string, Record<string, Record<string, string[]>>>;

export interface FeedResponse {
  period: string;
  items: FeedItem[];
  reactions: Reactions;
}

export interface UserStats {
  streak: number;
  totalXp: number;
  weeklyXp: number;
  monthlyXp: number;
  activeDaysThisWeek: number;
  activeDaysThisMonth: number;
  xpByType: Record<string, number>;
}

export interface UserDaySummary {
  username: string;
  date: string;
  items: FeedItem[];
  totalXp: number;
  reactions: Record<string, string[]>; // emoji → from-usernames
}
