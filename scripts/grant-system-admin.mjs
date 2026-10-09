import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnvironment } from './runtime-env.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
applyEnvironment(root);

const require = createRequire(import.meta.url);
const { PrismaClient } = require(join(root, 'apps', 'api', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();
const adminEmail = (process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@dgop.local').toLowerCase();

try {
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email: adminEmail }, select: { id: true, isActive: true } });
    if (!user) throw new Error(`Administrator account ${adminEmail} does not exist. Seed or create it first.`);

    const systemRole = await tx.role.findFirst({
      where: { code: 'system_admin', isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!systemRole) throw new Error('The active system_admin role does not exist. Apply the canonical seed first.');

    const [roles, permissions] = await Promise.all([
      tx.role.findMany({
        where: { isActive: true, deletedAt: null, code: { not: 'auditor' } },
        select: { id: true },
      }),
      tx.permission.findMany({ select: { id: true } }),
    ]);

    const roleAssignments = await tx.userRole.createMany({
      data: roles.map((role) => ({ userId: user.id, roleId: role.id })),
      skipDuplicates: true,
    });
    const permissionGrants = await tx.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: systemRole.id, permissionId: permission.id })),
      skipDuplicates: true,
    });

    const changed = roleAssignments.count > 0 || permissionGrants.count > 0 || !user.isActive;
    if (changed) {
      await tx.user.update({
        where: { id: user.id },
        data: { isActive: true, tokenVersion: { increment: 1 } },
      });
    }

    return {
      roleCount: roles.length,
      permissionCount: permissions.length,
      addedRoles: roleAssignments.count,
      addedPermissions: permissionGrants.count,
      sessionRefreshRequired: changed,
    };
  });

  console.log(
    `System administrator grant verified for ${adminEmail}: ${result.roleCount} active roles and ${result.permissionCount} permissions; `
      + `${result.addedRoles} role assignments and ${result.addedPermissions} permission grants added.`,
  );
  if (result.sessionRefreshRequired) console.log('Existing administrator sessions were invalidated; sign in again to load the expanded authority.');
} finally {
  await prisma.$disconnect();
}
