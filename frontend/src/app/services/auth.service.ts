import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, finalize } from 'rxjs';
import { AccountSettings } from '../models/user.model';

export interface CurrentUser {
  username: string;
  displayName?: string;
  profilePic?: string;
  xp?: number;
  bio?: string;
  website?: string;
  pronouns?: string;
  isPrivate?: boolean;
  settings?: AccountSettings;
}

export interface RegisterData {
  username: string;
  password: string;
  email?: string;
  displayName?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user = signal<CurrentUser | null>(null);
  private _loaded = signal(false);
  currentUser = this._user.asReadonly();
  loaded = this._loaded.asReadonly();

  constructor(private http: HttpClient) {
    this.loadMe();
  }

  private loadMe(): void {
    this.http.get<CurrentUser>('/api/me').pipe(
      finalize(() => this._loaded.set(true))
    ).subscribe({
      next: u => this._user.set(u),
      error: () => this._user.set(null)
    });
  }

  private signedIn = (u: CurrentUser) => { this._user.set(u); this._loaded.set(true); };

  /** `username` may be a username or an email address. */
  login(username: string, password?: string): Observable<CurrentUser> {
    return this.http.post<CurrentUser>('/api/login', { username, password }).pipe(tap(this.signedIn));
  }

  /** register(username, password) keeps working; pass an object for email/display name. */
  register(usernameOrData: string | RegisterData, password?: string): Observable<CurrentUser> {
    const body = typeof usernameOrData === 'string' ? { username: usernameOrData, password } : usernameOrData;
    return this.http.post<CurrentUser>('/api/register', body).pipe(tap(this.signedIn));
  }

  loginWithOAuth(endpoint: string, payload: object): Observable<CurrentUser> {
    return this.http.post<CurrentUser>(endpoint, payload).pipe(tap(this.signedIn));
  }

  forgotPassword(email: string): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>('/api/password/forgot', { email });
  }

  /** Sets a new password from an emailed token; logs this device in. */
  resetPassword(token: string, password: string): Observable<CurrentUser> {
    return this.http.post<CurrentUser>('/api/password/reset', { token, password }).pipe(tap(this.signedIn));
  }

  logout(): Observable<unknown> {
    return this.http.post('/api/logout', {}).pipe(
      tap(() => this._user.set(null))
    );
  }

  /** Invalidates every session. keepCurrent keeps this device logged in. */
  logoutAll(keepCurrent: boolean): Observable<unknown> {
    return this.http.post('/api/account/logout-all', { keepCurrent }).pipe(
      tap(() => { if (!keepCurrent) this._user.set(null); })
    );
  }

  /** Replace the cached user (e.g. with the response of a settings update). */
  setUser(u: CurrentUser | null): void {
    this._user.set(u);
  }

  isLoggedIn(): boolean {
    return this._user() !== null;
  }

  refresh(): void {
    this.loadMe();
  }
}
