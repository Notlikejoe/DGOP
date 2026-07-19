import type { CookieOptions, Request } from 'express';
import { jwtDurationMs } from './auth-duration';

export const AUTH_COOKIE_NAME = 'dgop_session';

export function authCookieOptions(req: Request): CookieOptions {
  const forwardedProto = req.get('x-forwarded-proto');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || forwardedProto === 'https',
    path: '/',
    maxAge: jwtDurationMs(process.env.JWT_EXPIRES_IN),
  };
}

export function clearAuthCookieOptions(req: Request): CookieOptions {
  const options = authCookieOptions(req);
  delete options.maxAge;
  return options;
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(valueParts.join('='));
    } catch {
      return undefined;
    }
  }
  return undefined;
}
