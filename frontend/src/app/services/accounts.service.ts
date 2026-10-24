import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AuthService, CurrentUser } from './auth.service';
import { FollowRequest, FollowStatus, ListUser, MessagesFrom, NotificationPrefs, Profile } from '../models/user.model';

export type RelationKind = 'blocks' | 'mutes' | 'restricts' | 'close-friends';

export interface FollowResult {
  action: 'followed' | 'unfollowed' | 'requested' | 'cancelled';
  followStatus: FollowStatus;
}

/** API calls for accounts, privacy and settings (backend: web.accounts). */
@Injectable({ providedIn: 'root' })
export class AccountsService {
  constructor(private http: HttpClient, private auth: AuthService) {}

  private me = tap<CurrentUser>(u => this.auth.setUser(u));

  // Profile
  getProfile(username: string): Observable<Profile> {
    return this.http.get<Profile>(`/api/users/${encodeURIComponent(username)}`);
  }
  updateProfile(data: { displayName?: string; username?: string; bio?: string; website?: string; pronouns?: string; profilePic?: string }): Observable<CurrentUser> {
    return this.http.put<CurrentUser>('/api/profile', data).pipe(this.me);
  }
  followers(username: string, q = ''): Observable<ListUser[]> {
    return this.http.get<ListUser[]>(`/api/users/${encodeURIComponent(username)}/followers`, { params: q ? { q } : {} });
  }
  following(username: string, q = ''): Observable<ListUser[]> {
    return this.http.get<ListUser[]>(`/api/users/${encodeURIComponent(username)}/following`, { params: q ? { q } : {} });
  }
  suggested(limit = 20): Observable<ListUser[]> {
    return this.http.get<ListUser[]>('/api/users/suggested', { params: { limit } });
  }

  // Follow
  toggleFollow(username: string): Observable<FollowResult> {
    return this.http.post<FollowResult>('/api/follow', { username });
  }
  removeFollower(username: string): Observable<unknown> {
    return this.http.post(`/api/followers/${encodeURIComponent(username)}/remove`, {});
  }
  followRequests(): Observable<FollowRequest[]> {
    return this.http.get<FollowRequest[]>('/api/follow-requests');
  }
  acceptRequest(username: string): Observable<unknown> {
    return this.http.post(`/api/follow-requests/${encodeURIComponent(username)}/accept`, {});
  }
  declineRequest(username: string): Observable<unknown> {
    return this.http.post(`/api/follow-requests/${encodeURIComponent(username)}/decline`, {});
  }

  // Block / mute / restrict / close friends
  list(kind: RelationKind): Observable<ListUser[]> {
    return this.http.get<ListUser[]>(`/api/${kind}`);
  }
  add(kind: RelationKind, username: string): Observable<unknown> {
    return this.http.post(`/api/${kind}/${encodeURIComponent(username)}`, {});
  }
  remove(kind: RelationKind, username: string): Observable<unknown> {
    return this.http.delete(`/api/${kind}/${encodeURIComponent(username)}`);
  }

  // Account
  changeUsername(username: string): Observable<CurrentUser> {
    return this.http.put<CurrentUser>('/api/account/username', { username }).pipe(this.me);
  }
  changeEmail(email: string): Observable<CurrentUser> {
    return this.http.put<CurrentUser>('/api/account/email', { email }).pipe(this.me);
  }
  changePassword(currentPassword: string, newPassword: string): Observable<CurrentUser> {
    return this.http.put<CurrentUser>('/api/account/password', { currentPassword, newPassword }).pipe(this.me);
  }
  deactivate(password: string): Observable<unknown> {
    return this.http.post('/api/account/deactivate', { password, confirm: password }).pipe(tap(() => this.auth.setUser(null)));
  }
  deleteAccount(password: string): Observable<unknown> {
    return this.http.post('/api/account/delete', { password, confirm: password }).pipe(tap(() => this.auth.setUser(null)));
  }

  // Settings
  updatePrivacy(data: { isPrivate?: boolean; hideActivity?: boolean; messagesFrom?: MessagesFrom }): Observable<CurrentUser> {
    return this.http.put<CurrentUser>('/api/settings/privacy', data).pipe(this.me);
  }
  updateNotifications(data: Partial<NotificationPrefs>): Observable<CurrentUser> {
    return this.http.put<CurrentUser>('/api/settings/notifications', data).pipe(this.me);
  }
}
