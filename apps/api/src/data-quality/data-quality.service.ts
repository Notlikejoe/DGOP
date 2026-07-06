import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DataQualityDimension,
  DataQualityIssueStatus,
  DataQualitySeverity,
  Prisma,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService, EffectiveScope } from '../access/scope.service';
import { parseCsv } from '../common/csv';
import { parsePageParams, toPaged } from '../common/pagination';
import {
  CloseDataQualityIssueDto,
  CreateDataQualityIssueDto,
  UpdateDataQualityIssueDto,
} from './data-quality.dto';

const DQ_STEWARD_CODE = 'dq_steward';
const RULE_PRIORITY = ['domain', 'capability', 'subject', 'org_unit', 'system'] as const;
type PrismaWriter = PrismaService | Prisma.TransactionClient;

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
};

@Injectable()
export class DataQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
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

  private issueScopeWhere(assetIds: Set<string> | 'all'): Record<string, unknown> {
    if (assetIds === 'all') return {};
    return { OR: [{ assetId: null }, { assetId: { in: [...assetIds] } }] };
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

  private async nextCaseCode(client: PrismaWriter, issueCode: string): Promise<string> {
    const preferred = `WFC-${issueCode}`;
    const existing = await client.workflowCase.findUnique({ where: { code: preferred } });
    if (!existing) return preferred;
    return `WFC-${issueCode}-${Date.now()}`;
  }

  async summary(roleCodes: string[]) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const scoped = this.issueScopeWhere(assetIds);
    const base = { AND: [{ deletedAt: null }, scoped] };
    const [total, open, critical, overdue, closed] = await Promise.all([
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
    ]);
    return {
      total,
      open,
      critical,
      overdue,
      closed,
      closureRate: total ? Math.round((closed / total) * 100) : 0,
    };
  }

  async list(
    roleCodes: string[],
    filters: { search?: string; status?: string; severity?: string; dimension?: string; assetId?: string },
    page?: string | number,
    pageSize?: string | number,
  ) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const and: Record<string, unknown>[] = [{ deletedAt: null }, this.issueScopeWhere(assetIds)];
    if (filters.status) and.push({ status: filters.status });
    if (filters.severity) and.push({ severity: filters.severity });
    if (filters.dimension) and.push({ dimension: filters.dimension });
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
    if (!params) return this.prisma.dataQualityIssue.findMany(query);
    const [rows, total] = await Promise.all([
      this.prisma.dataQualityIssue.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.dataQualityIssue.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async get(roleCodes: string[], id: string) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const issue = await this.prisma.dataQualityIssue.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.issueScopeWhere(assetIds)] },
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
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.dataQualityIssue.create({
        data: {
          code,
          title: dto.title,
          description: dto.description ?? null,
          severity: (dto.severity ?? 'medium') as DataQualitySeverity,
          dimension: (dto.dimension ?? 'completeness') as DataQualityDimension,
          status: responsible ? DataQualityIssueStatus.triaged : DataQualityIssueStatus.open,
          source: dto.source ?? 'manual',
          assetId: dto.assetId ?? null,
          responsiblePersonId: responsible?.id ?? null,
          dueDate,
          createdBy: actor,
        },
      });
      await this.writeEvidence(tx, issue.id, 'issue.created', actor, 'Issue registered and ready for triage.');
      await this.createWorkflow(tx, issue.id, actor);
      await this.writeAudit(tx, actor, 'data_quality_issue.create', 'data_quality_issue', issue.id, {
        code,
        assetId: dto.assetId ?? null,
        responsiblePersonId: responsible?.id ?? null,
      });
      return tx.dataQualityIssue.findUnique({ where: { id: issue.id }, include: issueInclude });
    });
  }

  async update(id: string, roleCodes: string[], dto: UpdateDataQualityIssueDto, actor: string) {
    const existing = await this.get(roleCodes, id);
    if (dto.assetId) await this.assertAssetVisible(roleCodes, dto.assetId);
    const responsible = dto.responsiblePersonId !== undefined
      ? await this.resolveResponsible(dto.assetId ?? existing.assetId, dto.responsiblePersonId)
      : undefined;
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.dataQualityIssue.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          severity: dto.severity as DataQualitySeverity | undefined,
          dimension: dto.dimension as DataQualityDimension | undefined,
          status: dto.status as DataQualityIssueStatus | undefined,
          assetId: dto.assetId,
          responsiblePersonId: responsible === undefined ? undefined : responsible?.id ?? null,
          dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
        },
        include: issueInclude,
      });
      await this.writeEvidence(tx, id, 'issue.updated', actor, 'Issue details updated.');
      await this.writeAudit(tx, actor, 'data_quality_issue.update', 'data_quality_issue', id);
      return issue;
    });
  }

  async close(id: string, roleCodes: string[], dto: CloseDataQualityIssueDto, actor: string) {
    const existing = await this.get(roleCodes, id);
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
      if (existing.workflowCaseId) {
        await tx.workflowTask.updateMany({
          where: {
            caseId: existing.workflowCaseId,
            status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
          },
          data: { status: TaskStatus.completed, completedAt: now },
        });
        await tx.workflowCase.update({
          where: { id: existing.workflowCaseId },
          data: { status: 'closed' },
        });
        await tx.workflowEvent.create({
          data: {
            caseId: existing.workflowCaseId,
            actor,
            action: 'case.closed',
            fromStatus: String(existing.workflowCase?.status ?? ''),
            toStatus: 'closed',
            comment: 'Data quality issue closed with evidence note.',
          },
        });
      }
      await this.writeAudit(tx, actor, 'data_quality_issue.close', 'data_quality_issue', id);
      return issue;
    });
  }

  async remove(id: string, roleCodes: string[], actor: string) {
    await this.get(roleCodes, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.dataQualityIssue.update({ where: { id }, data: { deletedAt: new Date(), status: 'cancelled' } });
      await this.writeAudit(tx, actor, 'data_quality_issue.delete', 'data_quality_issue', id);
    });
    return { success: true };
  }

  private async createWorkflow(client: PrismaWriter, issueId: string, actor: string): Promise<void> {
    const issue = await client.dataQualityIssue.findUnique({
      where: { id: issueId },
      include: { responsiblePerson: true },
    });
    if (!issue || issue.workflowCaseId) return;
    const code = await this.nextCaseCode(client, issue.code);
    const wfCase = await client.workflowCase.create({
      data: {
        code,
        title: `Resolve DQ issue: ${issue.title}`,
        description: issue.description,
        type: 'data_quality_issue',
        status: 'submitted',
        assetId: issue.assetId,
        createdBy: actor,
      },
    });
    const task = await client.workflowTask.create({
      data: {
        caseId: wfCase.id,
        title: 'Investigate and remediate data quality issue',
        type: 'remediation',
        status: 'pending',
        assigneeUserId: issue.responsiblePerson?.userId ?? null,
        dueDate: issue.dueDate,
      },
    });
    await client.workflowEvent.createMany({
      data: [
        { caseId: wfCase.id, actor, action: 'case.created', toStatus: 'submitted' },
        {
          caseId: wfCase.id,
          taskId: task.id,
          actor,
          action: 'task.assigned',
          comment: issue.responsiblePerson?.fullNameEn ?? 'No responsible steward found yet',
        },
      ],
    });
    await client.dataQualityIssue.update({
      where: { id: issueId },
      data: { workflowCaseId: wfCase.id },
    });
    await this.writeEvidence(client, issueId, 'workflow.created', actor, `Workflow case ${code} opened.`);
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
    return client.auditLog.create({
      data: {
        actor,
        action,
        entityType,
        entityId,
        metadata: metadata ? (metadata as Prisma.InputJsonObject) : undefined,
      },
    });
  }

  async importCsv(roleCodes: string[], csv: string, actor: string) {
    const rows = parseCsv(csv);
    if (!rows.length) throw new BadRequestException('CSV has no data rows');
    const assets = await this.prisma.dataAsset.findMany({ where: { deletedAt: null }, select: { id: true, code: true } });
    const assetByCode = new Map(assets.map((a) => [a.code.toLowerCase(), a.id]));
    let created = 0;
    const errors: { row: number; message: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2;
      const title = (row['title'] ?? '').trim();
      if (!title) {
        errors.push({ row: line, message: 'Missing title' });
        continue;
      }
      const assetCode = (row['assetcode'] ?? '').trim().toLowerCase();
      const assetId = assetCode ? assetByCode.get(assetCode) : undefined;
      if (assetCode && !assetId) {
        errors.push({ row: line, message: `Unknown assetCode: ${row['assetcode']}` });
        continue;
      }
      try {
        await this.create(
          roleCodes,
          {
            code: (row['code'] ?? '').trim() || undefined,
            title,
            description: (row['description'] ?? '').trim() || null,
            severity: ((row['severity'] ?? 'medium').trim() || 'medium') as never,
            dimension: ((row['dimension'] ?? 'completeness').trim() || 'completeness') as never,
            assetId: assetId ?? null,
            dueDate: (row['duedate'] ?? '').trim() || null,
            source: 'csv',
          },
          actor,
        );
        created++;
      } catch (e) {
        errors.push({ row: line, message: (e as Error).message });
      }
    }
    await this.audit.log({
      actor,
      action: 'data_quality_issue.import',
      entityType: 'data_quality_issue',
      entityId: 'bulk',
      metadata: { processed: rows.length, created, errors: errors.length },
    });
    return { processed: rows.length, created, errors };
  }
}
