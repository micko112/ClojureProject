import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';
import { map, catchError, of } from 'rxjs';

export const authGuard = () => {
  const router = inject(Router);
  const api = inject(ApiService);
  const auth = inject(AuthService);

  if (auth.isLoggedIn()) return true;

  return api.getMe().pipe(
    map(user => {
      auth.currentUser.set(user);
      return true;
    }),
    catchError(() => {
      router.navigate(['/login']);
      return of(false);
    })
  );
};
