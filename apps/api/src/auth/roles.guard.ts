import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from './decorators';
import { AuthUser } from './auth.types';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    const allowed = !!user && user.roles.some((r) => required.includes(r));

    if (!allowed) {
      await this.audit.log({
        actor: user?.email ?? 'anonymous',
        action: 'auth.access.denied',
        entityType: 'route',
        entityId: request.path,
        metadata: { requiredRoles: required, userRoles: user?.roles ?? [] },
      });
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
