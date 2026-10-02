import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, Prisma, TaskDecision, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AIUC_STAGE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { aiNoticeAccess } from './ai-notifications';
import { governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
import { isSystemAdministrator } from '../auth/system-admin';
import {
  AI_CLASSIFICATION_CRITERIA,
  AiCalculationInputV1,
  assertCalculationInputV1,
} from './ai-governance.contracts';

const CLASSIFICATION_TASK_TITLE = 'Six-criterion SDAIA classification assessment';
const OFFICER_TASK_TITLE = 'Verify proposed SDAIA classification';
const ENGINE_VERSION = 'AIUC_CLASSIFICATION_MAX_V1';
const DECISION_ENGINE_VERSION = 'AIUC_CLASSIFICATION_DECISION_V1';

type JsonRecord = Record<string, unknown>;
type OfficerDecisionMode = 'verify' | 'override' | 'unacceptable';
type OfficerDecisionOptions = {
  expectedVersion: number;
  approvedTierCode?: string;
  justification?: string;
  evidenceIds?: string[];
  authorityReference?: string;
  clientIp?: string;
};
type ConfigValue = {
  code: string;
  labelEn: string;
  labelAr: string;
  score?: number;
  minScore?: number;
  maxScore?: number;
  automatic?: boolean;
  anchors?: Record<string, unknown>;
};

const classificationCase = {
  id: true,
  useCaseRef: true,
  workflowCaseId: true,
  requesterUserId: true,
  assetId:true,
  ownerPersonId: true,
  name: true,
  description: true,
  version: true,
  updatedAt: true,
  workflowCase: { select: { id: true, code: true, status: true } },
  intakeRevisions: {
    orderBy: { revision: 'desc' as const },
    take: 1,
    select: { id: true, revision: true, payload: true, submittedAt: true, createdAt: true },
  },
  assessments: {
    where: { kind: 'classification' as const },
    orderBy: { round: 'desc' as const },
    take: 1,
    select: { id: true, round: true, engineVersion: true, ruleReferenceVersionId: true, inputs: true, result: true, createdBy: true, createdAt: true },
  },
} satisfies Prisma.AiUseCaseSelect;

function metadata(value: Prisma.JsonValue): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function integer(value: unknown): number | undefined {
  return Number.isInteger(value) ? Number(value) : undefined;
}

function validAnchor(value: unknown): boolean {
  const anchor = metadata(value as Prisma.JsonValue);
  return typeof anchor['labelEn'] === 'string' && !!anchor['labelEn'].trim()
    && typeof anchor['labelAr'] === 'string' && !!anchor['labelAr'].trim();
}

function requiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new BadRequestException(`${label} is required`);
  return normalized;
}

function classificationResult(value: Prisma.JsonValue): { scoreMax: number; proposedTierCode: string } {
  const result = metadata(value);
  const scoreMax = integer(result['scoreMax']);
  const proposedTierCode = typeof result['proposedTierCode'] === 'string' ? result['proposedTierCode'].trim() : '';
  if (!scoreMax || !proposedTierCode) throw new ConflictException('The latest classification round has no calculated proposal');
  return { scoreMax, proposedTierCode };
}

@Injectable()
export class AiClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AiAuthorizationService,
    private readonly audit: AuditService,
    private readonly routing: AiWorkflowRoutingService,
  ) {}

  private async published(listCode: string, at: Date, client: PrismaService | Prisma.TransactionClient = this.prisma) {
    return client.governedReferenceVersion.findFirst({
      where: {
        listCode,
        state: 'published',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { version: 'desc' },
      include: { values: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
    });
  }

  private async resolveConfiguration(client: PrismaService | Prisma.TransactionClient = this.prisma) {
    const now = new Date();
    const [scoreVersion, tierVersion] = await Promise.all([
      this.published('R_SDAIA_SCORE', now, client),
      this.published('R_SDAIA_TIER', now, client),
    ]);
    const issues: string[] = [];
    if (!scoreVersion) issues.push('Published R_SDAIA_SCORE is required');
    if (!tierVersion) issues.push('Published R_SDAIA_TIER is required');

    const scores: ConfigValue[] = (scoreVersion?.values ?? []).map(value => {
      const meta = metadata(value.metadata);
      return {
        code: value.code,
        labelEn: value.labelEn,
        labelAr: value.labelAr,
        score: integer(meta['score']),
        anchors: metadata(meta['anchors'] as Prisma.JsonValue),
      };
    });
    const numericScores = scores.map(value => value.score).filter((value): value is number => value !== undefined);
    if (numericScores.length !== 5 || new Set(numericScores).size !== 5 || ![1, 2, 3, 4, 5].every(value => numericScores.includes(value))) {
      issues.push('R_SDAIA_SCORE must publish one metadata.score entry for each integer 1–5');
    }
    for (const criterion of AI_CLASSIFICATION_CRITERIA) {
      if (scores.some(value => !value.anchors || !validAnchor(value.anchors[criterion]))) {
        issues.push(`R_SDAIA_SCORE metadata must include bilingual ${criterion} anchors for every score`);
      }
    }

    const tiers: ConfigValue[] = (tierVersion?.values ?? []).map(value => {
      const meta = metadata(value.metadata);
      return {
        code: value.code,
        labelEn: value.labelEn,
        labelAr: value.labelAr,
        minScore: integer(meta['minScore']),
        maxScore: integer(meta['maxScore']),
        automatic: meta['automatic'] === true,
      };
    });
    const automaticTiers = tiers.filter(value => value.automatic);
    for (const score of [1, 2, 3, 4, 5]) {
      const matches = automaticTiers.filter(value => value.minScore !== undefined && value.maxScore !== undefined
        && score >= value.minScore && score <= value.maxScore);
      if (matches.length !== 1) issues.push(`R_SDAIA_TIER must map score ${score} to exactly one automatic tier`);
    }
    if (automaticTiers.length !== 3) issues.push('R_SDAIA_TIER must publish exactly three automatic tier bands');
    for (const code of ['MINIMAL', 'LIMITED', 'HIGH']) {
      if (automaticTiers.filter(value => value.code.toUpperCase() === code).length !== 1) {
        issues.push(`R_SDAIA_TIER must publish one automatic ${code} tier`);
      }
    }
    const unacceptable = tiers.filter(value => !value.automatic && value.code.toUpperCase() === 'UNACCEPTABLE');
    if (unacceptable.length !== 1) issues.push('R_SDAIA_TIER must publish exactly one manual UNACCEPTABLE tier');

    return {
      ready: issues.length === 0,
      issues: [...new Set(issues)],
      criteria: [...AI_CLASSIFICATION_CRITERIA],
      scoreVersionId: scoreVersion?.id ?? null,
      tierVersionId: tierVersion?.id ?? null,
      scores,
      tiers,
    };
  }

  async configuration(userId: string) {
    await this.authorization.authorize(userId, 'aiuc.classify.assess');
    return this.resolveConfiguration();
  }

  async queue(userId: string) {
    await this.authorization.authorize(userId, 'aiuc.classify.assess');
    return this.prisma.aiUseCase.findMany({
      where: {
        deletedAt: null,
        useCaseRef: { not: null },
        workflowCase: {
          is: {
            status: CaseStatus.under_review,
            tasks: { some: { assigneeRoleCode: 'AI_WORKING_GROUP', ...this.routing.pendingStageWhere(AIUC_STAGE.classification, CLASSIFICATION_TASK_TITLE) } },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      select: classificationCase,
    });
  }

  async verificationQueue(userId: string) {
    const actor = await this.authorization.authorize(userId, 'aiuc.classify.assess');
    if (!actor.roles.includes('AI_GOVERNANCE_OFFICER')) {
      throw new ForbiddenException('Responsible AI Officer role is required for classification verification');
    }
    return this.prisma.aiUseCase.findMany({
      where: {
        deletedAt: null,
        useCaseRef: { not: null },
        workflowCase: {
          is: {
            status: CaseStatus.under_review,
            tasks: { some: { assigneeRoleCode: 'AI_GOVERNANCE_OFFICER', ...this.routing.pendingStageWhere(AIUC_STAGE.classification, OFFICER_TASK_TITLE) } },
          },
        },
        assessments: { some: { kind: 'classification' } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      select: classificationCase,
    });
  }

  async assess(userId: string, id: string, expectedVersion: number, value: unknown) {
    let input: AiCalculationInputV1;
    try {
      assertCalculationInputV1(value);
      input = value;
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    if (input.kind !== 'classification') throw new BadRequestException('Classification input is required');

    return this.prisma.$transaction(async tx => {
      const actor = await this.authorization.authorize(userId, 'aiuc.classify.assess', tx);
      const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: classificationCase });
      if (!current || !current.workflowCaseId || !current.useCaseRef || current.workflowCase?.status !== CaseStatus.under_review) {
        throw new NotFoundException('AI use case is not available for classification');
      }
      if (current.version !== expectedVersion) throw new ConflictException('AI use case changed; reload before recording classification');
      const task = await tx.workflowTask.findFirst({
        where: {
          caseId: current.workflowCaseId,
          assigneeRoleCode: 'AI_WORKING_GROUP',
          ...this.routing.pendingStageWhere(AIUC_STAGE.classification, CLASSIFICATION_TASK_TITLE),
        },
      });
      if (!task) throw new ConflictException('No active AIUC classification task exists');

      const config = await this.resolveConfiguration(tx);
      if (!config.ready || !config.scoreVersionId || !config.tierVersionId) {
        throw new BadRequestException({ message: 'AI classification reference configuration is incomplete', issues: config.issues });
      }
      const permitted = new Set(config.scores.map(value => value.score));
      if (input.scores.some(score => !permitted.has(score.value))) {
        throw new BadRequestException('A classification score is outside the published R_SDAIA_SCORE version');
      }
      const scoreMax = Math.max(...input.scores.map(score => score.value));
      const tier = config.tiers.find(value => value.automatic && value.minScore !== undefined && value.maxScore !== undefined
        && scoreMax >= value.minScore && scoreMax <= value.maxScore);
      if (!tier) throw new BadRequestException('Published tier bands do not resolve the calculated score');

      const previous = await tx.aiAssessmentRound.findFirst({
        where: { useCaseId: id, riskId: null, kind: 'classification' },
        orderBy: { round: 'desc' },
        select: { round: true },
      });
      const round = (previous?.round ?? 0) + 1;
      const now = new Date();
      const result = {
        scoreMax,
        proposedTierCode: tier.code,
        routingFacts: this.routing.routingFacts(task.formDataJson),
        criteria: AI_CLASSIFICATION_CRITERIA.map((criterion, index) => ({ criterion, score: input.scores[index].value })),
        referenceVersions: { R_SDAIA_SCORE: config.scoreVersionId, R_SDAIA_TIER: config.tierVersionId },
      };
      const assessment = await tx.aiAssessmentRound.create({
        data: {
          useCaseId: id,
          kind: 'classification',
          round,
          engineVersion: ENGINE_VERSION,
          ruleReferenceVersionId: config.tierVersionId,
          inputs: {
            kind: 'classification',
            criteria: AI_CLASSIFICATION_CRITERIA.map((criterion, index) => ({ criterion, ...input.scores[index] })),
            scoreReferenceVersionId: config.scoreVersionId,
          } as Prisma.InputJsonObject,
          result: result as Prisma.InputJsonObject,
          createdBy: userId,
        },
      });
      await tx.workflowTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.completed,
          decision: TaskDecision.approved,
          decisionComment: `Proposed tier ${tier.code}; maximum score ${scoreMax}`,
          completedAt: now,
          formSubmittedAt: now,
          formSubmittedBy: userId,
        },
      });
      await this.routing.createStageTask(tx, current.workflowCaseId, AIUC_STAGE.classification, now, {
        assigneeRoleCode: 'AI_GOVERNANCE_OFFICER',
        formDataJson: { routingFacts: result.routingFacts, verificationTask: true },
      });
      const updated = await tx.aiUseCase.updateMany({
        where: { id, version: expectedVersion, workflowCaseId: current.workflowCaseId },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('AI use case changed; reload before recording classification');
      await tx.workflowEvent.create({
        data: {
          caseId: current.workflowCaseId,
          taskId: task.id,
          actor: userId,
          action: 'aiuc.classification.assessed',
          fromStatus: CaseStatus.under_review,
          toStatus: CaseStatus.under_review,
          comment: `Proposed tier ${tier.code}; maximum score ${scoreMax}`,
        },
      });
      await this.audit.logRequired({
        actor: userId,
        action: 'aiuc.classification.assessed',
        entityType: 'ai_use_case',
        entityId: id,
        metadata: {
          actorRoles: actor.roles,
          caseCode: current.workflowCase.code,
          useCaseRef: current.useCaseRef,
          assessmentId: assessment.id,
          round,
          scoreMax,
          proposedTierCode: tier.code,
          referenceVersions: result.referenceVersions,
        },
      }, tx);
      return tx.aiUseCase.findUniqueOrThrow({ where: { id }, select: classificationCase });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async verify(userId: string, id: string, expectedVersion: number, justification?: string, clientIp?: string) {
    return this.recordOfficerDecision(userId, id, 'verify', { expectedVersion, justification, clientIp });
  }

  async override(userId: string, id: string, expectedVersion: number, approvedTierCode: string,
    justification: string, evidenceIds: string[], authorityReference: string, clientIp?: string) {
    return this.recordOfficerDecision(userId, id, 'override', {
      expectedVersion, approvedTierCode, justification, evidenceIds, authorityReference, clientIp,
    });
  }

  async unacceptable(userId: string, id: string, expectedVersion: number, justification: string,
    evidenceIds: string[], authorityReference: string, clientIp?: string) {
    return this.recordOfficerDecision(userId, id, 'unacceptable', {
      expectedVersion, justification, evidenceIds, authorityReference, clientIp,
    });
  }

  private async reversalGate(tx:Prisma.TransactionClient,userId:string,id:string) {
    const current=await tx.aiUseCase.findFirst({where:{id,deletedAt:null,isSampleData:false},select:classificationCase});
    if(!current?.workflowCaseId||!await aiNoticeAccess(tx,userId,current.workflowCaseId))throw new NotFoundException('Native AI classification not found');
    const source=current.assessments[0],result=source?metadata(source.result):{},decision=metadata(result['officerDecision'] as Prisma.JsonValue);
    const levels=['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER','AI_ETHICS_COMMITTEE','AI_EXECUTIVE_TEAM','STEERING_COMMITTEE'];
    const previousLevel=levels.indexOf(String(decision['actorRole']));
    const access=await aiNoticeAccess(tx,userId,current.workflowCaseId);
    const grants=await tx.rolePermission.findMany({where:{role:{code:{in:['AI_ETHICS_COMMITTEE','AI_EXECUTIVE_TEAM','STEERING_COMMITTEE']},isActive:true,deletedAt:null,userRoles:{some:{userId}}},permission:{resource:'aiuc.classify',action:'reverse'}},include:{role:true}});
    const administratorOverride=isSystemAdministrator(access?.roles);
    const role=administratorOverride?'STEERING_COMMITTEE':grants.map(g=>g.role.code).sort((a,b)=>levels.indexOf(a)-levels.indexOf(b)).find(r=>levels.indexOf(r)>previousLevel);
    const owner=current.ownerPersonId?await tx.person.findUnique({where:{id:current.ownerPersonId},select:{userId:true}}):null;
    const calculated=source?classificationResult(source.result):null;
    const basis=typeof result['sourceAssessmentId']==='string'?await tx.aiAssessmentRound.findFirst({where:{id:result['sourceAssessmentId'],useCaseId:id,kind:'classification'}}):null;
    const canReverse=!!source&&source.engineVersion===DECISION_ENGINE_VERSION&&['override','unacceptable'].includes(String(decision['decisionType']))&&previousLevel>=1&&!!role&&(administratorOverride||!access!.roles.includes('auditor')&&![current.requesterUserId,owner?.userId,source.createdBy,basis?.createdBy,decision['verifiedBy']].includes(userId))&&!current.assetId&&['under_review','decision_made','approved'].includes(current.workflowCase!.status)&&result['approvedTierCode']!==calculated?.proposedTierCode;
    return {current,source,basis,result,decision,role,canReverse};
  }
  async reversalContext(userId:string,id:string) {
    return governanceTransaction(this.prisma,async tx=>{const g=await this.reversalGate(tx,userId,id);return {version:g.current.version,assessmentId:g.source?.id??null,calculatedTierCode:g.result['proposedTierCode']??null,approvedTierCode:g.result['approvedTierCode']??null,scoreMax:g.result['scoreMax']??null,canReverse:g.canReverse,registeredReassessmentRequired:!!g.current.assetId};});
  }
  async reverseOverride(userId:string,id:string,expectedVersion:number,justificationValue:string,evidenceInput:string[],authorityReferenceValue:string,clientIp?:string) {
    const justification=governanceText(justificationValue),authorityReference=governanceText(authorityReferenceValue);
    return governanceTransaction(this.prisma,async tx=>{
      const actor=await this.authorization.authorize(userId,'aiuc.classify.reverse',tx),g=await this.reversalGate(tx,userId,id);
      await this.authorization.enforceDuty(actor,'approve_aiuc',{requesterId:g.current.requesterUserId,useCaseOwnerId:g.current.ownerPersonId?(await tx.person.findUnique({where:{id:g.current.ownerPersonId}}))?.userId??undefined:undefined},id);
      if(!g.canReverse)throw new ForbiddenException('Only an independent higher classification authority may reverse the current pre-registration override');
      if(g.current.version!==expectedVersion)throw new ConflictException('AI classification changed; reload');
      const source=g.source!,evidenceIds=await governanceEvidence(tx,evidenceInput),calculated=classificationResult(source.result),now=new Date();
      const tier=await tx.governedReferenceValue.findUnique({where:{versionId_code:{versionId:source.ruleReferenceVersionId,code:calculated.proposedTierCode}}});
      if(!tier||metadata(tier.metadata)['automatic']!==true)throw new ConflictException('The immutable assessment lacks its pinned automatic tier');
      const task=await this.routing.createStageTask(tx,g.current.workflowCaseId!,AIUC_STAGE.classification,now,{title:'Higher-authority classification reversal',assigneeRoleCode:g.role!,assigneeUserId:userId,formDataJson:{sourceAssessmentId:source.id,operation:'tier_reversal'}});
      const routingFacts=metadata(g.basis?.result??source.result)['routingFacts'];
      const decisionRound=await tx.aiAssessmentRound.create({data:{useCaseId:id,kind:'classification',round:source.round+1,engineVersion:DECISION_ENGINE_VERSION,ruleReferenceVersionId:source.ruleReferenceVersionId,inputs:source.inputs as Prisma.InputJsonValue,result:{...g.result as Prisma.InputJsonObject,routingFacts:(routingFacts??{}) as Prisma.InputJsonValue,approvedTierCode:calculated.proposedTierCode,sourceAssessmentId:source.id,officerDecision:{decisionType:'reversal',reversesAssessmentId:source.id,actorRole:g.role!,verifiedBy:userId,verifiedAt:now.toISOString(),justification,evidenceIds,authorityReference}},createdBy:userId}});
      await tx.workflowTask.update({where:{id:task.id},data:{status:'completed',decision:'approved',completedAt:now,formSubmittedAt:now,formSubmittedBy:userId,decisionComment:justification}});
      const cancelled=await tx.workflowTask.findMany({where:{caseId:g.current.workflowCaseId!,id:{not:task.id},status:{in:['pending','in_progress']}},select:{id:true}});
      await tx.workflowTask.updateMany({where:{id:{in:cancelled.map(t=>t.id)}},data:{status:'cancelled',decisionComment:'Superseded by higher-authority classification reversal'}});
      const route=await this.routing.openPostClassificationGate(tx,g.current.workflowCaseId!,decisionRound.id,calculated.proposedTierCode,calculated.proposedTierCode,this.routing.routingFacts({routingFacts}),now);
      await tx.workflowCase.update({where:{id:g.current.workflowCaseId!},data:{status:route.nextStatus}});
      if((await tx.aiUseCase.updateMany({where:{id,version:expectedVersion,assetId:null},data:{version:{increment:1}}})).count!==1)throw new ConflictException('AI classification changed; reload');
      await tx.workflowEvent.create({data:{caseId:g.current.workflowCaseId!,taskId:task.id,actor:userId,action:'aiuc.classification.reversed',fromStatus:g.current.workflowCase!.status,toStatus:route.nextStatus,comment:justification}});
      await this.audit.logRequired({actor:userId,action:'aiuc.classification.reversed',entityType:'ai_use_case',entityId:id,metadata:{sourceAssessmentId:source.id,decisionAssessmentId:decisionRound.id,oldValue:g.result['approvedTierCode'],newValue:calculated.proposedTierCode,scoreMax:calculated.scoreMax,actorRoleCode:g.role,justification,evidenceIds,authorityReference,clientIp:clientIp??null,cancelledTaskIds:cancelled.map(t=>t.id),before:{version:expectedVersion,status:g.current.workflowCase!.status},after:{version:expectedVersion+1,status:route.nextStatus}}},tx);
      return {id,version:expectedVersion+1,assessmentId:decisionRound.id};
    });
  }

  private async recordOfficerDecision(userId: string, id: string, mode: OfficerDecisionMode, options: OfficerDecisionOptions) {
    return this.prisma.$transaction(async tx => {
      const permission = mode === 'override' ? 'aiuc.classify.override' as const
        : mode === 'unacceptable' ? 'aiuc.tier.unacceptable' as const
          : 'aiuc.classify.assess' as const;
      const actor = await this.authorization.authorize(userId, permission, tx);
      if (mode === 'verify' && !actor.roles.includes('AI_GOVERNANCE_OFFICER')) {
        throw new ForbiddenException('Responsible AI Officer role is required for classification verification');
      }
      const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: classificationCase });
      if (!current || !current.workflowCaseId || !current.useCaseRef || current.workflowCase?.status !== CaseStatus.under_review) {
        throw new NotFoundException('AI use case is not available for classification verification');
      }
      if (current.version !== options.expectedVersion) {
        throw new ConflictException('AI use case changed; reload before recording classification verification');
      }
      const task = await tx.workflowTask.findFirst({
        where: {
          caseId: current.workflowCaseId,
          assigneeRoleCode: 'AI_GOVERNANCE_OFFICER',
          ...this.routing.pendingStageWhere(AIUC_STAGE.classification, OFFICER_TASK_TITLE),
        },
      });
      if (!task) throw new ConflictException('No active Responsible AI Officer verification task exists');

      const source = current.assessments[0];
      if (!source) throw new ConflictException('A calculated classification round is required before verification');
      if (source.createdBy === actor.id && !isSystemAdministrator(actor.roles)) {
        throw new ForbiddenException('The classification assessor cannot verify or override the same round');
      }
      const calculated = classificationResult(source.result);
      const tierVersion = await tx.governedReferenceVersion.findUnique({
        where: { id: source.ruleReferenceVersionId },
        include: { values: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
      });
      if (!tierVersion || tierVersion.listCode !== 'R_SDAIA_TIER') {
        throw new ConflictException('The classification tier reference version is unavailable');
      }
      const tiers = tierVersion.values.map(value => ({ value, meta: metadata(value.metadata) }));
      const proposedTier = tiers.find(entry => entry.value.code === calculated.proposedTierCode);
      if (!proposedTier || proposedTier.meta['automatic'] !== true) {
        throw new ConflictException('The calculated proposal is not an automatic tier in its pinned reference version');
      }

      let approvedTier = proposedTier;
      let justification = options.justification?.trim() || undefined;
      let authorityReference: string | undefined;
      let evidenceIds: string[] = [];
      if (mode === 'override') {
        const code = requiredText(options.approvedTierCode, 'Approved tier code');
        const targetTier = tiers.find(entry => entry.value.code === code);
        if (!targetTier) throw new BadRequestException('Approved tier is outside the assessment reference version');
        approvedTier = targetTier;
        if (approvedTier.value.code === proposedTier.value.code) {
          throw new BadRequestException('An override must differ from the calculated proposed tier');
        }
        if (approvedTier.meta['automatic'] !== true) {
          throw new BadRequestException('Use the manual Unacceptable operation for a non-automatic tier');
        }
      } else if (mode === 'unacceptable') {
        const manual = tiers.filter(entry => entry.meta['automatic'] !== true && entry.value.code.toUpperCase() === 'UNACCEPTABLE');
        if (manual.length !== 1) throw new ConflictException('The pinned tier version has no unique manual Unacceptable value');
        approvedTier = manual[0];
      }

      if (mode !== 'verify') {
        justification = requiredText(options.justification, 'Override justification');
        authorityReference = requiredText(options.authorityReference, 'Higher-authority reference');
        evidenceIds = [...new Set((options.evidenceIds ?? []).map(value => value.trim()).filter(Boolean))];
        if (!evidenceIds.length) throw new BadRequestException('At least one DGOP evidence identifier is required');
        const evidenceCount = await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } });
        if (evidenceCount !== evidenceIds.length) throw new BadRequestException('Every override evidence identifier must exist in the DGOP evidence store');
      }

      const actorRole = ['STEERING_COMMITTEE', 'AI_EXECUTIVE_TEAM', 'AI_ETHICS_COMMITTEE', 'AI_GOVERNANCE_OFFICER']
        .find(role => actor.roles.includes(role));
      if (!actorRole) throw new ForbiddenException('A higher classification authority role is required');
      const now = new Date();
      const sourceResult = metadata(source.result);
      const officerDecision: Prisma.InputJsonObject = {
        decisionType: mode,
        approvedTierCode: approvedTier.value.code,
        actorRole,
        verifiedBy: actor.id,
        verifiedAt: now.toISOString(),
        evidenceIds,
        ...(justification ? { justification } : {}),
        ...(authorityReference ? { authorityReference } : {}),
      };
      const result: Prisma.InputJsonObject = {
        scoreMax: calculated.scoreMax,
        proposedTierCode: calculated.proposedTierCode,
        approvedTierCode: approvedTier.value.code,
        sourceAssessmentId: source.id,
        officerDecision,
        ...(sourceResult['criteria'] !== undefined ? { criteria: sourceResult['criteria'] as Prisma.InputJsonValue } : {}),
        ...(sourceResult['referenceVersions'] !== undefined
          ? { referenceVersions: sourceResult['referenceVersions'] as Prisma.InputJsonValue }
          : {}),
      };
      const decisionRound = await tx.aiAssessmentRound.create({
        data: {
          useCaseId: id,
          kind: 'classification',
          round: source.round + 1,
          engineVersion: DECISION_ENGINE_VERSION,
          ruleReferenceVersionId: source.ruleReferenceVersionId,
          inputs: source.inputs as Prisma.InputJsonValue,
          result,
          createdBy: actor.id,
        },
      });
      await tx.workflowTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.completed,
          decision: TaskDecision.approved,
          decisionComment: `${mode}: ${calculated.proposedTierCode} -> ${approvedTier.value.code}`,
          completedAt: now,
          formSubmittedAt: now,
          formSubmittedBy: actor.id,
        },
      });

      const routingFacts = this.routing.routingFacts({ routingFacts: sourceResult['routingFacts'] });
      const route = await this.routing.openPostClassificationGate(
        tx, current.workflowCaseId, decisionRound.id, approvedTier.value.code, calculated.proposedTierCode, routingFacts, now,
      );
      const updated = await tx.aiUseCase.updateMany({
        where: { id, version: options.expectedVersion, workflowCaseId: current.workflowCaseId },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('AI use case changed; reload before recording classification verification');
      const action = `aiuc.classification.${mode === 'verify' ? 'verified' : mode === 'override' ? 'overridden' : 'unacceptable'}`;
      await tx.workflowEvent.create({
        data: {
          caseId: current.workflowCaseId,
          taskId: task.id,
          actor: actor.id,
          action,
          fromStatus: CaseStatus.under_review,
          toStatus: route.nextStatus,
          comment: `${calculated.proposedTierCode} -> ${approvedTier.value.code}; next ${route.nextRoles.join(', ')}`,
        },
      });
      await this.audit.logRequired({
        actor: actor.id,
        action,
        entityType: 'ai_use_case',
        entityId: id,
        metadata: {
          actorRoles: actor.roles,
          actorRole,
          clientIp: options.clientIp ?? null,
          caseCode: current.workflowCase.code,
          useCaseRef: current.useCaseRef,
          sourceAssessmentId: source.id,
          decisionAssessmentId: decisionRound.id,
          scoreMax: calculated.scoreMax,
          oldValue: calculated.proposedTierCode,
          newValue: approvedTier.value.code,
          justification: justification ?? null,
          evidenceIds,
          authorityReference: authorityReference ?? null,
          nextRoles: route.nextRoles,
          conditionalReviewTaskCount: route.reviewTaskCount,
        },
      }, tx);
      return tx.aiUseCase.findUniqueOrThrow({ where: { id }, select: classificationCase });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async returnForReassessment(userId: string, id: string, expectedVersion: number, justificationValue: string, clientIp?: string) {
    const justification = requiredText(justificationValue, 'Return justification');
    return this.prisma.$transaction(async tx => {
      const actor = await this.authorization.authorize(userId, 'aiuc.classify.assess', tx);
      if (!actor.roles.includes('AI_GOVERNANCE_OFFICER')) {
        throw new ForbiddenException('Responsible AI Officer role is required for classification verification');
      }
      const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: classificationCase });
      if (!current || !current.workflowCaseId || !current.useCaseRef || current.workflowCase?.status !== CaseStatus.under_review) {
        throw new NotFoundException('AI use case is not available for classification verification');
      }
      if (current.version !== expectedVersion) throw new ConflictException('AI use case changed; reload before returning classification');
      const task = await tx.workflowTask.findFirst({
        where: { caseId: current.workflowCaseId, assigneeRoleCode: 'AI_GOVERNANCE_OFFICER', ...this.routing.pendingStageWhere(AIUC_STAGE.classification, OFFICER_TASK_TITLE) },
      });
      if (!task) throw new ConflictException('No active Responsible AI Officer verification task exists');
      const source = current.assessments[0];
      if (!source) throw new ConflictException('A calculated classification round is required before verification');
      if (source.createdBy === actor.id && !isSystemAdministrator(actor.roles)) throw new ForbiddenException('The classification assessor cannot verify the same round');
      const calculated = classificationResult(source.result);
      const now = new Date();
      await tx.workflowTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.completed,
          decision: TaskDecision.rejected,
          decisionComment: justification,
          completedAt: now,
          formSubmittedAt: now,
          formSubmittedBy: actor.id,
        },
      });
      await this.routing.createStageTask(tx, current.workflowCaseId, AIUC_STAGE.classification, now, {
        formDataJson: { routingFacts: this.routing.routingFacts({ routingFacts: metadata(source.result)['routingFacts'] }) },
      });
      const updated = await tx.aiUseCase.updateMany({
        where: { id, version: expectedVersion, workflowCaseId: current.workflowCaseId },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('AI use case changed; reload before returning classification');
      await tx.workflowEvent.create({
        data: {
          caseId: current.workflowCaseId,
          taskId: task.id,
          actor: actor.id,
          action: 'aiuc.classification.returned',
          fromStatus: CaseStatus.under_review,
          toStatus: CaseStatus.under_review,
          comment: justification,
        },
      });
      await this.audit.logRequired({
        actor: actor.id,
        action: 'aiuc.classification.returned',
        entityType: 'ai_use_case',
        entityId: id,
        metadata: {
          actorRoles: actor.roles,
          clientIp: clientIp ?? null,
          caseCode: current.workflowCase.code,
          useCaseRef: current.useCaseRef,
          sourceAssessmentId: source.id,
          proposedTierCode: calculated.proposedTierCode,
          scoreMax: calculated.scoreMax,
          justification,
          nextRole: 'AI_WORKING_GROUP',
        },
      }, tx);
      return tx.aiUseCase.findUniqueOrThrow({ where: { id }, select: classificationCase });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reviewQueue(userId: string) {
    const actor = await this.authorization.authorize(userId, 'case.view.aiuc.org');
    const reviewRoles = actor.roles.filter(role => ['privacy_officer', 'security_reviewer', 'AI_ETHICS_COMMITTEE'].includes(role));
    if (!reviewRoles.length) return [];
    const stageCodes = [AIUC_STAGE.privacy, AIUC_STAGE.security, AIUC_STAGE.ethics];
    return this.prisma.aiUseCase.findMany({
      where: {
        deletedAt: null,
        useCaseRef: { not: null },
        workflowCase: {
          is: {
            status: CaseStatus.under_review,
            tasks: {
              some: {
                status: TaskStatus.pending,
                assigneeRoleCode: { in: reviewRoles },
                templateStage: { is: { code: { in: stageCodes }, template: { is: { code: 'AIUC_APPROVAL_V1' } } } },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      select: {
        ...classificationCase,
        workflowCase: {
          select: {
            id: true, code: true, status: true,
            tasks: {
              where: {
                status: TaskStatus.pending,
                assigneeRoleCode: { in: reviewRoles },
                templateStage: { is: { code: { in: stageCodes } } },
              },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true, title: true, assigneeRoleCode: true, dueDate: true, approvalGroupId: true, formDataJson: true,
                templateStage: { select: { code: true, nameEn: true, nameAr: true } },
              },
            },
          },
        },
      },
    });
  }

  async reviewGate(
    userId: string,
    id: string,
    taskId: string,
    expectedVersion: number,
    decision: 'approve' | 'return' | 'reject',
    justificationValue: string,
    evidenceValues: string[],
    clientIp?: string,
  ) {
    const justification = requiredText(justificationValue, 'Review justification');
    const evidenceIds = [...new Set(evidenceValues.map(value => value.trim()).filter(Boolean))];
    if (!evidenceIds.length) throw new BadRequestException('At least one DGOP evidence identifier is required');
    return this.prisma.$transaction(async tx => {
      const actor = await this.authorization.authorize(userId, 'case.view.aiuc.org', tx);
      const current = await tx.aiUseCase.findFirst({
        where: { id, deletedAt: null },
        select: {
          ...classificationCase,
          owner: { select: { userId: true } },
        },
      });
      if (!current || !current.workflowCaseId || current.workflowCase?.status !== CaseStatus.under_review) {
        throw new NotFoundException('AI use case is not available for specialist review');
      }
      if (current.version !== expectedVersion) throw new ConflictException('AI use case changed; reload before recording specialist review');
      const task = await tx.workflowTask.findFirst({
        where: {
          id: taskId,
          caseId: current.workflowCaseId,
          status: TaskStatus.pending,
          templateStage: { is: { code: { in: [AIUC_STAGE.privacy, AIUC_STAGE.security, AIUC_STAGE.ethics] } } },
        },
        include: { templateStage: { select: { code: true, nameEn: true } } },
      });
      if (!task || !task.assigneeRoleCode || !actor.roles.includes(task.assigneeRoleCode)) {
        throw new ForbiddenException('The specialist review task is not assigned to an active actor role');
      }
      if (task.templateStage?.code === AIUC_STAGE.ethics) {
        await this.authorization.enforceDuty(actor, 'ethics_review', {
          requesterId: current.requesterUserId,
          useCaseOwnerId: current.owner?.userId ?? undefined,
        }, id);
      }
      const evidenceCount = await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } });
      if (evidenceCount !== evidenceIds.length) {
        throw new BadRequestException('Every review evidence identifier must exist in the DGOP evidence store');
      }
      const now = new Date();
      await tx.workflowTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.completed,
          decision: decision === 'approve' ? TaskDecision.approved : TaskDecision.rejected,
          decisionComment: justification,
          completedAt: now,
          formSubmittedAt: now,
          formSubmittedBy: actor.id,
          formDataJson: {
            ...metadata(task.formDataJson as Prisma.JsonValue),
            reviewDecision: decision,
            justification,
            evidenceIds,
          } as Prisma.InputJsonObject,
        },
      });
      const form = metadata(task.formDataJson as Prisma.JsonValue);
      const approvedTierCode = requiredText(typeof form['approvedTierCode'] === 'string' ? form['approvedTierCode'] : undefined, 'Approved tier code');
      const decisionRoundId = requiredText(typeof form['classificationDecisionId'] === 'string' ? form['classificationDecisionId'] : undefined, 'Classification decision identifier');
      const routingFacts = this.routing.routingFacts(task.formDataJson);
      let nextRoles: string[] = [];
      let nextStatus: CaseStatus = CaseStatus.under_review;
      if (decision === 'approve') {
        const openPeers = task.approvalGroupId ? await tx.workflowTask.count({
          where: { caseId: current.workflowCaseId, approvalGroupId: task.approvalGroupId, status: TaskStatus.pending, id: { not: task.id } },
        }) : 0;
        if (openPeers === 0) {
          const next = await this.routing.createDecisionTask(
            tx, current.workflowCaseId, decisionRoundId, approvedTierCode, routingFacts, now,
          );
          nextStatus = CaseStatus.decision_made;
          if (next.assigneeRoleCode) nextRoles = [next.assigneeRoleCode];
        }
      } else {
        if (task.approvalGroupId) {
          await tx.workflowTask.updateMany({
            where: { caseId: current.workflowCaseId, approvalGroupId: task.approvalGroupId, status: TaskStatus.pending },
            data: { status: TaskStatus.cancelled, completedAt: now, decisionComment: `Cancelled after ${task.templateStage?.code} ${decision}` },
          });
        }
        if (decision === 'return') {
          await this.routing.createStageTask(tx, current.workflowCaseId, AIUC_STAGE.classification, now, {
            formDataJson: { routingFacts },
          });
          nextRoles = ['AI_WORKING_GROUP'];
        } else {
          nextStatus = CaseStatus.rejected;
          await tx.workflowCase.update({ where: { id: current.workflowCaseId }, data: { status: nextStatus } });
        }
      }
      const updated = await tx.aiUseCase.updateMany({
        where: { id, version: expectedVersion, workflowCaseId: current.workflowCaseId },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('AI use case changed; reload before recording specialist review');
      const action = `aiuc.review.${task.templateStage?.code}.${decision}`;
      await tx.workflowEvent.create({
        data: {
          caseId: current.workflowCaseId,
          taskId: task.id,
          actor: actor.id,
          action,
          fromStatus: CaseStatus.under_review,
          toStatus: nextStatus,
          comment: justification,
        },
      });
      await this.audit.logRequired({
        actor: actor.id,
        action,
        entityType: 'ai_use_case',
        entityId: id,
        metadata: {
          actorRoles: actor.roles,
          reviewerRole: task.assigneeRoleCode,
          stageCode: task.templateStage?.code,
          taskId: task.id,
          decision,
          justification,
          evidenceIds,
          clientIp: clientIp ?? null,
          approvedTierCode,
          classificationDecisionId: decisionRoundId,
          nextRoles,
        },
      }, tx);
      return tx.aiUseCase.findUniqueOrThrow({ where: { id }, select: classificationCase });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
