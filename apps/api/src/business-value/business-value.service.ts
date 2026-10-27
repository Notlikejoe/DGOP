import { ConflictException } from '@nestjs/common';
import { BUSINESS_REGISTERS, BusinessRegister, BusinessRegisterQueryDto, MeasureValuationDto } from './business-value.dto';
import { parsePageParams, toPaged } from '../common/pagination';
import { valuationOutcomeStatus } from './business-value.logic';
import { Optional } from '@nestjs/common';
import { EvidenceService } from '../evidence/evidence.service';
import { governanceDecisionActor, governanceDecisionProof } from '../common/governance-decision-proof';
import { businessDecisionRoles } from '../auth/business-roles';
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
import { formatBusinessSequence, nextAvailableBusinessCode } from '../common/business-sequence';
import { AuditService } from '../audit/audit.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { WorkflowService } from '../workflow/workflow.service';
import { claimGovernanceWrite, requireTransition } from '../common/governance-write';
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
    @Optional() private readonly evidence?: EvidenceService,
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

  async listRegister(register:string,roleCodes:string[],actor:string|undefined,query:BusinessRegisterQueryDto={}) {
    if(!(BUSINESS_REGISTERS as readonly string[]).includes(register))throw new NotFoundException('Business register not found');
    if((query.search?.length??0)>200)throw new BadRequestException('Search cannot exceed 200 characters');
    const scope=await this.scope.resolve(roleCodes),assets=await this.visibleAssetIds(scope),optional=this.optionalScopeWhere(scope,assets),assetWhere=this.assetRecordWhere(assets);
    const fields:Record<string,string[]>={glossary:['code','termEn','termAr','definition'],lineage:['code','processName','businessProcess'],valuations:['code','useCase','valueDriver','ownerName'],lifecycle:['code','proposedStatus','retentionBasis'],assessments:['code','processName','operationalImpact'],kpis:['code','name','useCase','ownerName'],surveys:['respondent','feedback']};
    const base=register==='lineage'?this.lineageScopeWhere(scope,assets):['valuations','lifecycle','surveys'].includes(register)?assetWhere:optional;
    const search=query.search?.trim(),where={AND:[base,...(search?[{OR:fields[register].map(field=>({[field]:{contains:search,mode:'insensitive'}}))}]:[])]};
    const params=parsePageParams(query.page??1,query.pageSize??25)!;
    const page=async<T>(rows:Promise<T[]>,total:Promise<number>)=>{const [data,count]=await Promise.all([rows,total]);return toPaged(data,count,params);};
    let result:ReturnType<typeof toPaged<any>>;
    switch(register){
      case 'glossary':result=await page(this.prisma.businessGlossaryTerm.findMany({where:where as Prisma.BusinessGlossaryTermWhereInput,include:{asset:{select:assetSelect},domain:{select:domainSelect},workflowCase:{select:workflowSelect}},orderBy:[{status:'asc'},{updatedAt:'desc'},{id:'asc'}],skip:params.skip,take:params.take}),this.prisma.businessGlossaryTerm.count({where:where as Prisma.BusinessGlossaryTermWhereInput}));break;
      case 'lineage':result=await page(this.prisma.businessLineageMap.findMany({where:where as Prisma.BusinessLineageMapWhereInput,include:{sourceAsset:{select:assetSelect},targetAsset:{select:assetSelect},domain:{select:domainSelect},workflowCase:{select:workflowSelect}},orderBy:[{impactScore:'desc'},{updatedAt:'desc'},{id:'asc'}],skip:params.skip,take:params.take}),this.prisma.businessLineageMap.count({where:where as Prisma.BusinessLineageMapWhereInput}));break;
      case 'valuations':result=await page(this.prisma.dataAssetValuation.findMany({where:where as Prisma.DataAssetValuationWhereInput,include:{asset:{select:assetSelect},domain:{select:domainSelect},surveys:{orderBy:{createdAt:'desc'},take:3}},orderBy:[{status:'asc'},{annualValue:'desc'},{id:'asc'}],skip:params.skip,take:params.take}),this.prisma.dataAssetValuation.count({where:where as Prisma.DataAssetValuationWhereInput}));break;
      case 'lifecycle':result=await page(this.prisma.assetLifecycleDecision.findMany({where:where as Prisma.AssetLifecycleDecisionWhereInput,include:{asset:{select:assetSelect},workflowCase:{select:workflowSelect}},orderBy:[{status:'asc'},{disposalDueAt:'asc'},{id:'asc'}],skip:params.skip,take:params.take}),this.prisma.assetLifecycleDecision.count({where:where as Prisma.AssetLifecycleDecisionWhereInput}));break;
      case 'assessments':result=await page(this.prisma.businessImpactAssessment.findMany({where:where as Prisma.BusinessImpactAssessmentWhereInput,include:{asset:{select:assetSelect},domain:{select:domainSelect},workflowCase:{select:workflowSelect}},orderBy:[{impactScore:'desc'},{updatedAt:'desc'},{id:'asc'}],skip:params.skip,take:params.take}),this.prisma.businessImpactAssessment.count({where:where as Prisma.BusinessImpactAssessmentWhereInput}));break;
      case 'kpis':result=await page(this.prisma.dataValueKpi.findMany({where:where as Prisma.DataValueKpiWhereInput,include:{asset:{select:assetSelect},domain:{select:domainSelect}},orderBy:[{status:'asc'},{updatedAt:'desc'},{id:'asc'}],skip:params.skip,take:params.take}),this.prisma.dataValueKpi.count({where:where as Prisma.DataValueKpiWhereInput}));break;
      default:result=await page(this.prisma.dataUserSurvey.findMany({where:where as Prisma.DataUserSurveyWhereInput,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:params.skip,take:params.take}),this.prisma.dataUserSurvey.count({where:where as Prisma.DataUserSurveyWhereInput}));
    }
    const allowed=new Set<string>();
    if(actor&&['glossary','lineage','lifecycle','valuations'].includes(register))try{
      const roles=await businessDecisionRoles(this.prisma,roleCodes,'business_value.edit'),decisionScope=await this.scope.resolve(roles),decisionAssets=await this.visibleAssetIds(decisionScope),ids=result.data.map(row=>row.id);
      const filter={AND:[register==='lineage'?this.lineageScopeWhere(decisionScope,decisionAssets):['lifecycle','valuations'].includes(register)?this.assetRecordWhere(decisionAssets):this.optionalScopeWhere(decisionScope,decisionAssets),{id:{in:ids}}]};
      const rows=register==='glossary'?await this.prisma.businessGlossaryTerm.findMany({where:filter as Prisma.BusinessGlossaryTermWhereInput,select:{id:true}}):register==='lineage'?await this.prisma.businessLineageMap.findMany({where:filter as Prisma.BusinessLineageMapWhereInput,select:{id:true}}):register==='valuations'?await this.prisma.dataAssetValuation.findMany({where:filter as Prisma.DataAssetValuationWhereInput,select:{id:true}}):await this.prisma.assetLifecycleDecision.findMany({where:filter as Prisma.AssetLifecycleDecisionWhereInput,select:{id:true}});rows.forEach(row=>allowed.add(row.id));
    }catch(error){if(!(error instanceof ForbiddenException))throw error;}
    result.data=result.data.map(row=>({...row,...(register==='valuations'?{canMeasure:allowed.has(row.id),assurance:row.realizationProof?'verified':row.status==='realized'?'review_needed':'forecast'}:{}),...(register==='lineage'?{canVerify:allowed.has(row.id)&&row.createdBy!==actor}:['glossary','lifecycle'].includes(register)?{canDecide:allowed.has(row.id)&&row.createdBy!==actor}:{})}));
    return result;
  }

  async workspace(roleCodes:string[],actor?:string){
    const scope=await this.scope.resolve(roleCodes),assets=await this.visibleAssetIds(scope),optional=this.optionalScopeWhere(scope,assets),assetWhere=this.assetRecordWhere(assets),lineageWhere=this.lineageScopeWhere(scope,assets),now=new Date();
    const [pages,glossaryTotal,glossaryApproved,glossaryDue,lineageTotal,lineageVerified,lifecycleTotal,lifecyclePending,biaTotal,biaCritical,kpiTotal,kpiRealized,values,surveys]=await Promise.all([
      Promise.all(BUSINESS_REGISTERS.map(key=>this.listRegister(key,roleCodes,actor))),
      this.prisma.businessGlossaryTerm.count({where:optional as Prisma.BusinessGlossaryTermWhereInput}),
      this.prisma.businessGlossaryTerm.count({where:{AND:[optional as Prisma.BusinessGlossaryTermWhereInput,{status:'approved'}]}}),
      this.prisma.businessGlossaryTerm.count({where:{AND:[optional as Prisma.BusinessGlossaryTermWhereInput,{reviewDueAt:{lte:now}}]}}),
      this.prisma.businessLineageMap.count({where:lineageWhere}),this.prisma.businessLineageMap.count({where:{AND:[lineageWhere,{status:'verified'}]}}),
      this.prisma.assetLifecycleDecision.count({where:assetWhere}),this.prisma.assetLifecycleDecision.count({where:{AND:[assetWhere,{status:{in:['proposed','approved']}}]}}),
      this.prisma.businessImpactAssessment.count({where:optional}),this.prisma.businessImpactAssessment.count({where:{AND:[optional,{OR:[{impactLevel:'critical'},{impactScore:{gte:85}}]}]}}),
      this.prisma.dataValueKpi.count({where:optional}),this.prisma.dataValueKpi.count({where:{AND:[optional,{status:'realized'}]}}),
      this.prisma.dataAssetValuation.aggregate({where:assetWhere,_sum:{annualValue:true,actualAnnualValue:true,surveyScore:true},_count:{id:true}}),
      this.prisma.dataUserSurvey.aggregate({where:assetWhere,_sum:{score:true},_count:{id:true}}),
    ]);
    const registers=Object.fromEntries(BUSINESS_REGISTERS.map((key,i)=>[key,pages[i]])),rows=Object.fromEntries(BUSINESS_REGISTERS.map((key,i)=>[key,pages[i].data])),score=glossaryTotal?Math.round(glossaryApproved/glossaryTotal*100):0,surveyCount=values._count.id+surveys._count.id;
    return {summary:{glossary:{total:glossaryTotal,approved:glossaryApproved,reviewDue:glossaryDue,readinessScore:score,status:glossaryDue||score<60?'at_risk':score>=80?'healthy':'watch'},lineageMaps:lineageTotal,verifiedLineage:lineageVerified,
      lifecycleDecisions:lifecycleTotal,lifecyclePending,impactAssessments:biaTotal,criticalImpact:biaCritical,valueKpis:kpiTotal,realizedKpis:kpiRealized,
      totalAnnualValue:Math.round(values._sum.annualValue??0),totalActualAnnualValue:Math.round(values._sum.actualAnnualValue??0),averageSurveyScore:surveyCount?Math.round(((values._sum.surveyScore??0)+(surveys._sum.score??0))/surveyCount):0},
      graph:{...this.lineageGraph(rows.lineage,rows.assessments),limited:true,shownLineage:rows.lineage.length,totalLineage:lineageTotal},...rows,registerPages:registers};
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
      await this.audit.logRequired({ actor, action: 'business_value.glossary.create', entityType: 'business_glossary_term', entityId: row.id, metadata: { code, workflowCaseId } }, tx);
      return row;
    });
  }

  async decideGlossaryTerm(roleCodes: string[], id: string, dto: DecideGlossaryTermDto, actor: string) {
    roleCodes=await businessDecisionRoles(this.prisma,roleCodes,'business_value.edit');
    const existing = await this.findVisibleGlossary(roleCodes, id);
    if (existing.createdBy === actor && FINAL_GLOSSARY_STATUSES.has(dto.status)) {
      throw new ForbiddenException('Glossary term creators cannot make the final review decision');
    }
    requireTransition(existing.status, dto.status, {
      draft: ['under_review'], under_review: ['approved', 'needs_revision'],
      needs_revision: ['under_review'], approved: ['under_review', 'retired', 'expired'],
      expired: ['under_review', 'retired'], retired: [],
    });
    if (dto.status === 'approved' && dto.definition && dto.definition !== existing.definition) {
      throw new BadRequestException('Submit the changed definition for review before approving it');
    }
    const definitionChanged = dto.definition && dto.definition !== existing.definition;
    const nextVersion = definitionChanged ? existing.version + 1 : existing.version;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await claimGovernanceWrite(() => tx.businessGlossaryTerm.update({
        where: { id, updatedAt: existing.updatedAt, status: existing.status },
        data: {
          status: dto.status,
          definition: dto.definition ?? undefined,
          version: nextVersion,
          approvedBy: dto.status === BusinessGlossaryStatus.approved ? actor : undefined,
          approvedAt: dto.status === BusinessGlossaryStatus.approved ? new Date() : undefined,
          updatedBy: actor,
        },
      }));
      if (definitionChanged) {
        await tx.businessGlossaryTermVersion.create({
          data: { termId: id, version: nextVersion, definition: dto.definition!, status: dto.status, changedBy: actor },
        });
      }
      await this.audit.logRequired({ actor, action: 'business_value.glossary.decide', entityType: 'business_glossary_term', entityId: id, metadata: { status: dto.status } }, tx);
      return updated;
    });
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
    return this.prisma.$transaction(async (tx) => {
    const row = await tx.businessLineageMap.create({
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
    await this.audit.logRequired({ actor, action: 'business_value.lineage.create', entityType: 'business_lineage_map', entityId: row.id, metadata: { code } }, tx);
    return row;
    });
  }

  async updateLineage(roleCodes: string[], id: string, dto: UpdateBusinessLineageDto, actor: string) {
    if(dto.status==='verified')roleCodes=await businessDecisionRoles(this.prisma,roleCodes,'business_value.edit');
    const existing = await this.findVisibleLineage(roleCodes, id);
    if (existing.createdBy === actor && dto.status === BusinessLineageStatus.verified) {
      throw new ForbiddenException('Lineage creators cannot verify their own lineage map');
    }
    const impactScore = dto.impactScore === undefined ? existing.impactScore : clampScore(dto.impactScore, existing.impactScore);
    return this.prisma.$transaction(async (tx) => {
    const row = await claimGovernanceWrite(() => tx.businessLineageMap.update({
      where: { id, status: existing.status, updatedAt: existing.updatedAt },
      data: {
        status: dto.status,
        impactScore,
        impactLevel: dto.impactLevel ?? (dto.impactScore === undefined ? undefined : impactLevelFromScore(impactScore)),
        updatedBy: actor,
      },
    }));
    await this.audit.logRequired({ actor, action: 'business_value.lineage.update', entityType: 'business_lineage_map', entityId: id, metadata: { status: row.status } }, tx);
    return row;
    });
  }

  async createValuation(
    roleCodes: string[],
    dto: CreateDataAssetValuationDto,
    actor: string,
  ) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.assertAssetVisible(scope, dto.assetId);
    const code = await this.nextCode('dataAssetValuation', 'DVR');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.dataAssetValuation.create({
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
          status: valuationOutcomeStatus(dto.annualValue ?? 0),
          ownerName: dto.ownerName ?? null,
          createdBy: actor,
        },
      });
      await this.audit.logRequired(
        {
          actor,
          action: 'business_value.valuation.create',
          entityType: 'data_asset_valuation',
          entityId: row.id,
          metadata: { code },
        },
        tx,
      );
      return row;
    });
  }

  async measureValuation(roleCodes:string[],id:string,dto:MeasureValuationDto,actor:string){
    const roles=await businessDecisionRoles(this.prisma,roleCodes,'business_value.edit'),existing=await this.findVisibleValuation(roles,id),measuredAt=new Date(dto.measuredAt);
    if(!Number.isFinite(dto.actualAnnualValue)||dto.actualAnnualValue<0||!Number.isFinite(measuredAt.getTime())||measuredAt>new Date())throw new BadRequestException('A nonnegative measured value and a nonfuture measurement date are required');
    if(dto.expectedVersion!==existing.version)throw new ConflictException('Valuation changed; reload before measuring');
    return this.prisma.$transaction(async tx=>{const identity=await governanceDecisionActor(tx,actor,'business_value.edit'),status=valuationOutcomeStatus(existing.annualValue,dto.actualAnnualValue),proof=await governanceDecisionProof(tx,this.evidence,identity,{evidenceId:dto.evidenceId,justification:dto.evidenceJustification,targetType:'data_asset_valuation',targetId:id,context:{assetId:existing.assetId,forecast:existing.annualValue,actualAnnualValue:dto.actualAnnualValue,measuredAt:measuredAt.toISOString(),version:existing.version+1}});
      const claimed=await tx.dataAssetValuation.updateMany({where:{id,version:dto.expectedVersion},data:{actualAnnualValue:dto.actualAnnualValue,measuredAt,status,realizationProof:proof as unknown as Prisma.InputJsonValue,version:{increment:1},updatedBy:actor}});if(claimed.count!==1)throw new ConflictException('Valuation changed; reload before measuring');
      await this.audit.logRequired({actor,action:'business_value.valuation.measure',entityType:'data_asset_valuation',entityId:id,metadata:{status,previousVersion:existing.version,newVersion:existing.version+1,realizationProof:proof}},tx);return tx.dataAssetValuation.findUniqueOrThrow({where:{id}});
    });
  }

  async createSurvey(
    roleCodes: string[],
    dto: CreateDataUserSurveyDto,
    actor: string,
  ) {
    const scope = await this.scope.resolve(roleCodes);
    if (!dto.valuationId && !dto.assetId)
      throw new BadRequestException('Survey requires a valuation or asset');
    let assetId = dto.assetId ?? null;
    if (dto.valuationId) {
      const valuation = await this.findVisibleValuation(
        roleCodes,
        dto.valuationId,
      );
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
        const surveys = await tx.dataUserSurvey.findMany({
          where: { valuationId: dto.valuationId },
          select: { score: true },
        });
        await tx.dataAssetValuation.update({
          where: { id: dto.valuationId },
          data: {
            surveyScore: averageScore(surveys.map((survey) => survey.score)),
          },
        });
      }
      await this.audit.logRequired(
        {
          actor,
          action: 'business_value.survey.create',
          entityType: 'data_user_survey',
          entityId: created.id,
        },
        tx,
      );
      return created;
    });
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
      await this.audit.logRequired({ actor, action: 'business_value.lifecycle.create', entityType: 'asset_lifecycle_decision', entityId: row.id, metadata: { code, workflowCaseId } }, tx);
      return row;
    });
  }

  async decideLifecycle(roleCodes: string[], id: string, dto: DecideLifecycleDecisionDto, actor: string) {
    roleCodes=await businessDecisionRoles(this.prisma,roleCodes,'business_value.edit');
    const existing = await this.findVisibleLifecycle(roleCodes, id);
    if (existing.createdBy === actor && FINAL_LIFECYCLE_STATUSES.has(dto.status)) {
      throw new ForbiddenException('Lifecycle decision creators cannot approve or reject their own decision');
    }
    requireTransition(existing.status, dto.status, { proposed: ['approved', 'rejected'], approved: ['implemented', 'rejected'], implemented: [], rejected: [] });
    if (dto.status === 'implemented' && (!existing.approvedBy || !existing.approvedAt)) {
      throw new BadRequestException('Implementation requires a recorded independent approval');
    }
    const isApproved = dto.status === LifecycleDecisionStatus.approved;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await claimGovernanceWrite(() => tx.assetLifecycleDecision.update({
        where: { id, status: existing.status, updatedAt: existing.updatedAt },
        data: {
          status: dto.status,
          approvedBy: isApproved ? actor : undefined,
          approvedAt: isApproved ? new Date() : undefined,
          updatedBy: actor,
        },
      }));
      if (dto.status === LifecycleDecisionStatus.implemented) {
        await claimGovernanceWrite(() => tx.dataAsset.update({ where: { id: existing.assetId, lifecycleStatus: existing.currentStatus }, data: { lifecycleStatus: existing.proposedStatus } }));
      }
      await this.audit.logRequired({ actor, action: 'business_value.lifecycle.decide', entityType: 'asset_lifecycle_decision', entityId: id, metadata: { status: dto.status } }, tx);
      return updated;
    });
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
      await this.audit.logRequired({ actor, action: 'business_value.bia.create', entityType: 'business_impact_assessment', entityId: row.id, metadata: { code, workflowCaseId } }, tx);
      return row;
    });
  }

  async createKpi(
    roleCodes: string[],
    dto: CreateDataValueKpiDto,
    actor: string,
  ) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = dto.assetId
      ? await this.assertAssetVisible(scope, dto.assetId)
      : null;
    const domainId = dto.domainId ?? asset?.domainId ?? null;
    await this.assertDomainVisible(scope, domainId);
    if (!asset && !domainId && !this.isUnrestricted(scope))
      throw new BadRequestException(
        'Data value KPI needs a visible asset or domain',
      );
    const code = await this.nextCode('dataValueKpi', 'DVK');
    const status = dataValueStatus(dto.actualValue, dto.targetValue);
    if (dto.status !== undefined && dto.status !== status)
      throw new BadRequestException(
        'KPI status must match the measured actual and target values',
      );
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.dataValueKpi.create({
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
      await this.audit.logRequired(
        {
          actor,
          action: 'business_value.kpi.create',
          entityType: 'data_value_kpi',
          entityId: row.id,
          metadata: { code, status },
        },
        tx,
      );
      return row;
    });
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
    return nextAvailableBusinessCode(
      tx,
      `workflow_case:${prefix.toLowerCase()}:${day}`,
      (value) => `${prefix}-${day}-${formatBusinessSequence(value, 3)}`,
      async (code) => !(await tx.workflowCase.findUnique({ where: { code }, select: { id: true } })),
    );
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
    return nextAvailableBusinessCode(
      this.prisma,
      `business_value:${model}:${day}`,
      (value) => `${prefix}-${day}-${formatBusinessSequence(value, 3)}`,
      async (code) => !(
        model === 'businessGlossaryTerm'
          ? await this.prisma.businessGlossaryTerm.findUnique({ where: { code } })
          : model === 'businessLineageMap'
            ? await this.prisma.businessLineageMap.findUnique({ where: { code } })
            : model === 'dataAssetValuation'
              ? await this.prisma.dataAssetValuation.findUnique({ where: { code } })
              : model === 'assetLifecycleDecision'
                ? await this.prisma.assetLifecycleDecision.findUnique({ where: { code } })
                : model === 'businessImpactAssessment'
                  ? await this.prisma.businessImpactAssessment.findUnique({ where: { code } })
                  : await this.prisma.dataValueKpi.findUnique({ where: { code } })
      ),
    );
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
