import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Wildcard permission granted to system_admin (matches every permission). */
export const WILDCARD = '*';

/**
 * Resolves a user's effective permissions from their role codes (live from the DB,
 * so privilege changes take effect immediately without re-login).
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async permissionsForRoleCodes(roleCodes: string[], client: Prisma.TransactionClient = this.prisma): Promise<string[]> {
    if (roleCodes.length === 0) return [];
    const activeRoles = await client.role.findMany({
      where: { code: { in: roleCodes }, isActive: true, deletedAt: null },
      select: { id: true, code: true },
    });
    if (activeRoles.some((role) => role.code === 'system_admin')) return [WILDCARD];
    if (activeRoles.length === 0) return [];
    const rows = await client.rolePermission.findMany({
      where: { roleId: { in: activeRoles.map((role) => role.id) } },
      include: { permission: true },
    });
    return [
      ...new Set(rows.map((r) => `${r.permission.resource}.${r.permission.action}`)),
    ];
  }

  hasPermission(granted: string[], required: string): boolean {
    return granted.includes(WILDCARD) || granted.includes(required);
  }
}
