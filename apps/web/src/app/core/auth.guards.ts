import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { AiCapabilities } from './auth.models';

export function aiScreenGuard(screen:keyof AiCapabilities['screens']):CanActivateFn {
  return async()=>{
    const auth=inject(AuthService),router=inject(Router);
    if(!auth.isAuthenticated())return router.createUrlTree(['/login']);
    await auth.refreshAiCapabilities();
    return auth.hasAiScreen(screen)||router.createUrlTree(['/unauthorized']);
  };
}

/** Requires an authenticated user; otherwise redirect to login with returnUrl. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
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
