import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { AccessService } from './access.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const alternatives = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY,[context.getHandler(),context.getClass()]);
    if (!required?.length && !alternatives?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    const granted = user ? await this.access.permissionsForRoleCodes(user.roles) : [];
    const allowed =
      !!user && (!required?.length || required.every((perm) => this.access.hasPermission(granted, perm)))
      && (!alternatives?.length || alternatives.some(perm=>this.access.hasPermission(granted,perm)));

    if (!allowed) {
      await this.audit.log({
        actor: user?.email ?? 'anonymous',
        action: 'auth.access.denied',
        entityType: 'route',
        entityId: request.path,
        metadata: { requiredPermissions: required, anyPermissions:alternatives, userRoles: user?.roles ?? [] },
      });
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
