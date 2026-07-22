import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CaseStatus,
  DataQualityDimension,
  DataQualityIssueStatus,
  DataQualityPriority,
  DataQualityRcaTemplate,
  DataQualityRuleStatus,
  DataQualityScoreLevel,
  DataQualitySeverity,
  DataQualitySlaStage,
  DataQualitySlaStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService, EffectiveScope } from '../access/scope.service';
import { WorkflowService } from '../workflow/workflow.service';
import { parseCsv } from '../common/csv';
import { boundedFirstPageParams, parsePageParams, toPaged } from '../common/pagination';
import {
  CloseDataQualityIssueDto,
  CreateDataQualityIssueDto,
  CreateDataQualityRuleDto,
  DQ_DIMENSIONS,
  DQ_PRIORITIES,
  DQ_RULE_STATUSES,
  DQ_SEVERITIES,
  DQ_STATUSES,
  DataQualityRuleTransitionDto,
  DqDimension,
  DqPriority,
  DqRuleStatus,
  DqSeverity,
  DqStatus,
  ImportDataQualityProfileDto,
  RunDataQualityProfileDto,
  UpdateDataQualityIssueDto,
  UpdateDataQualityRuleDto,
  UpsertDataQualityRcaDto,
} from './data-quality.dto';
import {
  currentSlaStage,
  DQ_DIMENSION_ORDER,
  dueAtForStage,
  isSlaBreached,
  priorityForSeverity,
  profileScore,
  slaDueDates,
} from './data-quality.logic';
import {
  DATA_QUALITY_IMPORT_API_MESSAGES,
  DATA_QUALITY_IMPORT_DEFAULTS,
  DATA_QUALITY_IMPORT_ROW_KEYS,
  DataQualityImportRowError,
} from './data-quality.config';
import {
  profileCsvRows,
  ProfilingIssueRecommendation,
  ProfilingRuleRecommendation,
  RelatedProfilingDataset,
} from './data-quality.profiling';

const DQ_STEWARD_CODE = 'dq_steward';
const RULE_PRIORITY = ['domain', 'capability', 'subject', 'org_unit', 'system'] as const;
type PrismaWriter = PrismaService | Prisma.TransactionClient;

function parseImportEnum<T extends string>(
  raw: string | undefined,
  fallback: T,
  allowed: readonly T[],
  normalize: (value: string) => string = (value) => value,
): T | null {
  const value = normalize((raw ?? fallback).trim() || fallback);
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function parseFilterEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  label: string,
  normalize: (value: string) => string = (value) => value,
): T | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const value = normalize(trimmed);
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new BadRequestException(`Invalid ${label}: ${trimmed}`);
}

const issueInclude = {
  asset: {
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      classification: { select: { id: true, code: true, nameEn: true, nameAr: true, color: true } },
    },
  },
  responsiblePerson: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true, userId: true } },
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
  evidence: { orderBy: { createdAt: 'desc' as const }, take: 6 },
  rcaRecords: { orderBy: { updatedAt: 'desc' as const }, take: 2 },
  slaBreaches: { orderBy: { createdAt: 'desc' as const }, take: 4 },
  scores: { orderBy: { measuredAt: 'desc' as const }, take: 3 },
};

const ruleInclude = {
  asset: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  ownerPerson: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true } },
  versions: { orderBy: { version: 'desc' as const }, take: 3 },
  scores: { orderBy: { measuredAt: 'desc' as const }, take: 3 },
};

const profileInclude = {
  asset: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  columns: { orderBy: { anomalyCount: 'desc' as const } },
};

@Injectable()
export class DataQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly workflow?: WorkflowService,
  ) {}

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

  private async visibleAssetIds(roleCodes: string[]): Promise<Set<string> | 'all'> {
    const scope = await this.scope.resolve(roleCodes);
    const unrestricted =
      scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
    if (unrestricted) return 'all';
    const assets = await this.prisma.dataAsset.findMany({
      where: { AND: [{ deletedAt: null }, this.assetScopeWhere(scope)] },
      select: { id: true },
    });
    return new Set(assets.map((a) => a.id));
  }

  private issueScopeWhere(assetIds: Set<string> | 'all', actorEmail?: string): Record<string, unknown> {
    if (assetIds === 'all') return {};
    const or: Record<string, unknown>[] = [];
    if (assetIds.size > 0) or.push({ assetId: { in: [...assetIds] } });
    if (actorEmail) {
      or.push({ AND: [{ assetId: null }, { createdBy: actorEmail }] });
    }
    return or.length ? { OR: or } : { id: { equals: '__no_visible_dq_issues__' } };
  }

  private isUnrestricted(scope: EffectiveScope): boolean {
    return scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
  }

  private qualityRecordScopeWhere<T extends object>(scope: EffectiveScope, assetIds: Set<string> | 'all'): T {
    if (this.isUnrestricted(scope)) return {} as T;
    const or: Record<string, unknown>[] = [];
    if (assetIds !== 'all' && assetIds.size > 0) {
      or.push({ assetId: { in: [...assetIds] } });
    }
    if (scope.orgUnits === 'all' && scope.maxClassRank == null && scope.domains !== 'all') {
      or.push({ domainId: { in: scope.domains } });
    }
    return (or.length ? { OR: or } : { id: { equals: '__no_visible_scope__' } }) as T;
  }

  private async assertQualityRecordScope(
    roleCodes: string[],
    target: { assetId?: string | null; domainId?: string | null },
  ): Promise<void> {
    const scope = await this.scope.resolve(roleCodes);
    if (target.assetId) {
      await this.assertAssetVisible(roleCodes, target.assetId);
    }
    await this.assertDomain(target.domainId);
    if (this.isUnrestricted(scope)) return;
    if (target.domainId && scope.domains !== 'all' && !scope.domains.includes(target.domainId)) {
      throw new BadRequestException('Data quality domain is outside your data scope');
    }
    if (target.assetId) return;
    if (
      target.domainId &&
      scope.orgUnits === 'all' &&
      scope.maxClassRank == null &&
      scope.domains !== 'all' &&
      scope.domains.includes(target.domainId)
    ) {
      return;
    }
    throw new BadRequestException('Data quality record is outside your data scope');
  }

  private async nextIssueCode(): Promise<string> {
    const count = await this.prisma.dataQualityIssue.count();
    for (let i = 1; i <= 50; i++) {
      const code = `DQI-${String(count + i).padStart(4, '0')}`;
      const exists = await this.prisma.dataQualityIssue.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `DQI-${Date.now()}`;
  }

  private async nextRuleCode(): Promise<string> {
    const count = await this.prisma.dataQualityRule.count();
    for (let i = 1; i <= 50; i++) {
      const code = `DQR-${String(count + i).padStart(4, '0')}`;
      const exists = await this.prisma.dataQualityRule.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `DQR-${Date.now()}`;
  }

  private async nextCaseCode(client: PrismaWriter, issueCode: string): Promise<string> {
    const preferred = `WFC-${issueCode}`;
    const existing = await client.workflowCase.findUnique({ where: { code: preferred } });
    if (!existing) return preferred;
    return `WFC-${issueCode}-${Date.now()}`;
  }

  private async assertDomain(id: string | null | undefined): Promise<void> {
    if (!id) return;
    const domain = await this.prisma.dataDomain.findFirst({ where: { id, deletedAt: null } });
    if (!domain) throw new BadRequestException('Data domain not found');
  }

  private async assertPerson(id: string | null | undefined): Promise<void> {
    if (!id) return;
    const person = await this.prisma.person.findFirst({ where: { id, deletedAt: null } });
    if (!person) throw new BadRequestException('Responsible person not found');
  }

  private issueSlaWhere(assetIds: Set<string> | 'all', actorEmail?: string) {
    return { AND: [{ deletedAt: null }, this.issueScopeWhere(assetIds, actorEmail)] };
  }

  private async refreshSlaBreaches(roleCodes: string[], actorEmail?: string): Promise<number> {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const issues = await this.prisma.dataQualityIssue.findMany({
      where: this.issueSlaWhere(assetIds, actorEmail),
      select: {
        id: true,
        status: true,
        triageDueAt: true,
        remediationDueAt: true,
        validationDueAt: true,
        dueDate: true,
      },
    });
    const now = new Date();
    let created = 0;
    for (const issue of issues) {
      if (!isSlaBreached(issue, now)) continue;
      const stage = currentSlaStage(issue.status);
      const dueAt = dueAtForStage(issue, stage);
      if (!stage || !dueAt) continue;
      const existing = await this.prisma.dataQualitySlaBreach.findFirst({
        where: { issueId: issue.id, stage, status: { in: [DataQualitySlaStatus.active, DataQualitySlaStatus.breached] } },
      });
      if (existing) continue;
      await this.prisma.dataQualitySlaBreach.create({
        data: {
          issueId: issue.id,
          stage,
          status: DataQualitySlaStatus.breached,
          dueAt,
          breachedAt: now,
          note: 'SLA timer breached for current remediation stage.',
        },
      });
      created++;
    }
    return created;
  }

  async refreshSlaBreachMarkers(roleCodes: string[], actorEmail?: string): Promise<{ created: number }> {
    return { created: await this.refreshSlaBreaches(roleCodes, actorEmail) };
  }

  async summary(roleCodes: string[], actorEmail?: string) {
    const [scope, assetIds] = await Promise.all([this.scope.resolve(roleCodes), this.visibleAssetIds(roleCodes)]);
    const scoped = this.issueScopeWhere(assetIds, actorEmail);
    const base = { AND: [{ deletedAt: null }, scoped] };
    const recordScope = this.qualityRecordScopeWhere<Prisma.DataQualityRuleWhereInput>(scope, assetIds);
    const scoreWhere =
      this.qualityRecordScopeWhere<Prisma.DataQualityScoreWhereInput>(scope, assetIds);
    const profileWhere =
      this.qualityRecordScopeWhere<Prisma.DataQualityProfileWhereInput>(scope, assetIds);
    const [total, open, critical, overdue, closed, rules, deployedRules, profiles, breachedSla, scoreRows] = await Promise.all([
      this.prisma.dataQualityIssue.count({ where: base }),
      this.prisma.dataQualityIssue.count({
        where: { AND: [{ deletedAt: null }, scoped, { status: { in: ['open', 'triaged', 'in_progress'] } }] },
      }),
      this.prisma.dataQualityIssue.count({
        where: { AND: [{ deletedAt: null }, scoped, { severity: DataQualitySeverity.critical }] },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          AND: [
            { deletedAt: null },
            scoped,
            { status: { in: ['open', 'triaged', 'in_progress', 'resolved'] } },
            { dueDate: { lt: new Date() } },
          ],
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: { AND: [{ deletedAt: null }, scoped, { status: DataQualityIssueStatus.closed }] },
      }),
      this.prisma.dataQualityRule.count({ where: { AND: [{ deletedAt: null }, recordScope] } }),
      this.prisma.dataQualityRule.count({ where: { AND: [{ deletedAt: null, status: DataQualityRuleStatus.deployed }, recordScope] } }),
      this.prisma.dataQualityProfile.count({ where: profileWhere }),
      this.prisma.dataQualityIssue.count({
        where: { AND: [{ deletedAt: null }, scoped, { slaBreaches: { some: { status: DataQualitySlaStatus.breached } } }] },
      }),
      this.prisma.dataQualityScore.findMany({
        where: scoreWhere,
        select: { score: true },
        orderBy: { measuredAt: 'desc' },
        take: 20,
      }),
    ]);
    const qualityScore = scoreRows.length
      ? Math.round(scoreRows.reduce((sum, row) => sum + row.score, 0) / scoreRows.length)
      : Math.max(0, 100 - open * 5 - critical * 15 - overdue * 10);
    return {
      total,
      open,
      critical,
      overdue,
      closed,
      breachedSla,
      rules,
      deployedRules,
      profiles,
      qualityScore,
      closureRate: total ? Math.round((closed / total) * 100) : 0,
    };
  }

  async list(
    roleCodes: string[],
    filters: { search?: string; status?: string; severity?: string; dimension?: string; assetId?: string },
    page?: string | number,
    pageSize?: string | number,
    actorEmail?: string,
  ) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const and: Record<string, unknown>[] = [{ deletedAt: null }, this.issueScopeWhere(assetIds, actorEmail)];
    const status = parseFilterEnum<DqStatus>(filters.status, DQ_STATUSES, 'data quality status', (value) => value.toLowerCase());
    const severity = parseFilterEnum<DqSeverity>(filters.severity, DQ_SEVERITIES, 'data quality severity', (value) => value.toLowerCase());
    const dimension = parseFilterEnum<DqDimension>(filters.dimension, DQ_DIMENSIONS, 'data quality dimension', (value) => value.toLowerCase());
    if (status) and.push({ status });
    if (severity) and.push({ severity });
    if (dimension) and.push({ dimension });
    if (filters.assetId) and.push({ assetId: filters.assetId });
    if (filters.search) {
      const term = filters.search.trim();
      and.push({
        OR: [
          { code: { contains: term, mode: 'insensitive' } },
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    const where = { AND: and };
    const params = parsePageParams(page, pageSize);
    const query = {
      where,
      include: issueInclude,
      orderBy: [{ dueDate: 'asc' as const }, { createdAt: 'desc' as const }],
    };
    if (!params) {
      const bounded = boundedFirstPageParams(pageSize);
      return this.prisma.dataQualityIssue.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const [rows, total] = await Promise.all([
      this.prisma.dataQualityIssue.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.dataQualityIssue.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async get(roleCodes: string[], id: string, actorEmail?: string) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const issue = await this.prisma.dataQualityIssue.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.issueScopeWhere(assetIds, actorEmail)] },
      include: issueInclude,
    });
    if (!issue) throw new NotFoundException('data quality issue not found');
    return issue;
  }

  private async assertAssetVisible(roleCodes: string[], assetId: string): Promise<void> {
    const assetIds = await this.visibleAssetIds(roleCodes);
    if (assetIds !== 'all' && !assetIds.has(assetId)) {
      throw new BadRequestException('Linked asset is outside your data scope');
    }
    const asset = await this.prisma.dataAsset.findFirst({ where: { id: assetId, deletedAt: null } });
    if (!asset) throw new BadRequestException('Linked data asset not found');
  }

  private async resolveResponsible(assetId?: string | null, explicitPersonId?: string | null) {
    if (explicitPersonId) {
      const person = await this.prisma.person.findFirst({ where: { id: explicitPersonId, deletedAt: null } });
      if (!person) throw new BadRequestException('Responsible person not found');
      return person;
    }
    if (!assetId) return null;
    const dqRoleType = await this.prisma.roleType.findFirst({
      where: { code: DQ_STEWARD_CODE, deletedAt: null },
    });
    if (!dqRoleType) return null;
    const now = new Date();
    const direct = await this.prisma.stewardshipAssignment.findFirst({
      where: {
        targetType: 'asset',
        targetId: assetId,
        roleTypeId: dqRoleType.id,
        isPrimary: true,
        isActive: true,
        approvalStatus: 'approved',
        deletedAt: null,
        effectiveDate: { lte: now },
        OR: [{ expiryDate: null }, { expiryDate: { gte: now } }],
      },
      include: { person: true },
      orderBy: { effectiveDate: 'desc' },
    });
    if (direct) return direct.person;

    const asset = await this.prisma.dataAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: { subjects: true },
    });
    if (!asset) return null;
    const dimValues: Record<string, string[]> = {
      domain: asset.domainId ? [asset.domainId] : [],
      capability: asset.capabilityId ? [asset.capabilityId] : [],
      subject: asset.subjects.map((s) => s.dataSubjectId),
      org_unit: asset.orgUnitId ? [asset.orgUnitId] : [],
      system: asset.systemId ? [asset.systemId] : [],
    };
    for (const scope of RULE_PRIORITY) {
      const ids = dimValues[scope] ?? [];
      if (!ids.length) continue;
      const rule = await this.prisma.assignmentRule.findFirst({
        where: {
          roleTypeId: dqRoleType.id,
          scopeType: scope,
          refId: { in: ids },
          isActive: true,
          deletedAt: null,
        },
        include: { person: true },
        orderBy: { priority: 'asc' },
      });
      if (rule) return rule.person;
    }
    return null;
  }

  async create(roleCodes: string[], dto: CreateDataQualityIssueDto, actor: string) {
    if (dto.assetId) await this.assertAssetVisible(roleCodes, dto.assetId);
    const responsible = await this.resolveResponsible(dto.assetId, dto.responsiblePersonId);
    const code = dto.code?.trim() || (await this.nextIssueCode());
    const severity = (dto.severity ?? 'medium') as DataQualitySeverity;
    const priority = (dto.priority as DataQualityPriority | undefined) ?? priorityForSeverity(severity);
    const detectedAt = new Date();
    const dueDates = slaDueDates(detectedAt, priority);
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.dataQualityIssue.create({
        data: {
          code,
          title: dto.title,
          description: dto.description ?? null,
          severity,
          dimension: (dto.dimension ?? 'completeness') as DataQualityDimension,
          priority,
          status: responsible ? DataQualityIssueStatus.triaged : DataQualityIssueStatus.open,
          source: dto.source ?? 'manual',
          assetId: dto.assetId ?? null,
          responsiblePersonId: responsible?.id ?? null,
          detectedAt,
          dueDate,
          ...dueDates,
          createdBy: actor,
        },
      });
      await this.writeEvidence(tx, issue.id, 'issue.created', actor, 'Issue registered and ready for triage.');
      await this.createWorkflow(tx, issue.id, roleCodes, actor);
      await this.writeAudit(tx, actor, 'data_quality_issue.create', 'data_quality_issue', issue.id, {
        code,
        assetId: dto.assetId ?? null,
        responsiblePersonId: responsible?.id ?? null,
        priority,
      });
      return tx.dataQualityIssue.findUnique({ where: { id: issue.id }, include: issueInclude });
    });
  }

  async update(id: string, roleCodes: string[], dto: UpdateDataQualityIssueDto, actor: string) {
    const existing = await this.get(roleCodes, id, actor);
    if (dto.status === DataQualityIssueStatus.closed) {
      throw new BadRequestException('Use the close action to close a data quality issue');
    }
    if (dto.status === DataQualityIssueStatus.cancelled) {
      throw new BadRequestException('Use the delete action to cancel a data quality issue');
    }
    if (dto.assetId) await this.assertAssetVisible(roleCodes, dto.assetId);
    const responsible = dto.responsiblePersonId !== undefined
      ? await this.resolveResponsible(dto.assetId ?? existing.assetId, dto.responsiblePersonId)
      : undefined;
    const nextPriority =
      (dto.priority as DataQualityPriority | undefined) ??
      (dto.severity ? priorityForSeverity(dto.severity as DataQualitySeverity) : undefined);
    const nextDueDates = nextPriority ? slaDueDates(existing.detectedAt, nextPriority) : {};
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.dataQualityIssue.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          severity: dto.severity as DataQualitySeverity | undefined,
          priority: nextPriority,
          dimension: dto.dimension as DataQualityDimension | undefined,
          status: dto.status as DataQualityIssueStatus | undefined,
          assetId: dto.assetId,
          responsiblePersonId: responsible === undefined ? undefined : responsible?.id ?? null,
          dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
          ...nextDueDates,
        },
        include: issueInclude,
      });
      await this.writeEvidence(tx, id, 'issue.updated', actor, 'Issue details updated.');
      await this.writeAudit(tx, actor, 'data_quality_issue.update', 'data_quality_issue', id);
      return issue;
    });
  }

  async close(id: string, roleCodes: string[], dto: CloseDataQualityIssueDto, actor: string) {
    const existing = await this.get(roleCodes, id, actor);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.dataQualityIssue.update({
        where: { id },
        data: {
          status: DataQualityIssueStatus.closed,
          resolutionSummary: dto.resolutionSummary,
          closedAt: now,
        },
        include: issueInclude,
      });
      await this.writeEvidence(tx, id, 'issue.closed', actor, dto.resolutionSummary);
      await tx.dataQualitySlaBreach.updateMany({
        where: { issueId: id, status: { in: [DataQualitySlaStatus.active, DataQualitySlaStatus.breached] } },
        data: { status: DataQualitySlaStatus.completed },
      });
      if (existing.workflowCaseId) {
        if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
        await this.workflow.recordDomainCaseProgress({
          caseId: existing.workflowCaseId,
          roleCodes,
          actor,
          targetStatus: CaseStatus.closed,
          eventAction: 'data_quality_issue.closed',
          comment: dto.resolutionSummary,
          completeOpenTasks: true,
        }, tx);
      } else {
        await this.writeAudit(tx, actor, 'workflow_case.not_linked', 'data_quality_issue', id, {
          reason: 'Data quality issue closed without a linked workflow case',
        });
      }
      await this.writeAudit(tx, actor, 'data_quality_issue.close', 'data_quality_issue', id);
      return issue;
    });
  }

  async remove(id: string, roleCodes: string[], actor: string) {
    await this.get(roleCodes, id, actor);
    await this.prisma.$transaction(async (tx) => {
      await tx.dataQualityIssue.update({ where: { id }, data: { deletedAt: new Date(), status: 'cancelled' } });
      await this.writeAudit(tx, actor, 'data_quality_issue.delete', 'data_quality_issue', id);
    });
    return { success: true };
  }

  private async createWorkflow(
    client: PrismaWriter,
    issueId: string,
    roleCodes: string[],
    actor: string,
  ): Promise<void> {
    const issue = await client.dataQualityIssue.findUnique({
      where: { id: issueId },
      include: { responsiblePerson: true },
    });
    if (!issue || issue.workflowCaseId) return;
    if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
    const wfCase = await this.workflow.openRoutedCase(
      {
        roleCodes,
        actor,
        title: `Resolve DQ issue: ${issue.title}`,
        description: issue.description,
        type: 'data_quality_issue',
        status: CaseStatus.submitted,
        assetId: issue.assetId,
        preferredCode: await this.nextCaseCode(client, issue.code),
        initialAssigneeUserId: issue.responsiblePerson?.userId ?? null,
        initialDueDate: issue.dueDate,
      },
      client as Prisma.TransactionClient,
    );
    await client.dataQualityIssue.update({
      where: { id: issueId },
      data: { workflowCaseId: wfCase.id },
    });
    await this.writeEvidence(client, issueId, 'workflow.created', actor, `Workflow case ${wfCase.code} opened.`);
  }

  private async writeEvidence(client: PrismaWriter, issueId: string, action: string, actor: string, note?: string) {
    return client.dataQualityIssueEvidence.create({
      data: { issueId, action, actor, note: note ?? null },
    });
  }

  private async writeAudit(
    client: PrismaWriter,
    actor: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.log({
      actor,
      action,
      entityType,
      entityId,
      metadata: metadata ?? null,
    }, client);
  }

  async scorecard(roleCodes: string[]) {
    const [scope, assetIds] = await Promise.all([this.scope.resolve(roleCodes), this.visibleAssetIds(roleCodes)]);
    const scoped = this.issueScopeWhere(assetIds);
    const issueWhere = { AND: [{ deletedAt: null }, scoped] };
    const scoreWhere = this.qualityRecordScopeWhere<Prisma.DataQualityScoreWhereInput>(scope, assetIds);
    const profileWhere = this.qualityRecordScopeWhere<Prisma.DataQualityProfileWhereInput>(scope, assetIds);
    const ruleWhere = { AND: [{ deletedAt: null }, this.qualityRecordScopeWhere<Prisma.DataQualityRuleWhereInput>(scope, assetIds)] };
    const [issues, scores, rules, profiles] = await Promise.all([
      this.prisma.dataQualityIssue.findMany({
        where: issueWhere,
        select: {
          dimension: true,
          status: true,
          severity: true,
          asset: {
            select: { domain: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
          },
        },
      }),
      this.prisma.dataQualityScore.findMany({
        where: scoreWhere,
        include: {
          asset: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          rule: { select: { id: true, code: true, nameEn: true, nameAr: true, status: true } },
        },
        orderBy: { measuredAt: 'desc' },
        take: 200,
      }),
      this.prisma.dataQualityRule.findMany({
        where: ruleWhere,
        include: ruleInclude,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
      this.prisma.dataQualityProfile.findMany({
        where: profileWhere,
        include: profileInclude,
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    const dimensionRows = DQ_DIMENSION_ORDER.map((dimension) => {
      const dimensionScores = scores.filter((score) => score.dimension === dimension);
      const dimensionIssues = issues.filter((issue) => issue.dimension === dimension);
      const openIssues = dimensionIssues.filter((issue) => issue.status !== DataQualityIssueStatus.closed).length;
      const critical = dimensionIssues.filter((issue) => issue.severity === DataQualitySeverity.critical).length;
      const score = dimensionScores.length
        ? Math.round(dimensionScores.reduce((sum, row) => sum + row.score, 0) / dimensionScores.length)
        : Math.max(0, 100 - openIssues * 8 - critical * 12);
      return {
        dimension,
        score,
        openIssues,
        critical,
        rules: rules.filter((rule) => rule.dimension === dimension).length,
      };
    });

    const domainMap = new Map<string, { id: string; code: string; nameEn: string; nameAr: string; scores: number[]; issues: number }>();
    for (const score of scores) {
      if (!score.domain) continue;
      const current = domainMap.get(score.domain.id) ?? {
        id: score.domain.id,
        code: score.domain.code,
        nameEn: score.domain.nameEn,
        nameAr: score.domain.nameAr,
        scores: [],
        issues: 0,
      };
      current.scores.push(score.score);
      domainMap.set(score.domain.id, current);
    }
    for (const issue of issues) {
      const domain = issue.asset?.domain;
      if (!domain) continue;
      const current = domainMap.get(domain.id) ?? {
        id: domain.id,
        code: domain.code,
        nameEn: domain.nameEn,
        nameAr: domain.nameAr,
        scores: [],
        issues: 0,
      };
      if (issue.status !== DataQualityIssueStatus.closed) current.issues++;
      domainMap.set(domain.id, current);
    }
    const domains = [...domainMap.values()].map((domain) => ({
      id: domain.id,
      code: domain.code,
      nameEn: domain.nameEn,
      nameAr: domain.nameAr,
      score: domain.scores.length
        ? Math.round(domain.scores.reduce((sum, score) => sum + score, 0) / domain.scores.length)
        : Math.max(0, 100 - domain.issues * 8),
      openIssues: domain.issues,
    }));
    const overallScore = dimensionRows.length
      ? Math.round(dimensionRows.reduce((sum, row) => sum + row.score, 0) / dimensionRows.length)
      : 0;
    return {
      overallScore,
      dimensions: dimensionRows,
      domains,
      rules,
      profiles,
      scoreRows: scores.slice(0, 20),
    };
  }

  async listRules(
    roleCodes: string[],
    filters: { search?: string; status?: string; dimension?: string },
    page?: string | number,
    pageSize?: string | number,
  ) {
    const [scope, assetIds] = await Promise.all([this.scope.resolve(roleCodes), this.visibleAssetIds(roleCodes)]);
    const and: Record<string, unknown>[] = [
      { deletedAt: null },
      this.qualityRecordScopeWhere<Prisma.DataQualityRuleWhereInput>(scope, assetIds),
    ];
    const status = parseFilterEnum<DqRuleStatus>(filters.status, DQ_RULE_STATUSES, 'data quality rule status', (value) => value.toLowerCase());
    const dimension = parseFilterEnum<DqDimension>(filters.dimension, DQ_DIMENSIONS, 'data quality rule dimension', (value) => value.toLowerCase());
    if (status) and.push({ status });
    if (dimension) and.push({ dimension });
    if (filters.search) {
      const term = filters.search.trim();
      and.push({
        OR: [
          { code: { contains: term, mode: 'insensitive' } },
          { nameEn: { contains: term, mode: 'insensitive' } },
          { nameAr: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    const where = { AND: and };
    const params = parsePageParams(page, pageSize);
    const query = { where, include: ruleInclude, orderBy: [{ status: 'asc' as const }, { updatedAt: 'desc' as const }] };
    if (!params) {
      const bounded = boundedFirstPageParams(pageSize);
      return this.prisma.dataQualityRule.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const [rows, total] = await Promise.all([
      this.prisma.dataQualityRule.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.dataQualityRule.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async createRule(roleCodes: string[], dto: CreateDataQualityRuleDto, actor: string) {
    await this.assertQualityRecordScope(roleCodes, { assetId: dto.assetId, domainId: dto.domainId });
    await this.assertPerson(dto.ownerPersonId);
    const code = dto.code?.trim() || (await this.nextRuleCode());
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.dataQualityRule.create({
        data: {
          code,
          nameEn: dto.nameEn,
          nameAr: dto.nameAr,
          description: dto.description ?? null,
          dimension: (dto.dimension ?? 'completeness') as DataQualityDimension,
          severity: (dto.severity ?? 'medium') as DataQualitySeverity,
          assetId: dto.assetId ?? null,
          domainId: dto.domainId ?? null,
          ownerPersonId: dto.ownerPersonId ?? null,
          thresholdExpression: dto.thresholdExpression ?? null,
          checkFrequency: dto.checkFrequency ?? 'weekly',
          impactSummary: dto.impactSummary ?? null,
          createdBy: actor,
        },
      });
      await tx.dataQualityRuleVersion.create({
        data: {
          ruleId: rule.id,
          version: 1,
          status: DataQualityRuleStatus.draft,
          definitionJson: dto.definitionJson ? (dto.definitionJson as Prisma.InputJsonObject) : undefined,
          changeSummary: 'Initial rule definition.',
          createdBy: actor,
        },
      });
      await this.writeAudit(tx, actor, 'data_quality_rule.create', 'data_quality_rule', rule.id, { code });
      return tx.dataQualityRule.findUnique({ where: { id: rule.id }, include: ruleInclude });
    });
  }

  async updateRule(id: string, roleCodes: string[], dto: UpdateDataQualityRuleDto, actor: string) {
    const existing = await this.prisma.dataQualityRule.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('data quality rule not found');
    await this.assertQualityRecordScope(roleCodes, existing);
    await this.assertQualityRecordScope(roleCodes, {
      assetId: dto.assetId !== undefined ? dto.assetId : existing.assetId,
      domainId: dto.domainId !== undefined ? dto.domainId : existing.domainId,
    });
    await this.assertPerson(dto.ownerPersonId);
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.dataQualityRule.update({
        where: { id },
        data: {
          nameEn: dto.nameEn,
          nameAr: dto.nameAr,
          description: dto.description,
          dimension: dto.dimension as DataQualityDimension | undefined,
          severity: dto.severity as DataQualitySeverity | undefined,
          assetId: dto.assetId,
          domainId: dto.domainId,
          ownerPersonId: dto.ownerPersonId,
          thresholdExpression: dto.thresholdExpression,
          checkFrequency: dto.checkFrequency,
          impactSummary: dto.impactSummary,
          currentVersion: dto.definitionJson ? { increment: 1 } : undefined,
          status: existing.status === DataQualityRuleStatus.deployed ? DataQualityRuleStatus.in_review : undefined,
        },
      });
      if (dto.definitionJson) {
        await tx.dataQualityRuleVersion.create({
          data: {
            ruleId: id,
            version: rule.currentVersion,
            status: DataQualityRuleStatus.in_review,
            definitionJson: dto.definitionJson as Prisma.InputJsonObject,
            changeSummary: dto.changeSummary ?? 'Rule definition updated.',
            createdBy: actor,
          },
        });
      }
      await this.writeAudit(tx, actor, 'data_quality_rule.update', 'data_quality_rule', id);
      return tx.dataQualityRule.findUnique({ where: { id }, include: ruleInclude });
    });
  }

  async transitionRule(id: string, roleCodes: string[], action: 'submit' | 'approve' | 'deploy' | 'retire', dto: DataQualityRuleTransitionDto, actor: string) {
    const existing = await this.prisma.dataQualityRule.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('data quality rule not found');
    await this.assertQualityRecordScope(roleCodes, existing);
    const now = new Date();
    const next: Partial<{
      status: DataQualityRuleStatus;
      approvedBy: string | null;
      approvedAt: Date | null;
      deployedAt: Date | null;
      retiredAt: Date | null;
    }> = {};
    if (action === 'submit') {
      if (existing.status !== DataQualityRuleStatus.draft) {
        throw new BadRequestException('Only draft rules can be submitted for review');
      }
      next.status = DataQualityRuleStatus.in_review;
    }
    if (action === 'approve') {
      if (existing.status !== DataQualityRuleStatus.in_review) {
        throw new BadRequestException('Only rules in review can be approved');
      }
      if (existing.createdBy === actor) {
        throw new BadRequestException('Rule creators cannot approve their own rule');
      }
      next.status = DataQualityRuleStatus.approved;
      next.approvedBy = actor;
      next.approvedAt = now;
    }
    if (action === 'deploy') {
      if (existing.status !== DataQualityRuleStatus.approved) {
        throw new BadRequestException('Only approved rules can be deployed');
      }
      next.status = DataQualityRuleStatus.deployed;
      next.deployedAt = now;
    }
    if (action === 'retire') {
      const retireAllowed: readonly DataQualityRuleStatus[] = [
        DataQualityRuleStatus.approved,
        DataQualityRuleStatus.deployed,
      ];
      if (!retireAllowed.includes(existing.status)) {
        throw new BadRequestException('Only approved or deployed rules can be retired');
      }
      next.status = DataQualityRuleStatus.retired;
      next.retiredAt = now;
    }
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.dataQualityRule.update({ where: { id }, data: next });
      await tx.dataQualityRuleVersion.updateMany({
        where: { ruleId: id, version: rule.currentVersion },
        data: {
          status: next.status,
          reviewedBy: action === 'approve' ? actor : undefined,
          reviewedAt: action === 'approve' ? now : undefined,
        },
      });
      await this.writeAudit(tx, actor, `data_quality_rule.${action}`, 'data_quality_rule', id, {
        comment: dto.comment ?? null,
        status: next.status,
      });
      return tx.dataQualityRule.findUnique({ where: { id }, include: ruleInclude });
    });
  }

  async listProfiles(roleCodes: string[], page?: string | number, pageSize?: string | number) {
    const [scope, assetIds] = await Promise.all([this.scope.resolve(roleCodes), this.visibleAssetIds(roleCodes)]);
    const where = this.qualityRecordScopeWhere<Prisma.DataQualityProfileWhereInput>(scope, assetIds);
    const params = parsePageParams(page, pageSize);
    const query = { where, include: profileInclude, orderBy: { createdAt: 'desc' as const } };
    if (!params) {
      const bounded = boundedFirstPageParams(pageSize);
      return this.prisma.dataQualityProfile.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const [rows, total] = await Promise.all([
      this.prisma.dataQualityProfile.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.dataQualityProfile.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async importProfile(roleCodes: string[], dto: ImportDataQualityProfileDto, actor: string) {
    if (!dto.columns?.length) throw new BadRequestException('Profiling import must include at least one column');
    await this.assertQualityRecordScope(roleCodes, { assetId: dto.assetId, domainId: dto.domainId });
    const score = profileScore(dto.columns);
    const asset = dto.assetId
      ? await this.prisma.dataAsset.findFirst({ where: { id: dto.assetId, deletedAt: null }, select: { domainId: true } })
      : null;
    const domainId = dto.domainId ?? asset?.domainId ?? null;
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.dataQualityProfile.create({
        data: {
          assetId: dto.assetId ?? null,
          domainId,
          source: dto.source ?? 'profiling_import',
          importedBy: actor,
          rowCount: dto.rowCount ?? 0,
          columnCount: dto.columns.length,
          qualityScore: score.qualityScore,
          recommendedRules: score.recommendedRules,
          anomalyCount: score.anomalyCount,
          summaryJson: dto.summaryJson ? (dto.summaryJson as Prisma.InputJsonObject) : undefined,
          columns: {
            create: dto.columns.map((column) => ({
              columnName: column.columnName,
              dataType: column.dataType ?? null,
              completenessPct: column.completenessPct ?? 0,
              uniquenessPct: column.uniquenessPct ?? 0,
              validityPct: column.validityPct ?? 0,
              pattern: column.pattern ?? null,
              anomalyCount: column.anomalyCount ?? 0,
              recommendation: column.recommendation ?? null,
              dimension: column.dimension as DataQualityDimension | undefined,
            })),
          },
        },
      });
      await tx.dataQualityScore.create({
        data: {
          level: dto.assetId ? DataQualityScoreLevel.asset : DataQualityScoreLevel.domain,
          refId: dto.assetId ?? domainId,
          assetId: dto.assetId ?? null,
          domainId,
          score: score.qualityScore,
          totalChecks: dto.columns.length,
          failedChecks: score.recommendedRules,
          source: dto.source ?? 'profiling_import',
          notes: 'Score generated from profiling import.',
        },
      });
      await this.writeAudit(tx, actor, 'data_quality_profile.import', 'data_quality_profile', profile.id, { ...score });
      return tx.dataQualityProfile.findUnique({ where: { id: profile.id }, include: profileInclude });
    });
  }

  async runProfilingEngine(roleCodes: string[], dto: RunDataQualityProfileDto, actor: string) {
    const rows = parseCsv(dto.csv);
    if (!rows.length) throw new BadRequestException('Profiling CSV has no data rows');
    await this.assertQualityRecordScope(roleCodes, { assetId: dto.assetId, domainId: dto.domainId });
    const relatedDatasets = this.parseRelatedProfilingDatasets(dto.relatedDatasets ?? []);
    const report = profileCsvRows(rows, {
      datasetName: dto.datasetName,
      relatedDatasets,
    });
    const asset = dto.assetId
      ? await this.prisma.dataAsset.findFirst({ where: { id: dto.assetId, deletedAt: null }, select: { domainId: true } })
      : null;
    const domainId = dto.domainId ?? asset?.domainId ?? null;
    const source = dto.source ?? 'native_csv_profiler';
    const createRuleDrafts = dto.createRuleDrafts ?? false;
    const createIssues = dto.createIssues ?? true;
    const profile = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.dataQualityProfile.create({
        data: {
          assetId: dto.assetId ?? null,
          domainId,
          source,
          importedBy: actor,
          rowCount: report.rowCount,
          columnCount: report.columnCount,
          qualityScore: report.qualityScore,
          recommendedRules: report.recommendedRules,
          anomalyCount: report.anomalyCount,
          summaryJson: this.profileSummaryJson(report) as Prisma.InputJsonObject,
          columns: {
            create: report.columns.map((column) => ({
              columnName: column.columnName,
              dataType: `${column.dataType}:${column.semanticType}`,
              completenessPct: column.completenessPct,
              uniquenessPct: column.uniquenessPct,
              validityPct: column.validityPct,
              pattern: column.pattern,
              anomalyCount: column.anomalyCount,
              recommendation: column.recommendation,
              dimension: column.dimension ?? undefined,
            })),
          },
        },
      });
      await tx.dataQualityScore.create({
        data: {
          level: dto.assetId ? DataQualityScoreLevel.asset : DataQualityScoreLevel.domain,
          refId: dto.assetId ?? domainId,
          assetId: dto.assetId ?? null,
          domainId,
          score: report.qualityScore,
          totalChecks: report.columnCount,
          failedChecks: report.recommendedRules,
          source,
          notes: 'Overall score generated by the native profiling engine.',
        },
      });
      for (const dimension of DQ_DIMENSION_ORDER) {
        const dimensionScore = report.dimensionScores[dimension];
        await tx.dataQualityScore.create({
          data: {
            level: dto.assetId ? DataQualityScoreLevel.asset : DataQualityScoreLevel.domain,
            refId: dto.assetId ?? domainId,
            assetId: dto.assetId ?? null,
            domainId,
            dimension,
            score: dimensionScore.score,
            totalChecks: dimensionScore.totalChecks,
            failedChecks: dimensionScore.failedChecks,
            source,
            notes: `Profiling dimension score for ${dimension}.`,
          },
        });
      }
      const draftedRuleIds = createRuleDrafts
        ? await this.createProfileRuleDrafts(tx, report.recommendations, {
          assetId: dto.assetId ?? null,
          domainId,
          actor,
          profileId: saved.id,
        })
        : [];
      await this.writeAudit(tx, actor, 'data_quality_profile.run', 'data_quality_profile', saved.id, {
        source,
        datasetName: report.datasetName,
        rowCount: report.rowCount,
        columnCount: report.columnCount,
        qualityScore: report.qualityScore,
        anomalyCount: report.anomalyCount,
        recommendedRules: report.recommendedRules,
        draftedRuleIds,
      });
      return {
        profile: await tx.dataQualityProfile.findUnique({ where: { id: saved.id }, include: profileInclude }),
        draftedRuleIds,
      };
    });
    const createdIssueIds = createIssues
      ? await this.createProfilingIssues(roleCodes, report.issueRecommendations, {
        actor,
        assetId: dto.assetId ?? null,
        profileId: profile.profile?.id ?? '',
      })
      : [];
    return {
      ...profile.profile,
      engineReport: this.profileSummaryJson(report),
      draftedRuleIds: profile.draftedRuleIds,
      createdIssueIds,
    };
  }

  private parseRelatedProfilingDatasets(datasets: { name: string; csv: string }[]): RelatedProfilingDataset[] {
    return datasets.map((dataset) => {
      const rows = parseCsv(dataset.csv);
      if (!rows.length) {
        throw new BadRequestException(`Related profiling dataset has no rows: ${dataset.name}`);
      }
      return { name: dataset.name, rows };
    });
  }

  private profileSummaryJson(report: ReturnType<typeof profileCsvRows>): Record<string, unknown> {
    return {
      summary: report.summary,
      datasetName: report.datasetName,
      rowCount: report.rowCount,
      columnCount: report.columnCount,
      qualityScore: report.qualityScore,
      anomalyCount: report.anomalyCount,
      recommendedRules: report.recommendedRules,
      dimensionScores: report.dimensionScores,
      recommendations: report.recommendations,
      issueRecommendations: report.issueRecommendations,
      relationships: report.relationships,
      crossColumnFindings: report.crossColumnFindings,
      columnStatistics: report.columns.map((column) => ({
        columnName: column.columnName,
        dataType: column.dataType,
        semanticType: column.semanticType,
        score: column.score,
        completenessPct: column.completenessPct,
        uniquenessPct: column.uniquenessPct,
        validityPct: column.validityPct,
        consistencyPct: column.consistencyPct,
        accuracyPct: column.accuracyPct,
        timelinessPct: column.timelinessPct,
        pattern: column.pattern,
        anomalyCount: column.anomalyCount,
        dimension: column.dimension,
        severity: column.severity,
        stats: column.stats,
      })),
    };
  }

  private async createProfileRuleDrafts(
    client: PrismaWriter,
    recommendations: ProfilingRuleRecommendation[],
    context: { assetId: string | null; domainId: string | null; actor: string; profileId: string },
  ): Promise<string[]> {
    const createdIds: string[] = [];
    const nowKey = Date.now();
    for (const [index, recommendation] of recommendations.slice(0, 10).entries()) {
      const duplicate = await client.dataQualityRule.findFirst({
        where: {
          deletedAt: null,
          assetId: context.assetId,
          domainId: context.domainId,
          dimension: recommendation.dimension,
          thresholdExpression: recommendation.thresholdExpression,
          status: { not: DataQualityRuleStatus.retired },
        },
        select: { id: true },
      });
      if (duplicate) continue;
      const rule = await client.dataQualityRule.create({
        data: {
          code: `DQR-PROF-${nowKey}-${index + 1}`,
          nameEn: recommendation.titleEn,
          nameAr: recommendation.titleAr,
          description: recommendation.reason,
          dimension: recommendation.dimension,
          severity: recommendation.severity,
          assetId: context.assetId,
          domainId: context.domainId,
          thresholdExpression: recommendation.thresholdExpression,
          checkFrequency: 'weekly',
          impactSummary: `Generated from profiling run ${context.profileId} with ${recommendation.confidence}% confidence.`,
          createdBy: context.actor,
        },
      });
      await client.dataQualityRuleVersion.create({
        data: {
          ruleId: rule.id,
          version: 1,
          status: DataQualityRuleStatus.draft,
          definitionJson: recommendation.definitionJson as Prisma.InputJsonObject,
          changeSummary: `Draft generated from profiling run ${context.profileId}.`,
          createdBy: context.actor,
        },
      });
      createdIds.push(rule.id);
    }
    return createdIds;
  }

  private async createProfilingIssues(
    roleCodes: string[],
    recommendations: ProfilingIssueRecommendation[],
    context: { actor: string; assetId: string | null; profileId: string },
  ): Promise<string[]> {
    const createdIds: string[] = [];
    for (const recommendation of recommendations.slice(0, 5)) {
      const issue = await this.create(
        roleCodes,
        {
          title: recommendation.title,
          description: `${recommendation.description} Profiling run: ${context.profileId}.`,
          severity: recommendation.severity,
          priority: recommendation.priority,
          dimension: recommendation.dimension,
          assetId: context.assetId,
          source: 'profiling_engine',
        },
        context.actor,
      );
      if (issue?.id) createdIds.push(issue.id);
    }
    return createdIds;
  }

  async upsertRca(issueId: string, roleCodes: string[], dto: UpsertDataQualityRcaDto, actor: string) {
    const existing = await this.get(roleCodes, issueId, actor);
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.dataQualityRcaRecord.create({
        data: {
          issueId,
          template: (dto.template ?? 'five_whys') as DataQualityRcaTemplate,
          summary: dto.summary ?? null,
          why1: dto.why1 ?? null,
          why2: dto.why2 ?? null,
          why3: dto.why3 ?? null,
          why4: dto.why4 ?? null,
          why5: dto.why5 ?? null,
          fishboneJson: dto.fishboneJson ? (dto.fishboneJson as Prisma.InputJsonObject) : undefined,
          processMap: dto.processMap ?? null,
          lineageNotes: dto.lineageNotes ?? null,
          rootCause: dto.rootCause ?? null,
          remediationPlan: dto.remediationPlan ?? null,
          validationResult: dto.validationResult ?? null,
          createdBy: actor,
          updatedBy: actor,
        },
      });
      if (existing.status === DataQualityIssueStatus.open || existing.status === DataQualityIssueStatus.triaged) {
        await tx.dataQualityIssue.update({
          where: { id: issueId },
          data: { status: DataQualityIssueStatus.in_progress },
        });
      }
      await this.writeEvidence(tx, issueId, 'rca.recorded', actor, dto.rootCause ?? dto.summary ?? 'Root-cause analysis recorded.');
      await this.writeAudit(tx, actor, 'data_quality_issue.rca', 'data_quality_issue', issueId);
      return record;
    });
  }

  async importCsv(roleCodes: string[], csv: string, actor: string) {
    const batchId = `dq-import-${randomUUID()}`;
    const rows = parseCsv(csv);
    if (!rows.length) throw new BadRequestException(DATA_QUALITY_IMPORT_API_MESSAGES.emptyCsv);
    const assetIds = await this.visibleAssetIds(roleCodes);
    const assets = await this.prisma.dataAsset.findMany({
      where: assetIds === 'all'
        ? { deletedAt: null }
        : { id: { in: [...assetIds] }, deletedAt: null },
      select: { id: true, code: true },
    });
    const assetByCode = new Map(assets.map((a) => [a.code.toLowerCase(), a.id]));
    let created = 0;
    const createdIds: string[] = [];
    const errors: DataQualityImportRowError[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2;
      const title = (row[DATA_QUALITY_IMPORT_ROW_KEYS.title] ?? '').trim();
      if (!title) {
        errors.push({ row: line, code: 'missing_title' });
        continue;
      }
      const rawAssetCode = row[DATA_QUALITY_IMPORT_ROW_KEYS.assetCode] ?? '';
      const assetCode = rawAssetCode.trim().toLowerCase();
      const assetId = assetCode ? assetByCode.get(assetCode) : undefined;
      if (assetCode && !assetId) {
        errors.push({ row: line, code: 'asset_unavailable', params: { assetCode: rawAssetCode } });
        continue;
      }
      const severity = parseImportEnum<DqSeverity>(
        row[DATA_QUALITY_IMPORT_ROW_KEYS.severity],
        DATA_QUALITY_IMPORT_DEFAULTS.severity,
        DQ_SEVERITIES,
        (value) => value.toLowerCase(),
      );
      if (!severity) {
        errors.push({ row: line, code: 'row_rejected', params: { reason: `Invalid severity: ${row[DATA_QUALITY_IMPORT_ROW_KEYS.severity]}` } });
        continue;
      }
      const priority = parseImportEnum<DqPriority>(
        row[DATA_QUALITY_IMPORT_ROW_KEYS.priority],
        DATA_QUALITY_IMPORT_DEFAULTS.priority,
        DQ_PRIORITIES,
        (value) => value.toUpperCase(),
      );
      if (!priority) {
        errors.push({ row: line, code: 'row_rejected', params: { reason: `Invalid priority: ${row[DATA_QUALITY_IMPORT_ROW_KEYS.priority]}` } });
        continue;
      }
      const dimension = parseImportEnum<DqDimension>(
        row[DATA_QUALITY_IMPORT_ROW_KEYS.dimension],
        DATA_QUALITY_IMPORT_DEFAULTS.dimension,
        DQ_DIMENSIONS,
        (value) => value.toLowerCase(),
      );
      if (!dimension) {
        errors.push({ row: line, code: 'row_rejected', params: { reason: `Invalid dimension: ${row[DATA_QUALITY_IMPORT_ROW_KEYS.dimension]}` } });
        continue;
      }
      try {
        const issue = await this.create(
          roleCodes,
          {
            code: (row[DATA_QUALITY_IMPORT_ROW_KEYS.code] ?? '').trim() || undefined,
            title,
            description: (row[DATA_QUALITY_IMPORT_ROW_KEYS.description] ?? '').trim() || null,
            severity,
            priority,
            dimension,
            assetId: assetId ?? null,
            dueDate: (row[DATA_QUALITY_IMPORT_ROW_KEYS.dueDate] ?? '').trim() || null,
            source: DATA_QUALITY_IMPORT_DEFAULTS.source,
          },
          actor,
        );
        if (!issue) {
          throw new BadRequestException('Imported issue could not be loaded after creation');
        }
        created++;
        createdIds.push(issue.id);
      } catch (e) {
        errors.push({ row: line, code: 'row_rejected', params: { reason: (e as Error).message } });
      }
    }
    await this.audit.log({
      actor,
      action: 'data_quality_issue.import',
      entityType: 'data_quality_issue',
      entityId: batchId,
      metadata: { batchId, processed: rows.length, created, failed: errors.length, createdIds },
    });
    return { batchId, processed: rows.length, created, failed: errors.length, createdIds, errors };
  }
}
