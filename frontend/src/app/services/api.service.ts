import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // Activities
  getActivities(): Observable<any[]> {
    return this.http.get<any[]>('/api/activities');
  }
  createActivity(data: any): Observable<any> {
    return this.http.post('/api/activities', data);
  }
  updateActivity(id: string, data: any): Observable<any> {
    return this.http.put(`/api/activities/${id}`, data);
  }
  deleteActivity(id: string): Observable<any> {
    return this.http.delete(`/api/activities/${id}`);
  }

  // Feed / Posts
  getFeed(): Observable<any[]> {
    return this.http.get<any[]>('/api/feed');
  }
  createPost(data: any): Observable<any> {
    return this.http.post('/api/posts', data);
  }
  getPost(id: string): Observable<any> {
    return this.http.get(`/api/posts/${id}`);
  }
  likePost(id: string): Observable<any> {
    return this.http.post(`/api/posts/${id}/like`, {});
  }
  deletePost(id: string): Observable<any> {
    return this.http.delete(`/api/posts/${id}`);
  }

  // Comments
  getComments(postId: string): Observable<any[]> {
    return this.http.get<any[]>(`/api/posts/${postId}/comments`);
  }
  createComment(postId: string, content: string): Observable<any> {
    return this.http.post(`/api/posts/${postId}/comments`, { content });
  }
  deleteComment(commentId: string): Observable<any> {
    return this.http.delete(`/api/comments/${commentId}`);
  }

  // Profile
  getProfile(username: string): Observable<any> {
    return this.http.get(`/api/users/${username}`);
  }
  updateProfile(data: any): Observable<any> {
    return this.http.put('/api/profile', data);
  }
  deleteAccount(username: string): Observable<any> {
    return this.http.delete(`/api/users/${username}`);
  }

  // Follow
  toggleFollow(username: string): Observable<any> {
    return this.http.post('/api/follow', { username });
  }
  getFollowers(username: string): Observable<string[]> {
    return this.http.get<string[]>(`/api/followers/${username}`);
  }
  getFollowing(username: string): Observable<string[]> {
    return this.http.get<string[]>(`/api/following/${username}`);
  }

  // Leaderboard
  getLeaderboard(filter?: string): Observable<any[]> {
    let params = new HttpParams();
    if (filter) params = params.set('filter', filter);
    return this.http.get<any[]>('/api/leaderboard', { params });
  }

  // Search
  searchUsers(q: string): Observable<User[]> {
    return this.http.get<User[]>('/api/users/search', { params: { q } });
  }

  // Badges
  getBadges(username: string): Observable<any[]> {
    return this.http.get<any[]>(`/api/users/${username}/badges`);
  }

  // Notifications
  getNotifications(): Observable<any[]> {
    return this.http.get<any[]>('/api/notifications');
  }
  markNotificationsRead(): Observable<any> {
    return this.http.post('/api/notifications/read', {});
  }

  // Trending
  getTrending(): Observable<any[]> {
    return this.http.get<any[]>('/api/trending');
  }

  // File upload
  uploadFile(file: File): Observable<{ url: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ url: string }>('/api/upload', fd);
  }

  // DM / Conversations
  getConversations(): Observable<any[]> {
    return this.http.get<any[]>('/api/conversations');
  }
  sendMessage(toUsername: string, content: string, mediaUrl?: string, mediaType?: string): Observable<any> {
    return this.http.post('/api/messages', { to: toUsername, content, mediaUrl, mediaType });
  }
  getMessages(convId: string): Observable<any[]> {
    return this.http.get<any[]>(`/api/conversations/${convId}/messages`);
  }
  markConversationRead(convId: string): Observable<any> {
    return this.http.post(`/api/conversations/${convId}/read`, {});
  }
  getUnreadMessages(): Observable<any> {
    return this.http.get('/api/messages/unread');
  }

  // Groups
  getGroups(): Observable<any[]> {
    return this.http.get<any[]>('/api/groups');
  }
  createGroup(data: any): Observable<any> {
    return this.http.post('/api/groups', data);
  }
  getGroup(id: string): Observable<any> {
    return this.http.get(`/api/groups/${id}`);
  }
  toggleGroupMembership(groupId: string): Observable<any> {
    return this.http.post(`/api/groups/${groupId}/join`, {});
  }
  getGroupMessages(groupId: string): Observable<any[]> {
    return this.http.get<any[]>(`/api/groups/${groupId}/messages`);
  }
  sendGroupMessage(groupId: string, content: string, mediaUrl?: string, mediaType?: string): Observable<any> {
    return this.http.post(`/api/groups/${groupId}/messages`, { content, mediaUrl, mediaType });
  }

  // Competitions
  getCompetitions(): Observable<any[]> {
    return this.http.get<any[]>('/api/competitions');
  }
  createCompetition(data: any): Observable<any> {
    return this.http.post('/api/competitions', data);
  }
  getCompetition(id: string): Observable<any> {
    return this.http.get(`/api/competitions/${id}`);
  }
  toggleCompetitionMembership(id: string): Observable<any> {
    return this.http.post(`/api/competitions/${id}/join`, {});
  }
  joinCompetitionByCode(code: string): Observable<any> {
    return this.http.post('/api/competitions/join', { code });
  }
  getCompetitionLeaderboard(id: string): Observable<any[]> {
    return this.http.get<any[]>(`/api/competitions/${id}/leaderboard`);
  }
  getCompetitionFeed(id: string): Observable<any[]> {
    return this.http.get<any[]>(`/api/competitions/${id}/feed`);
  }

  // Recap
  getRecap(username: string, period: string): Observable<any> {
    return this.http.get(`/api/recap/${username}`, { params: { period } });
  }

  // Challenges
  getChallenges(): Observable<any[]> {
    return this.http.get<any[]>('/api/challenges');
  }
  createChallenge(targetUsername: string): Observable<any> {
    return this.http.post('/api/challenges', { target: targetUsername });
  }
  respondChallenge(id: number | string, action: string): Observable<any> {
    return this.http.put(`/api/challenges/${id}`, { action });
  }

  // Stories
  getStories(): Observable<any[]> {
    return this.http.get<any[]>('/api/stories');
  }
  createStory(data: { text?: string; bgColor?: string; mediaUrl?: string; mediaType?: string }): Observable<any> {
    return this.http.post('/api/stories', data);
  }
  viewStory(id: string): Observable<any> {
    return this.http.post(`/api/stories/${id}/view`, {});
  }
  deleteStory(id: string): Observable<any> {
    return this.http.delete(`/api/stories/${id}`);
  }

  // Aliases used by some components
  togglePostLike(postId: string): Observable<any> {
    return this.likePost(postId);
  }
  addComment(postId: string, content: string): Observable<any> {
    return this.createComment(postId, content);
  }
}
