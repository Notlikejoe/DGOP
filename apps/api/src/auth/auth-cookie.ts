import type { CookieOptions, Request } from 'express';

export const AUTH_COOKIE_NAME = 'dgop_session';

function parseDurationMs(value?: string): number {
  if (!value) return 8 * 60 * 60 * 1000;
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) return 8 * 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  if (unit === 'd') return amount * 24 * 60 * 60 * 1000;
  if (unit === 'h') return amount * 60 * 60 * 1000;
  if (unit === 'm') return amount * 60 * 1000;
  if (unit === 's') return amount * 1000;
  return amount;
}

export function authCookieOptions(req: Request): CookieOptions {
  const forwardedProto = req.get('x-forwarded-proto');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || forwardedProto === 'https',
    path: '/',
    maxAge: parseDurationMs(process.env.JWT_EXPIRES_IN),
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
    if (key === name) return decodeURIComponent(valueParts.join('='));
  }
  return undefined;
}
