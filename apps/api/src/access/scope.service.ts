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

/**
 * Resolves a user's effective data-visibility scope (union across their roles) and
 * builds Prisma where-fragments for dimension-bearing data (assets, arriving in Sprint 4).
 *
 * Semantics: a role with no scope rows for a dimension is unrestricted on that dimension,
 * so the union becomes 'all'. system_admin is always fully unrestricted.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(roleCodes: string[]): Promise<EffectiveScope> {
    if (roleCodes.includes('system_admin')) {
      return { orgUnits: 'all', domains: 'all', maxClassRank: null };
    }
    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes }, isActive: true, deletedAt: null },
      include: { dataScopes: true },
    });
    if (roles.length === 0) return { orgUnits: 'all', domains: 'all', maxClassRank: null };

    const orgUnits = await this.resolveDimension(
      roles.map((r) => r.dataScopes as ScopeRow[]),
      'org_unit',
      'organizationUnit',
    );
    const domains = await this.resolveDimension(
      roles.map((r) => r.dataScopes as ScopeRow[]),
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
    perRoleScopes: ScopeRow[][],
    scopeType: 'org_unit' | 'data_domain',
    model: 'organizationUnit' | 'dataDomain',
  ): Promise<string[] | 'all'> {
    const base = new Set<string>();
    const expand = new Set<string>();
    for (const scopes of perRoleScopes) {
      const rows = scopes.filter((s) => s.scopeType === scopeType);
      // A role with no rows for this dimension is unrestricted -> union is 'all'.
      if (rows.length === 0) return 'all';
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
