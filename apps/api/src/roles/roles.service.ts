import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import {
  CreateRoleDto,
  SetRolePermissionsDto,
  SetRoleScopesDto,
  UpdateRoleDto,
} from './roles.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async list() {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: { nameEn: 'asc' },
      include: {
        _count: { select: { userRoles: true, permissions: true } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      description: r.description,
      isSystem: r.isSystem,
      isActive: r.isActive,
      maxClassificationRank: r.maxClassificationRank,
      userCount: r._count.userRoles,
      permissionCount: r._count.permissions,
    }));
  }

  async get(id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: {
        permissions: { include: { permission: true } },
        dataScopes: true,
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return {
      id: role.id,
      code: role.code,
      nameEn: role.nameEn,
      nameAr: role.nameAr,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      maxClassificationRank: role.maxClassificationRank,
      permissions: role.permissions.map(
        (p) => `${p.permission.resource}.${p.permission.action}`,
      ),
      scopes: role.dataScopes.map((s) => ({
        scopeType: s.scopeType,
        refId: s.refId,
        includeDescendants: s.includeDescendants,
      })),
    };
  }

  permissionsCatalog() {
    return this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
  }

  async create(dto: CreateRoleDto, actor: string) {
    const existing = await this.prisma.role.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Role code already exists');
    const role = await this.prisma.role.create({
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description,
        isActive: dto.isActive ?? true,
        isSystem: false,
        maxClassificationRank: dto.maxClassificationRank ?? null,
      },
    });
    await this.audit.log({
      actor,
      action: 'role.create',
      entityType: 'role',
      entityId: role.id,
      metadata: { code: role.code },
    });
    return this.get(role.id);
  }

  async update(id: string, dto: UpdateRoleDto, actor: string) {
    const role = await this.requireRole(id);
    const role2 = await this.prisma.role.update({
      where: { id: role.id },
      data: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description,
        isActive: dto.isActive,
        ...(dto.maxClassificationRank !== undefined
          ? { maxClassificationRank: dto.maxClassificationRank }
          : {}),
      },
    });
    await this.audit.log({
      actor,
      action: 'role.update',
      entityType: 'role',
      entityId: role2.id,
      metadata: { code: role2.code },
    });
    return this.get(role2.id);
  }

  async remove(id: string, actor: string) {
    const role = await this.requireRole(id);
    if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted');
    await this.prisma.role.update({
      where: { id: role.id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      actor,
      action: 'role.delete',
      entityType: 'role',
      entityId: role.id,
      metadata: { code: role.code },
    });
    return { success: true };
  }

  async setPermissions(id: string, dto: SetRolePermissionsDto, actor: string) {
    const role = await this.requireRole(id);
    if (role.code === 'system_admin') {
      throw new ForbiddenException('system_admin permissions are immutable');
    }
    const catalog = await this.prisma.permission.findMany();
    const idByKey = new Map(catalog.map((p) => [`${p.resource}.${p.action}`, p.id]));
    const unknown = dto.permissions.filter((k) => !idByKey.has(k));
    if (unknown.length) {
      throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
    }
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      this.prisma.rolePermission.createMany({
        data: dto.permissions.map((k) => ({
          roleId: role.id,
          permissionId: idByKey.get(k)!,
        })),
        skipDuplicates: true,
      }),
    ]);
    await this.audit.log({
      actor,
      action: 'role.permissions.set',
      entityType: 'role',
      entityId: role.id,
      metadata: { code: role.code, count: dto.permissions.length },
    });
    return this.get(role.id);
  }

  async setScopes(id: string, dto: SetRoleScopesDto, actor: string) {
    const role = await this.requireRole(id);
    if (role.code === 'system_admin') {
      throw new ForbiddenException('system_admin scope is always unrestricted');
    }
    await this.prisma.$transaction([
      this.prisma.roleDataScope.deleteMany({ where: { roleId: role.id } }),
      this.prisma.roleDataScope.createMany({
        data: dto.scopes.map((s) => ({
          roleId: role.id,
          scopeType: s.scopeType,
          refId: s.refId,
          includeDescendants: s.includeDescendants ?? true,
        })),
        skipDuplicates: true,
      }),
      this.prisma.role.update({
        where: { id: role.id },
        data: {
          ...(dto.maxClassificationRank !== undefined
            ? { maxClassificationRank: dto.maxClassificationRank }
            : {}),
        },
      }),
    ]);
    await this.audit.log({
      actor,
      action: 'role.scopes.set',
      entityType: 'role',
      entityId: role.id,
      metadata: { code: role.code, count: dto.scopes.length },
    });
    return this.get(role.id);
  }

  async scopePreview(id: string) {
    const role = await this.requireRole(id);
    return this.scope.resolve([role.code]);
  }

  private async requireRole(id: string) {
    const role = await this.prisma.role.findFirst({ where: { id, deletedAt: null } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }
}
