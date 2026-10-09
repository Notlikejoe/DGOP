import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, GovernanceNotificationSeverity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { governanceDigest, governanceTransaction } from './ai-governance-ledger';
import { aiReviewThresholds } from './ai-risk-review.service';
import { jsonRecord } from './ai-risk-scoring';
import { AI_NOTIFICATION_SOURCES, emitAiNotice, aiNoticeAccess, processAiTriageSignals, processAiNotificationClosures, aiVariables } from './ai-notifications';

export const AI_ALERT_SOURCES=AI_NOTIFICATION_SOURCES;
@Injectable()
export class AiOperationalAlertsService {
 constructor(private readonly db:PrismaService,private readonly risks:AiRiskIntakeService,private readonly audit:AuditService){}
 async visibility(userId:string):Promise<Prisma.GovernanceNotificationWhereInput>{
  const ordinary={OR:[{sourceType:null},{sourceType:{notIn:AI_ALERT_SOURCES}}]};
  const alternatives:Prisma.GovernanceNotificationWhereInput[]=[ordinary];
  try{const access=await this.risks.visibility(userId);if(access.actor.administratorOverride)return {};alternatives.push({sourceType:{in:AI_ALERT_SOURCES.filter(s=>s!=='ai_use_case')},workflowCase:{is:{aiRisk:{is:access.where}}},AND:[{OR:[{assigneeUserId:null},{assigneeUserId:userId}]}]});}
  catch(e){if(!(e instanceof ForbiddenException))throw e;}
  // AIUC notices also support requester-only users without any AIRS purpose grant.
  const assigned=await this.db.governanceNotification.findMany({where:{sourceType:'ai_use_case',assigneeUserId:userId,workflowCaseId:{not:null}},select:{workflowCaseId:true},distinct:['workflowCaseId']});
  const cases:string[]=[];
  for(const n of assigned)if(n.workflowCaseId&&await aiNoticeAccess(this.db,userId,n.workflowCaseId))cases.push(n.workflowCaseId);
  alternatives.push({sourceType:'ai_use_case',assigneeUserId:userId,workflowCaseId:{in:cases}});
  return {OR:alternatives};
 }
 private async emit(tx:Prisma.TransactionClient,input:{code:string;sourceType:string;sourceId:string;caseId:string;taskId?:string;dedupeKey:string;userId:string;role:string;variables:Record<string,string>;severity:GovernanceNotificationSeverity}){
  return await emitAiNotice(tx,this.audit,{...input,variables:await aiVariables(tx,input.caseId,input.variables)})?1:0;
 }
 private async recipients(tx:Prisma.TransactionClient,riskId:string,roles:string[],exactId?:string){
  const users=await tx.user.findMany({where:{isActive:true,...(exactId?{id:exactId}:{}),userRoles:{some:{role:{is:{code:{in:roles},isActive:true,deletedAt:null}}},none:{role:{is:{code:'auditor',isActive:true,deletedAt:null}}}}},select:{id:true}});
  const result:Array<{id:string;role:string}>=[];
  for(const u of users){try{const access=await this.risks.visibility(u.id,tx);
   const role=roles.find(r=>access.actor.roles.includes(r)&&(r==='AI_GOVERNANCE_OFFICER'?access.permissionRoles['case.view.airs.org']:access.permissionRoles['airs.risk.assess'])?.includes(r));
   if(role&&await tx.aiRisk.findFirst({where:{AND:[access.where,{id:riskId}]},select:{id:true}}))result.push({id:u.id,role});
  }catch(e){if(!(e instanceof ForbiddenException))throw e;}}
  return result;
 }
 private async archiveSuperseded(tx:Prisma.TransactionClient,riskId:string,caseId:string|null,validTreatment:Set<string>,harmonyPrefix:string|null){
  if(!caseId)return 0;let cursor:string|undefined,total=0;
  do{const rows=await tx.governanceNotification.findMany({where:{workflowCaseId:caseId,sourceType:{in:['ai_risk_treatment','ai_risk_harmony']},status:{not:'archived'}},orderBy:{id:'asc'},take:50,...(cursor?{cursor:{id:cursor},skip:1}:{})});
   if(!rows.length)break;
   const stale=rows.filter(n=>n.sourceType==='ai_risk_treatment'?![...validTreatment].some(prefix=>n.dedupeKey?.startsWith(prefix)):!harmonyPrefix||!n.dedupeKey?.startsWith(harmonyPrefix)).map(n=>n.id);
   if(stale.length){const update=await tx.governanceNotification.updateMany({where:{id:{in:stale},status:{not:'archived'}},data:{status:'archived'}});
    await tx.governanceNotificationDeliveryAttempt.updateMany({where:{notificationId:{in:stale},status:{in:['planned','failed']}},data:{status:'skipped',nextRetryAt:null,errorMessage:'AI work completed, superseded or no longer eligible'}});
    await this.audit.logRequired({actor:'system:ai-operational-alerts',action:'airs.operational.alerts.archived',entityType:'ai_risk',entityId:riskId,metadata:{notificationIds:stale,count:update.count,reason:'completed_superseded_or_ineligible',externalDelivery:false}},tx);total+=update.count;
   }cursor=rows[rows.length-1].id;
  }while(cursor);return total;
 }
 async process(now=new Date(),riskId?:string){
  if(!Number.isFinite(now.getTime()))throw new Error('Valid operational alert instant required');
  const triage=riskId?{created:0}:await processAiTriageSignals(this.db,this.audit,now);
  const closures=await processAiNotificationClosures(this.db,this.audit,riskId);
  const holidays=await this.db.ksaHoliday.findMany(),dates=holidays.filter(h=>!h.isRecurring).map(h=>h.date.toISOString().slice(0,10)),recurring=holidays.filter(h=>h.isRecurring).map(h=>h.date.toISOString().slice(5,10));
  let cursor:string|undefined,created=triage.created,archived=closures.archived;
  do{
   const rows=await this.db.aiRisk.findMany({where:{...(riskId?{id:riskId}:{}),OR:[{deletedAt:null,isSampleData:false,riskRef:{not:null},workflowCase:{is:{status:{in:['under_review','implemented']}}},useCase:{is:{deletedAt:null,isSampleData:false,useCaseRef:{not:null},OR:[{operationalStatusCode:null},{operationalStatusCode:{notIn:['ARCHIVED','SUSPENDED']}}],asset:{is:{isActive:true,deletedAt:null}}}}},{workflowCase:{is:{governanceNotifications:{some:{sourceType:{in:['ai_risk_treatment','ai_risk_harmony']},status:{not:'archived'}}}}}}]},orderBy:{id:'asc'},take:50,...(cursor?{cursor:{id:cursor},skip:1}:{})});
   if(!rows.length)break;
   for(const row of rows){const outcome=await governanceTransaction(this.db,async tx=>{
    const risk=await tx.aiRisk.findUniqueOrThrow({where:{id:row.id},include:{workflowCase:true,owner:true,useCase:{include:{asset:true,assessments:{where:{kind:'classification',riskId:null},orderBy:{round:'desc'},take:1}}}}});
    // Lock business lineage against concurrent execution/reassessment while emitting observations.
    await tx.$executeRaw`SELECT id FROM ai_risks WHERE id=${risk.id} FOR UPDATE`;
    const current=await tx.$queryRaw<Array<{id:string}>>`SELECT ai_severity_current_assessment(${risk.id}) AS id`;
    const assessment=current[0]?.id?await tx.aiAssessmentRound.findUnique({where:{id:current[0].id}}):null;
    const inherentId=assessment?.kind==='residual'?jsonRecord(assessment.inputs)['inherentAssessmentId']:assessment?.id;
    const response=await tx.aiRiskResponse.findFirst({where:{riskId:risk.id},orderBy:{round:'desc'},include:{decisions:true,plans:{orderBy:{round:'desc'},take:1,include:{decision:true}}}});
    const plan=response?.plans[0],pins=jsonRecord(plan?.snapshot),actionIds=pins['actionIds'];let count=0;
    const active=!risk.deletedAt&&!risk.isSampleData&&!!risk.riskRef&&!!risk.workflowCase&&['under_review','implemented'].includes(risk.workflowCase.status)&&!risk.useCase.deletedAt&&!risk.useCase.isSampleData&&!!risk.useCase.useCaseRef&&!['ARCHIVED','SUSPENDED'].includes(risk.useCase.operationalStatusCode??'')&&!!risk.useCase.asset?.isActive&&!risk.useCase.asset.deletedAt;
    const validTreatment=new Set<string>();let harmonyPrefix:string|null=null;
    if(active&&assessment&&response&&response.assessmentId===inherentId&&response.decisions.some(d=>d.kind==='officer'&&d.decision==='approve')&&plan?.decision?.decision==='approve'&&Array.isArray(actionIds)&&pins['isSampleData']!==true){
     const actions=await tx.aiTreatmentAction.findMany({where:{id:{in:actionIds.filter((id):id is string=>typeof id==='string')},responseId:response.id,deletedAt:null},include:{workflowTask:{include:{templateStage:{include:{template:true}}}},assignee:true,progress:{orderBy:{round:'desc'},take:1}}});
     for(const action of actions){const task=action.workflowTask,data=jsonRecord(action.planData);
      if(!task||!task.dueDate||!['pending','in_progress'].includes(task.status)||action.progress[0]?.completionPct===100||data['isSampleData']===true||!action.assignee?.userId||!action.assignee.isActive||action.assignee.deletedAt||task.assigneeUserId!==action.assignee.userId||
       !task.templateStage?.isActive||!task.templateStage.template.isActive||task.templateStage.template.deletedAt||task.templateStage.template.code!=='AIRS_LIFECYCLE_V1')continue;
      validTreatment.add(`ai-treatment:${plan.id}:${action.id}:`);
      const executors=await this.recipients(tx,risk.id,[String(data['executorRole'])],action.assignee.userId);if(!executors.length)continue;
      for(const threshold of aiReviewThresholds(task.createdAt,task.dueDate,now,dates,recurring)){
       const recipients=threshold===100?[...executors,...await this.recipients(tx,risk.id,['AI_RISK_OWNER'],risk.owner?.userId??''),...await this.recipients(tx,risk.id,['AI_GOVERNANCE_OFFICER'])]:executors;
       for(const recipient of new Map(recipients.map(r=>[r.id,r])).values())count+=await this.emit(tx,{code:'AIRS-NTF-04',sourceType:'ai_risk_treatment',sourceId:action.id,caseId:task.caseId,taskId:task.id,
        dedupeKey:`ai-treatment:${plan.id}:${action.id}:${threshold}:${recipient.id}`,userId:recipient.id,role:recipient.role,severity:threshold===100?'critical':'warning',
        variables:{risk_id:risk.id,risk_ref:risk.riskRef!,usecase_id:risk.useCase.useCaseRef!,case_number:risk.workflowCase!.code,action_ref:action.actionRef,sla_pct:String(threshold),due_date:new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',calendar:'islamic-umalqura',dateStyle:'medium'}).format(task.dueDate)+' / '+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',calendar:'gregory',dateStyle:'medium'}).format(task.dueDate)}});
      }
     }
    }
    // A classification discrepancy opens an independent review notice; neither model is edited.
    const classification=risk.useCase.assessments[0],tier=jsonRecord(classification?.result)['approvedTierCode'];
    if(active&&classification&&['HIGH','UNACCEPTABLE','LIMITED','MINIMAL','LOW'].includes(String(tier))){
     const linked=await tx.aiRisk.findMany({where:{useCaseId:risk.useCaseId,deletedAt:null,isSampleData:false,riskRef:{not:null}},select:{id:true}});
     const all=await tx.$queryRaw<Array<{riskId:string;id:string;result:Prisma.JsonValue}>>`SELECT r.id AS "riskId",a.id,a.result FROM ai_risks r LEFT JOIN ai_assessment_rounds a ON a.id=ai_severity_current_assessment(r.id) WHERE r.id IN (${Prisma.join(linked.map(r=>r.id))})`;
     if(all.length&&all.every(a=>!!a.id)){
      const high=all.some(a=>['HIGH','CRITICAL'].includes(String(jsonRecord(a.result)['bandCode']))),tierHigh=['HIGH','UNACCEPTABLE'].includes(String(tier));
      if(high!==tierHigh){const digest=governanceDigest({classification:classification.id,assessments:all.map(a=>a.id).sort()});
       harmonyPrefix=`ai-harmony:${risk.useCaseId}:${digest}:`;
       for(const recipient of await this.recipients(tx,risk.id,['AI_GOVERNANCE_OFFICER'])){
        const access=await this.risks.visibility(recipient.id,tx);if(await tx.aiRisk.count({where:{AND:[access.where,{id:{in:linked.map(r=>r.id)}}]}})!==linked.length)continue;
        count+=await this.emit(tx,{code:'AIX-NTF-03',sourceType:'ai_risk_harmony',sourceId:risk.useCaseId,caseId:risk.workflowCaseId!,dedupeKey:`ai-harmony:${risk.useCaseId}:${digest}:${recipient.id}`,
         userId:recipient.id,role:recipient.role,severity:'warning',variables:{risk_id:risk.id,risk_ref:risk.riskRef!,usecase_id:risk.useCase.useCaseRef!,tier:String(tier),residual_level:high?'HIGH/CRITICAL':'LOW/MEDIUM'}});
       }
      }
     }
    }
    const resolved=await this.archiveSuperseded(tx,risk.id,risk.workflowCaseId,validTreatment,harmonyPrefix);
    return {created:count,archived:resolved};
   });created+=outcome.created;archived+=outcome.archived;}
   cursor=rows[rows.length-1].id;
  }while(cursor);
  return {created,archived,externalDelivery:false};
 }
}
