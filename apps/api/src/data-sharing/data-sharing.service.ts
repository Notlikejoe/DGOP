import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CaseStatus,
  DataSharingAgreementStatus,
  DataSharingRequestStatus,
  DataSharingReviewDecision,
  DataSharingReviewStep,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { parsePageParams, toPaged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CreateDataSharingAgreementDto,
  CreateDataSharingRequestDto,
  CreateDataSharingUsageMetricDto,
  SaveDataSharingReviewDto,
  UpdateDataSharingAgreementDto,
  UpdateDataSharingRequestDto,
} from './data-sharing.dto';
import {
  DATA_SHARING_REVIEW_STEPS,
  addMonths,
  agreementRenewalStatus,
  calculateSharingRisk,
  statusFromReviews,
  usageStatus,
} from './data-sharing.logic';

export interface DataSharingFilters {
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
  },
};

const requestInclude = {
  legalBasis: true,
  asset: assetSelect,
  domain: refSelect,
  classification: classificationSelect,
  maskingPolicy: { select: { id: true, code: true, nameEn: true, nameAr: true, technique: true } },
  roleDataAccessMap: { select: { id: true, scopeKey: true, personalDataAllowed: true, approvalRequired: true } },
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
  reviews: { include: { reviewerPerson: personSelect }, orderBy: { step: 'asc' as const } },
  agreements: { include: { ownerPerson: personSelect }, orderBy: { updatedAt: 'desc' as const } },
};

const agreementInclude = {
  request: { select: { id: true, requestNumber: true, status: true } },
  asset: assetSelect,
  domain: refSelect,
  ownerPerson: personSelect,
  usageMetrics: { orderBy: { metricDate: 'desc' as const }, take: 8 },
};

type PrismaWriter = PrismaService | Prisma.TransactionClient;
type SharingRequestWithInclude = Prisma.DataSharingRequestGetPayload<{ include: typeof requestInclude }>;
type SharingAgreementWithInclude = Prisma.DataSharingAgreementGetPayload<{ include: typeof agreementInclude }>;
const NO_VISIBLE_RECORD_ID = '__no_visible_data_sharing_records__';

@Injectable()
export class DataSharingService {
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

  private visibleRecordBranches(scope: EffectiveScope, assetIds: Set<string> | 'all') {
    const branches: Prisma.DataSharingRequestWhereInput[] = [];
    if (assetIds !== 'all' && assetIds.size > 0) branches.push({ assetId: { in: [...assetIds] } });
    if (scope.orgUnits === 'all' && scope.domains !== 'all' && scope.domains.length > 0) {
      branches.push({ AND: [{ assetId: null }, { domainId: { in: scope.domains } }] });
    }
    return branches;
  }

  private requestScopeWhere(scope: EffectiveScope, assetIds: Set<string> | 'all'): Prisma.DataSharingRequestWhereInput {
    if (this.isUnrestricted(scope)) return { deletedAt: null };
    const branches = this.visibleRecordBranches(scope, assetIds);
    return branches.length ? { deletedAt: null, OR: branches } : { deletedAt: null, id: NO_VISIBLE_RECORD_ID };
  }

  private agreementScopeWhere(scope: EffectiveScope, assetIds: Set<string> | 'all'): Prisma.DataSharingAgreementWhereInput {
    if (this.isUnrestricted(scope)) return {};
    const branches = this.visibleRecordBranches(scope, assetIds) as Prisma.DataSharingAgreementWhereInput[];
    return branches.length ? { OR: branches } : { id: NO_VISIBLE_RECORD_ID };
  }

  private async assertAssetVisible(roleCodes: string[], assetId?: string | null) {
    if (!assetId) return null;
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.prisma.dataAsset.findFirst({
      where: { AND: [{ id: assetId }, this.assetScopeWhere(scope)] },
      include: { classification: classificationSelect },
    });
    if (!asset) throw new NotFoundException('data asset not found');
    return asset;
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

  private async assertOptionalReferences(roleCodes: string[], dto: { legalBasisId?: string | null; classificationId?: string | null; maskingPolicyId?: string | null; roleDataAccessMapId?: string | null }) {
    const scope = await this.scope.resolve(roleCodes);
    const [basis, classification, masking, accessMap] = await Promise.all([
      dto.legalBasisId ? this.prisma.privacyLegalBasis.findFirst({ where: { id: dto.legalBasisId, isActive: true }, select: { id: true } }) : Promise.resolve({ id: null }),
      dto.classificationId ? this.prisma.classification.findFirst({ where: { id: dto.classificationId, deletedAt: null }, select: { id: true, rank: true } }) : Promise.resolve({ id: null, rank: null }),
      dto.maskingPolicyId ? this.prisma.maskingPolicy.findFirst({ where: { id: dto.maskingPolicyId, deletedAt: null, isActive: true }, select: { id: true } }) : Promise.resolve({ id: null }),
      dto.roleDataAccessMapId ? this.prisma.roleDataAccessMap.findFirst({ where: { id: dto.roleDataAccessMapId, isActive: true }, select: { id: true } }) : Promise.resolve({ id: null }),
    ]);
    if (dto.legalBasisId && !basis) throw new BadRequestException('legal basis not found');
    if (dto.classificationId && !classification) throw new BadRequestException('classification not found');
    if (dto.classificationId && classification?.rank != null && scope.maxClassRank != null && classification.rank > scope.maxClassRank) {
      throw new NotFoundException('classification not found');
    }
    if (dto.maskingPolicyId && !masking) throw new BadRequestException('masking policy not found');
    if (dto.roleDataAccessMapId && !accessMap) throw new BadRequestException('role data access map not found');
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

  private async assertAgreementVisible(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const row = await this.prisma.dataSharingAgreement.findFirst({
      where: { AND: [{ id }, this.agreementScopeWhere(scope, assetIds)] },
      include: agreementInclude,
    });
    if (!row) throw new NotFoundException('data sharing agreement not found');
    return row;
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

  private async createWorkflow(client: Prisma.TransactionClient, request: { requestNumber: string; purpose: string; assetId?: string | null }, roleCodes: string[], actor: string): Promise<string> {
    if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
    const workflowCase = await this.workflow.openRoutedCase({
      roleCodes,
      actor,
      title: `Data sharing ${request.requestNumber}`,
      description: request.purpose,
      type: 'data_sharing_request',
      status: CaseStatus.submitted,
      assetId: request.assetId ?? null,
      preferredCode: await this.nextCode(client, 'workflowCase', 'code', 'WFC-DSI'),
    }, client);
    return workflowCase.id;
  }

  private decorateRequest<T extends SharingRequestWithInclude>(row: T) {
    return {
      ...row,
      reviewSummary: {
        total: row.reviews.length,
        approved: row.reviews.filter((review) => review.decision === DataSharingReviewDecision.approved).length,
        pending: row.reviews.filter((review) => review.decision === DataSharingReviewDecision.pending).length,
        blocked: row.reviews.filter((review) => review.decision === DataSharingReviewDecision.rejected || review.decision === DataSharingReviewDecision.needs_changes).length,
      },
    };
  }

  private decorateAgreement<T extends SharingAgreementWithInclude>(row: T) {
    return { ...row, renewalSignal: agreementRenewalStatus(row.renewalDueAt, row.status) };
  }

  async summary(roleCodes: string[]) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const scoped = this.requestScopeWhere(scope, assetIds);
    const agreementScoped = this.agreementScopeWhere(scope, assetIds);
    const [requests, agreements, reviews, usage] = await Promise.all([
      this.prisma.dataSharingRequest.findMany({ where: scoped, select: { status: true, riskScore: true } }),
      this.prisma.dataSharingAgreement.findMany({ where: agreementScoped, select: { status: true, renewalDueAt: true } }),
      this.prisma.dataSharingReview.count({ where: { decision: DataSharingReviewDecision.pending, request: { is: scoped } } }),
      this.prisma.dataSharingUsageMetric.aggregate({ where: { agreement: { is: agreementScoped } }, _sum: { recordsShared: true, apiCalls: true, incidents: true } }),
    ]);
    return {
      totalRequests: requests.length,
      underReview: requests.filter((row) => row.status === DataSharingRequestStatus.under_review || row.status === DataSharingRequestStatus.submitted).length,
      approved: requests.filter((row) => row.status === DataSharingRequestStatus.approved || row.status === DataSharingRequestStatus.agreement_active).length,
      highRisk: requests.filter((row) => row.riskScore >= 70).length,
      activeAgreements: agreements.filter((row) => row.status === DataSharingAgreementStatus.active).length,
      renewalDue: agreements.filter((row) => agreementRenewalStatus(row.renewalDueAt, row.status) === DataSharingAgreementStatus.renewal_due).length,
      pendingReviews: reviews,
      recordsShared: usage._sum.recordsShared ?? 0,
      apiCalls: usage._sum.apiCalls ?? 0,
      incidents: usage._sum.incidents ?? 0,
    };
  }

  async listRequests(roleCodes: string[], filters: DataSharingFilters) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const pageParams = parsePageParams(filters.page, filters.pageSize)!;
    const { skip, take } = pageParams;
    const clauses: Prisma.DataSharingRequestWhereInput[] = [this.requestScopeWhere(scope, assetIds)];
    if (filters.search) clauses.push({ OR: [{ requestNumber: { contains: filters.search, mode: 'insensitive' } }, { requesterOrg: { contains: filters.search, mode: 'insensitive' } }, { recipientOrg: { contains: filters.search, mode: 'insensitive' } }, { purpose: { contains: filters.search, mode: 'insensitive' } }] });
    if (filters.status) clauses.push({ status: filters.status as DataSharingRequestStatus });
    const where = { AND: clauses };
    const [rows, total] = await Promise.all([
      this.prisma.dataSharingRequest.findMany({ where, include: requestInclude, orderBy: [{ riskScore: 'desc' }, { updatedAt: 'desc' }], skip, take }),
      this.prisma.dataSharingRequest.count({ where }),
    ]);
    return toPaged(rows.map((row) => this.decorateRequest(row)), total, pageParams);
  }

  async getRequest(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const row = await this.prisma.dataSharingRequest.findFirst({
      where: { AND: [{ id }, this.requestScopeWhere(scope, assetIds)] },
      include: requestInclude,
    });
    if (!row) throw new NotFoundException('data sharing request not found');
    return this.decorateRequest(row);
  }

  async createRequest(roleCodes: string[], dto: CreateDataSharingRequestDto, actor: string) {
    const asset = await this.assertScopedWriteTarget(roleCodes, dto.assetId, dto.domainId, 'Data sharing request');
    await this.assertOptionalReferences(roleCodes, dto);
    const risk = calculateSharingRisk({
      classificationRank: asset?.classification?.rank ?? null,
      consentRequired: dto.consentRequired,
      crossBorderTransfer: dto.crossBorderTransfer,
      hasMasking: Boolean(dto.maskingPolicyId),
      hasLegalBasis: Boolean(dto.legalBasisId),
    });
    return this.prisma.$transaction(async (tx) => {
      const requestNumber = await this.nextCode(tx, 'dataSharingRequest', 'requestNumber', 'DSI');
      const request = await tx.dataSharingRequest.create({
        data: {
          requestNumber,
          requesterOrg: dto.requesterOrg,
          recipientOrg: dto.recipientOrg,
          purpose: dto.purpose,
          legalBasisId: dto.legalBasisId || null,
          assetId: dto.assetId || null,
          domainId: dto.domainId ?? asset?.domainId ?? null,
          classificationId: dto.classificationId ?? asset?.classificationId ?? null,
          maskingPolicyId: dto.maskingPolicyId || null,
          roleDataAccessMapId: dto.roleDataAccessMapId || null,
          consentRequired: dto.consentRequired ?? false,
          crossBorderTransfer: dto.crossBorderTransfer ?? false,
          status: DataSharingRequestStatus.under_review,
          riskScore: risk.riskScore,
          requiredControlsJson: risk.controls,
          createdBy: actor,
        },
        select: { id: true, requestNumber: true, purpose: true, assetId: true },
      });
      for (const step of DATA_SHARING_REVIEW_STEPS) {
        await tx.dataSharingReview.create({
          data: { requestId: request.id, step, decision: DataSharingReviewDecision.pending, createdBy: actor },
        });
      }
      const workflowCaseId = await this.createWorkflow(tx, request, roleCodes, actor);
      await tx.dataSharingRequest.update({ where: { id: request.id }, data: { workflowCaseId } });
      await this.audit.log({
        actor,
        action: 'data_sharing_request.create',
        entityType: 'data_sharing_request',
        entityId: request.id,
      }, tx);
      return tx.dataSharingRequest.findUniqueOrThrow({ where: { id: request.id }, include: requestInclude });
    }).then((row) => this.decorateRequest(row));
  }

  async updateRequest(roleCodes: string[], id: string, dto: UpdateDataSharingRequestDto, actor: string) {
    await this.getRequest(roleCodes, id);
    if (dto.status !== undefined) throw new BadRequestException('Data sharing request status is controlled by review decisions and agreements');
    if (dto.riskScore !== undefined) throw new BadRequestException('Data sharing risk is calculated from request controls');
    const row = await this.prisma.dataSharingRequest.update({
      where: { id },
      data: { purpose: dto.purpose, updatedBy: actor },
      include: requestInclude,
    });
    await this.audit.log({ actor, action: 'data_sharing_request.update', entityType: 'data_sharing_request', entityId: id });
    return this.decorateRequest(row);
  }

  async saveReview(roleCodes: string[], id: string, dto: SaveDataSharingReviewDto, actor: string) {
    const request = await this.getRequest(roleCodes, id);
    if (dto.decision && dto.decision !== DataSharingReviewDecision.pending && request.createdBy === actor) {
      throw new ForbiddenException('Request creators cannot approve or reject their own data sharing request');
    }
    await this.assertPerson(dto.reviewerPersonId, 'Reviewer');
    await this.prisma.dataSharingReview.upsert({
      where: { requestId_step: { requestId: id, step: dto.step } },
      create: {
        requestId: id,
        step: dto.step,
        decision: dto.decision ?? DataSharingReviewDecision.pending,
        reviewerPersonId: dto.reviewerPersonId || null,
        note: dto.note ?? null,
        decidedAt: dto.decision && dto.decision !== DataSharingReviewDecision.pending ? new Date() : null,
        createdBy: actor,
      },
      update: {
        decision: dto.decision ?? DataSharingReviewDecision.pending,
        reviewerPersonId: dto.reviewerPersonId || null,
        note: dto.note ?? null,
        decidedAt: dto.decision && dto.decision !== DataSharingReviewDecision.pending ? new Date() : null,
      },
    });
    const reviews = await this.prisma.dataSharingReview.findMany({ where: { requestId: id }, select: { decision: true } });
    await this.prisma.dataSharingRequest.update({ where: { id }, data: { status: statusFromReviews(reviews), updatedBy: actor } });
    await this.audit.log({ actor, action: 'data_sharing_review.upsert', entityType: 'data_sharing_request', entityId: id, metadata: { step: dto.step } });
    return this.getRequest(roleCodes, id);
  }

  async listAgreements(roleCodes: string[], filters: DataSharingFilters) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, scope);
    const pageParams = parsePageParams(filters.page, filters.pageSize)!;
    const { skip, take } = pageParams;
    const clauses: Prisma.DataSharingAgreementWhereInput[] = [this.agreementScopeWhere(scope, assetIds)];
    if (filters.search) clauses.push({ OR: [{ agreementNumber: { contains: filters.search, mode: 'insensitive' } }, { recipientOrg: { contains: filters.search, mode: 'insensitive' } }, { purpose: { contains: filters.search, mode: 'insensitive' } }] });
    if (filters.status) clauses.push({ status: filters.status as DataSharingAgreementStatus });
    const where = clauses.length ? { AND: clauses } : {};
    const [rows, total] = await Promise.all([
      this.prisma.dataSharingAgreement.findMany({ where, include: agreementInclude, orderBy: { updatedAt: 'desc' }, skip, take }),
      this.prisma.dataSharingAgreement.count({ where }),
    ]);
    return toPaged(rows.map((row) => this.decorateAgreement(row)), total, pageParams);
  }

  async createAgreement(roleCodes: string[], dto: CreateDataSharingAgreementDto, actor: string) {
    const request = dto.requestId ? await this.getRequest(roleCodes, dto.requestId) : null;
    if (request && request.status !== DataSharingRequestStatus.approved && request.status !== DataSharingRequestStatus.agreement_active) {
      throw new BadRequestException('Only an approved data sharing request can become an agreement');
    }
    await this.assertScopedWriteTarget(roleCodes, dto.assetId ?? request?.assetId, dto.domainId ?? request?.domainId, 'Data sharing agreement');
    await this.assertPerson(dto.ownerPersonId, 'Owner');
    const startAt = dto.startAt ? new Date(dto.startAt) : new Date();
    const row = await this.prisma.dataSharingAgreement.create({
      data: {
        agreementNumber: await this.nextCode(this.prisma, 'dataSharingAgreement', 'agreementNumber', 'DSA'),
        requestId: dto.requestId || null,
        assetId: dto.assetId ?? request?.assetId ?? null,
        domainId: dto.domainId ?? request?.domainId ?? null,
        recipientOrg: dto.recipientOrg,
        purpose: dto.purpose,
        status: dto.status ?? DataSharingAgreementStatus.active,
        ownerPersonId: dto.ownerPersonId || null,
        agreementUrl: dto.agreementUrl || null,
        startAt,
        endAt: dto.endAt ? new Date(dto.endAt) : addMonths(startAt, 12),
        renewalDueAt: dto.renewalDueAt ? new Date(dto.renewalDueAt) : addMonths(startAt, 11),
        createdBy: actor,
      },
      include: agreementInclude,
    });
    if (dto.requestId) {
      await this.prisma.dataSharingRequest.update({ where: { id: dto.requestId }, data: { status: DataSharingRequestStatus.agreement_active, updatedBy: actor } });
    }
    await this.audit.log({ actor, action: 'data_sharing_agreement.create', entityType: 'data_sharing_agreement', entityId: row.id });
    return this.decorateAgreement(row);
  }

  async updateAgreement(roleCodes: string[], id: string, dto: UpdateDataSharingAgreementDto, actor: string) {
    await this.assertAgreementVisible(roleCodes, id);
    const row = await this.prisma.dataSharingAgreement.update({
      where: { id },
      data: {
        status: dto.status,
        agreementUrl: dto.agreementUrl,
        renewalDueAt: dto.renewalDueAt ? new Date(dto.renewalDueAt) : undefined,
        retiredAt: dto.retiredAt ? new Date(dto.retiredAt) : undefined,
        updatedBy: actor,
      },
      include: agreementInclude,
    });
    await this.audit.log({ actor, action: 'data_sharing_agreement.update', entityType: 'data_sharing_agreement', entityId: row.id });
    return this.decorateAgreement(row);
  }

  async recordUsage(roleCodes: string[], id: string, dto: CreateDataSharingUsageMetricDto, actor: string) {
    await this.assertAgreementVisible(roleCodes, id);
    const row = await this.prisma.dataSharingUsageMetric.create({
      data: {
        agreementId: id,
        metricDate: dto.metricDate ? new Date(dto.metricDate) : new Date(),
        recordsShared: dto.recordsShared ?? 0,
        apiCalls: dto.apiCalls ?? 0,
        incidents: dto.incidents ?? 0,
        status: dto.status ?? usageStatus(dto),
        note: dto.note ?? null,
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'data_sharing_usage.create', entityType: 'data_sharing_usage_metric', entityId: row.id });
    return row;
  }
}
