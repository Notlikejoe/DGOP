import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, JwtPayload } from './auth.types';
import { AccessService } from '../access/access.service';
import { ScopeService } from '../access/scope.service';
import {
  isProductionLikeRuntime,
  isUnsafeDefaultAdminCredential,
} from '../common/runtime-safety';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly scope: ScopeService,
  ) {}

  async login(email: string, password: string, ip?: string) {
    const user = await this.users.findByEmailWithRoles(email);
    const passwordOk = user ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!user || !user.isActive || !passwordOk) {
      await this.audit.log({
        actor: email,
        action: 'auth.login.failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        metadata: { ip, reason: !user ? 'not_found' : !user.isActive ? 'inactive' : 'bad_password' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (isProductionLikeRuntime() && isUnsafeDefaultAdminCredential(user.email, password)) {
      await this.audit.log({
        actor: email,
        action: 'auth.login.failed',
        entityType: 'user',
        entityId: user.id,
        metadata: { ip, reason: 'unsafe_default_credential' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    try {
      await this.users.updateLastLogin(user.id);
    } catch (error) {
      // Keep local demos usable if the development database cannot write the optional login timestamp.
      this.logger.warn(`Could not update last login for ${user.email}: ${String(error)}`);
    }
    const roles = user.userRoles.map((ur) => ur.role.code);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles,
      tokenVersion: user.tokenVersion,
    };
    const accessToken = this.jwt.sign(payload);

    try {
      await this.audit.log({
        actor: user.email,
        action: 'auth.login.success',
        entityType: 'user',
        entityId: user.id,
        metadata: { ip },
      });
    } catch (error) {
      this.logger.warn(`Could not write login audit event for ${user.email}: ${String(error)}`);
    }

    return { accessToken, user: await this.toProfile(user) };
  }

  async me(userId: string) {
    const user = await this.users.findByIdWithRoles(userId);
    if (!user) throw new UnauthorizedException();
    return this.toProfile(user);
  }

  async sessionFromToken(token?: string | null) {
    if (!token) return null;
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const user = await this.users.findByIdWithRoles(payload.sub);
      if (!user?.isActive) return null;
      if (payload.tokenVersion !== user.tokenVersion) return null;
      return this.toProfile(user);
    } catch {
      return null;
    }
  }

  async logout(user: AuthUser) {
    await this.users.bumpTokenVersion(user.id);
    await this.audit.log({
      actor: user.email,
      action: 'auth.logout',
      entityType: 'user',
      entityId: user.id,
    });
    return { success: true };
  }

  private async toProfile(user: {
    id: string;
    email: string;
    displayName: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    tokenVersion: number;
    userRoles: { role: { code: string; nameEn: string; nameAr: string } }[];
  }) {
    const roleCodes = user.userRoles.map((ur) => ur.role.code);
    const [permissions, scopes] = await Promise.all([
      this.access.permissionsForRoleCodes(roleCodes),
      this.scope.resolve(roleCodes),
    ]);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      roles: user.userRoles.map((ur) => ({
        code: ur.role.code,
        nameEn: ur.role.nameEn,
        nameAr: ur.role.nameAr,
      })),
      permissions,
      scopes,
    };
  }
}
