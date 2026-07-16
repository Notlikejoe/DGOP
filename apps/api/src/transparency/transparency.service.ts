import { Injectable } from '@nestjs/common';
import {
  BreachStatus,
  CaseStatus,
  DataSharingAgreementStatus,
  DataSharingReviewDecision,
  DataSharingRequestStatus,
  DpiaRiskLevel,
  DsrRequestStatus,
  FoiRequestStatus,
  OpenDataCandidateStatus,
  OpenDataSignalStatus,
  Prisma,
  TaskStatus,
} from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { AccessService } from '../access/access.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { foiSlaStatus } from '../foi/foi.logic';
import { breachNotificationStatus, privacySlaStatus } from '../privacy/privacy.logic';
import { agreementRenewalStatus } from '../data-sharing/data-sharing.logic';
import {
  addTrendDate,
  emptyTrendBuckets,
  releaseReadiness,
  riskSeverity,
  sortRisks,
  type RiskSignal,
} from './transparency.logic';

const OPEN_WORKFLOW_STATUSES: CaseStatus[] = [
  CaseStatus.draft,
  CaseStatus.submitted,
  CaseStatus.under_review,
  CaseStatus.awaiting_information,
  CaseStatus.approved,
];

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.pending, TaskStatus.in_progress];
const TRANSPARENCY_CASE_TYPES = [
  'open_data_candidate',
  'foi_request',
  'foi_appeal',
  'privacy_dpia',
  'privacy_dsr',
  'privacy_breach',
  'data_sharing_request',
];

@Injectable()
export class TransparencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly access: AccessService,
  ) {}

  private assetScopeWhere(scope: EffectiveScope): Prisma.DataAssetWhereInput {
    const where: Prisma.DataAssetWhereInput = { deletedAt: null };
    if (scope.orgUnits !== 'all') where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== 'all') where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [{ classificationId: null }, { classification: { rank: { lte: scope.maxClassRank } } }];
    }
    return where;
  }

  private isUnrestricted(scope: EffectiveScope): boolean {
    return scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
  }

  private async visibleAssetIds(scope: EffectiveScope): Promise<Set<string> | 'all'> {
    if (this.isUnrestricted(scope)) return 'all';
    const rows = await this.prisma.dataAsset.findMany({ where: this.assetScopeWhere(scope), select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  private assetScoped<T extends Record<string, unknown>>(
    assetIds: Set<string> | 'all',
    emptyId = '__no_visible_transparency_records__',
  ): T {
    if (assetIds === 'all') return {} as T;
    return (assetIds.size ? { assetId: { in: [...assetIds] } } : { id: emptyId }) as unknown as T;
  }

  private domainBranches(scope: EffectiveScope, assetIds: Set<string> | 'all') {
    const branches: Record<string, unknown>[] = [];
    if (assetIds !== 'all' && assetIds.size > 0) branches.push({ assetId: { in: [...assetIds] } });
    if (scope.orgUnits === 'all' && scope.domains !== 'all' && scope.domains.length > 0) {
      branches.push({ AND: [{ assetId: null }, { domainId: { in: scope.domains } }] });
    }
    return branches;
  }

  private privacyScoped<T extends Record<string, unknown>>(scope: EffectiveScope, assetIds: Set<string> | 'all'): T {
    if (this.isUnrestricted(scope)) return { deletedAt: null } as unknown as T;
    const branches = this.domainBranches(scope, assetIds);
    return (branches.length ? { deletedAt: null, OR: branches } : { deletedAt: null, id: '__no_visible_privacy_records__' }) as unknown as T;
  }

  private sharingScoped<T extends Record<string, unknown>>(scope: EffectiveScope, assetIds: Set<string> | 'all', deletedAt = true): T {
    const base = deletedAt ? { deletedAt: null } : {};
    if (this.isUnrestricted(scope)) return base as unknown as T;
    const branches = this.domainBranches(scope, assetIds);
    return (branches.length ? { ...base, OR: branches } : { ...base, id: '__no_visible_sharing_records__' }) as unknown as T;
  }

  private foiScoped(assetIds: Set<string> | 'all'): Prisma.FoiRequestWhereInput {
    if (assetIds === 'all') return { deletedAt: null };
    if (assetIds.size === 0) return { deletedAt: null, assetId: null };
    return { deletedAt: null, OR: [{ assetId: { in: [...assetIds] } }, { assetId: null }] };
  }

  private can(granted: string[], permission: string): boolean {
    return this.access.hasPermission(granted, permission);
  }

  private hasAny(granted: string[], permissions: string[]): boolean {
    return permissions.some((permission) => this.can(granted, permission));
  }

  async cockpit(user: AuthUser) {
    const [granted, scope] = await Promise.all([
      this.access.permissionsForRoleCodes(user.roles),
      this.scope.resolve(user.roles),
    ]);
    const assetIds = await this.visibleAssetIds(scope);
    const canOpenData = this.can(granted, 'open_data_candidates.view');
    const canFoi = this.can(granted, 'foi_requests.view');
    const canPrivacy = this.can(granted, 'privacy_operations.view');
    const canSharing = this.hasAny(granted, ['data_sharing_requests.view', 'data_sharing_agreements.view']);
    const canWorkflow = this.can(granted, 'workflow_cases.view') || this.can(granted, 'workflow_tasks.view');

    const now = new Date();
    const trends = emptyTrendBuckets(now);
    const [openData, foi, privacy, sharing, workflow] = await Promise.all([
      canOpenData ? this.openDataSection(assetIds, trends, now) : Promise.resolve(null),
      canFoi ? this.foiSection(assetIds, trends, now) : Promise.resolve(null),
      canPrivacy ? this.privacySection(scope, assetIds, now) : Promise.resolve(null),
      canSharing ? this.sharingSection(scope, assetIds, now) : Promise.resolve(null),
      canWorkflow ? this.workflowSection(now) : Promise.resolve(null),
    ]);

    const risks = sortRisks([
      ...(openData?.risks ?? []),
      ...(foi?.risks ?? []),
      ...(privacy?.risks ?? []),
      ...(sharing?.risks ?? []),
      ...(workflow?.risks ?? []),
    ]).slice(0, 12);

    const readiness = releaseReadiness({
      openDataPublished: openData?.published ?? 0,
      openDataTotal: openData?.total ?? 0,
      foiClosed: foi?.closed ?? 0,
      foiTotal: foi?.total ?? 0,
      privacyBlockers: (privacy?.highRiskDpias ?? 0) + (privacy?.breachNotificationRisk ?? 0),
      sharingBlockers: (sharing?.highRiskRequests ?? 0) + (sharing?.renewalDue ?? 0),
      overdueWorkflow: workflow?.overdueTasks ?? 0,
    });

    return {
      generatedAt: now.toISOString(),
      readiness,
      openData,
      foi,
      privacy,
      sharing,
      workflow,
      trends,
      risks,
      scenarios: this.uatScenarios(openData, foi, privacy, sharing),
    };
  }

  private async openDataSection(assetIds: Set<string> | 'all', trends: ReturnType<typeof emptyTrendBuckets>, now: Date) {
    const scopeWhere = this.assetScoped<Prisma.OpenDataCandidateWhereInput>(assetIds);
    const baseWhere: Prisma.OpenDataCandidateWhereInput = { deletedAt: null, ...scopeWhere };
    const [
      total,
      assessment,
      underReview,
      approved,
      published,
      pendingApprovals,
      candidatesForTrend,
      publicationsForTrend,
      risky,
    ] = await Promise.all([
      this.prisma.openDataCandidate.count({ where: baseWhere }),
      this.prisma.openDataCandidate.count({ where: { ...baseWhere, status: OpenDataCandidateStatus.assessment } }),
      this.prisma.openDataCandidate.count({ where: { ...baseWhere, status: OpenDataCandidateStatus.under_review } }),
      this.prisma.openDataCandidate.count({ where: { ...baseWhere, status: OpenDataCandidateStatus.approved } }),
      this.prisma.openDataCandidate.count({ where: { ...baseWhere, status: OpenDataCandidateStatus.published } }),
      this.prisma.openDataApproval.count({
        where: { decision: 'pending', candidate: { is: baseWhere } },
      }),
      this.prisma.openDataCandidate.findMany({ where: baseWhere, select: { createdAt: true } }),
      this.prisma.openDataPublication.findMany({
        where: { candidate: { is: baseWhere } },
        select: { publishedAt: true },
      }),
      this.prisma.openDataCandidate.findMany({
        where: {
          ...baseWhere,
          OR: [
            { eligibilityScore: { lt: 60 } },
            { classificationSignal: OpenDataSignalStatus.blocked },
            { dataQualitySignal: OpenDataSignalStatus.blocked },
            { personalDataSignal: OpenDataSignalStatus.blocked },
            { ownershipSignal: OpenDataSignalStatus.blocked },
            { nextReviewAt: { lte: now } },
          ],
        },
        select: { id: true, code: true, titleEn: true, eligibilityScore: true, status: true, nextReviewAt: true },
        orderBy: [{ eligibilityScore: 'asc' }, { updatedAt: 'desc' }],
        take: 6,
      }),
    ]);

    candidatesForTrend.forEach((row) => addTrendDate(trends, 'openDataCreated', row.createdAt));
    publicationsForTrend.forEach((row) => addTrendDate(trends, 'openDataPublished', row.publishedAt));
    const overdueReview = risky.filter((row) => row.nextReviewAt && row.nextReviewAt <= now).length;
    const risks: RiskSignal[] = risky.map((row) => ({
      id: row.id,
      source: 'open_data',
      title: row.titleEn,
      detail: `${row.code} eligibility ${row.eligibilityScore}%`,
      severity: row.nextReviewAt && row.nextReviewAt <= now ? 'high' : riskSeverity(100 - row.eligibilityScore),
      route: `/governance/open-data/${row.id}`,
      dueAt: row.nextReviewAt?.toISOString() ?? null,
      metric: row.eligibilityScore,
    }));

    return {
      total,
      assessment,
      underReview,
      approved,
      published,
      pendingApprovals,
      overdueReview,
      readinessPct: total ? Math.round(((approved + published) / total) * 100) : 0,
      risks,
    };
  }

  private async foiSection(assetIds: Set<string> | 'all', trends: ReturnType<typeof emptyTrendBuckets>, now: Date) {
    const where = this.foiScoped(assetIds);
    const openStatuses: FoiRequestStatus[] = [
      FoiRequestStatus.registered,
      FoiRequestStatus.under_review,
      FoiRequestStatus.awaiting_clarification,
      FoiRequestStatus.decision_due,
      FoiRequestStatus.extended,
      FoiRequestStatus.appealed,
    ];
    const [requests, disclosures, appeals] = await Promise.all([
      this.prisma.foiRequest.findMany({
        where,
        select: {
          id: true,
          requestNumber: true,
          subject: true,
          requesterType: true,
          status: true,
          dueAt: true,
          receivedAt: true,
        },
      }),
      this.prisma.foiDisclosure.findMany({ where: { request: { is: where } }, select: { releasedAt: true } }),
      this.prisma.foiAppeal.count({ where: { request: { is: where } } }),
    ]);

    requests.forEach((row) => addTrendDate(trends, 'foiReceived', row.receivedAt));
    disclosures.forEach((row) => addTrendDate(trends, 'foiDisclosed', row.releasedAt));
    const open = requests.filter((row) => openStatuses.includes(row.status)).length;
    const closedStatuses: FoiRequestStatus[] = [
      FoiRequestStatus.closed,
      FoiRequestStatus.disclosed,
      FoiRequestStatus.rejected,
      FoiRequestStatus.cancelled,
    ];
    const closed = requests.filter((row) => closedStatuses.includes(row.status)).length;
    const overdue = requests.filter((row) => foiSlaStatus(row.dueAt, row.status, now) === 'overdue').length;
    const dueSoon = requests.filter((row) => foiSlaStatus(row.dueAt, row.status, now) === 'due_soon').length;
    const highProfile = requests.filter((row) => ['government', 'media'].includes(row.requesterType)).length;
    const risks: RiskSignal[] = requests
      .filter((row) => ['overdue', 'due_soon'].includes(foiSlaStatus(row.dueAt, row.status, now)) || ['government', 'media'].includes(row.requesterType))
      .map((row) => {
        const sla = foiSlaStatus(row.dueAt, row.status, now);
        return {
          id: row.id,
          source: 'foi' as const,
          title: row.subject,
          detail: `${row.requestNumber} ${sla.replace('_', ' ')}`,
          severity: sla === 'overdue' ? 'critical' : sla === 'due_soon' ? 'high' : 'medium',
          route: `/governance/foi/${row.id}`,
          dueAt: row.dueAt.toISOString(),
        };
      });

    return {
      total: requests.length,
      open,
      closed,
      overdue,
      dueSoon,
      highProfile,
      appeals,
      disclosures: disclosures.length,
      risks,
    };
  }

  private async privacySection(scope: EffectiveScope, assetIds: Set<string> | 'all', now: Date) {
    const scoped = this.privacyScoped<Prisma.PrivacyDpiaWhereInput>(scope, assetIds);
    const [dpias, dsrs, breaches] = await Promise.all([
      this.prisma.privacyDpia.findMany({
        where: scoped,
        select: { id: true, code: true, title: true, status: true, riskLevel: true, dueAt: true },
      }),
      this.prisma.privacyDsrRequest.findMany({
        where: scoped as Prisma.PrivacyDsrRequestWhereInput,
        select: { id: true, requestNumber: true, requesterName: true, requestType: true, status: true, dueAt: true },
      }),
      this.prisma.privacyBreach.findMany({
        where: scoped as Prisma.PrivacyBreachWhereInput,
        select: { id: true, code: true, title: true, severity: true, status: true, notificationDueAt: true, notifiedAt: true },
      }),
    ]);
    const highDpiaRisks: DpiaRiskLevel[] = [DpiaRiskLevel.high, DpiaRiskLevel.critical];
    const highRiskDpias = dpias.filter((row) => highDpiaRisks.includes(row.riskLevel)).length;
    const dsrOverdue = dsrs.filter((row) => privacySlaStatus(row.dueAt, row.status, now) === 'overdue').length;
    const breachNotificationRisk = breaches.filter((row) =>
      ['urgent', 'overdue'].includes(breachNotificationStatus(row.notificationDueAt, row.status, row.notifiedAt, now)),
    ).length;
    const risks: RiskSignal[] = [
      ...dpias
        .filter((row) => highDpiaRisks.includes(row.riskLevel) || privacySlaStatus(row.dueAt, row.status, now) === 'overdue')
        .map((row) => ({
          id: row.id,
          source: 'privacy' as const,
          title: row.title,
          detail: `${row.code} ${row.riskLevel}`,
          severity: row.riskLevel === DpiaRiskLevel.critical ? 'critical' as const : 'high' as const,
          route: '/governance/privacy',
          dueAt: row.dueAt?.toISOString() ?? null,
        })),
      ...dsrs
        .filter((row) => privacySlaStatus(row.dueAt, row.status, now) !== 'closed')
        .map((row) => ({
          id: row.id,
          source: 'privacy' as const,
          title: row.requesterName,
          detail: `${row.requestNumber} ${row.requestType}`,
          severity: privacySlaStatus(row.dueAt, row.status, now) === 'overdue' ? 'critical' as const : 'medium' as const,
          route: '/governance/privacy',
          dueAt: row.dueAt.toISOString(),
        })),
      ...breaches
        .filter((row) => breachNotificationStatus(row.notificationDueAt, row.status, row.notifiedAt, now) !== 'notified')
        .map((row) => ({
          id: row.id,
          source: 'privacy' as const,
          title: row.title,
          detail: `${row.code} notification ${breachNotificationStatus(row.notificationDueAt, row.status, row.notifiedAt, now)}`,
          severity: breachNotificationStatus(row.notificationDueAt, row.status, row.notifiedAt, now) === 'overdue' ? 'critical' as const : 'high' as const,
          route: '/governance/privacy',
          dueAt: row.notificationDueAt.toISOString(),
        })),
    ];
    return {
      dpias: dpias.length,
      dsrs: dsrs.length,
      breaches: breaches.length,
      highRiskDpias,
      dsrOverdue,
      breachNotificationRisk,
      risks,
    };
  }

  private async sharingSection(scope: EffectiveScope, assetIds: Set<string> | 'all', now: Date) {
    const requestWhere = this.sharingScoped<Prisma.DataSharingRequestWhereInput>(scope, assetIds);
    const agreementWhere = this.sharingScoped<Prisma.DataSharingAgreementWhereInput>(scope, assetIds, false);
    const [requests, pendingReviews, agreements, usage] = await Promise.all([
      this.prisma.dataSharingRequest.findMany({
        where: requestWhere,
        select: { id: true, requestNumber: true, recipientOrg: true, purpose: true, status: true, riskScore: true },
      }),
      this.prisma.dataSharingReview.count({ where: { decision: DataSharingReviewDecision.pending, request: { is: requestWhere } } }),
      this.prisma.dataSharingAgreement.findMany({
        where: agreementWhere,
        select: { id: true, agreementNumber: true, recipientOrg: true, purpose: true, status: true, renewalDueAt: true },
      }),
      this.prisma.dataSharingUsageMetric.findMany({
        where: { agreement: { is: agreementWhere } },
        select: { recordsShared: true, apiCalls: true, incidents: true, status: true },
      }),
    ]);
    const highRiskRequests = requests.filter((row) => row.riskScore >= 70).length;
    const renewalDue = agreements.filter((row) => agreementRenewalStatus(row.renewalDueAt, row.status, now) === DataSharingAgreementStatus.renewal_due).length;
    const risks: RiskSignal[] = [
      ...requests
        .filter((row) => row.riskScore >= 70 || row.status === DataSharingRequestStatus.under_review)
        .map((row) => ({
          id: row.id,
          source: 'data_sharing' as const,
          title: row.recipientOrg,
          detail: `${row.requestNumber} risk ${row.riskScore}`,
          severity: riskSeverity(row.riskScore),
          route: '/governance/data-sharing',
          metric: row.riskScore,
        })),
      ...agreements
        .filter((row) => agreementRenewalStatus(row.renewalDueAt, row.status, now) === DataSharingAgreementStatus.renewal_due)
        .map((row) => ({
          id: row.id,
          source: 'data_sharing' as const,
          title: row.recipientOrg,
          detail: `${row.agreementNumber} renewal due`,
          severity: 'high' as const,
          route: '/governance/data-sharing',
          dueAt: row.renewalDueAt?.toISOString() ?? null,
        })),
    ];
    return {
      totalRequests: requests.length,
      underReview: requests.filter((row) => row.status === DataSharingRequestStatus.under_review).length,
      highRiskRequests,
      activeAgreements: agreements.filter((row) => row.status === DataSharingAgreementStatus.active).length,
      renewalDue,
      pendingReviews,
      recordsShared: usage.reduce((sum, row) => sum + row.recordsShared, 0),
      incidents: usage.reduce((sum, row) => sum + row.incidents, 0),
      risks,
    };
  }

  private async workflowSection(now: Date) {
    const cases = await this.prisma.workflowCase.findMany({
      where: { type: { in: TRANSPARENCY_CASE_TYPES } },
      select: {
        id: true,
        code: true,
        title: true,
        type: true,
        status: true,
        tasks: { select: { id: true, title: true, status: true, dueDate: true } },
      },
      take: 200,
      orderBy: { updatedAt: 'desc' },
    });
    const openCases = cases.filter((row) => OPEN_WORKFLOW_STATUSES.includes(row.status)).length;
    const overdueTasks = cases.flatMap((row) => row.tasks).filter((task) => task.dueDate && task.dueDate < now && OPEN_TASK_STATUSES.includes(task.status)).length;
    const risks = cases.flatMap((row) =>
      row.tasks
        .filter((task) => task.dueDate && task.dueDate < now && OPEN_TASK_STATUSES.includes(task.status))
        .map((task) => ({
          id: task.id,
          source: 'workflow' as const,
          title: task.title,
          detail: `${row.code} ${row.type}`,
          severity: 'high' as const,
          route: `/governance/workflow/cases/${row.id}`,
          dueAt: task.dueDate?.toISOString() ?? null,
        })),
    );
    return { cases: cases.length, openCases, overdueTasks, risks };
  }

  private uatScenarios(
    openData: Awaited<ReturnType<TransparencyService['openDataSection']>> | null,
    foi: Awaited<ReturnType<TransparencyService['foiSection']>> | null,
    privacy: Awaited<ReturnType<TransparencyService['privacySection']>> | null,
    sharing: Awaited<ReturnType<TransparencyService['sharingSection']>> | null,
  ) {
    return [
      {
        id: 'open_data_publication',
        title: 'Open Data candidate assessment to publication',
        status: (openData?.published ?? 0) > 0 ? 'ready' : (openData?.underReview ?? 0) > 0 ? 'watch' : 'not_started',
        evidence: `${openData?.published ?? 0} published, ${openData?.pendingApprovals ?? 0} approvals pending`,
      },
      {
        id: 'foi_disclosure_appeal',
        title: 'FOI intake to disclosure and appeal',
        status: (foi?.disclosures ?? 0) > 0 ? 'ready' : (foi?.open ?? 0) > 0 ? 'watch' : 'not_started',
        evidence: `${foi?.disclosures ?? 0} disclosures, ${foi?.appeals ?? 0} appeals`,
      },
      {
        id: 'privacy_dpia_dsr',
        title: 'DPIA and DSR workflow',
        status: (privacy?.highRiskDpias ?? 0) || (privacy?.dsrOverdue ?? 0) ? 'blocked' : (privacy?.dpias ?? 0) || (privacy?.dsrs ?? 0) ? 'ready' : 'not_started',
        evidence: `${privacy?.dpias ?? 0} DPIAs, ${privacy?.dsrs ?? 0} DSRs`,
      },
      {
        id: 'data_sharing_approval',
        title: 'Data sharing request approval',
        status: (sharing?.pendingReviews ?? 0) ? 'watch' : (sharing?.activeAgreements ?? 0) ? 'ready' : 'not_started',
        evidence: `${sharing?.activeAgreements ?? 0} active agreements, ${sharing?.pendingReviews ?? 0} reviews pending`,
      },
    ];
  }
}
