import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User } from '../models/user.model';
import { ActivitiesResponse, ActivityType } from '../models/activity.model';
import { LeaderboardEntry } from '../models/leaderboard.model';
import { FeedResponse, UserStats } from '../models/feed.model';
import { Post } from '../models/post.model';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = '/api';

  constructor(private http: HttpClient) {}

  // Users
  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${this.base}/users`, { withCredentials: true });
  }

  createUser(username: string): Observable<any> {
    return this.http.post(`${this.base}/users`, { username }, { withCredentials: true });
  }

  getUserStats(username: string): Observable<UserStats> {
    return this.http.get<UserStats>(`${this.base}/users/${username}/stats`, { withCredentials: true });
  }

  // Auth
  login(username: string): Observable<User> {
    return this.http.post<User>(`${this.base}/login`, { username }, { withCredentials: true });
  }

  logout(): Observable<any> {
    return this.http.post(`${this.base}/logout`, {}, { withCredentials: true });
  }

  getMe(): Observable<User> {
    return this.http.get<User>(`${this.base}/me`, { withCredentials: true });
  }

  // Activities
  getActivities(date?: string, username?: string): Observable<ActivitiesResponse> {
    let params = new HttpParams();
    if (date) params = params.set('date', date);
    if (username) params = params.set('username', username);
    return this.http.get<ActivitiesResponse>(`${this.base}/activities`, { params, withCredentials: true });
  }

  addActivity(payload: { activityType: string; duration: number; intensity: number; startTime: number }): Observable<any> {
    return this.http.post(`${this.base}/activities`, payload, { withCredentials: true });
  }

  deleteActivity(id: number): Observable<any> {
    return this.http.delete(`${this.base}/activities/${id}`, { withCredentials: true });
  }

  // Leaderboard
  getLeaderboard(period: string = 'weekly', date?: string): Observable<LeaderboardEntry[]> {
    let params = new HttpParams().set('period', period);
    if (date) params = params.set('date', date);
    return this.http.get<LeaderboardEntry[]>(`${this.base}/leaderboard`, { params, withCredentials: true });
  }

  // Feed
  getFeed(date?: string, period: string = 'daily'): Observable<FeedResponse> {
    let params = new HttpParams().set('period', period);
    if (date) params = params.set('date', date);
    return this.http.get<FeedResponse>(`${this.base}/feed`, { params, withCredentials: true });
  }

  // Reactions
  toggleReaction(toUser: string, date: string, emoji: string): Observable<{ action: string }> {
    return this.http.post<{ action: string }>(
      `${this.base}/reactions`,
      { toUser, date, emoji },
      { withCredentials: true }
    );
  }

  // Activity Types
  getActivityTypes(): Observable<ActivityType[]> {
    return this.http.get<ActivityType[]>(`${this.base}/activity-types`, { withCredentials: true });
  }

  // Posts
  getPosts(limit = 30): Observable<Post[]> {
    const params = new HttpParams().set('limit', limit.toString());
    return this.http.get<Post[]>(`${this.base}/posts`, { params, withCredentials: true });
  }

  getUserPosts(username: string, limit = 30): Observable<Post[]> {
    const params = new HttpParams().set('username', username).set('limit', limit.toString());
    return this.http.get<Post[]>(`${this.base}/posts`, { params, withCredentials: true });
  }

  createPost(payload: { content: string; activityTag?: string }): Observable<any> {
    return this.http.post(`${this.base}/posts`, payload, { withCredentials: true });
  }

  togglePostLike(postId: number): Observable<{ action: string }> {
    return this.http.post<{ action: string }>(`${this.base}/posts/${postId}/like`, {}, { withCredentials: true });
  }
}
