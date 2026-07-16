import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CaseStatus,
  FoiAppealStatus,
  FoiDecisionOutcome,
  FoiRequestChannel,
  FoiRequestStatus,
  FoiReviewStatus,
  FoiReviewType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { parsePageParams, toPaged } from '../common/pagination';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CreateFoiAppealDto,
  CreateFoiDisclosureDto,
  CreateFoiExemptionDto,
  CreateFoiRequestDto,
  SaveFoiDecisionDto,
  SaveFoiReviewDto,
  UpdateFoiRequestDto,
} from './foi.dto';
import { addKsaBusinessDays, canDiscloseFoi, foiSlaStatus, statusForFoiDecision } from './foi.logic';

export interface FoiRequestFilters {
  search?: string;
  status?: FoiRequestStatus;
  channel?: FoiRequestChannel;
  page?: string | number;
  pageSize?: string | number;
}

const refSelect = { select: { id: true, code: true, nameEn: true, nameAr: true } };
const classificationSelect = { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } };
const personSelect = { select: { id: true, fullNameEn: true, fullNameAr: true, email: true, jobTitle: true, userId: true } };

const requestInclude = {
  assignedOfficer: personSelect,
  asset: { select: { id: true, code: true, nameEn: true, nameAr: true, domainId: true, classificationId: true, domain: refSelect, classification: classificationSelect } },
  dataDomain: refSelect,
  classification: classificationSelect,
  responseTemplate: { select: { id: true, code: true, nameEn: true, nameAr: true, outcome: true } },
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
  reviews: { include: { reviewer: personSelect }, orderBy: { createdAt: 'asc' as const } },
  exemptions: { include: { classification: classificationSelect }, orderBy: { createdAt: 'desc' as const } },
  decisions: { include: { responseTemplate: { select: { id: true, code: true, nameEn: true, nameAr: true } } }, orderBy: { decidedAt: 'desc' as const } },
  disclosures: { orderBy: { releasedAt: 'desc' as const } },
  appeals: { include: { assignedOfficer: personSelect, workflowCase: { select: { id: true, code: true, status: true } } }, orderBy: { submittedAt: 'desc' as const } },
};

type RequestWithInclude = Prisma.FoiRequestGetPayload<{ include: typeof requestInclude }>;
type PrismaWriter = PrismaService | Prisma.TransactionClient;

@Injectable()
export class FoiService {
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

  private async visibleAssetIds(roleCodes: string[]): Promise<Set<string> | 'all'> {
    const scope = await this.scope.resolve(roleCodes);
    if (scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null) return 'all';
    const rows = await this.prisma.dataAsset.findMany({ where: this.assetScopeWhere(scope), select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  private requestScopeWhere(assetIds: Set<string> | 'all'): Prisma.FoiRequestWhereInput {
    if (assetIds === 'all') return { deletedAt: null };
    if (assetIds.size === 0) return { deletedAt: null, assetId: null };
    return { deletedAt: null, OR: [{ assetId: { in: [...assetIds] } }, { assetId: null }] };
  }

  private async assertAssetVisible(roleCodes: string[], assetId?: string | null) {
    if (!assetId) return null;
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.prisma.dataAsset.findFirst({
      where: { AND: [{ id: assetId }, this.assetScopeWhere(scope)] },
      select: { id: true, domainId: true, classificationId: true },
    });
    if (!asset) throw new NotFoundException('data asset not found');
    return asset;
  }

  private async assertDomainVisible(roleCodes: string[], dataDomainId?: string | null): Promise<void> {
    if (!dataDomainId) return;
    const scope = await this.scope.resolve(roleCodes);
    if (scope.domains !== 'all' && !scope.domains.includes(dataDomainId)) {
      throw new NotFoundException('data domain not found');
    }
    const domain = await this.prisma.dataDomain.findFirst({ where: { id: dataDomainId, deletedAt: null }, select: { id: true } });
    if (!domain) throw new NotFoundException('data domain not found');
  }

  private async assertClassification(id?: string | null): Promise<void> {
    if (!id) return;
    const classification = await this.prisma.classification.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!classification) throw new BadRequestException('classification not found');
  }

  private async assertPerson(id?: string | null, label = 'Person'): Promise<void> {
    if (!id) return;
    const person = await this.prisma.person.findFirst({ where: { id, deletedAt: null, isActive: true }, select: { id: true } });
    if (!person) throw new BadRequestException(`${label} not found`);
  }

  private async requireRequest(roleCodes: string[], id: string): Promise<RequestWithInclude> {
    const request = await this.prisma.foiRequest.findFirst({
      where: { AND: [{ id }, this.requestScopeWhere(await this.visibleAssetIds(roleCodes))] },
      include: requestInclude,
    });
    if (!request) throw new NotFoundException('foi request not found');
    return this.decorate(request);
  }

  private decorate<T extends RequestWithInclude>(request: T): T & { slaStatus: ReturnType<typeof foiSlaStatus> } {
    return { ...request, slaStatus: foiSlaStatus(request.dueAt, request.status) };
  }

  private async nextRequestNumber(client: PrismaWriter): Promise<string> {
    const year = new Date().getFullYear();
    const count = await client.foiRequest.count({ where: { requestNumber: { startsWith: `FOI-${year}-` } } });
    for (let offset = 1; offset < 1000; offset += 1) {
      const requestNumber = `FOI-${year}-${String(count + offset).padStart(4, '0')}`;
      const exists = await client.foiRequest.findUnique({ where: { requestNumber } });
      if (!exists) return requestNumber;
    }
    throw new BadRequestException('Could not generate FOI request number');
  }

  private async nextAppealNumber(client: PrismaWriter): Promise<string> {
    const year = new Date().getFullYear();
    const count = await client.foiAppeal.count({ where: { appealNumber: { startsWith: `FOIA-${year}-` } } });
    for (let offset = 1; offset < 1000; offset += 1) {
      const appealNumber = `FOIA-${year}-${String(count + offset).padStart(4, '0')}`;
      const exists = await client.foiAppeal.findUnique({ where: { appealNumber } });
      if (!exists) return appealNumber;
    }
    throw new BadRequestException('Could not generate FOI appeal number');
  }

  private async nextWorkflowCaseCode(client: PrismaWriter): Promise<string> {
    const count = await client.workflowCase.count();
    for (let offset = 1; offset < 1000; offset += 1) {
      const code = `WFC-FOI-${String(count + offset).padStart(4, '0')}`;
      const exists = await client.workflowCase.findUnique({ where: { code } });
      if (!exists) return code;
    }
    throw new BadRequestException('Could not generate workflow case code');
  }

  private async createWorkflowForRequest(client: Prisma.TransactionClient, request: { id: string; requestNumber: string; subject: string; assetId?: string | null; assignedOfficerPersonId?: string | null }, roleCodes: string[], actor: string): Promise<string> {
    const officer = request.assignedOfficerPersonId
      ? await client.person.findFirst({ where: { id: request.assignedOfficerPersonId }, select: { userId: true } })
      : null;
    if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
    const workflowCase = await this.workflow.openRoutedCase({
      roleCodes,
      actor,
      title: `FOI request ${request.requestNumber}`,
      description: request.subject,
      type: 'foi_request',
      status: CaseStatus.submitted,
      assetId: request.assetId ?? null,
      initialAssigneeUserId: officer?.userId ?? null,
      initialDueDate: addKsaBusinessDays(new Date(), 1),
      initialTaskTitle: 'Validate FOI intake and prepare review',
      preferredCode: await this.nextWorkflowCaseCode(client),
    }, client);
    await client.workflowEvent.create({
      data: { caseId: workflowCase.id, actor, action: 'foi_request.workflow_created', comment: `Created for ${request.requestNumber}.` },
    });
    return workflowCase.id;
  }

  private async createWorkflowForAppeal(client: Prisma.TransactionClient, appeal: { id: string; appealNumber: string; requestId: string; assignedOfficerPersonId?: string | null }, roleCodes: string[], actor: string): Promise<string> {
    const officer = appeal.assignedOfficerPersonId
      ? await client.person.findFirst({ where: { id: appeal.assignedOfficerPersonId }, select: { userId: true } })
      : null;
    if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
    const workflowCase = await this.workflow.openRoutedCase({
      roleCodes,
      actor,
      title: `FOI appeal ${appeal.appealNumber}`,
      description: `Appeal for FOI request ${appeal.requestId}.`,
      type: 'foi_appeal',
      status: CaseStatus.submitted,
      initialAssigneeUserId: officer?.userId ?? null,
      initialDueDate: addKsaBusinessDays(new Date(), 5),
      initialTaskTitle: 'Review FOI appeal independently',
      preferredCode: await this.nextWorkflowCaseCode(client),
    }, client);
    await client.workflowEvent.create({
      data: { caseId: workflowCase.id, actor, action: 'foi_appeal.workflow_created', comment: `Created for ${appeal.appealNumber}.` },
    });
    return workflowCase.id;
  }

  async summary(roleCodes: string[]) {
    const where = this.requestScopeWhere(await this.visibleAssetIds(roleCodes));
    const [total, open, overdueRows, dueSoonRows, appeals, disclosures] = await Promise.all([
      this.prisma.foiRequest.count({ where }),
      this.prisma.foiRequest.count({ where: { ...where, status: { in: [FoiRequestStatus.registered, FoiRequestStatus.under_review, FoiRequestStatus.awaiting_clarification, FoiRequestStatus.decision_due, FoiRequestStatus.extended] } } }),
      this.prisma.foiRequest.findMany({ where, select: { dueAt: true, status: true } }),
      this.prisma.foiRequest.findMany({ where, select: { dueAt: true, status: true } }),
      this.prisma.foiAppeal.count({ where: { request: { is: where } } }),
      this.prisma.foiDisclosure.count({ where: { request: { is: where } } }),
    ]);
    return {
      total,
      open,
      overdue: overdueRows.filter((row) => foiSlaStatus(row.dueAt, row.status) === 'overdue').length,
      dueSoon: dueSoonRows.filter((row) => foiSlaStatus(row.dueAt, row.status) === 'due_soon').length,
      appeals,
      disclosures,
    };
  }

  async list(roleCodes: string[], filters: FoiRequestFilters) {
    const scoped = this.requestScopeWhere(await this.visibleAssetIds(roleCodes));
    const clauses: Prisma.FoiRequestWhereInput[] = [scoped];
    if (filters.status) clauses.push({ status: filters.status });
    if (filters.channel) clauses.push({ channel: filters.channel });
    if (filters.search?.trim()) {
      const q = filters.search.trim();
      clauses.push({
        OR: [
          { requestNumber: { contains: q, mode: 'insensitive' } },
          { requesterName: { contains: q, mode: 'insensitive' } },
          { requesterEmail: { contains: q, mode: 'insensitive' } },
          { subject: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.FoiRequestWhereInput = { AND: clauses };
    const paging = parsePageParams(filters.page, filters.pageSize);
    if (paging) {
      const [rows, total] = await Promise.all([
        this.prisma.foiRequest.findMany({
          where,
          include: requestInclude,
          orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
          skip: (paging.page - 1) * paging.pageSize,
          take: paging.pageSize,
        }),
        this.prisma.foiRequest.count({ where }),
      ]);
      return toPaged(rows.map((row) => this.decorate(row)), total, paging);
    }
    const rows = await this.prisma.foiRequest.findMany({ where, include: requestInclude, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }] });
    return rows.map((row) => this.decorate(row));
  }

  get(roleCodes: string[], id: string) {
    return this.requireRequest(roleCodes, id);
  }

  templates() {
    return this.prisma.foiResponseTemplate.findMany({ where: { isActive: true }, orderBy: [{ outcome: 'asc' }, { code: 'asc' }] });
  }

  async create(roleCodes: string[], dto: CreateFoiRequestDto, actor: string) {
    const asset = await this.assertAssetVisible(roleCodes, dto.assetId);
    const dataDomainId = dto.dataDomainId ?? asset?.domainId ?? null;
    const classificationId = dto.classificationId ?? asset?.classificationId ?? null;
    await Promise.all([
      this.assertDomainVisible(roleCodes, dataDomainId),
      this.assertClassification(classificationId),
      this.assertPerson(dto.assignedOfficerPersonId, 'Assigned officer'),
    ]);
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.foiRequest.create({
        data: {
          requestNumber: await this.nextRequestNumber(tx),
          requesterName: dto.requesterName,
          requesterEmail: dto.requesterEmail ?? null,
          requesterPhone: dto.requesterPhone ?? null,
          requesterType: dto.requesterType ?? 'individual',
          channel: dto.channel ?? 'manual',
          category: dto.category ?? 'record_request',
          subject: dto.subject,
          description: dto.description,
          receivedAt,
          dueAt: addKsaBusinessDays(receivedAt, 20),
          identityValidated: dto.identityValidated ?? false,
          contactValidated: dto.contactValidated ?? !!dto.requesterEmail,
          assignedOfficerPersonId: dto.assignedOfficerPersonId ?? null,
          assetId: dto.assetId ?? null,
          dataDomainId,
          classificationId,
          createdBy: actor,
        },
        select: { id: true, requestNumber: true, subject: true, assetId: true, assignedOfficerPersonId: true },
      });
      const workflowCaseId = await this.createWorkflowForRequest(tx, created, roleCodes, actor);
      await tx.foiRequest.update({ where: { id: created.id }, data: { workflowCaseId } });
      for (const reviewType of [FoiReviewType.classification, FoiReviewType.privacy, FoiReviewType.legal]) {
        await tx.foiReview.create({ data: { requestId: created.id, reviewType, status: FoiReviewStatus.pending, createdBy: actor } });
      }
      await this.audit.log({
        actor,
        action: 'foi_request.create',
        entityType: 'foi_request',
        entityId: created.id,
        metadata: { requestNumber: created.requestNumber },
      }, tx);
      return created;
    });
    return this.get(roleCodes, request.id);
  }

  async update(roleCodes: string[], id: string, dto: UpdateFoiRequestDto, actor: string) {
    await this.requireRequest(roleCodes, id);
    const asset = await this.assertAssetVisible(roleCodes, dto.assetId);
    const dataDomainId = dto.dataDomainId ?? asset?.domainId;
    await Promise.all([
      this.assertDomainVisible(roleCodes, dataDomainId),
      this.assertClassification(dto.classificationId ?? asset?.classificationId),
      this.assertPerson(dto.assignedOfficerPersonId, 'Assigned officer'),
    ]);
    const data: Prisma.FoiRequestUpdateInput = {
      updatedBy: actor,
      ...(dto.requesterName !== undefined ? { requesterName: dto.requesterName } : {}),
      ...(dto.requesterEmail !== undefined ? { requesterEmail: dto.requesterEmail } : {}),
      ...(dto.requesterPhone !== undefined ? { requesterPhone: dto.requesterPhone } : {}),
      ...(dto.requesterType !== undefined ? { requesterType: dto.requesterType } : {}),
      ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.receivedAt !== undefined ? { receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : undefined } : {}),
      ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.identityValidated !== undefined ? { identityValidated: dto.identityValidated } : {}),
      ...(dto.contactValidated !== undefined ? { contactValidated: dto.contactValidated } : {}),
      ...(dto.assignedOfficerPersonId !== undefined ? { assignedOfficer: dto.assignedOfficerPersonId ? { connect: { id: dto.assignedOfficerPersonId } } : { disconnect: true } } : {}),
      ...(dto.assetId !== undefined ? { asset: dto.assetId ? { connect: { id: dto.assetId } } : { disconnect: true } } : {}),
      ...(dataDomainId !== undefined ? { dataDomain: dataDomainId ? { connect: { id: dataDomainId } } : { disconnect: true } } : {}),
      ...(dto.classificationId !== undefined || asset?.classificationId !== undefined ? { classification: (dto.classificationId ?? asset?.classificationId) ? { connect: { id: dto.classificationId ?? asset?.classificationId ?? '' } } : { disconnect: true } } : {}),
    };
    await this.prisma.foiRequest.update({ where: { id }, data });
    await this.audit.log({ actor, action: 'foi_request.update', entityType: 'foi_request', entityId: id });
    return this.get(roleCodes, id);
  }

  async saveReview(roleCodes: string[], id: string, dto: SaveFoiReviewDto, actor: string) {
    await this.requireRequest(roleCodes, id);
    await this.assertPerson(dto.reviewerPersonId, 'Reviewer');
    await this.prisma.foiReview.upsert({
      where: { requestId_reviewType: { requestId: id, reviewType: dto.reviewType } },
      update: {
        status: dto.status ?? FoiReviewStatus.completed,
        reviewerPersonId: dto.reviewerPersonId ?? null,
        note: dto.note ?? null,
        evidenceSummary: dto.evidenceSummary ?? null,
        completedAt: dto.status === FoiReviewStatus.pending ? null : new Date(),
      },
      create: {
        requestId: id,
        reviewType: dto.reviewType,
        status: dto.status ?? FoiReviewStatus.completed,
        reviewerPersonId: dto.reviewerPersonId ?? null,
        note: dto.note ?? null,
        evidenceSummary: dto.evidenceSummary ?? null,
        completedAt: dto.status === FoiReviewStatus.pending ? null : new Date(),
        createdBy: actor,
      },
    });
    await this.prisma.foiRequest.update({ where: { id }, data: { status: FoiRequestStatus.under_review, updatedBy: actor } });
    await this.audit.log({ actor, action: 'foi_review.save', entityType: 'foi_request', entityId: id, metadata: { reviewType: dto.reviewType } });
    return this.get(roleCodes, id);
  }

  async createExemption(roleCodes: string[], id: string, dto: CreateFoiExemptionDto, actor: string) {
    await this.requireRequest(roleCodes, id);
    await this.assertClassification(dto.classificationId);
    await this.prisma.foiExemptionEvidence.create({
      data: {
        requestId: id,
        basisCode: dto.basisCode,
        title: dto.title,
        description: dto.description ?? null,
        classificationId: dto.classificationId ?? null,
        recordedBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'foi_exemption.create', entityType: 'foi_request', entityId: id, metadata: { basisCode: dto.basisCode } });
    return this.get(roleCodes, id);
  }

  async saveDecision(roleCodes: string[], id: string, dto: SaveFoiDecisionDto, actor: string) {
    const current = await this.requireRequest(roleCodes, id);
    const extendedDueAt = dto.outcome === FoiDecisionOutcome.extended
      ? (dto.extendedDueAt ? new Date(dto.extendedDueAt) : addKsaBusinessDays(current.dueAt, 10))
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.foiDecision.create({
        data: {
          requestId: id,
          outcome: dto.outcome,
          summary: dto.summary,
          justification: dto.justification,
          responseTemplateId: dto.responseTemplateId ?? null,
          decidedBy: actor,
          extendedDueAt,
        },
      });
      await tx.foiRequest.update({
        where: { id },
        data: {
          status: statusForFoiDecision(dto.outcome),
          decisionOutcome: dto.outcome,
          decisionSummary: dto.summary,
          responseTemplateId: dto.responseTemplateId ?? null,
          extendedDueAt,
          dueAt: extendedDueAt ?? current.dueAt,
          updatedBy: actor,
        },
      });
      if (current.workflowCaseId) {
        if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
        await this.workflow.recordDomainCaseProgress({
          caseId: current.workflowCaseId,
          roleCodes,
          actor,
          targetStatus: CaseStatus.decision_made,
          eventAction: 'foi_decision.recorded',
          comment: dto.outcome,
        }, tx);
      }
      await this.audit.log({
        actor,
        action: 'foi_decision.save',
        entityType: 'foi_request',
        entityId: id,
        metadata: { outcome: dto.outcome },
      }, tx);
    });
    return this.get(roleCodes, id);
  }

  async createDisclosure(roleCodes: string[], id: string, dto: CreateFoiDisclosureDto, actor: string) {
    const current = await this.requireRequest(roleCodes, id);
    if (!canDiscloseFoi(current.status)) {
      throw new BadRequestException('FOI request must be approved or partially approved before disclosure');
    }
    const decision = current.decisions.find((row) => row.outcome === FoiDecisionOutcome.approved || row.outcome === FoiDecisionOutcome.partially_approved);
    await this.prisma.$transaction(async (tx) => {
      await tx.foiDisclosure.create({
        data: {
          requestId: id,
          decisionId: decision?.id ?? null,
          method: dto.method ?? 'secure_link',
          recipient: dto.recipient,
          recordUrl: dto.recordUrl ?? null,
          summary: dto.summary ?? null,
          disclosedBy: actor,
        },
      });
      await tx.foiRequest.update({ where: { id }, data: { status: FoiRequestStatus.disclosed, updatedBy: actor } });
      if (current.workflowCaseId) {
        if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
        await this.workflow.recordDomainCaseProgress({
          caseId: current.workflowCaseId,
          roleCodes,
          actor,
          targetStatus: CaseStatus.closed,
          eventAction: 'foi_disclosure.recorded',
          comment: dto.summary ?? 'Disclosure recorded.',
          completeOpenTasks: true,
        }, tx);
      }
      await this.audit.log({
        actor,
        action: 'foi_disclosure.create',
        entityType: 'foi_request',
        entityId: id,
      }, tx);
    });
    return this.get(roleCodes, id);
  }

  async createAppeal(roleCodes: string[], id: string, dto: CreateFoiAppealDto, actor: string) {
    await this.requireRequest(roleCodes, id);
    await this.assertPerson(dto.assignedOfficerPersonId, 'Appeal officer');
    const appeal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.foiAppeal.create({
        data: {
          requestId: id,
          appealNumber: await this.nextAppealNumber(tx),
          status: dto.status ?? FoiAppealStatus.submitted,
          reason: dto.reason,
          dueAt: addKsaBusinessDays(new Date(), 10),
          assignedOfficerPersonId: dto.assignedOfficerPersonId ?? null,
          createdBy: actor,
        },
        select: { id: true, appealNumber: true, requestId: true, assignedOfficerPersonId: true },
      });
      const workflowCaseId = await this.createWorkflowForAppeal(tx, created, roleCodes, actor);
      await tx.foiAppeal.update({ where: { id: created.id }, data: { workflowCaseId } });
      await tx.foiRequest.update({ where: { id }, data: { status: FoiRequestStatus.appealed, updatedBy: actor } });
      await this.audit.log({
        actor,
        action: 'foi_appeal.create',
        entityType: 'foi_request',
        entityId: id,
        metadata: { appealNumber: created.appealNumber },
      }, tx);
      return created;
    });
    return this.get(roleCodes, appeal.requestId);
  }
}
