import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, mergeMap, of, takeUntil, tap, throwError } from 'rxjs';

import { AuthService } from './auth.service';
import { AccessChangedError, AccessUnavailableError } from './access-errors';

/** Sends the HTTP-only auth cookie and redirects to login on 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const epoch = auth.sessionEpoch;
  const generation = auth.accessGeneration();
  const protectedApi = req.url.startsWith('/api/') && !req.url.startsWith('/api/auth/');
  const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (protectedApi && write && !auth.canWrite()) return throwError(() => new AccessUnavailableError());
  const stale = () => epoch !== auth.sessionEpoch || generation !== auth.accessGeneration();
  const requestId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const authed = req.url.startsWith('/api')
    ? req.clone({
        withCredentials: true,
        setHeaders: {
          'x-request-id': requestId,
          'x-correlation-id': requestId,
          'x-dgop-csrf': 'same-origin',
        },
      })
    : req;

  const response = protectedApi && !write ? next(authed).pipe(
    takeUntil(auth.accessInvalidated$.pipe(mergeMap(() => throwError(() => new AccessChangedError())))),
  ) : next(authed);
  return response.pipe(
    mergeMap(event => protectedApi && event instanceof HttpResponse && stale()
      ? throwError(() => new AccessChangedError()) : of(event)),
    tap(event => {
      if (event instanceof HttpResponse && write
        && /^\/api\/(roles|users)(\/|\?|$)/.test(req.url)) auth.notifyAccessChanged(epoch);
    }),
    catchError((err: HttpErrorResponse) => {
      if (protectedApi && stale()) return throwError(() => new AccessChangedError());
      const isLogin = req.url.includes('/api/auth/login');
      const isSessionProbe = req.url.includes('/api/auth/session');
      const isAlreadyOnLogin = router.url.startsWith('/login');
      if (err.status === 401 && epoch === auth.sessionEpoch && !isLogin && !isSessionProbe) {
        auth.clearSession();
        if (!isAlreadyOnLogin) {
          const currentUrl = router.url && router.url !== '/' ? router.url : '/dashboard';
          void router.navigate(['/login'], { queryParams: { returnUrl: currentUrl } });
        }
      }
      return throwError(() => err);
    }),
  );
};
