import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, finalize } from 'rxjs';

export interface CurrentUser {
  username: string;
  displayName?: string;
  profilePic?: string;
  xp?: number;
  bio?: string;
  website?: string;
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

  login(username: string, password?: string): Observable<CurrentUser> {
    return this.http.post<CurrentUser>('/api/login', { username, password }).pipe(
      tap(u => { this._user.set(u); this._loaded.set(true); })
    );
  }

  register(username: string, password?: string): Observable<CurrentUser> {
    return this.http.post<CurrentUser>('/api/register', { username, password }).pipe(
      tap(u => { this._user.set(u); this._loaded.set(true); })
    );
  }

  loginWithOAuth(endpoint: string, payload: object): Observable<CurrentUser> {
    return this.http.post<CurrentUser>(endpoint, payload).pipe(
      tap(u => { this._user.set(u); this._loaded.set(true); })
    );
  }

  logout(): Observable<unknown> {
    return this.http.post('/api/logout', {}).pipe(
      tap(() => this._user.set(null))
    );
  }

  isLoggedIn(): boolean {
    return this._user() !== null;
  }

  refresh(): void {
    this.loadMe();
  }
}
