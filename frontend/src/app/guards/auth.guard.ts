import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return toObservable(auth.loaded).pipe(
    filter(loaded => loaded),
    take(1),
    map(() => auth.isLoggedIn() ? true : router.parseUrl('/login'))
  );
};
