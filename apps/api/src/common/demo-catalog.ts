import { Prisma } from '@prisma/client';
import { isManagedDemoProfile } from './demo-profile';
import { roles, permissionCatalog, rolePermissionMap, classifications, roleTypes, statusValues, ndiDomains, ndiSpecifications } from './governance-catalog';
import { syncAiSecurityCatalog } from '../ai-governance/ai-security-catalog';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Add missing canonical records; never prune, reset passwords or replace user memberships. */
export async function installDemoCatalog(db: PrismaService, audit: AuditService) {
  if (!isManagedDemoProfile()) throw new Error('Canonical demo installation requires an isolated managed database.');
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1832705421)`;
    const ranks: Record<string, number> = { business_steward: 2, technical_steward: 2, data_owner: 3, dq_steward: 3, privacy_officer: 4, security_reviewer: 4 };
    for (const role of roles) await tx.role.upsert({ where: { code: role.code }, create: { ...role, isSystem: true, maxClassificationRank: ranks[role.code] ?? null }, update: {} });
    for (const p of permissionCatalog) await tx.permission.upsert({ where: { resource_action: p }, create: p, update: {} });
    const installed = await tx.permission.findMany();
    const byCode = new Map(installed.map(p => [p.resource + '.' + p.action, p.id]));
    for (const role of roles) {
      const r = await tx.role.findUniqueOrThrow({ where: { code: role.code } });
      const codes = role.code === 'system_admin' ? [...byCode.keys()] : rolePermissionMap[role.code] ?? [];
      for (const code of codes) {
        const permissionId = byCode.get(code);
        if (!permissionId) throw new Error('Canonical role permission is absent: ' + code);
        await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: r.id, permissionId } }, create: { roleId: r.id, permissionId }, update: {} });
      }
    }
    for (const c of classifications) await tx.classification.upsert({ where: { code: c.code }, create: c, update: {} });
    for (const r of roleTypes) await tx.roleType.upsert({ where: { code: r.code }, create: r, update: {} });
    for (const s of statusValues) await tx.statusValue.upsert({ where: { domain_code: { domain: s.domain, code: s.code } }, create: s, update: {} });
    for (const d of ndiDomains) await tx.ndiDomain.upsert({ where: { code: d.code }, create: d, update: {} });
    for (const { domainCode, ...spec } of ndiSpecifications) {
      const domain = await tx.ndiDomain.findUniqueOrThrow({ where: { code: domainCode } });
      await tx.ndiSpecification.upsert({ where: { code: spec.code }, create: { ...spec, domainId: domain.id } as Prisma.NdiSpecificationUncheckedCreateInput, update: {} });
    }
    const ai = await syncAiSecurityCatalog(tx, audit, 'local-demo-installer', 'Additive synthetic demo installation; no developer database or existing account changes.');
    await audit.logRequired({ actor: 'local-demo-installer', action: 'demo.catalog.installed', entityType: 'demo_installation', entityId: process.env.DGOP_DEMO_INSTALLATION_ID,
      metadata: { demoOnly: true, roles: roles.length, permissions: permissionCatalog.length, ndiSpecifications: ndiSpecifications.length } }, tx);
    return { roles: roles.length, permissions: permissionCatalog.length, ai };
  }, { timeout: 60000 });
}
