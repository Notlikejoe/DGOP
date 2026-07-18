import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_COOKIE_NAME, readCookie } from './auth-cookie';
import { IS_PUBLIC_KEY } from './decorators';

export const CSRF_HEADER_NAME = 'x-dgop-csrf';
export const CSRF_HEADER_VALUE = 'same-origin';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!WRITE_METHODS.has(request.method.toUpperCase())) return true;

    // Bearer-token clients are not vulnerable to browser cookie CSRF.
    if (!readCookie(request, AUTH_COOKIE_NAME)) return true;

    const value = this.header(request, CSRF_HEADER_NAME);
    if (value === CSRF_HEADER_VALUE) return true;
    throw new ForbiddenException('Missing anti-CSRF header');
  }

  private header(req: Request, name: string): string | null {
    const value = req.headers[name];
    if (Array.isArray(value)) return value[0] ?? null;
    return typeof value === 'string' ? value : null;
  }
}
