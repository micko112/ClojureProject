export interface Activity {
  id: number;
  time: string;
  type: string;
  duration: number;
  intensity: number;
  xp: number;
}

export interface ActivitiesResponse {
  date: string;
  username: string;
  activities: Activity[];
  totalXp: number;
}

export interface ActivityType {
  key: string;
  name: string;
  xpPerMinute: number;
}
