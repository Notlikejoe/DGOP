import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessGlossaryStatus,
  BusinessLineageStatus,
  CaseStatus,
  DataValueStatus,
  LifecycleDecisionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CreateBusinessImpactAssessmentDto,
  CreateBusinessLineageDto,
  CreateDataAssetValuationDto,
  CreateDataUserSurveyDto,
  CreateDataValueKpiDto,
  CreateGlossaryTermDto,
  CreateLifecycleDecisionDto,
  DecideGlossaryTermDto,
  DecideLifecycleDecisionDto,
  UpdateBusinessLineageDto,
} from './business-value.dto';
import {
  averageScore,
  clampScore,
  dataValueStatus,
  glossaryHealth,
  impactLevelFromScore,
} from './business-value.logic';

const assetSelect = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  lifecycleStatus: true,
  ownerName: true,
  domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  classification: { select: { id: true, code: true, nameEn: true, rank: true } },
};

const domainSelect = { id: true, code: true, nameEn: true, nameAr: true };
const workflowSelect = { id: true, code: true, status: true, title: true };
const FINAL_GLOSSARY_STATUSES = new Set<BusinessGlossaryStatus>([
  BusinessGlossaryStatus.approved,
  BusinessGlossaryStatus.needs_revision,
  BusinessGlossaryStatus.retired,
  BusinessGlossaryStatus.expired,
]);
const FINAL_LIFECYCLE_STATUSES = new Set<LifecycleDecisionStatus>([
  LifecycleDecisionStatus.approved,
  LifecycleDecisionStatus.implemented,
  LifecycleDecisionStatus.rejected,
]);

@Injectable()
export class BusinessValueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly workflow?: WorkflowService,
  ) {}

  private isUnrestricted(scope: EffectiveScope): boolean {
    return scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
  }

  private assetScopeWhere(scope: EffectiveScope): Prisma.DataAssetWhereInput {
    const where: Prisma.DataAssetWhereInput = { deletedAt: null, isActive: true };
    if (scope.orgUnits !== 'all') where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== 'all') where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [{ classificationId: null }, { classification: { rank: { lte: scope.maxClassRank } } }];
    }
    return where;
  }

  private async visibleAssetIds(scope: EffectiveScope): Promise<Set<string> | 'all'> {
    if (this.isUnrestricted(scope)) return 'all';
    const rows = await this.prisma.dataAsset.findMany({
      where: this.assetScopeWhere(scope),
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  private assetRecordWhere(assetIds: Set<string> | 'all', field = 'assetId'): Record<string, unknown> {
    if (assetIds === 'all') return {};
    return assetIds.size ? { [field]: { in: [...assetIds] } } : { id: '__no_visible_business_value_records__' };
  }

  private optionalScopeWhere(
    scope: EffectiveScope,
    assetIds: Set<string> | 'all',
    assetField = 'assetId',
    domainField = 'domainId',
  ): Record<string, unknown> {
    if (this.isUnrestricted(scope)) return {};
    const branches: Record<string, unknown>[] = [];
    if (assetIds !== 'all' && assetIds.size) branches.push({ [assetField]: { in: [...assetIds] } });
    if (scope.domains !== 'all' && scope.domains.length) branches.push({ [domainField]: { in: scope.domains } });
    return branches.length ? { OR: branches } : { id: '__no_visible_business_value_records__' };
  }

  private lineageScopeWhere(scope: EffectiveScope, assetIds: Set<string> | 'all'): Prisma.BusinessLineageMapWhereInput {
    if (this.isUnrestricted(scope)) return {};
    const branches: Prisma.BusinessLineageMapWhereInput[] = [];
    if (assetIds !== 'all' && assetIds.size) {
      branches.push({ sourceAssetId: { in: [...assetIds] } }, { targetAssetId: { in: [...assetIds] } });
    }
    if (scope.domains !== 'all' && scope.domains.length) branches.push({ domainId: { in: scope.domains } });
    return branches.length ? { OR: branches } : { id: '__no_visible_business_lineage_records__' };
  }

  private async assertAssetVisible(scope: EffectiveScope, assetId: string) {
    const asset = await this.prisma.dataAsset.findFirst({
      where: { AND: [{ id: assetId }, this.assetScopeWhere(scope)] },
      select: { id: true, code: true, nameEn: true, lifecycleStatus: true, domainId: true },
    });
    if (!asset) throw new NotFoundException('data asset not found');
    return asset;
  }

  private async assertDomainVisible(scope: EffectiveScope, domainId?: string | null) {
    if (!domainId) return null;
    if (scope.domains !== 'all' && !scope.domains.includes(domainId)) throw new NotFoundException('data domain not found');
    const domain = await this.prisma.dataDomain.findFirst({
      where: { id: domainId, deletedAt: null },
      select: { id: true, code: true, nameEn: true },
    });
    if (!domain) throw new NotFoundException('data domain not found');
    return domain;
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid date value');
    return parsed;
  }

  async workspace(roleCodes: string[]) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(scope);
    const optionalWhere = this.optionalScopeWhere(scope, assetIds);
    const [glossary, lineage, valuations, lifecycle, assessments, kpis, surveys] = await Promise.all([
      this.prisma.businessGlossaryTerm.findMany({
        where: optionalWhere as Prisma.BusinessGlossaryTermWhereInput,
        include: {
          asset: { select: assetSelect },
          domain: { select: domainSelect },
          workflowCase: { select: workflowSelect },
          versions: { orderBy: { version: 'desc' }, take: 3 },
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
      this.prisma.businessLineageMap.findMany({
        where: this.lineageScopeWhere(scope, assetIds),
        include: {
          sourceAsset: { select: assetSelect },
          targetAsset: { select: assetSelect },
          domain: { select: domainSelect },
          workflowCase: { select: workflowSelect },
        },
        orderBy: [{ impactScore: 'desc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
      this.prisma.dataAssetValuation.findMany({
        where: this.assetRecordWhere(assetIds) as Prisma.DataAssetValuationWhereInput,
        include: {
          asset: { select: assetSelect },
          domain: { select: domainSelect },
          surveys: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
        orderBy: [{ status: 'asc' }, { annualValue: 'desc' }],
        take: 50,
      }),
      this.prisma.assetLifecycleDecision.findMany({
        where: this.assetRecordWhere(assetIds) as Prisma.AssetLifecycleDecisionWhereInput,
        include: { asset: { select: assetSelect }, workflowCase: { select: workflowSelect } },
        orderBy: [{ status: 'asc' }, { disposalDueAt: 'asc' }],
        take: 50,
      }),
      this.prisma.businessImpactAssessment.findMany({
        where: optionalWhere as Prisma.BusinessImpactAssessmentWhereInput,
        include: { asset: { select: assetSelect }, domain: { select: domainSelect }, workflowCase: { select: workflowSelect } },
        orderBy: [{ impactScore: 'desc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
      this.prisma.dataValueKpi.findMany({
        where: optionalWhere as Prisma.DataValueKpiWhereInput,
        include: { asset: { select: assetSelect }, domain: { select: domainSelect } },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
      this.prisma.dataUserSurvey.findMany({
        where: this.assetRecordWhere(assetIds) as Prisma.DataUserSurveyWhereInput,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      summary: {
        glossary: glossaryHealth(glossary.map((row) => ({ status: row.status, reviewDueAt: row.reviewDueAt }))),
        lineageMaps: lineage.length,
        verifiedLineage: lineage.filter((row) => row.status === BusinessLineageStatus.verified).length,
        lifecycleDecisions: lifecycle.length,
        lifecyclePending: lifecycle.filter((row) => row.status !== LifecycleDecisionStatus.implemented).length,
        impactAssessments: assessments.length,
        criticalImpact: assessments.filter((row) => row.impactLevel === 'critical' || row.impactScore >= 85).length,
        valueKpis: kpis.length,
        realizedKpis: kpis.filter((row) => row.status === DataValueStatus.realized).length,
        totalAnnualValue: Math.round(valuations.reduce((sum, row) => sum + row.annualValue, 0)),
        averageSurveyScore: averageScore([...valuations.map((row) => row.surveyScore), ...surveys.map((row) => row.score)]),
      },
      graph: this.lineageGraph(lineage, assessments),
      glossary,
      lineage,
      valuations,
      lifecycle,
      assessments,
      kpis,
      surveys,
    };
  }

  async createGlossaryTerm(roleCodes: string[], dto: CreateGlossaryTermDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = dto.assetId ? await this.assertAssetVisible(scope, dto.assetId) : null;
    const domainId = dto.domainId ?? asset?.domainId ?? null;
    await this.assertDomainVisible(scope, domainId);
    if (!asset && !domainId && !this.isUnrestricted(scope)) throw new BadRequestException('Glossary terms need a visible asset or domain');
    const code = await this.nextCode('businessGlossaryTerm', 'BDE');
    return this.prisma.$transaction(async (tx) => {
      const workflowCaseId = await this.createWorkflow(tx, 'business_glossary_term', `Approve glossary term ${dto.termEn}`, dto.assetId ?? null, roleCodes, actor);
      const row = await tx.businessGlossaryTerm.create({
        data: {
          code,
          termEn: dto.termEn,
          termAr: dto.termAr ?? null,
          definition: dto.definition,
          status: BusinessGlossaryStatus.under_review,
          reviewDueAt: this.parseDate(dto.reviewDueAt),
          assetId: dto.assetId ?? null,
          domainId,
          workflowCaseId,
          createdBy: actor,
          versions: {
            create: {
              version: 1,
              definition: dto.definition,
              status: BusinessGlossaryStatus.under_review,
              changedBy: actor,
            },
          },
        },
      });
      await this.audit.log({ actor, action: 'business_value.glossary.create', entityType: 'business_glossary_term', entityId: row.id, metadata: { code, workflowCaseId } });
      return row;
    });
  }

  async decideGlossaryTerm(roleCodes: string[], id: string, dto: DecideGlossaryTermDto, actor: string) {
    const existing = await this.findVisibleGlossary(roleCodes, id);
    if (existing.createdBy === actor && FINAL_GLOSSARY_STATUSES.has(dto.status)) {
      throw new ForbiddenException('Glossary term creators cannot make the final review decision');
    }
    const definitionChanged = dto.definition && dto.definition !== existing.definition;
    const nextVersion = definitionChanged ? existing.version + 1 : existing.version;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.businessGlossaryTerm.update({
        where: { id },
        data: {
          status: dto.status,
          definition: dto.definition ?? undefined,
          version: nextVersion,
          approvedBy: dto.status === BusinessGlossaryStatus.approved ? actor : undefined,
          approvedAt: dto.status === BusinessGlossaryStatus.approved ? new Date() : undefined,
          updatedBy: actor,
        },
      });
      if (definitionChanged) {
        await tx.businessGlossaryTermVersion.create({
          data: { termId: id, version: nextVersion, definition: dto.definition!, status: dto.status, changedBy: actor },
        });
      }
      return updated;
    });
    await this.audit.log({ actor, action: 'business_value.glossary.decide', entityType: 'business_glossary_term', entityId: id, metadata: { status: dto.status } });
    return row;
  }

  async createLineage(roleCodes: string[], dto: CreateBusinessLineageDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    const [source, target] = await Promise.all([
      dto.sourceAssetId ? this.assertAssetVisible(scope, dto.sourceAssetId) : Promise.resolve(null),
      dto.targetAssetId ? this.assertAssetVisible(scope, dto.targetAssetId) : Promise.resolve(null),
    ]);
    if (dto.sourceAssetId && dto.targetAssetId && dto.sourceAssetId === dto.targetAssetId) {
      throw new BadRequestException('Lineage requires two different assets');
    }
    const domainId = dto.domainId ?? source?.domainId ?? target?.domainId ?? null;
    await this.assertDomainVisible(scope, domainId);
    if (!source && !target && !domainId) {
      throw new BadRequestException('Lineage maps need a visible asset or domain');
    }
    const score = clampScore(dto.impactScore, 50);
    const code = await this.nextCode('businessLineageMap', 'BLI');
    const row = await this.prisma.businessLineageMap.create({
      data: {
        code,
        processName: dto.processName,
        businessProcess: dto.businessProcess ?? null,
        technicalBridge: dto.technicalBridge ?? null,
        sourceAssetId: dto.sourceAssetId ?? null,
        targetAssetId: dto.targetAssetId ?? null,
        domainId,
        impactScore: score,
        impactLevel: dto.impactLevel ?? impactLevelFromScore(score),
        status: BusinessLineageStatus.under_review,
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'business_value.lineage.create', entityType: 'business_lineage_map', entityId: row.id, metadata: { code } });
    return row;
  }

  async updateLineage(roleCodes: string[], id: string, dto: UpdateBusinessLineageDto, actor: string) {
    const existing = await this.findVisibleLineage(roleCodes, id);
    if (existing.createdBy === actor && dto.status === BusinessLineageStatus.verified) {
      throw new ForbiddenException('Lineage creators cannot verify their own lineage map');
    }
    const impactScore = dto.impactScore === undefined ? existing.impactScore : clampScore(dto.impactScore, existing.impactScore);
    const row = await this.prisma.businessLineageMap.update({
      where: { id },
      data: {
        status: dto.status,
        impactScore,
        impactLevel: dto.impactLevel ?? (dto.impactScore === undefined ? undefined : impactLevelFromScore(impactScore)),
        updatedBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'business_value.lineage.update', entityType: 'business_lineage_map', entityId: id, metadata: { status: row.status } });
    return row;
  }

  async createValuation(roleCodes: string[], dto: CreateDataAssetValuationDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.assertAssetVisible(scope, dto.assetId);
    const code = await this.nextCode('dataAssetValuation', 'DVR');
    const row = await this.prisma.dataAssetValuation.create({
      data: {
        code,
        assetId: dto.assetId,
        domainId: asset.domainId,
        useCase: dto.useCase,
        valueDriver: dto.valueDriver ?? null,
        annualValue: dto.annualValue ?? 0,
        roiPercent: dto.roiPercent ?? 0,
        adoptionScore: clampScore(dto.adoptionScore, 0),
        surveyScore: clampScore(dto.surveyScore, 0),
        status: dataValueStatus(dto.annualValue, dto.annualValue ? dto.annualValue * 0.8 : 0),
        ownerName: dto.ownerName ?? null,
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'business_value.valuation.create', entityType: 'data_asset_valuation', entityId: row.id, metadata: { code } });
    return row;
  }

  async createSurvey(roleCodes: string[], dto: CreateDataUserSurveyDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    if (!dto.valuationId && !dto.assetId) throw new BadRequestException('Survey requires a valuation or asset');
    let assetId = dto.assetId ?? null;
    if (dto.valuationId) {
      const valuation = await this.findVisibleValuation(roleCodes, dto.valuationId);
      assetId = valuation.assetId;
    }
    if (assetId) await this.assertAssetVisible(scope, assetId);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dataUserSurvey.create({
        data: {
          valuationId: dto.valuationId ?? null,
          assetId,
          respondent: dto.respondent ?? null,
          score: clampScore(dto.score, 0),
          feedback: dto.feedback ?? null,
          createdBy: actor,
        },
      });
      if (dto.valuationId) {
        const surveys = await tx.dataUserSurvey.findMany({ where: { valuationId: dto.valuationId }, select: { score: true } });
        await tx.dataAssetValuation.update({
          where: { id: dto.valuationId },
          data: { surveyScore: averageScore(surveys.map((survey) => survey.score)) },
        });
      }
      return created;
    });
    await this.audit.log({ actor, action: 'business_value.survey.create', entityType: 'data_user_survey', entityId: row.id });
    return row;
  }

  async createLifecycleDecision(roleCodes: string[], dto: CreateLifecycleDecisionDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.assertAssetVisible(scope, dto.assetId);
    const code = await this.nextCode('assetLifecycleDecision', 'LCM');
    return this.prisma.$transaction(async (tx) => {
      const workflowCaseId = await this.createWorkflow(tx, 'asset_lifecycle_decision', `Review lifecycle change ${code}`, dto.assetId, roleCodes, actor);
      const row = await tx.assetLifecycleDecision.create({
        data: {
          code,
          assetId: dto.assetId,
          currentStatus: asset.lifecycleStatus,
          proposedStatus: dto.proposedStatus,
          retentionDecision: dto.retentionDecision ?? 'review',
          retentionBasis: dto.retentionBasis ?? null,
          disposalDueAt: this.parseDate(dto.disposalDueAt),
          workflowCaseId,
          createdBy: actor,
        },
      });
      await this.audit.log({ actor, action: 'business_value.lifecycle.create', entityType: 'asset_lifecycle_decision', entityId: row.id, metadata: { code, workflowCaseId } });
      return row;
    });
  }

  async decideLifecycle(roleCodes: string[], id: string, dto: DecideLifecycleDecisionDto, actor: string) {
    const existing = await this.findVisibleLifecycle(roleCodes, id);
    if (existing.createdBy === actor && FINAL_LIFECYCLE_STATUSES.has(dto.status)) {
      throw new ForbiddenException('Lifecycle decision creators cannot approve or reject their own decision');
    }
    const isApproved = dto.status === LifecycleDecisionStatus.approved || dto.status === LifecycleDecisionStatus.implemented;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.assetLifecycleDecision.update({
        where: { id },
        data: {
          status: dto.status,
          approvedBy: isApproved ? actor : undefined,
          approvedAt: isApproved ? new Date() : undefined,
          updatedBy: actor,
        },
      });
      if (dto.status === LifecycleDecisionStatus.implemented) {
        await tx.dataAsset.update({ where: { id: existing.assetId }, data: { lifecycleStatus: existing.proposedStatus } });
      }
      return updated;
    });
    await this.audit.log({ actor, action: 'business_value.lifecycle.decide', entityType: 'asset_lifecycle_decision', entityId: id, metadata: { status: dto.status } });
    return row;
  }

  async createBia(roleCodes: string[], dto: CreateBusinessImpactAssessmentDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = dto.assetId ? await this.assertAssetVisible(scope, dto.assetId) : null;
    const domainId = dto.domainId ?? asset?.domainId ?? null;
    await this.assertDomainVisible(scope, domainId);
    if (!asset && !domainId) throw new BadRequestException('Business impact assessment requires an asset or domain');
    const impactScore = clampScore(dto.impactScore, 50);
    const code = await this.nextCode('businessImpactAssessment', 'BIA');
    return this.prisma.$transaction(async (tx) => {
      const workflowCaseId = await this.createWorkflow(tx, 'business_impact_assessment', `Review impact assessment ${code}`, dto.assetId ?? null, roleCodes, actor);
      const row = await tx.businessImpactAssessment.create({
        data: {
          code,
          assetId: dto.assetId ?? null,
          domainId,
          processName: dto.processName,
          impactScore,
          impactLevel: dto.impactLevel ?? impactLevelFromScore(impactScore),
          rtoHours: dto.rtoHours ?? null,
          revenueImpact: dto.revenueImpact ?? 0,
          citizenImpact: dto.citizenImpact ?? null,
          operationalImpact: dto.operationalImpact ?? null,
          workflowCaseId,
          createdBy: actor,
        },
      });
      await this.audit.log({ actor, action: 'business_value.bia.create', entityType: 'business_impact_assessment', entityId: row.id, metadata: { code, workflowCaseId } });
      return row;
    });
  }

  async createKpi(roleCodes: string[], dto: CreateDataValueKpiDto, actor: string) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = dto.assetId ? await this.assertAssetVisible(scope, dto.assetId) : null;
    const domainId = dto.domainId ?? asset?.domainId ?? null;
    await this.assertDomainVisible(scope, domainId);
    if (!asset && !domainId && !this.isUnrestricted(scope)) throw new BadRequestException('Data value KPI needs a visible asset or domain');
    const code = await this.nextCode('dataValueKpi', 'DVK');
    const status = dto.status ?? dataValueStatus(dto.actualValue, dto.targetValue);
    const row = await this.prisma.dataValueKpi.create({
      data: {
        code,
        name: dto.name,
        valueType: dto.valueType,
        period: dto.period,
        targetValue: dto.targetValue ?? 0,
        actualValue: dto.actualValue ?? 0,
        unit: dto.unit ?? null,
        useCase: dto.useCase ?? null,
        ownerName: dto.ownerName ?? null,
        status,
        assetId: dto.assetId ?? null,
        domainId,
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'business_value.kpi.create', entityType: 'data_value_kpi', entityId: row.id, metadata: { code, status } });
    return row;
  }

  private lineageGraph(lineage: Array<{
    id: string;
    code: string;
    processName: string;
    status: BusinessLineageStatus;
    impactLevel: string;
    impactScore: number;
    sourceAsset: { id: string; code: string; nameEn: string } | null;
    targetAsset: { id: string; code: string; nameEn: string } | null;
    domain: { id: string; code: string; nameEn: string } | null;
  }>, assessments: Array<{ assetId: string | null; domainId: string | null; impactLevel: string; impactScore: number }>) {
    const nodes = new Map<string, Record<string, unknown>>();
    const edges: Record<string, unknown>[] = [];
    const addNode = (id: string, label: string, type: string, status: string, count = 0) => {
      if (!nodes.has(id)) nodes.set(id, { id, label, type, status, count });
    };
    for (const row of lineage) {
      addNode(`process:${row.id}`, row.processName, 'process', row.status, row.impactScore);
      if (row.domain) {
        addNode(`domain:${row.domain.id}`, row.domain.nameEn, 'domain', row.impactLevel, assessments.filter((assessment) => assessment.domainId === row.domain?.id).length);
        edges.push({ id: `domain:${row.domain.id}->process:${row.id}`, from: `domain:${row.domain.id}`, to: `process:${row.id}`, label: 'governs', tone: 'muted' });
      }
      if (row.sourceAsset) {
        addNode(`asset:${row.sourceAsset.id}`, `${row.sourceAsset.code} - ${row.sourceAsset.nameEn}`, 'asset', row.impactLevel, row.impactScore);
        edges.push({ id: `source:${row.sourceAsset.id}->${row.id}`, from: `asset:${row.sourceAsset.id}`, to: `process:${row.id}`, label: 'feeds', tone: 'primary' });
      }
      if (row.targetAsset) {
        addNode(`asset:${row.targetAsset.id}`, `${row.targetAsset.code} - ${row.targetAsset.nameEn}`, 'asset', row.impactLevel, row.impactScore);
        edges.push({ id: `target:${row.id}->${row.targetAsset.id}`, from: `process:${row.id}`, to: `asset:${row.targetAsset.id}`, label: 'supports', tone: row.impactLevel === 'critical' ? 'danger' : 'primary' });
      }
    }
    return { nodes: [...nodes.values()], edges };
  }

  private async createWorkflow(tx: Prisma.TransactionClient, type: string, title: string, assetId: string | null, roleCodes: string[], actor: string): Promise<string> {
    if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const workflowCase = await this.workflow.openRoutedCase({
      roleCodes,
      actor,
      title,
      description: 'Business-value governance review created automatically.',
      type,
      status: CaseStatus.submitted,
      assetId,
      initialDueDate: dueDate,
      initialTaskTitle: `${title} review`,
      preferredCode: await this.nextWorkflowCode(tx, type),
    }, tx);
    await tx.workflowEvent.create({
      data: {
        caseId: workflowCase.id,
        actor,
        action: 'workflow.create',
        toStatus: CaseStatus.submitted,
        comment: 'Created from business-value workflow.',
      },
    });
    return workflowCase.id;
  }

  private async nextWorkflowCode(tx: Prisma.TransactionClient, type: string): Promise<string> {
    const prefix = type === 'asset_lifecycle_decision' ? 'WF-LCM' : type === 'business_impact_assessment' ? 'WF-BIA' : 'WF-BDE';
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await tx.workflowCase.count({ where: { code: { startsWith: `${prefix}-${day}` } } });
    return `${prefix}-${day}-${String(count + 1).padStart(3, '0')}`;
  }

  private async nextCode(
    model:
      | 'businessGlossaryTerm'
      | 'businessLineageMap'
      | 'dataAssetValuation'
      | 'assetLifecycleDecision'
      | 'businessImpactAssessment'
      | 'dataValueKpi',
    prefix: string,
  ): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const where = { code: { startsWith: `${prefix}-${day}` } };
    const count =
      model === 'businessGlossaryTerm'
        ? await this.prisma.businessGlossaryTerm.count({ where })
        : model === 'businessLineageMap'
          ? await this.prisma.businessLineageMap.count({ where })
          : model === 'dataAssetValuation'
            ? await this.prisma.dataAssetValuation.count({ where })
            : model === 'assetLifecycleDecision'
              ? await this.prisma.assetLifecycleDecision.count({ where })
              : model === 'businessImpactAssessment'
                ? await this.prisma.businessImpactAssessment.count({ where })
                : await this.prisma.dataValueKpi.count({ where });
    return `${prefix}-${day}-${String(count + 1).padStart(3, '0')}`;
  }

  private async scopedFindWhere(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(scope);
    return { AND: [{ id }, this.optionalScopeWhere(scope, assetIds)] };
  }

  private async findVisibleGlossary(roleCodes: string[], id: string) {
    const row = await this.prisma.businessGlossaryTerm.findFirst({
      where: (await this.scopedFindWhere(roleCodes, id)) as Prisma.BusinessGlossaryTermWhereInput,
    });
    if (!row) throw new NotFoundException('business_glossary_term not found');
    return row;
  }

  private async findVisibleLineage(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(scope);
    const row = await this.prisma.businessLineageMap.findFirst({
      where: { AND: [{ id }, this.lineageScopeWhere(scope, assetIds)] },
    });
    if (!row) throw new NotFoundException('business_lineage_map not found');
    return row;
  }

  private async findVisibleValuation(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(scope);
    const row = await this.prisma.dataAssetValuation.findFirst({
      where: { AND: [{ id }, this.assetRecordWhere(assetIds) as Prisma.DataAssetValuationWhereInput] },
    });
    if (!row) throw new NotFoundException('data_asset_valuation not found');
    return row;
  }

  private async findVisibleLifecycle(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(scope);
    const row = await this.prisma.assetLifecycleDecision.findFirst({
      where: { AND: [{ id }, this.assetRecordWhere(assetIds) as Prisma.AssetLifecycleDecisionWhereInput] },
    });
    if (!row) throw new NotFoundException('asset_lifecycle_decision not found');
    return row;
  }
}
