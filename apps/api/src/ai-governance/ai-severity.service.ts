import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService, riskSelect } from './ai-risk-intake.service';
import { AiWorkflowProjectionService } from './ai-workflow-projection.service';
import { AiWorkflowRoutingService, AIRS_TEMPLATE_CODE } from './ai-workflow-routing.service';
import { governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
import { jsonRecord } from './ai-risk-scoring';
import { CompleteAiRiskReviewDto } from './ai-risk-review.dto';
import { isSystemAdministrator } from '../auth/system-admin';

const authorities=['AI_GOVERNANCE_OFFICER','AI_ETHICS_COMMITTEE','AI_EXECUTIVE_TEAM','STEERING_COMMITTEE'];
export interface SeverityInput extends CompleteAiRiskReviewDto { action:'propose'|'approve'|'return'|'reverse'; severityCode?:string }
@Injectable()
export class AiSeverityService {
 constructor(private readonly prisma:PrismaService,private readonly risks:AiRiskIntakeService,private readonly projection:AiWorkflowProjectionService,
  private readonly authorization:AiAuthorizationService,private readonly routing:AiWorkflowRoutingService,private readonly audit:AuditService){}
 private async gate(tx:Prisma.TransactionClient,userId:string,id:string){
  const access=await this.risks.visibility(userId,tx),risk=await tx.aiRisk.findFirst({where:{AND:[access.where,{id,isSampleData:false,useCase:{is:{isSampleData:false}}}]},select:riskSelect});
  if(!risk?.workflowCase||!risk.riskRef)throw new NotFoundException('Registered AI risk not found');
  const calculation=jsonRecord((await this.projection.forCasesIn(tx,userId,[risk.workflowCase.id])).get(risk.workflowCase.id));
  const events=await tx.aiRiskSeverityEvent.findMany({where:{riskId:id},orderBy:{round:'desc'},take:20});
  const candidate=await tx.aiRiskSeverityEvent.findFirst({where:{riskId:id,kind:'proposal',outcomes:{none:{kind:{in:['approved','returned']}}}},orderBy:{round:'desc'}});
  const task=candidate?.taskId?await tx.workflowTask.findUnique({where:{id:candidate.taskId},include:{templateStage:{include:{template:true}}}}):null;
  const pending=task?.status==='pending'?candidate:null;
  const administratorOverride=isSystemAdministrator(access.actor.roles);
  const independent=administratorOverride||!access.actor.roles.includes('auditor')&&![risk.owner?.userId,risk.useCase.owner?.userId].includes(userId);
  const roles=authorities.filter(role=>access.permissionRoles['airs.severity.override']?.includes(role)),role=roles.find(role=>authorities.indexOf(role)<3);
  const settled=typeof calculation['assessmentId']==='string'?await tx.aiRiskSeverityEvent.findFirst({where:{riskId:id,assessmentId:calculation['assessmentId'],kind:{in:['approved','reversed']}},orderBy:{round:'desc'}}):null;
  const assigned=independent&&!!pending&&(administratorOverride||pending.actorId!==userId)&&!!task&&task.status==='pending'&&task.assigneeRoleCode!==null&&roles.includes(task.assigneeRoleCode)&&
   (administratorOverride||!task.assigneeUserId||task.assigneeUserId===userId)&&task.caseId===risk.workflowCase.id&&task.templateStage?.code==='airs-severity-override'&&task.templateStage.isActive&&
   task.templateStage.template.code===AIRS_TEMPLATE_CODE&&task.templateStage.template.isActive&&!task.templateStage.template.deletedAt&&
   jsonRecord(task.formDataJson)['proposalId']===pending.id&&jsonRecord(task.formDataJson)['assessmentId']===pending.assessmentId;
  const reverseRole=settled?.kind==='approved'?roles.find(role=>authorities.indexOf(role)+1>settled.authorityLevel):undefined;
  return {...access,risk,calculation,events,pending,task,settled,role,reverseRole,administratorOverride,
   canPropose:independent&&!!role&&!pending&&typeof calculation['assessmentId']==='string'&&typeof calculation['severityCode']==='string',
   canApprove:assigned&&pending!.assessmentId===calculation['assessmentId'],canReturn:assigned,
   canReverse:independent&&!pending&&!!reverseRole&&(administratorOverride||settled?.actorId!==userId)};
 }
 async context(userId:string,id:string){return governanceTransaction(this.prisma,async tx=>{const g=await this.gate(tx,userId,id);return {
  version:g.risk.version,calculatedSeverityCode:g.calculation['severityCode']??null,effectiveSeverityCode:g.settled?.severityCode??g.calculation['severityCode']??null,
  assessmentId:g.calculation['assessmentId']??null,score:g.calculation['score']??null,bandCode:g.calculation['bandCode']??null,pending:g.pending?{id:g.pending.id,severityCode:g.pending.severityCode,role:g.task?.assigneeRoleCode}:null,
  events:g.events.map(({clientIp,actorId,...event})=>event),historyLimit:20,administratorOverride:g.administratorOverride,canPropose:g.canPropose,canApprove:g.canApprove,canReturn:g.canReturn,canReverse:g.canReverse,
  acceptanceChanged:false,calculationChanged:false};});}
 async act(userId:string,id:string,dto:SeverityInput,clientIp?:string){
  const justification=governanceText(dto.justification);if(!['propose','approve','return','reverse'].includes(dto.action)||!Number.isInteger(dto.expectedVersion)||dto.expectedVersion<1||
   (dto.action==='propose'?!['P1','P2','P3','P4'].includes(dto.severityCode??''):dto.severityCode!==undefined))throw new BadRequestException('Specify a recognized severity action and current risk version');
  return governanceTransaction(this.prisma,async tx=>{
   const g=await this.gate(tx,userId,id);await this.authorization.authorize(userId,'airs.severity.override',tx);
   await this.authorization.enforceDuty(g.actor,'adopt_assessment',{riskOwnerId:g.risk.owner?.userId??undefined,useCaseOwnerId:g.risk.useCase.owner?.userId??undefined},id);
   if(!({propose:g.canPropose,approve:g.canApprove,return:g.canReturn,reverse:g.canReverse})[dto.action])throw new ForbiddenException('Only the assigned independent higher severity authority may act');
   if(g.risk.version!==dto.expectedVersion)throw new ConflictException('AI risk changed; reload');
   const evidenceIds=await governanceEvidence(tx,dto.evidenceIds),eventId=randomUUID(),now=new Date();
   const kind=dto.action==='propose'?'proposal':dto.action==='approve'?'approved':dto.action==='return'?'returned':'reversed';let taskId:string|null=null,relatedEventId:string|null=null;
   let assessmentId=String(g.calculation['assessmentId']),severityCode=dto.severityCode??'',previousSeverityCode=g.settled?.severityCode??String(g.calculation['severityCode']),actorRoleCode=g.role!;
   if(dto.action==='propose'){
    if(severityCode===previousSeverityCode)throw new BadRequestException('Propose a different operational severity');
    taskId=(await this.routing.createStageTask(tx,g.risk.workflowCase!.id,'airs-severity-override',now,{templateCode:AIRS_TEMPLATE_CODE,assigneeRoleCode:authorities[authorities.indexOf(actorRoleCode)+1],
     formDataJson:{riskId:id,assessmentId,proposalId:eventId,proposedSeverityCode:severityCode}})).id;
   }else if(dto.action==='reverse'){
    relatedEventId=g.settled!.id;assessmentId=g.settled!.assessmentId;severityCode=g.settled!.previousSeverityCode;previousSeverityCode=g.settled!.severityCode;actorRoleCode=g.reverseRole!;
   }else{
    relatedEventId=g.pending!.id;assessmentId=g.pending!.assessmentId;severityCode=g.pending!.severityCode;previousSeverityCode=g.pending!.previousSeverityCode;taskId=g.task!.id;actorRoleCode=g.task!.assigneeRoleCode!;
   }
   const event=await tx.aiRiskSeverityEvent.create({data:{id:eventId,riskId:id,assessmentId,round:(g.events[0]?.round??0)+1,kind,severityCode,previousSeverityCode,relatedEventId,taskId,actorId:userId,actorRoleCode,
    authorityLevel:authorities.indexOf(actorRoleCode)+1,justification,evidenceIds,clientIp}});
   if(dto.action==='approve'||dto.action==='return')await tx.workflowTask.update({where:{id:taskId!},data:{status:'completed',assigneeUserId:userId,completedAt:now,decision:dto.action==='approve'?'approved':null,decisionComment:justification,formSubmittedBy:userId,formSubmittedAt:now}});
   if((await tx.aiRisk.updateMany({where:{id,version:dto.expectedVersion},data:{version:{increment:1}}})).count!==1)throw new ConflictException('AI risk changed; reload');
   await tx.workflowEvent.create({data:{caseId:g.risk.workflowCase!.id,taskId,actor:userId,action:'airs.severity.'+kind,comment:justification}});
   await this.audit.logRequired({actor:userId,action:'airs.severity.'+kind,entityType:'ai_risk',entityId:id,metadata:{eventId,assessmentId,oldValue:previousSeverityCode,newValue:severityCode,relatedEventId,actorRoleCode,authorityLevel:event.authorityLevel,justification,evidenceIds,clientIp:clientIp??null,scoreChanged:false,acceptanceChanged:false}},tx);
   return {id,version:dto.expectedVersion+1,eventId};
  });
 }
}
