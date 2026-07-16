import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthService } from './auth.service';

/** Sends the HTTP-only auth cookie and redirects to login on 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const authed = req.url.startsWith('/api') ? req.clone({ withCredentials: true }) : req;

  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      const isLogin = req.url.includes('/api/auth/login');
      const isSessionProbe = req.url.includes('/api/auth/session');
      if (err.status === 401 && !isLogin && !isSessionProbe) {
        auth.clearSession();
        void router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
