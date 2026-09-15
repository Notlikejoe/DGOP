import { logAiRequired } from './ai-notifications';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService, riskSelect } from './ai-risk-intake.service';
import { AiWorkflowRoutingService, AIRS_TEMPLATE_CODE } from './ai-workflow-routing.service';
import { requiredInherentRound } from './ai-reassessment-state';
import { jsonRecord } from './ai-risk-scoring';
import { CompleteAiRiskReviewDto } from './ai-risk-review.dto';
import { nextAvailableBusinessCode, formatBusinessSequence } from '../common/business-sequence';

export const AI_COUNCILS = [
  { level:'domain_council', role:'AI_GOVERNANCE_OFFICER' },
  { level:'data_stewardship_council', role:'AI_ETHICS_COMMITTEE' },
  { level:'data_governance_board', role:'AI_EXECUTIVE_TEAM' },
  { level:'executive_steering_committee', role:'STEERING_COMMITTEE' },
] as const;
export type StrategyAction='propose'|'approve'|'return'|'close'|'open-escalation'|'advance'|'return-for-response';
export interface StrategyInput extends CompleteAiRiskReviewDto { action:StrategyAction; avoidanceAction?:'scope_change'|'stop_use_case'; scopeChange?:string; }
const options={isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000,maxWait:15000};

@Injectable()
export class AiRiskStrategyService {
  constructor(private readonly prisma:PrismaService,private readonly authorization:AiAuthorizationService,
    private readonly risks:AiRiskIntakeService,private readonly routing:AiWorkflowRoutingService,private readonly audit:AuditService){}

  private async gate(tx:Prisma.TransactionClient,userId:string,id:string) {
    const access=await this.risks.visibility(userId,tx);
    const risk=await tx.aiRisk.findFirst({where:{AND:[access.where,{id}]},select:riskSelect});
    if(!risk)throw new NotFoundException('AI risk not found');
    const assessment=await tx.aiAssessmentRound.findFirst({where:{riskId:id,kind:'inherent',round:{gte:await requiredInherentRound(tx,id)}},orderBy:{round:'desc'},include:{decisions:true}});
    const adoption=assessment?.decisions.find(d=>d.kind==='adoption'&&d.decision==='approve');
    const response=assessment?await tx.aiRiskResponse.findFirst({where:{riskId:id,assessmentId:assessment.id},orderBy:{round:'desc'},include:{decisions:true}}):null;
    const approved=response?.decisions.find(d=>d.kind==='officer'&&d.decision==='approve');
    const events=response?await tx.aiRiskStrategyEvent.findMany({where:{responseId:response.id},orderBy:{round:'asc'}}):[];
    const tasks=risk.workflowCase?await tx.workflowTask.findMany({where:{caseId:risk.workflowCase.id,status:'pending',templateStage:{is:{code:{in:['airs-avoidance-review','airs-closure','airs-escalation-gate']},isActive:true,template:{is:{code:AIRS_TEMPLATE_CODE,isActive:true,deletedAt:null}}}}},include:{templateStage:true}}):[];
    const task=tasks.length===1&&jsonRecord(tasks[0].formDataJson)['responseId']===response?.id?tasks[0]:null;
    const current=response?await tx.governedReferenceVersion.findFirst({where:{id:response.referenceVersionId,listCode:'R_STRATEGY',state:'published',effectiveFrom:{lte:new Date()},OR:[{effectiveTo:null},{effectiveTo:{gt:new Date()}}]},select:{id:true}}):null;
    const ownerActive=!!risk.ownerPersonId&&!!await tx.person.findFirst({where:{id:risk.ownerPersonId,userId:risk.owner?.userId,isActive:true,deletedAt:null},select:{id:true}});
    const active=!!task&&!!adoption&&!!approved&&!!response&&!response.decisions.some(d=>d.decision==='return')&&risk.workflowCase?.status==='under_review'&&ownerActive;
    const last=events.at(-1)??null;
    const independent=!access.actor.roles.includes('auditor')&&![risk.owner?.userId,risk.useCase.owner?.userId,response?.submittedBy].includes(userId);
    const assigned=!!task&&(!task.assigneeUserId||task.assigneeUserId===userId)&&!!task.assigneeRoleCode&&access.actor.roles.includes(task.assigneeRoleCode);
    const authority=active&&independent&&assigned&&!!access.permissionRoles['airs.strategy.decide']?.includes(task!.assigneeRoleCode!);
    const owner=active&&ownerActive&&risk.owner?.userId===userId&&access.actor.roles.includes('AI_RISK_OWNER')&&access.permissions.has('airs.risk.assess')&&!access.actor.roles.includes('auditor');
    const escalation=last?.escalationId?await tx.governanceEscalation.findUnique({where:{id:last.escalationId}}):null;
    return {...access,risk,assessment,adoption,response,events,last,task,current,escalation,
      canPropose:!!owner&&response?.strategyCode==='AVOID'&&task?.templateStage?.code==='airs-avoidance-review'&&(!last||last.kind==='avoidance_review'&&last.outcome==='return'),
      canReview:!!authority&&!!current&&response?.strategyCode==='AVOID'&&task?.templateStage?.code==='airs-avoidance-review'&&last?.kind==='avoidance_proposed',
      canReturn:!!authority&&response?.strategyCode==='AVOID'&&task?.templateStage?.code==='airs-avoidance-review'&&last?.kind==='avoidance_proposed',
      canClose:!!authority&&!!current&&response?.strategyCode==='AVOID'&&task?.templateStage?.code==='airs-closure'&&last?.kind==='avoidance_review'&&last.outcome==='approve'&&(task.assigneeRoleCode!=='STEERING_COMMITTEE'||last.actorId!==userId),
      canOpenEscalation:!!authority&&!!current&&response?.strategyCode==='ESCALATE'&&!last,
      canResolveEscalation:!!authority&&response?.strategyCode==='ESCALATE'&&!!escalation&&escalation.status==='open'&&escalation.workflowTaskId===task?.id&&escalation.ownerRoleCode===task?.assigneeRoleCode&&AI_COUNCILS.some(c=>c.level===escalation.level&&c.role===task?.assigneeRoleCode)&&jsonRecord(task?.formDataJson)['strategyEventId']===last?.id,
    };
  }
  async context(userId:string,id:string){return this.prisma.$transaction(async tx=>{
    const g=await this.gate(tx,userId,id);
    return {version:g.risk.version,strategyCode:g.response?.strategyCode??null,referencesCurrent:!!g.current,events:g.events,
      task:g.task?{id:g.task.id,role:g.task.assigneeRoleCode,stage:g.task.templateStage?.code}:null,escalation:g.escalation,
      canPropose:g.canPropose,canReview:g.canReview,canReturn:g.canReturn,canClose:g.canClose,canOpenEscalation:g.canOpenEscalation,canResolveEscalation:g.canResolveEscalation,
      canAdvance:g.canResolveEscalation&&!!g.current&&g.escalation?.level!==AI_COUNCILS[3].level};
  },options);}

  async act(userId:string,id:string,dto:StrategyInput,clientIp?:string) {
    if(!['propose','approve','return','close','open-escalation','advance','return-for-response'].includes(dto.action)||typeof dto.justification!=='string'||!dto.justification.trim()||dto.justification.length>5000||!Array.isArray(dto.evidenceIds)||!dto.evidenceIds.length||dto.evidenceIds.length>20||dto.evidenceIds.some(v=>typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v)))throw new BadRequestException('A recognized operational action, written justification and existing evidence are required');
    return this.prisma.$transaction(async tx=>{
      const g=await this.gate(tx,userId,id);
      await this.authorization.authorize(userId,dto.action==='propose'?'airs.risk.assess':'airs.strategy.decide',tx);
      if(dto.action!=='propose')await this.authorization.enforceDuty(g.actor,'adopt_assessment',{riskOwnerId:g.risk.owner?.userId??undefined,useCaseOwnerId:g.risk.useCase.owner?.userId??undefined,assessmentAssessorIds:[g.response?.submittedBy,...(dto.action==='close'&&g.task?.assigneeRoleCode==='STEERING_COMMITTEE'?[g.last?.actorId]:[])].filter((v):v is string=>!!v)},id);
      const allowed={propose:g.canPropose,approve:g.canReview,return:g.canReturn,close:g.canClose,'open-escalation':g.canOpenEscalation,advance:g.canResolveEscalation&&!!g.current&&g.escalation?.level!==AI_COUNCILS[3].level,'return-for-response':g.canResolveEscalation};
      if(!allowed[dto.action])throw new ForbiddenException('Only the live assigned independent operational authority may perform this action');
      if(g.risk.version!==dto.expectedVersion)throw new ConflictException('AI risk changed; reload');
      const evidenceIds=[...new Set(dto.evidenceIds)],now=new Date();
      if(await tx.ndiEvidence.count({where:{id:{in:evidenceIds},deletedAt:null}})!==evidenceIds.length)throw new BadRequestException('Every evidence identifier must exist');
      if(!['return','return-for-response'].includes(dto.action)){
        const refs=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM governed_reference_versions WHERE id=${g.response!.referenceVersionId} AND state='published' AND "effectiveFrom"<=CURRENT_TIMESTAMP AND ("effectiveTo" IS NULL OR "effectiveTo">CURRENT_TIMESTAMP) FOR SHARE`;
        if(refs.length!==1)throw new ConflictException('Strategy publication changed; return for a new response');
      }
      let kind='',outcome:string=dto.action,payload:Prisma.InputJsonObject={},escalationId=g.escalation?.id??null;
      if(dto.action==='propose'){
        if(!['scope_change','stop_use_case'].includes(dto.avoidanceAction??'')||typeof dto.scopeChange!=='string'||!dto.scopeChange.trim()||dto.scopeChange.length>5000)throw new BadRequestException('Specify the verified scope change or complete stop, with written implementation details');
        kind='avoidance_proposed';outcome=dto.avoidanceAction!;payload={scopeChange:dto.scopeChange.trim()};
      } else if(['approve','return'].includes(dto.action))kind='avoidance_review';
      else if(dto.action==='close'){
        kind='avoidance_closed';const proposal=g.events.find(e=>e.id===g.last!.basisEventId)!;outcome=proposal.outcome;payload=jsonRecord(proposal.payload) as Prisma.InputJsonObject;
      } else if(dto.action==='open-escalation'){
        kind='escalation_open';outcome=AI_COUNCILS[0].level;
        const day=now.toISOString().slice(0,10).replace(/-/g,'');
        const code=await nextAvailableBusinessCode(tx,`governance_operations:governanceEscalation:${day}`,v=>`ESC-${day}-${formatBusinessSequence(v,3)}`,async code=>!await tx.governanceEscalation.findUnique({where:{code},select:{id:true}}));
        escalationId=(await tx.governanceEscalation.create({data:{code,dedupeKey:`ai-strategy:${g.response!.id}`,level:AI_COUNCILS[0].level,sourceType:'ai_risk_strategy',sourceId:g.response!.id,reason:dto.justification.trim(),ownerRoleCode:AI_COUNCILS[0].role,workflowCaseId:g.risk.workflowCase!.id,workflowTaskId:g.task!.id,createdBy:userId}})).id;
      } else {kind='escalation_outcome';payload={councilLevel:g.escalation!.level};}
      const event=await tx.aiRiskStrategyEvent.create({data:{responseId:g.response!.id,round:(g.last?.round??0)+1,kind,outcome,taskId:g.task!.id,basisEventId:g.last?.id??null,escalationId,payload,actorId:userId,actorRoleCode:dto.action==='propose'?'AI_RISK_OWNER':g.task!.assigneeRoleCode!,justification:dto.justification.trim(),evidenceIds}});
      if(dto.action!=='propose')await tx.workflowTask.update({where:{id:g.task!.id},data:{status:'completed',completedAt:now,assigneeUserId:userId,formSubmittedBy:userId,formSubmittedAt:now,decisionComment:dto.justification.trim()}});
      const next=async(stage:string,role:string,extra:Prisma.InputJsonObject={})=>this.routing.createStageTask(tx,g.risk.workflowCase!.id,stage,now,{templateCode:AIRS_TEMPLATE_CODE,assigneeRoleCode:role,formDataJson:{responseId:g.response!.id,strategyEventId:event.id,...extra}});
      if(dto.action==='return')await next('airs-avoidance-review','AI_GOVERNANCE_OFFICER');
      if(dto.action==='approve')await next('airs-closure',g.last!.outcome==='stop_use_case'?'STEERING_COMMITTEE':'AI_GOVERNANCE_OFFICER');
      if(dto.action==='close'){
        await tx.workflowCase.update({where:{id:g.risk.workflowCase!.id},data:{status:'closed'}});
        if(outcome==='stop_use_case'){
          const uc=await tx.aiUseCase.findUniqueOrThrow({where:{id:g.risk.useCase.id}});
          await tx.aiUseCase.update({where:{id:uc.id},data:{operationalStatusCode:'ARCHIVED',operationalDecisionId:null,operationalStrategyEventId:event.id,version:{increment:1}}});
        }
      }
      if(dto.action==='open-escalation'||dto.action==='advance'){
        const index=dto.action==='open-escalation'?0:AI_COUNCILS.findIndex(c=>c.level===g.escalation!.level)+1,council=AI_COUNCILS[index];
        const task=await next('airs-escalation-gate',council.role,{escalationId:escalationId!});
        await tx.governanceEscalation.update({where:{id:escalationId!},data:{level:council.level,ownerRoleCode:council.role,workflowTaskId:task.id,updatedBy:userId}});
      }
      if(dto.action==='return-for-response'){
        await tx.governanceEscalation.update({where:{id:escalationId!},data:{status:'resolved',resolvedAt:now,updatedBy:userId}});
        await this.routing.openResponseGate(tx,g.risk.workflowCase!.id,g.assessment!.id,g.adoption!.id,g.risk.riskRef!,g.risk.owner!.userId!,now,g.response!.id);
      }
      if((await tx.aiRisk.updateMany({where:{id,version:dto.expectedVersion},data:{version:{increment:1}}})).count!==1)throw new ConflictException('AI risk changed; reload');
      const notificationIds:string[]=[];
      await tx.governanceNotification.updateMany({where:{sourceType:'ai_risk_strategy',sourceId:g.response!.id,status:{not:'archived'}},data:{status:'archived'}});
      await tx.governanceNotificationDeliveryAttempt.updateMany({where:{notification:{sourceType:'ai_risk_strategy',sourceId:g.response!.id,status:'archived'},status:{in:['planned','failed']}},data:{status:'skipped',nextRetryAt:null,errorMessage:'Native AI work completed or superseded'}});
      await tx.workflowEvent.create({data:{caseId:g.risk.workflowCase!.id,taskId:g.task!.id,actor:userId,action:`airs.strategy.${kind}.${outcome}`,comment:dto.justification.trim()}});
      await logAiRequired(this.audit, {actor:userId,action:`airs.strategy.${kind}`,entityType:'ai_risk',entityId:id,metadata:{eventId:event.id,responseId:g.response!.id,outcome,evidenceIds,notificationIds,justification:dto.justification.trim(),clientIp:clientIp??null}},tx);
      return {id,version:dto.expectedVersion+1,eventId:event.id};
    },options);
  }
}
