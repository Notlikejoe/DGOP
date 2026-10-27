import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, JwtPayload } from './auth.types';
import { AccessService } from '../access/access.service';
import { ScopeService } from '../access/scope.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { accessRevision, aiCapabilities } from './access-snapshot';
import { liveResponsibility, ResponsibilityRole } from './business-roles';
import {
  isProductionLikeRuntime,
  isUnsafeDefaultAdminCredential,
  isUnsafeDemoPassword,
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
    private readonly prisma: PrismaService,
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

    if (
      isProductionLikeRuntime() &&
      (isUnsafeDefaultAdminCredential(user.email, password) || isUnsafeDemoPassword(password))
    ) {
      await this.audit.log({
        actor: email,
        action: 'auth.login.failed',
        entityType: 'user',
        entityId: user.id,
        metadata: { ip, reason: 'unsafe_demo_credential' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    try {
      await this.users.updateLastLogin(user.id);
    } catch (error) {
      // Keep local demos usable if the development database cannot write the optional login timestamp.
      this.logger.warn(`Could not update last login for ${user.email}: ${String(error)}`);
    }
    const roles = this.activeUserRoles(user).map((ur) => ur.role.code);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles,
      tokenVersion: user.tokenVersion,
    };
    const accessToken = this.jwt.sign(payload);

    await this.audit.log({
      actor: user.email,
      action: 'auth.login.success',
      entityType: 'user',
      entityId: user.id,
      metadata: { ip },
    });

    const profile = await this.toProfile(user.id, user.tokenVersion);
    if (!profile) throw new UnauthorizedException();
    return { accessToken, user: profile };
  }

  async me(userId: string) {
    const profile = await this.toProfile(userId);
    if (!profile) throw new UnauthorizedException();
    return profile;
  }

  async sessionFromToken(token?: string | null) {
    if (!token) return null;
    let payload: JwtPayload;
    try { payload = this.jwt.verify<JwtPayload>(token); } catch { return null; }
    // Infrastructure failures must remain errors, not a false logout or cookie deletion.
    return this.toProfile(payload.sub, payload.tokenVersion);
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

  private activeUserRoles(user: {
    userRoles: {
      role: ResponsibilityRole & {
        id: string;
        code: string;
        nameEn: string;
        nameAr: string;
        isActive?: boolean;
        deletedAt?: Date | null;
        maxClassificationRank?: number | null;
        dataScopes?: {scopeType:string;refId:string;includeDescendants:boolean}[];
      };
    }[];
  }) {
    return user.userRoles.filter((ur) => liveResponsibility(ur.role));
  }

  private async toProfile(userId: string, tokenVersion?: number) {
    return this.prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { userRoles: { include: { role: {include:{businessRole:true,dataScopes:true}} } } } });
    if (!user?.isActive || tokenVersion !== undefined && user.tokenVersion !== tokenVersion) return null;
    const activeRoles = this.activeUserRoles(user);
    const roleCodes = activeRoles.map((ur) => ur.role.code);
    const [permissions, scopes, grants] = await Promise.all([
      this.access.permissionsForRoleCodes(roleCodes, tx),
      this.scope.resolve(roleCodes, tx),
      tx.rolePermission.findMany({ where: { roleId: { in: activeRoles.map(ur => ur.role.id) } },
        include: { permission: true, role: { select: { code: true, businessRoleCode: true } } } }),
    ]);
    const ai = aiCapabilities(roleCodes, grants, scopes);
    const businessAuthority=activeRoles.map(({role})=>({roleCode:role.code,businessRoleCode:role.businessRoleCode??null,
      maxClassificationRank:role.maxClassificationRank??null,
      scopes:[...(role.dataScopes??[])].map(s=>({scopeType:s.scopeType,refId:s.refId,includeDescendants:s.includeDescendants})).sort((a,b)=>(a.scopeType+a.refId).localeCompare(b.scopeType+b.refId)),
      permissions:grants.filter(g=>g.role.code===role.code).map(g=>g.permission.resource+'.'+g.permission.action).sort(),
    })).sort((a,b)=>a.roleCode.localeCompare(b.roleCode));
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      roles: activeRoles.map((ur) => ({
        code: ur.role.code,
        businessRoleCode: ur.role.businessRoleCode ?? null,
        nameEn: ur.role.nameEn,
        nameAr: ur.role.nameAr,
      })),
      permissions,
      businessPermissions:roleCodes.includes('auditor')?[]:[...new Set(grants.filter(g=>!['system_admin','auditor'].includes(g.role.code)).map(g=>g.permission.resource+'.'+g.permission.action))].sort(),
      scopes,
      aiCapabilities: ai,
      accessRevision: accessRevision(roleCodes, permissions, scopes, ai,businessAuthority),
    };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 3000 });
  }
}
