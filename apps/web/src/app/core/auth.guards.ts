import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Requires an authenticated user; otherwise redirect to login with returnUrl. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Also runs on child navigation; the shell applies this same policy after live access changes. */
export const pageAccessGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService), router = inject(Router);
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
  return auth.canAccessPage(state.url) || router.createUrlTree(['/about']);
};

/** Requires the named permission, or any one of the supplied permissions. */
export function permissionGuard(permission: string | readonly string[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (typeof permission === 'string' ? auth.hasPermission(permission) : permission.some(value => auth.hasPermission(value))) return true;
    if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
    return router.createUrlTree(['/unauthorized']);
  };
}
