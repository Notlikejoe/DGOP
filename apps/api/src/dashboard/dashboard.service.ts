import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService, EffectiveScope } from '../access/scope.service';
import { AccessService } from '../access/access.service';
import { ScoringService } from '../scoring/scoring.service';
import { AuthUser } from '../auth/auth.types';

export interface DashboardStats {
  assets: { total: number; withOwner: number; unassigned: number; coveragePct: number };
  approvals: { pending: number };
  myTasks: { open: number };
  people: { total: number };
  ndi: { specifications: number; domains: number; domainsCovered: number; coveragePct: number };
}

/** Role-aware dashboard payload. Sections the user cannot access are null. */
export interface DashboardSummary {
  governance: {
    assets: { total: number; withOwner: number; unassigned: number };
    ownershipCoveragePct: number;
    stewardshipCoveragePct: number;
    /** Organization-wide reference metric (not asset-scoped). */
    pendingApprovals: number;
  } | null;
  ndi: {
    readinessPct: number;
    maturity: string;
    satisfied: number;
    specifications: number;
    gaps: { missing: number; expired: number; rejected: number; unassigned: number; stuck: number };
  } | null;
  workflow: { myOpenTasks: number; myOverdueTasks: number } | null;
  myWork: {
    ownedAssets: number;
    ownedSpecs: number;
    evidenceToReview: number | null;
  } | null;
  reference: { people: number } | null;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly access: AccessService,
    private readonly scoring: ScoringService,
  ) {}

  /** Asset visibility scope, mirroring the assets service so tiles match the registry. */
  private assetScopeWhere(scope: EffectiveScope): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (scope.orgUnits !== 'all') where['orgUnitId'] = { in: scope.orgUnits };
    if (scope.domains !== 'all') where['domainId'] = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where['OR'] = [
        { classificationId: null },
        { classification: { rank: { lte: scope.maxClassRank } } },
      ];
    }
    return where;
  }

  async stats(roleCodes: string[], userId: string): Promise<DashboardStats> {
    const scope = await this.scope.resolve(roleCodes);
    const assetWhere = { AND: [{ deletedAt: null }, this.assetScopeWhere(scope)] };
    const ownedWhere = {
      AND: [{ deletedAt: null }, { ownerStatus: 'assigned' }, this.assetScopeWhere(scope)],
    };

    const [
      totalAssets,
      ownedAssets,
      pendingApprovals,
      myOpenTasks,
      people,
      ndiSpecs,
      ndiDomains,
      ndiCovered,
    ] = await Promise.all([
      this.prisma.dataAsset.count({ where: assetWhere }),
      this.prisma.dataAsset.count({ where: ownedWhere }),
      this.prisma.stewardshipAssignment.count({
        where: { deletedAt: null, approvalStatus: 'pending' },
      }),
      this.prisma.workflowTask.count({
        where: { assigneeUserId: userId, status: { in: ['pending', 'in_progress'] } },
      }),
      this.prisma.person.count({ where: { deletedAt: null } }),
      this.prisma.ndiSpecification.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.ndiDomain.count(),
      this.prisma.ndiSpecification.groupBy({
        by: ['domainId'],
        where: { deletedAt: null, isActive: true },
      }),
    ]);

    const coveragePct = totalAssets ? Math.round((ownedAssets / totalAssets) * 100) : 0;
    const domainsCovered = ndiCovered.length;
    const ndiCoveragePct = ndiDomains ? Math.round((domainsCovered / ndiDomains) * 100) : 0;

    return {
      assets: {
        total: totalAssets,
        withOwner: ownedAssets,
        unassigned: totalAssets - ownedAssets,
        coveragePct,
      },
      approvals: { pending: pendingApprovals },
      myTasks: { open: myOpenTasks },
      people: { total: people },
      ndi: {
        specifications: ndiSpecs,
        domains: ndiDomains,
        domainsCovered,
        coveragePct: ndiCoveragePct,
      },
    };
  }

  /**
   * Adaptive, role-aware dashboard. Each section is computed only when the user holds
   * the matching permission (so the API never leaks data the UI would hide), and the
   * "my work" section is keyed off the signed-in user's linked Person.
   */
  async summary(user: AuthUser): Promise<DashboardSummary> {
    const perms = await this.access.permissionsForRoleCodes(user.roles);
    const can = (p: string) => this.access.hasPermission(perms, p);

    const summary: DashboardSummary = {
      governance: null,
      ndi: null,
      workflow: null,
      myWork: null,
      reference: null,
    };

    // ----- Governance (org-wide KPIs, asset metrics scoped to the user) -----
    if (can('data_assets.view')) {
      const scope = await this.scope.resolve(user.roles);
      const scopeWhere = this.assetScopeWhere(scope);
      const assetWhere = { AND: [{ deletedAt: null }, scopeWhere] };

      const inScopeAssets = await this.prisma.dataAsset.findMany({
        where: assetWhere,
        select: { id: true, ownerStatus: true },
      });
      const total = inScopeAssets.length;
      const withOwner = inScopeAssets.filter((a) => a.ownerStatus === 'assigned').length;
      const assetIds = inScopeAssets.map((a) => a.id);

      const stewarded = assetIds.length
        ? await this.prisma.stewardshipAssignment.findMany({
            where: {
              deletedAt: null,
              approvalStatus: 'approved',
              targetType: 'asset',
              targetId: { in: assetIds },
            },
            select: { targetId: true },
            distinct: ['targetId'],
          })
        : [];

      const pendingApprovals = await this.prisma.stewardshipAssignment.count({
        where: { deletedAt: null, approvalStatus: 'pending' },
      });

      summary.governance = {
        assets: { total, withOwner, unassigned: total - withOwner },
        ownershipCoveragePct: total ? Math.round((withOwner / total) * 100) : 0,
        stewardshipCoveragePct: total ? Math.round((stewarded.length / total) * 100) : 0,
        pendingApprovals,
      };
    }

    // ----- NDI readiness (reuse the scoring engine, no re-derivation) -----
    if (can('ndi_scoring.view')) {
      const r = await this.scoring.readiness();
      summary.ndi = {
        readinessPct: r.overall.score,
        maturity: r.overall.maturity,
        satisfied: r.overall.satisfiedCount,
        specifications: r.overall.specCount,
        gaps: r.gapTotals,
      };
    }

    // ----- Workflow (the signed-in user's own tasks) -----
    if (can('workflow_tasks.view')) {
      const [myOpenTasks, myOverdueTasks] = await Promise.all([
        this.prisma.workflowTask.count({
          where: { assigneeUserId: user.id, status: { in: ['pending', 'in_progress'] } },
        }),
        this.prisma.workflowTask.count({
          where: {
            assigneeUserId: user.id,
            status: { in: ['pending', 'in_progress'] },
            dueDate: { lt: new Date() },
          },
        }),
      ]);
      summary.workflow = { myOpenTasks, myOverdueTasks };
    }

    // ----- My work (per-person, for owners / stewards) -----
    const person = await this.prisma.person.findFirst({
      where: { userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (person) {
      const [ownedAssignments, ownedSpecs] = await Promise.all([
        this.prisma.stewardshipAssignment.findMany({
          where: { deletedAt: null, personId: person.id, targetType: 'asset' },
          select: { targetId: true },
          distinct: ['targetId'],
        }),
        this.prisma.ndiSpecification.count({
          where: { deletedAt: null, ownerPersonId: person.id },
        }),
      ]);
      const evidenceToReview = can('evidence.review')
        ? await this.prisma.ndiEvidence.count({
            where: { deletedAt: null, status: { in: ['submitted', 'under_review'] } },
          })
        : null;
      summary.myWork = {
        ownedAssets: ownedAssignments.length,
        ownedSpecs,
        evidenceToReview,
      };
    }

    // ----- Reference (organization-wide) -----
    if (can('people.view')) {
      summary.reference = { people: await this.prisma.person.count({ where: { deletedAt: null } }) };
    }

    return summary;
  }
}
