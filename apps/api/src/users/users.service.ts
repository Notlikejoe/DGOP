import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateUserDto,
  ResetPasswordDto,
  SetUserRolesDto,
  UpdateUserDto,
} from './users.dto';
import { boundedFirstPageParams, parsePageParams, toPaged } from '../common/pagination';
import { AI_PERMISSIONS, splitAiPermission } from '../ai-governance/ai-permissions';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findByEmailWithRoles(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { userRoles: { where: { role: { isActive: true, deletedAt: null } }, include: { role: true } } },
    });
  }

  findByIdWithRoles(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { userRoles: { where: { role: { isActive: true, deletedAt: null } }, include: { role: true } } },
    });
  }

  async listUsers(page?: string | number, pageSize?: string | number) {
    const query = {
      orderBy: { createdAt: 'asc' as const },
      include: { userRoles: { where: { role: { isActive: true, deletedAt: null } }, include: { role: true } } },
    };
    const params = parsePageParams(page, pageSize);
    if (!params) {
      const bounded = boundedFirstPageParams(pageSize);
      const users = await this.prisma.user.findMany({ ...query, skip: bounded.skip, take: bounded.take });
      return users.map((u) => this.toAdminUser(u));
    }
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.user.count(),
    ]);
    return toPaged(users.map((u) => this.toAdminUser(u)), total, params);
  }

  listRoles() {
    return this.prisma.role.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { nameEn: 'asc' },
    });
  }

  updateLastLogin(id: string) {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  bumpTokenVersion(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true, tokenVersion: true },
    });
  }

  async create(dto: CreateUserDto, actor: string) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already in use');
    const roleIds = await this.resolveRoleIds(dto.roleCodes ?? []);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const aiGrant=roleIds.length ? await this.prisma.rolePermission.findFirst({where:{roleId:{in:roleIds},permission:{OR:AI_PERMISSIONS.map(splitAiPermission)}}}) : null;
    if (aiGrant) {
      if (!dto.justification?.trim()) throw new BadRequestException('Justification required for initial AI role memberships');
      const created=await this.prisma.$transaction(async tx=>{
        const record=await tx.user.create({data:{email,displayName:dto.displayName,passwordHash,userRoles:{create:roleIds.map(roleId=>({roleId}))}},include:{userRoles:{include:{role:true}}}});
        await this.audit.logRequired({actor,action:'ai.user.created',entityType:'user',entityId:record.id,
          metadata:{oldValue:[],newValue:dto.roleCodes,justification:dto.justification}},tx);
        return record;
      });
      return this.toAdminUser(created);
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: dto.displayName,
        passwordHash,
        userRoles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      include: { userRoles: { include: { role: true } } },
    });
    await this.audit.log({
      actor,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email, roles: dto.roleCodes ?? [] },
    });
    return this.toAdminUser(user);
  }

  async update(id: string, dto: UpdateUserDto, actor: string) {
    const user = await this.requireUser(id);
    if (dto.isActive === false) {
      await this.assertNotLastSystemAdmin(user.id);
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { displayName: dto.displayName, isActive: dto.isActive },
      include: { userRoles: { include: { role: true } } },
    });
    await this.audit.log({
      actor,
      action: 'user.update',
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email },
    });
    return this.toAdminUser(updated);
  }

  async setRoles(id: string, dto: SetUserRolesDto, actor: string) {
    const user = await this.requireUser(id);
    const roleIds = await this.resolveRoleIds(dto.roleCodes);
    const willHaveSystemAdmin = dto.roleCodes.includes('system_admin');
    if (!willHaveSystemAdmin) {
      await this.assertNotLastSystemAdmin(user.id);
    }
    const prior=await this.prisma.userRole.findMany({where:{userId:id},include:{role:true}});
    const affectedRoleIds=[...new Set([...roleIds,...prior.map(r=>r.roleId)])];
    const aiGrant=await this.prisma.rolePermission.findFirst({where:{roleId:{in:affectedRoleIds},permission:{OR:AI_PERMISSIONS.map(splitAiPermission)}}});
    if (aiGrant) {
      if (!dto.justification?.trim()) throw new BadRequestException('Justification required for AI role-membership changes');
      await this.prisma.$transaction(async tx=>{
        await tx.userRole.deleteMany({where:{userId:id}});
        await tx.userRole.createMany({data:roleIds.map(roleId=>({userId:id,roleId})),skipDuplicates:true});
        await this.audit.logRequired({actor,action:'ai.user.roles.set',entityType:'user',entityId:id,
          metadata:{oldValue:prior.map(r=>r.role.code),newValue:dto.roleCodes,justification:dto.justification}},tx);
      });
      return this.toAdminUser(await this.findByIdWithRoles(id));
    }
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: user.id } }),
      this.prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId: user.id, roleId })),
        skipDuplicates: true,
      }),
    ]);
    await this.audit.log({
      actor,
      action: 'user.roles.set',
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email, roles: dto.roleCodes },
    });
    return this.toAdminUser(await this.findByIdWithRoles(user.id));
  }

  async resetPassword(id: string, dto: ResetPasswordDto, actor: string) {
    const user = await this.requireUser(id);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await this.audit.log({
      actor,
      action: 'user.password.reset',
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email },
    });
    return { success: true };
  }

  private async resolveRoleIds(roleCodes: string[]): Promise<string[]> {
    if (roleCodes.length === 0) return [];
    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes }, deletedAt: null, isActive: true },
    });
    const found = new Set(roles.map((r) => r.code));
    const missing = roleCodes.filter((c) => !found.has(c));
    if (missing.length) throw new BadRequestException(`Unknown or inactive roles: ${missing.join(', ')}`);
    return roles.map((r) => r.id);
  }

  /** Prevents removing the last active system_admin (no lockout). */
  private async assertNotLastSystemAdmin(userId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    const isAdmin = target?.userRoles.some((ur) =>
      ur.role.code === 'system_admin' && ur.role.isActive && !ur.role.deletedAt,
    );
    if (!isAdmin) return;
    const activeAdmins = await this.prisma.user.count({
      where: {
        isActive: true,
        userRoles: { some: { role: { code: 'system_admin', isActive: true, deletedAt: null } } },
      },
    });
    if (activeAdmins <= 1) {
      throw new BadRequestException('Cannot remove the last active system administrator');
    }
  }

  private async requireUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private toAdminUser(u: {
    id: string;
    email: string;
    displayName: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    userRoles: { role: { code: string; nameEn: string; nameAr: string } }[];
  } | null) {
    if (!u) throw new NotFoundException('User not found');
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      roles: u.userRoles.map((ur) => ({
        code: ur.role.code,
        nameEn: ur.role.nameEn,
        nameAr: ur.role.nameAr,
      })),
    };
  }
}
