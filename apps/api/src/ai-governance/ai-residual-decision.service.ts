import { logAiRequired } from './ai-notifications';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, Prisma, TaskDecision, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService, AiDutyAction, aiDutyViolation } from './ai-authorization.service';
import { AiRiskIntakeService, riskSelect } from './ai-risk-intake.service';
import { AiResidualAssessmentService } from './ai-residual-assessment.service';
import { AiRiskAssessmentService } from './ai-risk-assessment.service';
import { AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { AiPermission } from './ai-permissions';
import { computeInherentRisk, jsonRecord, RiskScoringConfiguration } from './ai-risk-scoring';
import { DecideResidualRiskDto } from './ai-residual-decision.dto';
import { isSystemAdministrator } from '../auth/system-admin';

export const RESIDUAL_STAGES = {
  adoption: 'airs-residual-adoption', ethics: 'airs-residual-ethics', low: 'airs-accept-low',
  mediumOwner: 'airs-accept-medium-owner', countersign: 'airs-accept-medium-countersign',
  executive: 'airs-accept-high', steering: 'airs-restrict-critical',
} as const;
const stageRules: Record<string, {kind:string;role:string;permission:AiPermission;action:AiDutyAction;outcome:'approve'|'accept'|'restrict';band?:string}> = {
  [RESIDUAL_STAGES.adoption]: {kind:'adoption',role:'AI_GOVERNANCE_OFFICER',permission:'case.approve.airs',action:'adopt_assessment',outcome:'approve'},
  [RESIDUAL_STAGES.ethics]: {kind:'ethics',role:'AI_ETHICS_COMMITTEE',permission:'case.view.airs.org',action:'ethics_review',outcome:'approve',band:'HIGH'},
  [RESIDUAL_STAGES.low]: {kind:'accept_owner',role:'AI_USECASE_OWNER',permission:'airs.risk.accept.low',action:'accept_low',outcome:'accept',band:'LOW'},
  [RESIDUAL_STAGES.mediumOwner]: {kind:'accept_owner',role:'AI_USECASE_OWNER',permission:'airs.risk.accept.medium',action:'accept_medium',outcome:'accept',band:'MEDIUM'},
  [RESIDUAL_STAGES.countersign]: {kind:'countersign',role:'AI_GOVERNANCE_OFFICER',permission:'airs.risk.accept.medium',action:'accept_medium',outcome:'accept',band:'MEDIUM'},
  [RESIDUAL_STAGES.executive]: {kind:'executive',role:'AI_EXECUTIVE_TEAM',permission:'airs.risk.accept.high',action:'accept_high',outcome:'accept',band:'HIGH'},
  [RESIDUAL_STAGES.steering]: {kind:'steering',role:'STEERING_COMMITTEE',permission:'case.approve.airs',action:'restrict_critical',outcome:'restrict',band:'CRITICAL'},
};
const options={isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000,maxWait:15000};
export function residualAuthority(band:string) {
  const route:Record<string,{stage:string;role:string;level:number;accepted:boolean}>={
    LOW:{stage:RESIDUAL_STAGES.low,role:'AI_USECASE_OWNER',level:0,accepted:true},
    MEDIUM:{stage:RESIDUAL_STAGES.mediumOwner,role:'AI_USECASE_OWNER',level:0,accepted:true},
    HIGH:{stage:RESIDUAL_STAGES.ethics,role:'AI_ETHICS_COMMITTEE',level:3,accepted:true},
    CRITICAL:{stage:RESIDUAL_STAGES.steering,role:'STEERING_COMMITTEE',level:4,accepted:false},
  };
  if(!route[band])throw new ConflictException('A computed residual band is required');
  return route[band];
}

@Injectable()
export class AiResidualDecisionService {
  constructor(private readonly prisma:PrismaService,private readonly authorization:AiAuthorizationService,
    private readonly risks:AiRiskIntakeService,private readonly residual:AiResidualAssessmentService,
    private readonly scoring:AiRiskAssessmentService,private readonly routing:AiWorkflowRoutingService,private readonly audit:AuditService){}

  async gate(tx:Prisma.TransactionClient,userId:string,id:string) {
    const access=await this.risks.visibility(userId,tx);
    const risk=await tx.aiRisk.findFirst({where:{AND:[access.where,{id}]},select:riskSelect});
    if(!risk)throw new NotFoundException('AI risk not found');
    const rounds=await tx.aiAssessmentRound.findMany({where:{riskId:id,kind:'residual'},orderBy:{round:'desc'},include:{decisions:true}});
    const assessment=rounds[0],input=jsonRecord(assessment?.inputs),result=jsonRecord(assessment?.result);
    const prerequisites=await this.residual.gate(tx,userId,id);
    const parentCurrent=!!assessment&&input['inherentAssessmentId']===prerequisites.inherent?.id&&input['responseId']===prerequisites.response?.id&&input['planId']===(prerequisites.plan?.id??null);
    const returned=assessment?.decisions.some(d=>d.decision==='return');
    const active=parentCurrent&&!returned&&risk.workflowCase?.status==='under_review';
    const tasks=risk.workflowCase?.templateId&&assessment?await tx.workflowTask.findMany({where:{caseId:risk.workflowCase.id,status:TaskStatus.pending,
      templateStage:{is:{code:{in:Object.values(RESIDUAL_STAGES)},templateId:risk.workflowCase.templateId,isActive:true,template:{is:{code:AIRS_TEMPLATE_CODE,isActive:true,deletedAt:null}}}}},include:{templateStage:{select:{code:true}}}}):[];
    const current=tasks.filter(t=>jsonRecord(t.formDataJson)['assessmentId']===assessment?.id&&jsonRecord(t.formDataJson)['responseId']===input['responseId']&&jsonRecord(t.formDataJson)['inherentAssessmentId']===input['inherentAssessmentId']);
    const dimensions=Array.isArray(input['dimensions'])?input['dimensions'].map(jsonRecord):[];
    const facts={riskOwnerId:risk.owner?.userId??undefined,useCaseOwnerId:risk.useCase.owner?.userId??undefined,
      assessmentAssessorIds:[assessment?.createdBy,...dimensions.map(d=>d['assessedBy'])].filter((v):v is string=>typeof v==='string'),residualScore:result['score'] as number};
    const ownerActive=!!await tx.person.findFirst({where:{userId:facts.useCaseOwnerId??'',isActive:true,deletedAt:null},select:{id:true}});
    const useCase=await tx.aiUseCase.findUniqueOrThrow({where:{id:risk.useCase.id},select:{operationalStatusCode:true}});
    return {...access,risk,rounds,assessment,input,result,prerequisites,parentCurrent,active,current,facts,ownerActive,useCase};
  }
  private decision(g:Awaited<ReturnType<AiResidualDecisionService['gate']>>,kind:string) {return g.assessment?.decisions.find(d=>d.kind===kind);}
  private allowed(g:Awaited<ReturnType<AiResidualDecisionService['gate']>>,task:Awaited<ReturnType<AiResidualDecisionService['gate']>>['current'][number]) {
    const rule=stageRules[task.templateStage!.code];
    const administratorOverride=isSystemAdministrator(g.actor.roles);
    if(!rule||!g.active||task.assigneeRoleCode!==rule.role||!administratorOverride&&(!g.permissions.has(rule.permission)||!g.actor.roles.includes(rule.role)||(task.assigneeUserId&&task.assigneeUserId!==g.actor.id)||!!aiDutyViolation(g.actor.id,g.actor.roles,rule.action,g.facts,false)))return false;
    if(rule.band&&rule.band!==g.result['bandCode'])return false;
    if(rule.kind==='accept_owner'&&(!g.ownerActive||!administratorOverride&&g.actor.id!==g.facts.useCaseOwnerId))return false;
    if(rule.kind==='countersign'&&(this.decision(g,'accept_owner')?.decision!=='accept'||!administratorOverride&&(this.decision(g,'accept_owner')?.actorId===g.actor.id||g.facts.useCaseOwnerId===g.actor.id)))return false;
    if(rule.kind==='executive'&&(this.decision(g,'ethics')?.decision!=='approve'||!administratorOverride&&this.decision(g,'ethics')?.actorId===g.actor.id))return false;
    if(rule.kind!=='adoption'&&this.decision(g,'adoption')?.decision!=='approve')return false;
    return g.current.filter(t=>t.templateStage?.code===task.templateStage!.code).length===1;
  }
  private async references(tx:Prisma.TransactionClient,input:Record<string,unknown>,lock=false) {
    const config=input['configuration'] as RiskScoringConfiguration,controls=jsonRecord(input['controlEffectiveness']);
    if(!config||typeof controls['referenceVersionId']!=='string'||!await this.scoring.referencesCurrent(tx,config,lock))return false;
    const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT v.id FROM governed_reference_versions v JOIN governed_reference_values cv ON cv."versionId"=v.id
      WHERE v.id=${controls['referenceVersionId']} AND v."listCode"='R_CTRLEFF' AND v.state='published' AND v."effectiveFrom"<=CURRENT_TIMESTAMP
       AND (v."effectiveTo" IS NULL OR v."effectiveTo">CURRENT_TIMESTAMP) AND cv.code=${controls['code'] as string} FOR SHARE OF v`;
    return rows.length===1;
  }
  async context(userId:string,id:string) {return this.prisma.$transaction(async tx=>{
    const g=await this.gate(tx,userId,id),referencesCurrent=!!g.assessment&&await this.references(tx,g.input);
    const accepted=g.parentCurrent&&!!g.assessment&&!g.assessment.decisions.some(d=>d.decision==='return')&&g.assessment.decisions.some(d=>d.decision==='accept'&&
      (d.kind==='countersign'||d.kind==='executive'||d.kind==='accept_owner'&&g.result['bandCode']==='LOW'));
    return {version:g.risk.version,administratorOverride:isSystemAdministrator(g.actor.roles),assessmentId:g.assessment?.id??null,round:g.assessment?.round??null,bandCode:g.result['bandCode']??null,
      score:g.result['score']??null,adopted:g.parentCurrent&&!g.assessment?.decisions.some(d=>d.decision==='return')&&this.decision(g,'adoption')?.decision==='approve',riskAccepted:accepted,operationalStatusCode:g.useCase.operationalStatusCode,
      referencesCurrent,prerequisitesReady:g.prerequisites.ready,tasks:g.current.map(task=>{
        const rule=stageRules[task.templateStage!.code],canReturn=this.allowed(g,task);
        return {id:task.id,kind:rule.kind,roleCode:rule.role,canReturn,outcomes:canReturn&&referencesCurrent&&g.prerequisites.ready?(rule.outcome==='restrict'?['restrict','stop']:[rule.outcome]):[]};
      }),history:g.rounds.map(r=>({id:r.id,round:r.round,decisions:r.decisions}))};
  },options);}

  async decide(userId:string,id:string,taskId:string,dto:DecideResidualRiskDto,clientIp?:string) {
    if(!['approve','return','accept','restrict','stop'].includes(dto.decision)||typeof dto.justification!=='string'||!dto.justification.trim()||dto.justification.length>5000)throw new BadRequestException('A supported residual decision and written justification are required');
    if(!Array.isArray(dto.evidenceIds)||!dto.evidenceIds.length||dto.evidenceIds.length>20||dto.evidenceIds.some(v=>typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v)))throw new BadRequestException('Use 1–20 existing DGOP evidence identifiers');
    const evidenceIds=[...new Set(dto.evidenceIds)],conditions=dto.conditions??[];
    if(!Array.isArray(conditions)||conditions.length>20||conditions.some(v=>typeof v!=='string'||!v.trim()||v.length>5000))throw new BadRequestException('Conditions must be nonempty text, at most twenty');
    return this.prisma.$transaction(async tx=>{
      const g=await this.gate(tx,userId,id),task=g.current.find(t=>t.id===taskId);
      if(!g.active||!g.assessment||!task||g.risk.version!==dto.expectedVersion)throw new ConflictException('Residual decision gate/version changed; reload');
      const rule=stageRules[task.templateStage!.code],actor=await this.authorization.authorize(userId,rule.permission,tx);
      await this.authorization.enforceDuty(actor,rule.action,{...g.facts,justification:dto.justification,evidenceIds},id);
      if(!this.allowed(g,task))throw new ForbiddenException('Residual task requires its actual band authority and independent prerequisites');
      if(dto.decision!=='return') {
        if(!(rule.outcome==='restrict'?['restrict','stop']:[rule.outcome]).includes(dto.decision))throw new BadRequestException('This band/stage does not allow that outcome; Critical cannot be accepted');
        if(!g.prerequisites.ready||!await this.references(tx,g.input,true))throw new ConflictException('Treatment or scoring references changed; return for fresh assessment');
        let computed:ReturnType<typeof computeInherentRisk>;
        try{computed=computeInherentRisk(jsonRecord(g.input['likelihood'])['value'] as number,g.input['dimensions'] as Parameters<typeof computeInherentRisk>[1],g.input['configuration'] as RiskScoringConfiguration);}catch{throw new ConflictException('Immutable residual scoring inputs are inconsistent');}
        if(['score','bandCode','likelihood','impactFinal','impactTopDimension','severityCode'].some(key=>g.result[key]!==computed[key as keyof typeof computed]))throw new ConflictException('Immutable residual scoring result is inconsistent');
      }
      if(await tx.ndiEvidence.count({where:{id:{in:evidenceIds},deletedAt:null}})!==evidenceIds.length)throw new BadRequestException('Every decision evidence identifier must exist');
      const decision=await tx.aiRiskAssessmentDecision.create({data:{assessmentId:g.assessment.id,taskId,kind:rule.kind,decision:dto.decision,
        actorId:userId,actorRoleCode:rule.role,justification:dto.justification.trim(),evidenceIds,conditions:conditions.map(v=>v.trim()),clientIp}});
      const now=new Date();
      await tx.workflowTask.update({where:{id:taskId},data:{status:TaskStatus.completed,completedAt:now,assigneeUserId:userId,formSubmittedAt:now,formSubmittedBy:userId,
        decision:dto.decision==='return'?TaskDecision.rejected:TaskDecision.approved,decisionComment:dto.justification.trim(),formDataJson:{...jsonRecord(task.formDataJson),decisionId:decision.id,reviewDecision:dto.decision,conditions} as Prisma.InputJsonObject}});
      let nextTaskId:string|null=null,riskAccepted=false;
      const openTask=async(stage:string,owner=false)=>{
        if(owner) {
          if(!g.ownerActive||!g.facts.useCaseOwnerId)throw new ConflictException('The active actual Use-Case Owner is required');
          const nominee=await this.authorization.authorize(g.facts.useCaseOwnerId,stage===RESIDUAL_STAGES.low?'airs.risk.accept.low':'airs.risk.accept.medium',tx);
          if(!nominee.roles.includes('AI_USECASE_OWNER')||aiDutyViolation(nominee.id,nominee.roles,stage===RESIDUAL_STAGES.low?'accept_low':'accept_medium',g.facts,false))throw new ConflictException('Use-Case Owner is conflicted/ineligible for the computed band');
          const scope=await this.risks.visibility(nominee.id,tx);if(!await tx.aiRisk.findFirst({where:{AND:[scope.where,{id}]},select:{id:true}}))throw new ConflictException('Use-Case Owner must have risk scope');
        }
        const next=await this.routing.createStageTask(tx,g.risk.workflowCase!.id,stage,now,{templateCode:AIRS_TEMPLATE_CODE,assigneeUserId:owner?g.facts.useCaseOwnerId:undefined,
          formDataJson:{assessmentId:g.assessment!.id,responseId:g.input['responseId'],inherentAssessmentId:g.input['inherentAssessmentId'],previousDecisionId:decision.id,residualBand:g.result['bandCode'],authorityLevel:residualAuthority(g.result['bandCode'] as string).level,riskAccepted:false} as Prisma.InputJsonObject});
        nextTaskId=next.id;
      };
      if(dto.decision==='return') {
        await tx.workflowTask.updateMany({where:{id:{in:g.current.map(t=>t.id)},status:TaskStatus.pending},data:{status:TaskStatus.cancelled,completedAt:now}});
        if(!g.risk.owner?.userId||!g.prerequisites.ownerActive)throw new ConflictException('An active assigned Risk Owner is required for return');
        const next=await this.routing.createStageTask(tx,g.risk.workflowCase!.id,'airs-residual-assessment',now,{templateCode:AIRS_TEMPLATE_CODE,assigneeRoleCode:'AI_RISK_OWNER',assigneeUserId:g.risk.owner.userId,
          formDataJson:{responseId:g.input['responseId'],returnedAssessmentId:g.assessment.id,returnDecisionId:decision.id,returnJustification:dto.justification.trim()} as Prisma.InputJsonObject});
        nextTaskId=next.id;
      } else if(rule.kind==='adoption') {
        const route=residualAuthority(g.result['bandCode'] as string);await openTask(route.stage,['LOW','MEDIUM'].includes(g.result['bandCode'] as string));
      } else if(rule.kind==='ethics')await openTask(RESIDUAL_STAGES.executive);
      else if(rule.kind==='accept_owner'&&g.result['bandCode']==='MEDIUM')await openTask(RESIDUAL_STAGES.countersign);
      else {
        riskAccepted=dto.decision==='accept';
        if(rule.kind==='steering')await tx.aiUseCase.update({where:{id:g.risk.useCase.id},data:{operationalStatusCode:dto.decision==='stop'?'ARCHIVED':'SUSPENDED',operationalDecisionId:decision.id,version:{increment:1}}});
        await tx.workflowCase.update({where:{id:g.risk.workflowCase!.id},data:{status:CaseStatus.decision_made}});
        await openTask('airs-monitoring');
        await tx.workflowTask.update({where:{id:nextTaskId!},data:{formDataJson:{assessmentId:g.assessment.id,acceptanceDecisionId:decision.id,riskAccepted,residualBand:g.result['bandCode'],cadencePending:true,operationalStatusCode:rule.kind==='steering'?(dto.decision==='stop'?'ARCHIVED':'SUSPENDED'):null} as Prisma.InputJsonObject}});
      }
      if((await tx.aiRisk.updateMany({where:{id,version:dto.expectedVersion},data:{version:{increment:1}}})).count!==1)throw new ConflictException('AI risk changed; reload');
      const action=`airs.residual.${rule.kind}.${dto.decision}`;
      await tx.workflowEvent.create({data:{caseId:g.risk.workflowCase!.id,taskId,actor:userId,action,comment:dto.justification.trim()}});
      await logAiRequired(this.audit, {actor:userId,action,entityType:'ai_risk',entityId:id,metadata:{assessmentId:g.assessment.id,decisionId:decision.id,taskId,actorRoleCode:rule.role,
        bandCode:g.result['bandCode'],score:g.result['score'],decision:dto.decision,justification:dto.justification.trim(),evidenceIds,conditions,SoD:'passed',riskAccepted,nextTaskId,clientIp:clientIp??null}},tx);
      return {id,version:dto.expectedVersion+1,decisionId:decision.id,nextTaskId,riskAccepted};
    },options);
  }
}
