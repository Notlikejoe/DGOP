import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface EffectiveScope {
  /** Allowed organization unit ids, or 'all' when unrestricted. */
  orgUnits: string[] | 'all';
  /** Allowed data domain ids, or 'all' when unrestricted. */
  domains: string[] | 'all';
  /** Max classification rank the user may view, or null when unrestricted. */
  maxClassRank: number | null;
}

interface ScopeRow {
  scopeType: 'org_unit' | 'data_domain';
  refId: string;
  includeDescendants: boolean;
}

interface RoleWithScope {
  code: string;
  isSystem: boolean;
  maxClassificationRank: number | null;
  dataScopes: ScopeRow[];
}

const EMPTY_SCOPE: EffectiveScope = { orgUnits: [], domains: [], maxClassRank: null };

/**
 * Resolves a user's effective data-visibility scope (union across their roles) and
 * builds Prisma where-fragments for dimension-bearing data (assets, arriving in Sprint 4).
 *
 * Semantics: system roles with no scope rows remain unrestricted for seeded demo/admin
 * behavior. Custom roles with permissions but no scope rows are default-deny until an
 * administrator explicitly grants org-unit/domain scope.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(roleCodes: string[]): Promise<EffectiveScope> {
    if (roleCodes.includes('system_admin')) {
      return { orgUnits: 'all', domains: 'all', maxClassRank: null };
    }
    const roles = (await this.prisma.role.findMany({
      where: { code: { in: roleCodes }, isActive: true, deletedAt: null },
      include: { dataScopes: true },
    })) as RoleWithScope[];
    if (roles.length === 0) return EMPTY_SCOPE;

    const orgUnits = await this.resolveDimension(
      roles,
      'org_unit',
      'organizationUnit',
    );
    const domains = await this.resolveDimension(
      roles,
      'data_domain',
      'dataDomain',
    );

    let maxClassRank: number | null = -1;
    for (const r of roles) {
      if (r.maxClassificationRank == null) {
        maxClassRank = null;
        break;
      }
      maxClassRank = Math.max(maxClassRank, r.maxClassificationRank);
    }
    if (maxClassRank === -1) maxClassRank = null;

    return { orgUnits, domains, maxClassRank };
  }

  private async resolveDimension(
    roles: RoleWithScope[],
    scopeType: 'org_unit' | 'data_domain',
    model: 'organizationUnit' | 'dataDomain',
  ): Promise<string[] | 'all'> {
    const base = new Set<string>();
    const expand = new Set<string>();
    for (const role of roles) {
      const rows = role.dataScopes.filter((s) => s.scopeType === scopeType);
      if (rows.length === 0) {
        if (role.isSystem || role.dataScopes.length > 0) return 'all';
        continue;
      }
      for (const row of rows) {
        base.add(row.refId);
        if (row.includeDescendants) expand.add(row.refId);
      }
    }
    if (expand.size > 0) {
      const descendants = await this.descendantsOf(model, [...expand]);
      descendants.forEach((id) => base.add(id));
    }
    return [...base];
  }

  /** Walks the self-referencing tree to collect all descendant ids of the given roots. */
  private async descendantsOf(
    model: 'organizationUnit' | 'dataDomain',
    rootIds: string[],
  ): Promise<string[]> {
    const all: { id: string; parentId: string | null }[] = await (
      this.prisma as unknown as Record<string, any>
    )[model].findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    const childrenByParent = new Map<string, string[]>();
    for (const n of all) {
      if (!n.parentId) continue;
      const arr = childrenByParent.get(n.parentId) ?? [];
      arr.push(n.id);
      childrenByParent.set(n.parentId, arr);
    }
    const result: string[] = [];
    const stack = [...rootIds];
    while (stack.length) {
      const id = stack.pop()!;
      for (const child of childrenByParent.get(id) ?? []) {
        result.push(child);
        stack.push(child);
      }
    }
    return result;
  }

  /** Prisma where-fragment to constrain dimension-bearing records to a user's scope. */
  buildWhere(
    scope: EffectiveScope,
    fields: { orgUnitField?: string; domainField?: string; classRankField?: string } = {},
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    const { orgUnitField = 'orgUnitId', domainField = 'domainId', classRankField } = fields;
    if (scope.orgUnits !== 'all') where[orgUnitField] = { in: scope.orgUnits };
    if (scope.domains !== 'all') where[domainField] = { in: scope.domains };
    if (scope.maxClassRank != null && classRankField) {
      where[classRankField] = { lte: scope.maxClassRank };
    }
    return where;
  }
}
