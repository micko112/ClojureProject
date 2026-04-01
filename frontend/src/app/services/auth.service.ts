import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { User } from '../models/user.model';
import { tap, catchError } from 'rxjs/operators';
import { EMPTY, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  currentUser = signal<User | null>(null);

  constructor(private api: ApiService, private router: Router) {}

  checkAuth(): Observable<User> {
    return this.api.getMe().pipe(
      tap(user => this.currentUser.set(user)),
      catchError(() => {
        this.currentUser.set(null);
        return EMPTY;
      })
    );
  }

  login(username: string): Observable<User> {
    return this.api.login(username).pipe(
      tap(user => {
        this.currentUser.set(user);
        this.router.navigate(['/dashboard']);
      })
    );
  }

  logout(): Observable<any> {
    return this.api.logout().pipe(
      tap(() => {
        this.currentUser.set(null);
        this.router.navigate(['/login']);
      })
    );
  }

  isLoggedIn(): boolean {
    return this.currentUser() !== null;
  }

  refreshUser(): void {
    this.api.getMe().subscribe({
      next: user => this.currentUser.set(user),
      error: () => {}
    });
  }
}
