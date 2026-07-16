import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BreachStatus,
  CaseStatus,
  DpiaRiskLevel,
  DsrRequestStatus,
  PrivacyGatePhase,
  PrivacyGateStatus,
  PrivacyWorkStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { parsePageParams, toPaged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CreateBreachDto,
  CreateConsentRecordDto,
  CreateDpiaDto,
  CreateDsrRequestDto,
  CreatePrivacyLegalBasisDto,
  CreateRetentionRuleDto,
  CreateRopaRecordDto,
  SavePrivacyGateDto,
  UpdateBreachDto,
  UpdateDpiaDto,
  UpdateDsrRequestDto,
} from './privacy.dto';
import {
  addHours,
  addKsaBusinessDays,
  breachNotificationStatus,
  calculateDpiaRisk,
  dpiaStatusFromGates,
  privacySlaStatus,
} from './privacy.logic';

export interface PrivacyFilters {
  search?: string;
  status?: string;
  page?: string | number;
  pageSize?: string | number;
}

const refSelect = { select: { id: true, code: true, nameEn: true, nameAr: true } };
const classificationSelect = { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } };
const personSelect = { select: { id: true, fullNameEn: true, fullNameAr: true, email: true, jobTitle: true, userId: true } };
const assetSelect = {
  select: {
    id: true,
    code: true,
    nameEn: true,
    nameAr: true,
    domainId: true,
    classificationId: true,
    domain: refSelect,
    classification: classificationSelect,
    subjects: { include: { dataSubject: refSelect } },
  },
};

const dpiaInclude = {
  asset: assetSelect,
  domain: refSelect,
  legalBasis: true,
  classification: classificationSelect,
  reviewerPerson: personSelect,
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
  gates: { include: { reviewerPerson: personSelect }, orderBy: { phase: 'asc' as const } },
};

const dsrInclude = {
  asset: assetSelect,
  domain: refSelect,
  assignedPerson: personSelect,
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
};

const breachInclude = {
  asset: assetSelect,
  domain: refSelect,
  assignedPerson: personSelect,
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
};

const ropaInclude = {
  asset: assetSelect,
  domain: refSelect,
  legalBasis: true,
  ownerPerson: personSelect,
};

type PrismaWriter = PrismaService | Prisma.TransactionClient;
type DpiaWithInclude = Prisma.PrivacyDpiaGetPayload<{ include: typeof dpiaInclude }>;
type DsrWithInclude = Prisma.PrivacyDsrRequestGetPayload<{ include: typeof dsrInclude }>;
type BreachWithInclude = Prisma.PrivacyBreachGetPayload<{ include: typeof breachInclude }>;
const NO_VISIBLE_RECORD_ID = '__no_visible_privacy_records__';

const PRIVACY_GATE_PHASES = [
  PrivacyGatePhase.requirements,
  PrivacyGatePhase.design,
  PrivacyGatePhase.development,
  PrivacyGatePhase.testing,
  PrivacyGatePhase.deployment,
] as const;

@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly workflow?: WorkflowService,
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

  private async visibleAssetIds(roleCodes: string[], resolvedScope?: EffectiveScope): Promise<Set<string> | 'all'> {
    const scope = resolvedScope ?? await this.scope.resolve(roleCodes);
    if (scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null) return 'all';
    const rows = await this.prisma.dataAsset.findMany({ where: this.assetScopeWhere(scope), select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  private visibleRecordBranches(scope: EffectiveScope, assetIds: Set<string> | 'all', hasDomain = true) {
    const branches: Prisma.PrivacyDpiaWhereInput[] = [];
    if (assetIds !== 'all' && assetIds.size > 0) branches.push({ assetId: { in: [...assetIds] } });
    if (hasDomain && scope.orgUnits === 'all' && scope.domains !== 'all' && scope.domains.length > 0) {
      branches.push({ AND: [{ assetId: null }, { domainId: { in: scope.domains } }] });
    }
    return branches;
  }

  private scopedWhere<T extends Record<string, unknown>>(
    scope: EffectiveScope,
    assetIds: Set<string> | 'all',
    options: { deletedAt?: boolean; hasDomain?: boolean } = {},
  ): T {
    const includeDeletedAt = options.deletedAt ?? true;
    const base: Record<string, unknown> = includeDeletedAt ? { deletedAt: null } : {};
    if (this.isUnrestricted(scope)) return base as T;
    const branches = this.visibleRecordBranches(scope, assetIds, options.hasDomain ?? true);
    return (branches.length ? { ...base, OR: branches } : { ...base, id: NO_VISIBLE_RECORD_ID }) as unknown as T;
  }

  private async assertAssetVisible(roleCodes: string[], assetId?: string | null) {
    if (!assetId) return null;
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.prisma.dataAsset.findFirst({
      where: { AND: [{ id: assetId }, this.assetScopeWhere(scope)] },
      include: { classification: classificationSelect, subjects: { include: { dataSubject: refSelect } } },
    });
    if (!asset) throw new NotFoundException('data asset not found');
    return asset;
  }

  private async assertScopedWriteTarget(roleCodes: string[], assetId: string | null | undefined, domainId: string | null | undefined, label: string) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.assertAssetVisible(roleCodes, assetId);
    const effectiveDomainId = domainId ?? asset?.domainId ?? null;
    await this.assertDomainVisible(roleCodes, effectiveDomainId);
    if (this.isUnrestricted(scope)) return asset;
    if (asset) return asset;
    if (scope.orgUnits === 'all' && scope.domains !== 'all' && effectiveDomainId && scope.domains.includes(effectiveDomainId)) {
      return asset;
    }
    throw new BadRequestException(`${label} must be linked to a visible data asset or data domain`);
  }

  private async assertDomainVisible(roleCodes: string[], domainId?: string | null): Promise<void> {
    if (!domainId) return;
    const scope = await this.scope.resolve(roleCodes);
    if (scope.domains !== 'all' && !scope.domains.includes(domainId)) throw new NotFoundException('data domain not found');
    const domain = await this.prisma.dataDomain.findFirst({ where: { id: domainId, deletedAt: null }, select: { id: true } });
    if (!domain) throw new NotFoundException('data domain not found');
  }

  private async assertPerson(id?: string | null, label = 'Person'): Promise<void> {
    if (!id) return;
    const person = await this.prisma.person.findFirst({ where: { id, deletedAt: null, isActive: true }, select: { id: true } });
    if (!person) throw new BadRequestException(`${label} not found`);
  }

  private async assertLegalBasis(id?: string | null): Promise<void> {
    if (!id) return;
    const row = await this.prisma.privacyLegalBasis.findFirst({ where: { id, isActive: true }, select: { id: true } });
    if (!row) throw new BadRequestException('legal basis not found');
  }

  private async assertClassification(roleCodes: string[], id?: string | null): Promise<void> {
    if (!id) return;
    const [scope, row] = await Promise.all([
      this.scope.resolve(roleCodes),
      this.prisma.classification.findFirst({ where: { id, deletedAt: null }, select: { id: true, rank: true } }),
    ]);
    if (!row) throw new BadRequestException('classification not found');
    if (scope.maxClassRank != null && row.rank > scope.maxClassRank) throw new NotFoundException('classification not found');
  }

  private async nextCode(client: PrismaWriter, model: string, field: string, prefix: string): Promise<string> {
    const year = new Date().getFullYear();
    const delegate = (client as unknown as Record<string, any>)[model];
    const count = await delegate.count({ where: { [field]: { startsWith: `${prefix}-${year}-` } } });
    for (let offset = 1; offset < 1000; offset += 1) {
      const code = `${prefix}-${year}-${String(count + offset).padStart(4, '0')}`;
      const exists = await delegate.findUnique({ where: { [field]: code } });
      if (!exists) return code;
    }
    throw new BadRequestException(`Could not generate ${prefix} code`);
  }

  private async createWorkflow(client: Prisma.TransactionClient, input: { type: string; title: string; description?: string | null; assetId?: string | null; assigneePersonId?: string | null; dueAt?: Date | null }, roleCodes: string[], actor: string): Promise<string> {
    const assignee = input.assigneePersonId
      ? await client.person.findFirst({ where: { id: input.assigneePersonId }, select: { userId: true } })
      : null;
    if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
    const workflowCase = await this.workflow.openRoutedCase({
      roleCodes,
      actor,
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      status: CaseStatus.submitted,
      assetId: input.assetId ?? null,
      initialAssigneeUserId: assignee?.userId ?? null,
      initialDueDate: input.dueAt ?? null,
      preferredCode: await this.nextCode(client, 'workflowCase', 'code', 'WFC-PRV'),
    }, client);
    await client.workflowEvent.create({ data: { caseId: workflowCase.id, actor, action: `${input.type}.created` } });
    return workflowCase.id;
  }

  private decorateDpia<T extends DpiaWithInclude>(row: T) {
    return { ...row, slaStatus: privacySlaStatus(row.dueAt, row.status), gateSummary: this.gateSummary(row.gates) };
  }

  private decorateDsr<T extends DsrWithInclude>(row: T) {
    return { ...row, slaStatus: privacySlaStatus(row.dueAt, row.status) };
  }

  private decorateBreach<T extends BreachWithInclude>(row: T) {
    return { ...row, notificationStatus: breachNotificationStatus(row.notificationDueAt, row.status, row.notifiedAt) };
  }

  private gateSummary(gates: { status: PrivacyGateStatus }[]) {
    return {
      total: gates.length,
      approved: gates.filter((gate) => gate.status === PrivacyGateStatus.approved).length,
      blocked: gates.filter((gate) => gate.status === PrivacyGateStatus.blocked).length,
      pending: gates.filter((gate) => gate.status === PrivacyGateStatus.pending).length,
    };
  }

  async summary(roleCodes: string[]) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const scoped = this.scopedWhere<Prisma.PrivacyDpiaWhereInput>(scope, assetIds);
    const consentScoped = this.scopedWhere<Prisma.PrivacyConsentRecordWhereInput>(scope, assetIds, { deletedAt: false, hasDomain: false });
    const retentionScoped = this.scopedWhere<Prisma.PrivacyRetentionRuleWhereInput>(scope, assetIds, { deletedAt: false });
    const now = new Date();
    const [dpias, dsrs, breaches, ropaDue, consents, retentionDue] = await Promise.all([
      this.prisma.privacyDpia.findMany({ where: scoped, select: { status: true, riskLevel: true, dueAt: true } }),
      this.prisma.privacyDsrRequest.findMany({ where: scoped as Prisma.PrivacyDsrRequestWhereInput, select: { status: true, dueAt: true } }),
      this.prisma.privacyBreach.findMany({ where: scoped as Prisma.PrivacyBreachWhereInput, select: { status: true, notificationDueAt: true, notifiedAt: true } }),
      this.prisma.privacyRopaRecord.count({ where: { ...(scoped as Prisma.PrivacyRopaRecordWhereInput), reviewDueAt: { lte: addKsaBusinessDays(now, 14) } } }),
      this.prisma.privacyConsentRecord.count({ where: { ...consentScoped, status: 'active' } }),
      this.prisma.privacyRetentionRule.count({ where: { ...retentionScoped, nextReviewAt: { lte: addKsaBusinessDays(now, 30) }, isActive: true } }),
    ]);
    return {
      dpias: dpias.length,
      dpiaUnderReview: dpias.filter((row) => row.status === PrivacyWorkStatus.under_review || row.status === PrivacyWorkStatus.submitted).length,
      highRiskDpias: dpias.filter((row) => row.riskLevel === DpiaRiskLevel.high || row.riskLevel === DpiaRiskLevel.critical).length,
      dsrOpen: dsrs.filter((row) => !new Set<string>([DsrRequestStatus.fulfilled, DsrRequestStatus.closed]).has(row.status)).length,
      dsrOverdue: dsrs.filter((row) => privacySlaStatus(row.dueAt, row.status) === 'overdue').length,
      breachesOpen: breaches.filter((row) => !new Set<string>([BreachStatus.closed, BreachStatus.false_positive]).has(row.status)).length,
      breachNotificationRisk: breaches.filter((row) => ['urgent', 'overdue'].includes(breachNotificationStatus(row.notificationDueAt, row.status, row.notifiedAt))).length,
      ropaDue,
      activeConsents: consents,
      retentionDue,
    };
  }

  legalBases() {
    return this.prisma.privacyLegalBasis.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  }

  async createLegalBasis(dto: CreatePrivacyLegalBasisDto, actor: string) {
    const row = await this.prisma.privacyLegalBasis.create({ data: { ...dto, code: dto.code.trim().toLowerCase() } });
    await this.audit.log({ actor, action: 'privacy_legal_basis.create', entityType: 'privacy_legal_basis', entityId: row.id });
    return row;
  }

  async listRopa(roleCodes: string[], filters: PrivacyFilters) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const pageParams = parsePageParams(filters.page, filters.pageSize)!;
    const { skip, take } = pageParams;
    const clauses: Prisma.PrivacyRopaRecordWhereInput[] = [this.scopedWhere<Prisma.PrivacyRopaRecordWhereInput>(scope, assetIds)];
    if (filters.search) {
      clauses.push({ OR: [{ code: { contains: filters.search, mode: 'insensitive' } }, { processName: { contains: filters.search, mode: 'insensitive' } }, { purpose: { contains: filters.search, mode: 'insensitive' } }] });
    }
    if (filters.status) clauses.push({ status: filters.status as PrivacyWorkStatus });
    const where = { AND: clauses };
    const [data, total] = await Promise.all([
      this.prisma.privacyRopaRecord.findMany({ where, include: ropaInclude, orderBy: { updatedAt: 'desc' }, skip, take }),
      this.prisma.privacyRopaRecord.count({ where }),
    ]);
    return toPaged(data, total, pageParams);
  }

  async createRopa(roleCodes: string[], dto: CreateRopaRecordDto, actor: string) {
    await this.assertScopedWriteTarget(roleCodes, dto.assetId, dto.domainId, 'RoPA record');
    await this.assertLegalBasis(dto.legalBasisId);
    await this.assertPerson(dto.ownerPersonId, 'Owner');
    const row = await this.prisma.privacyRopaRecord.create({
      data: {
        code: await this.nextCode(this.prisma, 'privacyRopaRecord', 'code', 'ROPA'),
        processName: dto.processName,
        purpose: dto.purpose,
        assetId: dto.assetId || null,
        domainId: dto.domainId || null,
        legalBasisId: dto.legalBasisId || null,
        ownerPersonId: dto.ownerPersonId || null,
        dataSubjects: dto.dataSubjects || null,
        recipients: dto.recipients || null,
        retentionSummary: dto.retentionSummary || null,
        reviewDueAt: dto.reviewDueAt ? new Date(dto.reviewDueAt) : addKsaBusinessDays(new Date(), 90),
        status: dto.status ?? PrivacyWorkStatus.submitted,
        createdBy: actor,
      },
      include: ropaInclude,
    });
    await this.audit.log({ actor, action: 'privacy_ropa.create', entityType: 'privacy_ropa_record', entityId: row.id });
    return row;
  }

  async listDpias(roleCodes: string[], filters: PrivacyFilters) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const pageParams = parsePageParams(filters.page, filters.pageSize)!;
    const { skip, take } = pageParams;
    const clauses: Prisma.PrivacyDpiaWhereInput[] = [this.scopedWhere<Prisma.PrivacyDpiaWhereInput>(scope, assetIds)];
    if (filters.search) clauses.push({ OR: [{ code: { contains: filters.search, mode: 'insensitive' } }, { title: { contains: filters.search, mode: 'insensitive' } }] });
    if (filters.status) clauses.push({ status: filters.status as PrivacyWorkStatus });
    const where = { AND: clauses };
    const [rows, total] = await Promise.all([
      this.prisma.privacyDpia.findMany({ where, include: dpiaInclude, orderBy: [{ riskLevel: 'desc' }, { updatedAt: 'desc' }], skip, take }),
      this.prisma.privacyDpia.count({ where }),
    ]);
    return toPaged(rows.map((row) => this.decorateDpia(row)), total, pageParams);
  }

  async getDpia(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const row = await this.prisma.privacyDpia.findFirst({
      where: { AND: [{ id }, this.scopedWhere<Prisma.PrivacyDpiaWhereInput>(scope, assetIds)] },
      include: dpiaInclude,
    });
    if (!row) throw new NotFoundException('privacy dpia not found');
    return this.decorateDpia(row);
  }

  async createDpia(roleCodes: string[], dto: CreateDpiaDto, actor: string) {
    const asset = await this.assertScopedWriteTarget(roleCodes, dto.assetId, dto.domainId, 'DPIA');
    await this.assertLegalBasis(dto.legalBasisId);
    await this.assertClassification(roleCodes, dto.classificationId);
    await this.assertPerson(dto.reviewerPersonId, 'Reviewer');
    const risk = calculateDpiaRisk({
      classificationRank: asset?.classification?.rank ?? null,
      crossBorderTransfer: dto.crossBorderTransfer,
      sensitiveSubjects: Boolean(asset?.subjects?.length),
      existingControls: dto.existingControls,
    });
    return this.prisma.$transaction(async (tx) => {
      const code = await this.nextCode(tx, 'privacyDpia', 'code', 'DPIA');
      const dueAt = dto.dueAt ? new Date(dto.dueAt) : addKsaBusinessDays(new Date(), 10);
      const dpia = await tx.privacyDpia.create({
        data: {
          code,
          title: dto.title,
          description: dto.description ?? null,
          assetId: dto.assetId || null,
          domainId: dto.domainId ?? asset?.domainId ?? null,
          legalBasisId: dto.legalBasisId || null,
          classificationId: dto.classificationId ?? asset?.classificationId ?? null,
          status: PrivacyWorkStatus.under_review,
          riskLevel: risk.riskLevel,
          inherentRiskScore: risk.inherentRiskScore,
          residualRiskScore: risk.residualRiskScore,
          crossBorderTransfer: dto.crossBorderTransfer ?? false,
          reviewerPersonId: dto.reviewerPersonId || null,
          dueAt,
          createdBy: actor,
        },
        select: { id: true, code: true, title: true, description: true, assetId: true, reviewerPersonId: true, dueAt: true },
      });
      for (const phase of PRIVACY_GATE_PHASES) {
        await tx.privacyGate.create({
          data: {
            dpiaId: dpia.id,
            phase,
            status: PrivacyGateStatus.pending,
            reviewerPersonId: dto.reviewerPersonId || null,
            dueAt: addKsaBusinessDays(new Date(), phase === PrivacyGatePhase.deployment ? 10 : 5),
            createdBy: actor,
          },
        });
      }
      const workflowCaseId = await this.createWorkflow(
        tx,
        { type: 'privacy_dpia', title: `DPIA ${code}`, description: dto.title, assetId: dpia.assetId, assigneePersonId: dpia.reviewerPersonId, dueAt },
        roleCodes,
        actor,
      );
      await tx.privacyDpia.update({ where: { id: dpia.id }, data: { workflowCaseId } });
      await tx.auditLog.create({ data: { actor, action: 'privacy_dpia.create', entityType: 'privacy_dpia', entityId: dpia.id } });
      return tx.privacyDpia.findUniqueOrThrow({ where: { id: dpia.id }, include: dpiaInclude });
    }).then((row) => this.decorateDpia(row));
  }

  async updateDpia(roleCodes: string[], id: string, dto: UpdateDpiaDto, actor: string) {
    await this.getDpia(roleCodes, id);
    if (dto.status !== undefined) throw new BadRequestException('DPIA status is controlled by privacy gate decisions');
    if (dto.riskLevel !== undefined) throw new BadRequestException('DPIA risk is calculated from DPIA controls');
    const row = await this.prisma.privacyDpia.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        residualRiskScore: dto.residualRiskScore,
        decisionSummary: dto.decisionSummary,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
        updatedBy: actor,
      },
      include: dpiaInclude,
    });
    await this.audit.log({ actor, action: 'privacy_dpia.update', entityType: 'privacy_dpia', entityId: id });
    return this.decorateDpia(row);
  }

  async saveGate(roleCodes: string[], id: string, dto: SavePrivacyGateDto, actor: string) {
    const dpia = await this.getDpia(roleCodes, id);
    if (dto.status && dto.status !== PrivacyGateStatus.pending && dpia.createdBy === actor) {
      throw new ForbiddenException('DPIA creators cannot approve or block their own privacy gates');
    }
    await this.assertPerson(dto.reviewerPersonId, 'Reviewer');
    await this.prisma.privacyGate.upsert({
      where: { dpiaId_phase: { dpiaId: id, phase: dto.phase } },
      create: {
        dpiaId: id,
        phase: dto.phase,
        status: dto.status ?? PrivacyGateStatus.pending,
        reviewerPersonId: dto.reviewerPersonId || null,
        note: dto.note ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        completedAt: dto.status === PrivacyGateStatus.approved || dto.status === PrivacyGateStatus.not_required ? new Date() : null,
        createdBy: actor,
      },
      update: {
        status: dto.status ?? PrivacyGateStatus.pending,
        reviewerPersonId: dto.reviewerPersonId || null,
        note: dto.note ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        completedAt: dto.status === PrivacyGateStatus.approved || dto.status === PrivacyGateStatus.not_required ? new Date() : null,
      },
    });
    const gates = await this.prisma.privacyGate.findMany({ where: { dpiaId: id }, select: { status: true } });
    await this.prisma.privacyDpia.update({ where: { id }, data: { status: dpiaStatusFromGates(gates), updatedBy: actor } });
    await this.audit.log({ actor, action: 'privacy_gate.upsert', entityType: 'privacy_dpia', entityId: id, metadata: { phase: dto.phase } });
    return this.getDpia(roleCodes, id);
  }

  async listDsr(roleCodes: string[], filters: PrivacyFilters) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const pageParams = parsePageParams(filters.page, filters.pageSize)!;
    const { skip, take } = pageParams;
    const clauses: Prisma.PrivacyDsrRequestWhereInput[] = [this.scopedWhere<Prisma.PrivacyDsrRequestWhereInput>(scope, assetIds)];
    if (filters.search) clauses.push({ OR: [{ requestNumber: { contains: filters.search, mode: 'insensitive' } }, { requesterName: { contains: filters.search, mode: 'insensitive' } }, { description: { contains: filters.search, mode: 'insensitive' } }] });
    if (filters.status) clauses.push({ status: filters.status as DsrRequestStatus });
    const where = { AND: clauses };
    const [rows, total] = await Promise.all([
      this.prisma.privacyDsrRequest.findMany({ where, include: dsrInclude, orderBy: { dueAt: 'asc' }, skip, take }),
      this.prisma.privacyDsrRequest.count({ where }),
    ]);
    return toPaged(rows.map((row) => this.decorateDsr(row)), total, pageParams);
  }

  async createDsr(roleCodes: string[], dto: CreateDsrRequestDto, actor: string) {
    await this.assertScopedWriteTarget(roleCodes, dto.assetId, dto.domainId, 'DSR request');
    await this.assertPerson(dto.assignedPersonId, 'Assignee');
    return this.prisma.$transaction(async (tx) => {
      const requestNumber = await this.nextCode(tx, 'privacyDsrRequest', 'requestNumber', 'DSR');
      const dueAt = dto.dueAt ? new Date(dto.dueAt) : addKsaBusinessDays(new Date(), 20);
      const dsr = await tx.privacyDsrRequest.create({
        data: {
          requestNumber,
          requesterName: dto.requesterName,
          requesterEmail: dto.requesterEmail ?? null,
          requestType: dto.requestType,
          description: dto.description,
          identityValidated: dto.identityValidated ?? false,
          assetId: dto.assetId || null,
          domainId: dto.domainId || null,
          assignedPersonId: dto.assignedPersonId || null,
          dueAt,
          createdBy: actor,
        },
        select: { id: true, requestNumber: true, description: true, assetId: true, assignedPersonId: true, dueAt: true },
      });
      const workflowCaseId = await this.createWorkflow(tx, { type: 'privacy_dsr', title: `DSR ${requestNumber}`, description: dto.description, assetId: dsr.assetId, assigneePersonId: dsr.assignedPersonId, dueAt }, roleCodes, actor);
      await tx.privacyDsrRequest.update({ where: { id: dsr.id }, data: { workflowCaseId } });
      await tx.auditLog.create({ data: { actor, action: 'privacy_dsr.create', entityType: 'privacy_dsr_request', entityId: dsr.id } });
      return tx.privacyDsrRequest.findUniqueOrThrow({ where: { id: dsr.id }, include: dsrInclude });
    }).then((row) => this.decorateDsr(row));
  }

  async updateDsr(roleCodes: string[], id: string, dto: UpdateDsrRequestDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const exists = await this.prisma.privacyDsrRequest.findFirst({ where: { AND: [{ id }, this.scopedWhere<Prisma.PrivacyDsrRequestWhereInput>(scope, assetIds)] } });
    if (!exists) throw new NotFoundException('DSR request not found');
    const finalDsrStatuses: DsrRequestStatus[] = [DsrRequestStatus.fulfilled, DsrRequestStatus.rejected, DsrRequestStatus.closed];
    if (dto.status && finalDsrStatuses.includes(dto.status) && exists.createdBy === actor) {
      throw new ForbiddenException('DSR creators cannot close or reject their own request');
    }
    await this.assertPerson(dto.assignedPersonId, 'Assignee');
    const row = await this.prisma.privacyDsrRequest.update({
      where: { id },
      data: {
        status: dto.status,
        identityValidated: dto.identityValidated,
        assignedPersonId: dto.assignedPersonId,
        decisionSummary: dto.decisionSummary,
        fulfilledAt: dto.fulfilledAt ? new Date(dto.fulfilledAt) : undefined,
        updatedBy: actor,
      },
      include: dsrInclude,
    });
    await this.audit.log({ actor, action: 'privacy_dsr.update', entityType: 'privacy_dsr_request', entityId: id });
    return this.decorateDsr(row);
  }

  async listBreaches(roleCodes: string[], filters: PrivacyFilters) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const pageParams = parsePageParams(filters.page, filters.pageSize)!;
    const { skip, take } = pageParams;
    const clauses: Prisma.PrivacyBreachWhereInput[] = [this.scopedWhere<Prisma.PrivacyBreachWhereInput>(scope, assetIds)];
    if (filters.search) clauses.push({ OR: [{ code: { contains: filters.search, mode: 'insensitive' } }, { title: { contains: filters.search, mode: 'insensitive' } }] });
    if (filters.status) clauses.push({ status: filters.status as BreachStatus });
    const where = { AND: clauses };
    const [rows, total] = await Promise.all([
      this.prisma.privacyBreach.findMany({ where, include: breachInclude, orderBy: { notificationDueAt: 'asc' }, skip, take }),
      this.prisma.privacyBreach.count({ where }),
    ]);
    return toPaged(rows.map((row) => this.decorateBreach(row)), total, pageParams);
  }

  async createBreach(roleCodes: string[], dto: CreateBreachDto, actor: string) {
    await this.assertScopedWriteTarget(roleCodes, dto.assetId, dto.domainId, 'Privacy breach');
    await this.assertPerson(dto.assignedPersonId, 'Assignee');
    return this.prisma.$transaction(async (tx) => {
      const code = await this.nextCode(tx, 'privacyBreach', 'code', 'BRCH');
      const detectedAt = dto.detectedAt ? new Date(dto.detectedAt) : new Date();
      const notificationDueAt = addHours(detectedAt, 72);
      const breach = await tx.privacyBreach.create({
        data: {
          code,
          title: dto.title,
          description: dto.description ?? null,
          assetId: dto.assetId || null,
          domainId: dto.domainId || null,
          severity: dto.severity ?? 'medium',
          detectedAt,
          notificationDueAt,
          assignedPersonId: dto.assignedPersonId || null,
          createdBy: actor,
        },
        select: { id: true, code: true, title: true, description: true, assetId: true, assignedPersonId: true, notificationDueAt: true },
      });
      const workflowCaseId = await this.createWorkflow(tx, { type: 'privacy_breach', title: `Breach ${code}`, description: dto.title, assetId: breach.assetId, assigneePersonId: breach.assignedPersonId, dueAt: breach.notificationDueAt }, roleCodes, actor);
      await tx.privacyBreach.update({ where: { id: breach.id }, data: { workflowCaseId } });
      await tx.auditLog.create({ data: { actor, action: 'privacy_breach.create', entityType: 'privacy_breach', entityId: breach.id } });
      return tx.privacyBreach.findUniqueOrThrow({ where: { id: breach.id }, include: breachInclude });
    }).then((row) => this.decorateBreach(row));
  }

  async updateBreach(roleCodes: string[], id: string, dto: UpdateBreachDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const exists = await this.prisma.privacyBreach.findFirst({ where: { AND: [{ id }, this.scopedWhere<Prisma.PrivacyBreachWhereInput>(scope, assetIds)] } });
    if (!exists) throw new NotFoundException('privacy breach not found');
    const finalBreachStatuses: BreachStatus[] = [BreachStatus.closed, BreachStatus.false_positive];
    if (dto.status && finalBreachStatuses.includes(dto.status) && exists.createdBy === actor) {
      throw new ForbiddenException('Privacy breach creators cannot close their own incident');
    }
    const row = await this.prisma.privacyBreach.update({
      where: { id },
      data: {
        status: dto.status,
        severity: dto.severity,
        containedAt: dto.containedAt ? new Date(dto.containedAt) : undefined,
        notifiedAt: dto.notifiedAt ? new Date(dto.notifiedAt) : undefined,
        regulatorNotified: dto.regulatorNotified,
        subjectNotified: dto.subjectNotified,
        updatedBy: actor,
      },
      include: breachInclude,
    });
    await this.audit.log({ actor, action: 'privacy_breach.update', entityType: 'privacy_breach', entityId: id });
    return this.decorateBreach(row);
  }

  async createConsent(roleCodes: string[], dto: CreateConsentRecordDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    if (!this.isUnrestricted(scope) && !dto.assetId) throw new BadRequestException('Consent records must be linked to a visible data asset');
    await this.assertAssetVisible(roleCodes, dto.assetId);
    await this.assertLegalBasis(dto.legalBasisId);
    const row = await this.prisma.privacyConsentRecord.create({
      data: {
        assetId: dto.assetId || null,
        subjectRef: dto.subjectRef,
        purpose: dto.purpose,
        legalBasisId: dto.legalBasisId || null,
        status: dto.status ?? 'active',
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        source: dto.source ?? 'manual',
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'privacy_consent.create', entityType: 'privacy_consent_record', entityId: row.id });
    return row;
  }

  async createRetentionRule(roleCodes: string[], dto: CreateRetentionRuleDto, actor: string) {
    await this.assertScopedWriteTarget(roleCodes, dto.assetId, dto.domainId, 'Retention rule');
    await this.assertPerson(dto.ownerPersonId, 'Owner');
    const row = await this.prisma.privacyRetentionRule.create({
      data: {
        code: await this.nextCode(this.prisma, 'privacyRetentionRule', 'code', 'RET'),
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        assetId: dto.assetId || null,
        domainId: dto.domainId || null,
        trigger: dto.trigger ?? 'creation',
        durationDays: dto.durationDays,
        action: dto.action ?? 'review',
        ownerPersonId: dto.ownerPersonId || null,
        nextReviewAt: dto.nextReviewAt ? new Date(dto.nextReviewAt) : addKsaBusinessDays(new Date(), 90),
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'privacy_retention_rule.create', entityType: 'privacy_retention_rule', entityId: row.id });
    return row;
  }
}
