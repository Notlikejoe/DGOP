import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DataSharingRequestStatus,
  FoiRequestStatus,
  NdiEvidenceStatus,
  OpenDataCandidateStatus,
  PrivacyWorkStatus,
  Prisma,
} from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { AccessService } from '../access/access.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { foiSlaStatus } from '../foi/foi.logic';
import {
  filterDefinitions,
  toCsv,
  toSimplePdf,
  type ReportDefinition,
  type ReportFormat,
  type ReportResult,
  type ReportRow,
} from './reports.logic';

export interface ReportFilters {
  from?: string;
  to?: string;
  status?: string;
  domainId?: string;
}

export interface ReportExport {
  filename: string;
  contentType: string;
  body: Buffer | string;
}

type OpenDataReportRow = { status: OpenDataCandidateStatus };
type FoiReportRow = { status: FoiRequestStatus; dueAt: Date };
type PrivacyReportRow = { status: PrivacyWorkStatus; riskLevel: string };
type SharingReportRow = { status: DataSharingRequestStatus; riskScore: number };

const DEFINITIONS: ReportDefinition[] = [
  {
    id: 'operational-transparency',
    title: 'Transparency operations',
    description: 'Open Data, FOI, privacy, and sharing workload in one operating report.',
    tower: 'Transparency Operations',
    requiredAnyPermissions: ['open_data_candidates.view', 'foi_requests.view', 'privacy_operations.view', 'data_sharing_requests.view'],
    supportedFormats: ['json', 'csv', 'pdf'],
    scheduledPlaceholder: true,
    filters: [
      { key: 'from', label: 'From', type: 'date' },
      { key: 'to', label: 'To', type: 'date' },
    ],
  },
  {
    id: 'open-data-workload',
    title: 'Open Data workload',
    description: 'Candidate readiness, approvals, publication status, and overdue review signals.',
    tower: 'Transparency Operations',
    requiredAnyPermissions: ['open_data_candidates.view'],
    supportedFormats: ['json', 'csv', 'pdf'],
    scheduledPlaceholder: true,
    filters: [
      { key: 'status', label: 'Status', type: 'select', options: Object.values(OpenDataCandidateStatus) },
      { key: 'from', label: 'From', type: 'date' },
      { key: 'to', label: 'To', type: 'date' },
    ],
  },
  {
    id: 'foi-sla',
    title: 'FOI SLA and disclosure',
    description: 'Request status, SLA posture, disclosures, and appeals for FOI operations.',
    tower: 'Transparency Operations',
    requiredAnyPermissions: ['foi_requests.view'],
    supportedFormats: ['json', 'csv', 'pdf'],
    scheduledPlaceholder: true,
    filters: [
      { key: 'status', label: 'Status', type: 'select', options: Object.values(FoiRequestStatus) },
      { key: 'from', label: 'From', type: 'date' },
      { key: 'to', label: 'To', type: 'date' },
    ],
  },
  {
    id: 'ndi-readiness',
    title: 'NDI readiness overview',
    description: 'Domain-level specification and evidence readiness for governance reporting.',
    tower: 'Compliance Operations',
    requiredAnyPermissions: ['ndi_scoring.view', 'ndi_specifications.view'],
    supportedFormats: ['json', 'csv', 'pdf'],
    scheduledPlaceholder: true,
    filters: [{ key: 'domainId', label: 'NDI domain', type: 'text' }],
  },
];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly access: AccessService,
  ) {}

  private async granted(user: AuthUser): Promise<string[]> {
    return this.access.permissionsForRoleCodes(user.roles);
  }

  private canAny(granted: string[], definition: ReportDefinition): boolean {
    return definition.requiredAnyPermissions.some((permission) => this.access.hasPermission(granted, permission));
  }

  private can(granted: string[], permission: string): boolean {
    return this.access.hasPermission(granted, permission);
  }

  async catalog(user: AuthUser) {
    const granted = await this.granted(user);
    return filterDefinitions(DEFINITIONS, granted, (permissions, permission) =>
      this.access.hasPermission(permissions, permission),
    );
  }

  async run(user: AuthUser, reportId: string, filters: ReportFilters = {}): Promise<ReportResult> {
    const definition = DEFINITIONS.find((item) => item.id === reportId);
    if (!definition) throw new NotFoundException('report not found');
    const granted = await this.granted(user);
    if (!this.canAny(granted, definition)) throw new ForbiddenException('report access denied');

    if (definition.id === 'operational-transparency') return this.operationalTransparency(user, filters);
    if (definition.id === 'open-data-workload') return this.openDataWorkload(user, filters);
    if (definition.id === 'foi-sla') return this.foiSla(user, filters);
    if (definition.id === 'ndi-readiness') return this.ndiReadiness(user, filters);
    throw new NotFoundException('report not found');
  }

  async export(user: AuthUser, reportId: string, format: ReportFormat, filters: ReportFilters = {}): Promise<ReportExport> {
    const definition = DEFINITIONS.find((item) => item.id === reportId);
    if (!definition) throw new NotFoundException('report not found');
    if (!definition.supportedFormats.includes(format)) throw new BadRequestException('unsupported report format');
    const result = await this.run(user, reportId, filters);
    const stem = `${reportId}-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'json') {
      return {
        filename: `${stem}.json`,
        contentType: 'application/json',
        body: JSON.stringify(result, null, 2),
      };
    }
    if (format === 'csv') {
      return { filename: `${stem}.csv`, contentType: 'text/csv; charset=utf-8', body: toCsv(result) };
    }
    return { filename: `${stem}.pdf`, contentType: 'application/pdf', body: toSimplePdf(result) };
  }

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

  private async actorPersonId(user: AuthUser): Promise<string | null> {
    const person = await this.prisma.person.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ userId: user.id }, { email: user.email }],
      },
      select: { id: true },
    });
    return person?.id ?? null;
  }

  private async ndiSpecVisibilityWhere(user: AuthUser): Promise<Prisma.NdiSpecificationWhereInput> {
    const scope = await this.scope.resolve(user.roles);
    if (this.isUnrestricted(scope)) return { deletedAt: null, isActive: true };

    const personId = await this.actorPersonId(user);
    const visibility: Prisma.NdiSpecificationWhereInput[] = [
      {
        evidence: {
          some: {
            deletedAt: null,
            OR: [{ submittedBy: user.email }, { reviewedBy: user.email }],
          },
        },
      },
    ];
    if (personId) visibility.push({ ownerPersonId: personId });
    return {
      deletedAt: null,
      isActive: true,
      OR: visibility,
    };
  }

  private async ndiEvidenceVisibilityWhere(user: AuthUser): Promise<Prisma.NdiEvidenceWhereInput> {
    const scope = await this.scope.resolve(user.roles);
    if (this.isUnrestricted(scope)) return { deletedAt: null };

    const personId = await this.actorPersonId(user);
    const visibility: Prisma.NdiEvidenceWhereInput[] = [
      { submittedBy: user.email },
      { reviewedBy: user.email },
    ];
    if (personId) visibility.push({ spec: { ownerPersonId: personId } });
    return {
      deletedAt: null,
      OR: visibility,
    };
  }

  private async visibleAssetIdsForScope(scope: EffectiveScope): Promise<Set<string> | 'all'> {
    if (scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null) return 'all';
    const rows = await this.prisma.dataAsset.findMany({ where: this.assetScopeWhere(scope), select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  private async visibleAssetIds(user: AuthUser): Promise<Set<string> | 'all'> {
    return this.visibleAssetIdsForScope(await this.scope.resolve(user.roles));
  }

  private assetScoped(assetIds: Set<string> | 'all'): Prisma.OpenDataCandidateWhereInput {
    if (assetIds === 'all') return {};
    return assetIds.size ? { assetId: { in: [...assetIds] } } : { id: '__no_visible_report_rows__' };
  }

  private domainBranches(scope: EffectiveScope, assetIds: Set<string> | 'all') {
    const branches: Record<string, unknown>[] = [];
    if (assetIds !== 'all' && assetIds.size > 0) branches.push({ assetId: { in: [...assetIds] } });
    if (scope.orgUnits === 'all' && scope.domains !== 'all' && scope.domains.length > 0) {
      branches.push({ AND: [{ assetId: null }, { domainId: { in: scope.domains } }] });
    }
    return branches;
  }

  private privacyScoped(scope: EffectiveScope, assetIds: Set<string> | 'all'): Prisma.PrivacyDpiaWhereInput {
    if (this.isUnrestricted(scope)) return { deletedAt: null };
    const branches = this.domainBranches(scope, assetIds) as Prisma.PrivacyDpiaWhereInput[];
    return branches.length ? { deletedAt: null, OR: branches } : { deletedAt: null, id: '__no_visible_privacy_report_rows__' };
  }

  private sharingScoped(scope: EffectiveScope, assetIds: Set<string> | 'all'): Prisma.DataSharingRequestWhereInput {
    if (this.isUnrestricted(scope)) return { deletedAt: null };
    const branches = this.domainBranches(scope, assetIds) as Prisma.DataSharingRequestWhereInput[];
    return branches.length ? { deletedAt: null, OR: branches } : { deletedAt: null, id: '__no_visible_sharing_report_rows__' };
  }

  private foiBranches(scope: EffectiveScope, assetIds: Set<string> | 'all'): Prisma.FoiRequestWhereInput[] {
    const branches: Prisma.FoiRequestWhereInput[] = [];
    if (assetIds !== 'all' && assetIds.size > 0) branches.push({ assetId: { in: [...assetIds] } });
    if (scope.orgUnits === 'all' && scope.domains !== 'all' && scope.domains.length > 0) {
      branches.push({ AND: [{ assetId: null }, { dataDomainId: { in: scope.domains } }] });
    }
    return branches;
  }

  private foiScoped(scope: EffectiveScope, assetIds: Set<string> | 'all'): Prisma.FoiRequestWhereInput {
    if (this.isUnrestricted(scope)) return { deletedAt: null };
    const branches = this.foiBranches(scope, assetIds);
    return branches.length ? { deletedAt: null, OR: branches } : { deletedAt: null, id: '__no_visible_foi_report_rows__' };
  }

  private parseFilterDate(value: string | undefined, label: 'from' | 'to'): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new BadRequestException(`Invalid ${label} date filter`);
    }
    if (label === 'to') date.setHours(23, 59, 59, 999);
    return date;
  }

  private dateRange(field: string, filters: ReportFilters): Record<string, unknown> {
    const from = this.parseFilterDate(filters.from, 'from');
    const to = this.parseFilterDate(filters.to, 'to');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('Invalid report date range');
    }
    const range: Record<string, Date> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    return Object.keys(range).length ? { [field]: range } : {};
  }

  private enumFilter<T extends string>(value: string | undefined, allowed: readonly T[], label: string): T | undefined {
    if (!value) return undefined;
    if (!allowed.includes(value as T)) {
      throw new BadRequestException(`Invalid ${label} filter`);
    }
    return value as T;
  }

  private result(id: string, title: string, columns: ReportResult['columns'], rows: ReportRow[], summary: ReportResult['summary']): ReportResult {
    return { id, title, generatedAt: new Date().toISOString(), columns, rows, summary };
  }

  private async operationalTransparency(user: AuthUser, filters: ReportFilters): Promise<ReportResult> {
    const [granted, scope] = await Promise.all([this.granted(user), this.scope.resolve(user.roles)]);
    const assetIds = await this.visibleAssetIdsForScope(scope);
    const canOpenData = this.can(granted, 'open_data_candidates.view');
    const canFoi = this.can(granted, 'foi_requests.view');
    const canPrivacy = this.can(granted, 'privacy_operations.view');
    const canSharing = this.can(granted, 'data_sharing_requests.view');
    const openDataWhere: Prisma.OpenDataCandidateWhereInput = {
      deletedAt: null,
      ...this.assetScoped(assetIds),
      ...this.dateRange('createdAt', filters),
    };
    const foiWhere: Prisma.FoiRequestWhereInput = { ...this.foiScoped(scope, assetIds), ...this.dateRange('receivedAt', filters) };
    const [openDataRows, foiRows, privacyRows, sharingRows] = await Promise.all([
      canOpenData
        ? this.prisma.openDataCandidate.findMany({ where: openDataWhere, select: { status: true } })
        : Promise.resolve([] as OpenDataReportRow[]),
      canFoi
        ? this.prisma.foiRequest.findMany({ where: foiWhere, select: { status: true, dueAt: true } })
        : Promise.resolve([] as FoiReportRow[]),
      canPrivacy
        ? this.prisma.privacyDpia.findMany({
            where: { ...this.privacyScoped(scope, assetIds), ...this.dateRange('createdAt', filters) },
            select: { status: true, riskLevel: true },
          })
        : Promise.resolve([] as PrivacyReportRow[]),
      canSharing
        ? this.prisma.dataSharingRequest.findMany({
            where: { ...this.sharingScoped(scope, assetIds), ...this.dateRange('createdAt', filters) },
            select: { status: true, riskScore: true },
          })
        : Promise.resolve([] as SharingReportRow[]),
    ]);
    const openDataActive: OpenDataCandidateStatus[] = [
      OpenDataCandidateStatus.assessment,
      OpenDataCandidateStatus.under_review,
      OpenDataCandidateStatus.approved,
    ];
    const foiActive: FoiRequestStatus[] = [
      FoiRequestStatus.registered,
      FoiRequestStatus.under_review,
      FoiRequestStatus.decision_due,
      FoiRequestStatus.extended,
    ];
    const foiComplete: FoiRequestStatus[] = [FoiRequestStatus.disclosed, FoiRequestStatus.closed];
    const privacyActive: PrivacyWorkStatus[] = [
      PrivacyWorkStatus.draft,
      PrivacyWorkStatus.under_review,
      PrivacyWorkStatus.action_required,
    ];
    const privacyComplete: PrivacyWorkStatus[] = [PrivacyWorkStatus.approved, PrivacyWorkStatus.closed];
    const sharingActive: DataSharingRequestStatus[] = [
      DataSharingRequestStatus.submitted,
      DataSharingRequestStatus.under_review,
      DataSharingRequestStatus.approved,
    ];
    const rows: ReportRow[] = [];
    if (canOpenData) {
      rows.push({
        area: 'Open Data',
        total: openDataRows.length,
        active: openDataRows.filter((row) => openDataActive.includes(row.status)).length,
        complete: openDataRows.filter((row) => row.status === OpenDataCandidateStatus.published).length,
        risk: openDataRows.filter((row) => row.status === OpenDataCandidateStatus.rejected).length,
      });
    }
    if (canFoi) {
      rows.push({
        area: 'FOI',
        total: foiRows.length,
        active: foiRows.filter((row) => foiActive.includes(row.status)).length,
        complete: foiRows.filter((row) => foiComplete.includes(row.status)).length,
        risk: foiRows.filter((row) => foiSlaStatus(row.dueAt, row.status) === 'overdue').length,
      });
    }
    if (canPrivacy) {
      rows.push({
        area: 'Privacy',
        total: privacyRows.length,
        active: privacyRows.filter((row) => privacyActive.includes(row.status)).length,
        complete: privacyRows.filter((row) => privacyComplete.includes(row.status)).length,
        risk: privacyRows.filter((row) => ['high', 'critical'].includes(row.riskLevel)).length,
      });
    }
    if (canSharing) {
      rows.push({
        area: 'Data Sharing',
        total: sharingRows.length,
        active: sharingRows.filter((row) => sharingActive.includes(row.status)).length,
        complete: sharingRows.filter((row) => row.status === DataSharingRequestStatus.agreement_active).length,
        risk: sharingRows.filter((row) => row.riskScore >= 70).length,
      });
    }
    return this.result(
      'operational-transparency',
      'Transparency operations',
      [
        { key: 'area', label: 'Area' },
        { key: 'total', label: 'Total' },
        { key: 'active', label: 'Active' },
        { key: 'complete', label: 'Complete' },
        { key: 'risk', label: 'Risk' },
      ],
      rows,
      { rows: rows.length, risks: rows.reduce((sum, row) => sum + Number(row.risk), 0) },
    );
  }

  private async openDataWorkload(user: AuthUser, filters: ReportFilters): Promise<ReportResult> {
    const assetIds = await this.visibleAssetIds(user);
    const where: Prisma.OpenDataCandidateWhereInput = {
      deletedAt: null,
      ...this.assetScoped(assetIds),
      ...(filters.status
        ? { status: this.enumFilter(filters.status, Object.values(OpenDataCandidateStatus), 'open data status') }
        : {}),
      ...this.dateRange('createdAt', filters),
    };
    const rows = await this.prisma.openDataCandidate.findMany({
      where,
      select: {
        code: true,
        titleEn: true,
        status: true,
        eligibilityScore: true,
        nextReviewAt: true,
        asset: { select: { code: true, nameEn: true } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 500,
    });
    return this.result(
      'open-data-workload',
      'Open Data workload',
      [
        { key: 'code', label: 'Code' },
        { key: 'title', label: 'Title' },
        { key: 'asset', label: 'Asset' },
        { key: 'status', label: 'Status' },
        { key: 'eligibility', label: 'Eligibility' },
        { key: 'nextReview', label: 'Next review' },
      ],
      rows.map((row) => ({
        code: row.code,
        title: row.titleEn,
        asset: row.asset?.code ?? '-',
        status: row.status,
        eligibility: row.eligibilityScore,
        nextReview: row.nextReviewAt?.toISOString().slice(0, 10) ?? '-',
      })),
      { total: rows.length, published: rows.filter((row) => row.status === OpenDataCandidateStatus.published).length },
    );
  }

  private async foiSla(user: AuthUser, filters: ReportFilters): Promise<ReportResult> {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIdsForScope(scope);
    const where: Prisma.FoiRequestWhereInput = {
      ...this.foiScoped(scope, assetIds),
      ...(filters.status
        ? { status: this.enumFilter(filters.status, Object.values(FoiRequestStatus), 'FOI status') }
        : {}),
      ...this.dateRange('receivedAt', filters),
    };
    const rows = await this.prisma.foiRequest.findMany({
      where,
      select: {
        requestNumber: true,
        requesterName: true,
        subject: true,
        status: true,
        dueAt: true,
        receivedAt: true,
        disclosures: { select: { id: true } },
        appeals: { select: { id: true } },
      },
      orderBy: [{ dueAt: 'asc' }],
      take: 500,
    });
    const mapped = rows.map((row) => ({
      requestNumber: row.requestNumber,
      requester: row.requesterName,
      subject: row.subject,
      status: row.status,
      sla: foiSlaStatus(row.dueAt, row.status),
      dueAt: row.dueAt.toISOString().slice(0, 10),
      disclosures: row.disclosures.length,
      appeals: row.appeals.length,
    }));
    return this.result(
      'foi-sla',
      'FOI SLA and disclosure',
      [
        { key: 'requestNumber', label: 'Request' },
        { key: 'requester', label: 'Requester' },
        { key: 'subject', label: 'Subject' },
        { key: 'status', label: 'Status' },
        { key: 'sla', label: 'SLA' },
        { key: 'dueAt', label: 'Due' },
        { key: 'disclosures', label: 'Disclosures' },
        { key: 'appeals', label: 'Appeals' },
      ],
      mapped,
      { total: mapped.length, overdue: mapped.filter((row) => row.sla === 'overdue').length },
    );
  }

  private async ndiReadiness(user: AuthUser, filters: ReportFilters): Promise<ReportResult> {
    const scope = await this.scope.resolve(user.roles);
    const unrestricted = this.isUnrestricted(scope);
    const [specWhere, evidenceWhere] = await Promise.all([
      this.ndiSpecVisibilityWhere(user),
      this.ndiEvidenceVisibilityWhere(user),
    ]);
    const domains = await this.prisma.ndiDomain.findMany({
      where: filters.domainId ? { id: filters.domainId } : undefined,
      orderBy: { sortOrder: 'asc' },
      include: {
        specifications: {
          where: specWhere,
          select: {
            id: true,
            code: true,
            evidence: { where: evidenceWhere, select: { status: true } },
          },
        },
      },
    });
    const visibleDomains = unrestricted ? domains : domains.filter((domain) => domain.specifications.length > 0);
    const rows = visibleDomains.map((domain) => {
      const specs = domain.specifications;
      const approved = specs.filter((spec) => spec.evidence.some((evidence) => evidence.status === NdiEvidenceStatus.approved)).length;
      return {
        domain: domain.shortCode ?? domain.code,
        name: domain.nameEn,
        specifications: specs.length,
        approvedEvidence: approved,
        readiness: specs.length ? Math.round((approved / specs.length) * 100) : 0,
        gaps: specs.length - approved,
      };
    });
    return this.result(
      'ndi-readiness',
      'NDI readiness overview',
      [
        { key: 'domain', label: 'Domain' },
        { key: 'name', label: 'Name' },
        { key: 'specifications', label: 'Specifications' },
        { key: 'approvedEvidence', label: 'Approved evidence' },
        { key: 'readiness', label: 'Readiness' },
        { key: 'gaps', label: 'Gaps' },
      ],
      rows,
      { domains: rows.length, avgReadiness: rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.readiness), 0) / rows.length) : 0 },
    );
  }
}
