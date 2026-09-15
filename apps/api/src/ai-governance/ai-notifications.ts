import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, GovernanceNotificationSeverity } from '@prisma/client';
import type { AuditEntry, AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../access/scope.service';
import { AiPermission, aiRoleMayHold, splitAiPermission } from './ai-permissions';
import { jsonRecord } from './ai-risk-scoring';
import { businessDaysBetween } from '../governance-operations/governance-operations.logic';
import { governanceTransaction } from './ai-governance-ledger';

// FD §10.1 subjects are fixed; final body wording remains governed DMO content.
export const AI_NOTIFICATION_CATALOG = [
  ['AIUC-NTF-01','ai_use_case','AI use-case request submitted','تم استلام طلب حالة استخدام ذكاء اصطناعي'],
  ['AIUC-NTF-02','ai_use_case','Information requested on your AI use case','طلب استكمال معلومات حالة الاستخدام'],
  ['AIUC-NTF-03','ai_use_case','Triage SLA warning / breach','تنبيه / تجاوز مهلة فحص الاكتمال'],
  ['AIUC-NTF-04','ai_use_case','Decision on AI use-case adoption','قرار تبنّي حالة استخدام الذكاء الاصطناعي'],
  ['AIUC-NTF-05','ai_use_case','Use case approved — asset registered','اعتماد حالة الاستخدام وتسجيل الأصل'],
  ['AIRS-NTF-01','ai_risk_event','Risk case opened for your AI use case','فتح حالة مخاطر لحالة الاستخدام'],
  ['AIRS-NTF-02','ai_risk_event','New AI risk registered','تسجيل خطر جديد للذكاء الاصطناعي'],
  ['AIRS-NTF-03','ai_risk_treatment','Treatment action assigned to you','إسناد إجراء معالجة إليك'],
  ['AIRS-NTF-04','ai_risk_treatment','Treatment action overdue','تأخر إجراء المعالجة عن المستهدف'],
  ['AIRS-NTF-05','ai_risk_review','Periodic risk review due','استحقاق المراجعة الدورية للخطر'],
  ['AIRS-NTF-06','ai_risk_review','Risk review due soon','مراجعة الخطر تستحق قريباً'],
  ['AIX-NTF-01','ai_risk_event','Residual risk decision routed for acceptance','إحالة قرار الخطر المتبقي للاعتماد'],
  ['AIX-NTF-02','ai_risk_escalation','Case escalated — level {{escalation_level}}','تصعيد الحالة — المستوى {{escalation_level}}'],
] as const;
export const AI_NOTIFICATION_SOURCES = ['ai_use_case','ai_risk_event','ai_risk_escalation','ai_risk_strategy','ai_risk_review','ai_risk_treatment','ai_risk_harmony'];
const DAY=86400000,KSA=10800000;
export async function ensureAiNotificationTemplates(db:PrismaService) {
  await db.governanceNotificationTemplate.createMany({data:AI_NOTIFICATION_CATALOG.map(([code,sourceType,en,ar])=>({
    code,sourceType,name:en,titleTemplate:en+'\n'+ar,
    messageTemplate:'Case {{case_number}} / use case {{usecase_id}}: '+en+'. Risk {{risk_ref}}; action {{action_ref}}; due {{due_date}}. Owner {{owner_name}}; tier {{tier}}; residual {{residual_level}}; SLA {{sla_pct}}%; escalation {{escalation_level}}.\nالحالة {{case_number}} / حالة الاستخدام {{usecase_id}}: '+ar+'. الخطر {{risk_ref}}؛ الإجراء {{action_ref}}؛ الاستحقاق {{due_date}}. المسؤول {{owner_name}}؛ المستوى {{tier}}؛ الخطر المتبقي {{residual_level}}؛ المهلة {{sla_pct}}%؛ التصعيد {{escalation_level}}.',
    defaultChannelsJson:['in_app','email'],digestCadence:'immediate',isActive:false,createdBy:'system:ai-notification-drafts',
  })),skipDuplicates:true});
  await db.governanceNotificationTemplate.createMany({data:[
    {code:'AIX-NTF-03',sourceType:'ai_risk_harmony',name:'Classification and risk reconciliation',titleTemplate:'Classification and risk reconciliation\nمراجعة الاتساق بين التصنيف والخطر',messageTemplate:'Use case {{usecase_id}}: tier {{tier}}, risk {{residual_level}}.\nحالة الاستخدام {{usecase_id}}: التصنيف {{tier}}، الخطر {{residual_level}}.',defaultChannelsJson:['in_app','email'],digestCadence:'immediate',isActive:false,createdBy:'system:ai-notification-drafts'},
    {code:'AIX-NTF-04',sourceType:'ai_risk_strategy',name:'Risk strategy outcome',titleTemplate:'AI risk strategy updated\nتحديث استراتيجية خطر الذكاء الاصطناعي',messageTemplate:'Risk {{risk_ref}}: {{action}} / {{outcome}}. Owner {{owner_name}}.\nالخطر {{risk_ref}}: {{action}} / {{outcome}}. المسؤول {{owner_name}}.',defaultChannelsJson:['in_app'],digestCadence:'immediate',isActive:false,createdBy:'system:ai-notification-drafts'},
  ],skipDuplicates:true});
}
export function validateAiNotificationTemplate(code:string,source:string,title:string,body:string,cadence:string) {
  const known=AI_NOTIFICATION_CATALOG.find(row=>row[0]===code);
  if(!known&&!((code==='AIX-NTF-03'&&source==='ai_risk_harmony')||(code==='AIX-NTF-04'&&source==='ai_risk_strategy')))throw new BadRequestException('Use an approved AI notification catalog code');
  if(known&&known[1]!==source)throw new BadRequestException('Use the catalog source for this AI notification code');
  if(known&&(!title.includes(known[2])||!title.includes(known[3])))throw new BadRequestException('Preserve both exact functional-design notification subjects');
  if(!AI_NOTIFICATION_SOURCES.includes(source)||!['immediate','hourly','daily','weekly'].includes(cadence))throw new BadRequestException('Use a supported AI source and digest cadence');
  if(!body.trim()||!/[\u0600-\u06ff]/u.test(body)||!/[a-z]/iu.test(body))throw new BadRequestException('Provide governed English and Arabic notification content');
  const variables=new Set(['case_number','usecase_id','risk_ref','tier','residual_level','due_date','owner_name','sla_pct','escalation_level','action_ref','risk_id','action','outcome']);
  for(const [,key] of (title+'\n'+body).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))if(!variables.has(key))throw new BadRequestException('Use standard AI notification variables');
}
export function aiDeliveryNotBefore(at:Date,cadence:string,quiet:unknown):Date {
  if(!Number.isFinite(at.getTime())||!['immediate','hourly','daily','weekly'].includes(cadence))throw new BadRequestException('Valid notification cadence and instant required');
  let result=new Date(at),local=new Date(at.getTime()+KSA);
  if(cadence==='hourly')result=new Date(Math.floor((at.getTime()+KSA)/3600000)*3600000+3600000-KSA);
  if(cadence==='daily'||cadence==='weekly') {
    let target=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),8)-KSA;
    if(cadence==='weekly')target+=(7-local.getUTCDay())%7*DAY;
    if(target<=at.getTime())target+=cadence==='daily'?DAY:7*DAY;
    result=new Date(target);
  }
  if(quiet===null||quiet===undefined)return result;
  const q=jsonRecord(quiet),minute=(v:unknown)=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):null;
  const start=minute(q['start']),end=minute(q['end']);
  if(start===null||end===null||q['timezone']!==undefined&&q['timezone']!=='Asia/Riyadh'||start===end)throw new BadRequestException('Quiet hours require distinct HH:mm start/end in Asia/Riyadh');
  local=new Date(result.getTime()+KSA);const now=local.getUTCHours()*60+local.getUTCMinutes();
  const inside=start<end?now>=start&&now<end:now>=start||now<end;
  if(inside){let target=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),Math.floor(end/60),end%60)-KSA;if(target<=result.getTime())target+=DAY;result=new Date(target);}
  return result;
}

/** Installed purpose grants and native scope, evaluated inside the caller's transaction. */
export async function aiNoticeAccess(tx:Prisma.TransactionClient,userId:string,caseId:string) {
  const user=await tx.user.findFirst({where:{id:userId,isActive:true},include:{userRoles:{where:{role:{isActive:true,deletedAt:null}},include:{role:true}}}});
  if(!user)return null;
  const roles=user.userRoles.map(r=>r.role.code),c=await tx.workflowCase.findUnique({where:{id:caseId},include:{aiUseCase:{include:{owner:true,asset:{include:{classification:true}}}},aiRisk:{include:{owner:true,useCase:{include:{owner:true,asset:{include:{classification:true}}}}}},tasks:{select:{assigneeUserId:true}}}});
  if(!c||!['AIUC','AIRS'].includes(c.type))return null;
  const uc=c.aiUseCase??c.aiRisk?.useCase;if(!uc||uc.deletedAt||uc.isSampleData||c.aiRisk?.deletedAt||c.aiRisk?.isSampleData)return null;
  const suffix=c.type==='AIUC'?'aiuc':'airs';
  const purposes=['own','org','all'].map(v=>`case.view.${suffix}.${v}` as AiPermission);
  const grants=await tx.rolePermission.findMany({where:{roleId:{in:user.userRoles.map(r=>r.roleId)},permission:{OR:purposes.map(splitAiPermission)}},include:{permission:true,role:true}});
  const permissions=new Set(grants.filter(g=>aiRoleMayHold(g.role.code,`${g.permission.resource}.${g.permission.action}` as AiPermission)).map(g=>`${g.permission.resource}.${g.permission.action}`));
  if(!permissions.size)return null;
  const broad=permissions.has(`case.view.${suffix}.org`)||permissions.has(`case.view.${suffix}.all`);
  const own=uc.requesterUserId===userId||uc.owner?.userId===userId||c.aiRisk?.owner?.userId===userId||c.aiRisk?.createdBy===userId||c.tasks.some(t=>t.assigneeUserId===userId);
  if(!broad&&!own)return null;
  // An own AIUC draft is private; wider access requires an actual submitted revision.
  if(c.type==='AIUC'&&uc.requesterUserId!==userId&&!await tx.aiIntakeRevision.findFirst({where:{useCaseId:uc.id,submittedAt:{not:null}},select:{id:true}}))return null;
  const scope=await new ScopeService(tx as PrismaService).resolve(roles),asset=uc.asset;
  if(scope.orgUnits!=='all'&&(!uc.organizationUnitId||!scope.orgUnits.includes(uc.organizationUnitId)))return null;
  if(asset?.deletedAt||c.type==='AIRS'&&!asset)return null;
  if(scope.domains!=='all'&&(!asset?.domainId||!scope.domains.includes(asset.domainId)))return null;
  if(scope.maxClassRank!==null&&(!asset?.classification||asset.classification.rank>scope.maxClassRank))return null;
  return {user,roles,c,uc};
}
export interface AiNoticeInput {code:string;sourceType:string;sourceId:string;caseId:string;taskId?:string;dedupeKey:string;userId:string;role:string;variables:Record<string,string>;severity:GovernanceNotificationSeverity;at?:Date}
export async function emitAiNotice(tx:Prisma.TransactionClient,audit:AuditService,input:AiNoticeInput) {
  const template=await tx.governanceNotificationTemplate.findFirst({where:{code:input.code,isActive:true,sourceType:input.sourceType}});
  if(!template||await tx.governanceNotification.findUnique({where:{dedupeKey:input.dedupeKey}}))return null;
  const access=await aiNoticeAccess(tx,input.userId,input.caseId);
  if(!access||access.roles.includes('auditor')||!access.roles.includes(input.role))return null;
  const known=AI_NOTIFICATION_CATALOG.find(row=>row[0]===input.code);
  const render=(text:string)=>{let complete=true;const value=text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_,key:string)=>{if(input.variables[key]===undefined){complete=false;return '';}return input.variables[key];});return complete?value:null;};
  const title=render(known?known[2]+'\n'+known[3]:template.titleTemplate),message=render(template.messageTemplate);
  if(!title||!message)return null;
  const at=input.at??new Date(),preferences=await tx.governanceNotificationPreference.findMany({where:{OR:[{userId:input.userId},{userId:null,roleCode:input.role}]}}),rank={info:0,success:0,warning:1,critical:2};
  const notice=await tx.governanceNotification.create({data:{dedupeKey:input.dedupeKey,title,message,severity:input.severity,sourceType:input.sourceType,sourceId:input.sourceId,targetRoleCode:input.role,assigneeUserId:input.userId,workflowCaseId:input.caseId,workflowTaskId:input.taskId,createdBy:'system:ai-notifications'}});
  for(const channel of ['in_app','email'] as const){
    const pref=preferences.find(p=>p.userId===input.userId&&p.channel===channel)??preferences.find(p=>p.userId===null&&p.roleCode===input.role&&p.channel===channel);
    if(!Array.isArray(template.defaultChannelsJson)||!template.defaultChannelsJson.includes(channel)||pref&&(!pref.isEnabled||rank[pref.minimumSeverity]>rank[input.severity]))continue;
    const cadence=pref?.digestCadence??template.digestCadence;
    const notBefore=aiDeliveryNotBefore(at,cadence,pref?.quietHoursJson);
    await tx.governanceNotificationDeliveryAttempt.create({data:{notificationId:notice.id,channel,status:'planned',target:channel==='email'?access.user.email:input.userId,nextRetryAt:notBefore>at?notBefore:null,
      payloadJson:{templateCode:input.code,templateId:template.id,templateUpdatedAt:template.updatedAt.toISOString(),digestCadence:cadence,quietHours:pref?.quietHoursJson??null,notBefore:notBefore.toISOString(),locale:'en/ar',variables:input.variables,externalDelivery:false}}});
  }
  await audit.logRequired({actor:'system:ai-notifications',action:'ai.notification.created',entityType:access.c.type==='AIUC'?'ai_use_case':'ai_risk',entityId:access.c.aiUseCase?.id??access.c.aiRisk!.id,metadata:{notificationId:notice.id,templateCode:input.code,sourceType:input.sourceType,sourceId:input.sourceId,externalDelivery:false}},tx);
  return notice.id;
}

type Target={userId?:string|null;role?:string|null};
export async function notifyAiTargets(tx:Prisma.TransactionClient,audit:AuditService,code:string,caseId:string,sourceId:string,key:string,targets:Target[],variables:Record<string,string>,taskId?:string,at?:Date,severity:GovernanceNotificationSeverity='info') {
  const sourceType=AI_NOTIFICATION_CATALOG.find(c=>c[0]===code)?.[1]??(code==='AIX-NTF-04'?'ai_risk_strategy':null);
  if(!sourceType)return [];
  const recipients=new Map<string,{id:string;role:string}>();
  for(const target of targets){if(!target.userId&&!target.role)continue;
    const users=await tx.user.findMany({where:{isActive:true,...(target.userId?{id:target.userId}:{}),...(target.role?{userRoles:{some:{role:{code:target.role,isActive:true,deletedAt:null}}}}:{})},include:{userRoles:{where:{role:{isActive:true,deletedAt:null}},include:{role:true}}}});
    for(const user of users){const role=target.role??user.userRoles.find(r=>r.role.code!=='auditor'&&r.role.code!=='executive')?.role.code;if(role)recipients.set(user.id,{id:user.id,role});}
  }
  const ids:string[]=[];
  for(const recipient of recipients.values()){const id=await emitAiNotice(tx,audit,{code,sourceType,sourceId,caseId,taskId,dedupeKey:key+':'+recipient.id,userId:recipient.id,role:recipient.role,variables,severity,at});if(id)ids.push(id);}
  return ids;
}
export async function aiVariables(tx:Prisma.TransactionClient,caseId:string,extra:Record<string,string>={}) {
  const c=await tx.workflowCase.findUniqueOrThrow({where:{id:caseId},include:{aiUseCase:{include:{owner:true,assessments:{where:{kind:'classification'},orderBy:{round:'desc'},take:1}}},aiRisk:{include:{owner:true,useCase:true,assessments:{orderBy:{round:'desc'},take:1}}}}});
  const uc=c.aiUseCase??c.aiRisk?.useCase,result=jsonRecord((c.aiUseCase?.assessments[0]??c.aiRisk?.assessments[0])?.result);
  return {case_number:c.code,usecase_id:uc?.useCaseRef??'—',risk_ref:c.aiRisk?.riskRef??'—',risk_id:c.aiRisk?.id??'—',tier:String(result['approvedTierCode']??'—'),residual_level:String(result['bandCode']??'—'),due_date:'—',owner_name:c.aiRisk?.owner?.fullNameEn??c.aiUseCase?.owner?.fullNameEn??'—',sla_pct:'—',escalation_level:'—',action_ref:'—',...extra};
}
export function aiDualDue(date:Date) {
  const opts:Intl.DateTimeFormatOptions={timeZone:'Asia/Riyadh',day:'numeric',month:'long',year:'numeric'};
  return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',opts).format(date)+' / '+new Intl.DateTimeFormat('en-GB-u-ca-gregory',opts).format(date);
}

/** A successful required native audit and its template notices share one transaction. */
export async function logAiRequired(audit:AuditService,entry:AuditEntry,tx?:Prisma.TransactionClient) {
  await audit.logRequired(entry,tx);
  if(!tx||!entry.entityId)return;
  const action=entry.action,m=entry.metadata??{};
  if(entry.entityType==='ai_use_case') {
    const uc=await tx.aiUseCase.findUnique({where:{id:entry.entityId},include:{owner:true,intakeRevisions:{orderBy:{revision:'desc'},take:1},workflowCase:true}});
    if(!uc?.workflowCaseId||uc.isSampleData||uc.deletedAt)return;
    const variables:Record<string,string>=await aiVariables(tx,uc.workflowCaseId),payload=jsonRecord(uc.intakeRevisions[0]?.payload),targets:Target[]=[{userId:uc.requesterUserId}];
    let code:string|undefined,taskId:string|undefined;
    if(['aiuc.intake.submitted','aiuc.intake.resubmitted'].includes(action)){code='AIUC-NTF-01';targets.push({role:'AI_WORKING_GROUP'});const task=await tx.workflowTask.findFirst({where:{caseId:uc.workflowCaseId,status:'pending',templateStage:{code:'aiuc-triage'}}});if(task?.dueDate)variables.due_date=aiDualDue(task.dueDate);taskId=task?.id;}
    if(action==='aiuc.triage.return'){code='AIUC-NTF-02';const task=await tx.workflowTask.findFirst({where:{caseId:uc.workflowCaseId,status:'pending',templateStage:{code:'aiuc-completion'}}});if(task?.dueDate)variables.due_date=aiDualDue(task.dueDate);taskId=task?.id;}
    if(/^aiuc\.decision\.(approve|approve_with_conditions|reject|return)$/.test(action)){code='AIUC-NTF-04';targets.push({userId:typeof payload['proposed_owner']==='string'?payload['proposed_owner']:null});}
    if(/^aiuc\.request\.(withdrawn|closed_no_action)$/.test(action)){code='AIUC-NTF-04';variables.outcome=String(m['resolutionCode']);}
    if(action==='aiuc.asset.approve'&&uc.assetId){code='AIUC-NTF-05';targets.splice(0,targets.length,{userId:uc.owner?.userId,role:'AI_USECASE_OWNER'},{userId:typeof payload['data_owner']==='string'?payload['data_owner']:null,role:'data_owner'});}
    if(code)await notifyAiTargets(tx,audit,code,uc.workflowCaseId,uc.id,`ai-event:${uc.id}:${uc.version}:${action}`,targets,variables,taskId);
  }
  if(entry.entityType==='ai_risk') {
    const risk=await tx.aiRisk.findUnique({where:{id:entry.entityId},include:{owner:true,useCase:{include:{owner:true}},workflowCase:true}});
    if(!risk?.workflowCaseId||risk.isSampleData||risk.deletedAt)return;
    const variables=await aiVariables(tx,risk.workflowCaseId);
    if(['airs.handoff.created','airs.owner.assigned'].includes(action))await notifyAiTargets(tx,audit,'AIRS-NTF-01',risk.workflowCaseId,risk.id,'ai-open:'+risk.id,[{userId:risk.owner?.userId,role:'AI_RISK_OWNER'},{role:'AI_WORKING_GROUP'}],variables);
    if(action==='airs.intake.submitted')await notifyAiTargets(tx,audit,'AIRS-NTF-02',risk.workflowCaseId,risk.id,`ai-registered:${risk.id}:${risk.version}`,[{userId:risk.owner?.userId,role:'AI_RISK_OWNER'},{userId:risk.useCase.owner?.userId,role:'AI_USECASE_OWNER'}],variables);
    if(action==='airs.treatment.plan.approve'&&typeof m['planId']==='string') {
      const tasks=await tx.workflowTask.findMany({where:{caseId:risk.workflowCaseId,status:'pending',templateStage:{code:'airs-treatment'}}});
      for(const task of tasks){const facts=jsonRecord(task.formDataJson);if(facts['planId']!==m['planId'])continue;
        await notifyAiTargets(tx,audit,'AIRS-NTF-03',risk.workflowCaseId,String(facts['actionId']),`ai-treatment:${m['planId']}:${facts['actionId']}:assigned`,[{userId:task.assigneeUserId,role:task.assigneeRoleCode}],{...variables,action_ref:String(facts['actionRef']??'—'),due_date:task.dueDate?aiDualDue(task.dueDate):'—'},task.id);
      }
    }
    if(['airs.residual.adoption.approve','airs.residual.accept_owner.accept'].includes(action)&&typeof m['nextTaskId']==='string') {
      const task=await tx.workflowTask.findUnique({where:{id:m['nextTaskId']}});
      if(task&&task.templateStageId&&['AI_USECASE_OWNER','AI_GOVERNANCE_OFFICER','AI_ETHICS_COMMITTEE','AI_EXECUTIVE_TEAM','STEERING_COMMITTEE'].includes(task.assigneeRoleCode??''))await notifyAiTargets(tx,audit,'AIX-NTF-01',risk.workflowCaseId,task.id,'ai-acceptance:'+task.id,[{userId:task.assigneeUserId,role:task.assigneeRoleCode},{userId:risk.owner?.userId,role:'AI_RISK_OWNER'}],variables,task.id);
    }
    if(action.startsWith('airs.strategy.')&&typeof m['eventId']==='string') {
      const event=await tx.aiRiskStrategyEvent.findUnique({where:{id:m['eventId']},include:{escalation:true}});
      const tasks=await tx.workflowTask.findMany({where:{caseId:risk.workflowCaseId,status:'pending'},select:{id:true,assigneeUserId:true,assigneeRoleCode:true}});
      if(event)await notifyAiTargets(tx,audit,'AIX-NTF-04',risk.workflowCaseId,event.responseId,'ai-strategy:'+event.id,[{userId:risk.owner?.userId,role:'AI_RISK_OWNER'},...tasks.map(t=>({userId:t.assigneeUserId,role:t.assigneeRoleCode}))],{...variables,action:event.kind,outcome:event.outcome});
      if(event?.escalation)await notifyEscalation(tx,audit,event.escalation.id);
    }
    if(['airs.review.sla.signal','airs.review.sla.escalate'].includes(action)&&typeof m['escalationId']==='string')await notifyEscalation(tx,audit,m['escalationId']);
  }
}
async function notifyEscalation(tx:Prisma.TransactionClient,audit:AuditService,id:string) {
  const e=await tx.governanceEscalation.findUniqueOrThrow({where:{id}}),levels=['domain_council','data_stewardship_council','data_governance_board','executive_steering_committee'];
  const index=levels.indexOf(e.level);if(!e.workflowCaseId||index<1||e.status==='resolved')return;
  const variables=await aiVariables(tx,e.workflowCaseId,{escalation_level:String(index+1),due_date:e.dueAt?aiDualDue(e.dueAt):'—'});
  await notifyAiTargets(tx,audit,'AIX-NTF-02',e.workflowCaseId,e.id,`ai-escalation:${e.id}:${e.level}`,[{role:e.ownerRoleCode},{role:'AI_GOVERNANCE_OFFICER'}],variables,e.workflowTaskId??undefined,undefined,'critical');
}
export async function notifyReviewWindow(tx:Prisma.TransactionClient,audit:AuditService,reviewId:string,now:Date) {
  const r=await tx.aiRiskReview.findUniqueOrThrow({where:{id:reviewId},include:{completion:true,cancellation:true,task:true}});
  if(r.completion||r.cancellation||!['pending','in_progress'].includes(r.task.status)||now.getTime()<r.dueAt.getTime()-7*DAY)return [];
  const due=now>=r.dueAt,code=due?'AIRS-NTF-05':'AIRS-NTF-06',variables=await aiVariables(tx,r.task.caseId,{due_date:aiDualDue(r.dueAt),residual_level:r.bandCode});
  return notifyAiTargets(tx,audit,code,r.task.caseId,r.id,`ai-review-window:${r.id}:${code}`,[{userId:r.assignedOwnerId,role:'AI_RISK_OWNER'},...(!due?[{role:'AI_WORKING_GROUP'}]:[])],variables,r.taskId,now,due?'warning':'info');
}

export async function assertAiDeliveryEligible(tx:Prisma.TransactionClient,attemptId:string,now:Date) {
  const a=await tx.governanceNotificationDeliveryAttempt.findUniqueOrThrow({where:{id:attemptId},include:{notification:true}}),n=a.notification;
  if(!n.sourceType||!AI_NOTIFICATION_SOURCES.includes(n.sourceType))return;
  const access=n.assigneeUserId&&n.workflowCaseId?await aiNoticeAccess(tx,n.assigneeUserId,n.workflowCaseId):null;
  if(!access||n.status==='archived'||access.roles.includes('auditor')||!n.targetRoleCode||!access.roles.includes(n.targetRoleCode))throw new ForbiddenException('AI notice recipient no longer has native access or the assigned role');
  if(['sent','skipped'].includes(a.status))throw new BadRequestException('A completed AI delivery cannot be replayed');
  const payload=jsonRecord(a.payloadJson),templateId=payload['templateId'];
  const template=typeof templateId==='string'?await tx.governanceNotificationTemplate.findUnique({where:{id:templateId}}):null;
  if(!template?.isActive||!Array.isArray(template.defaultChannelsJson)||!template.defaultChannelsJson.includes(a.channel))throw new ForbiddenException('AI delivery template or channel is inactive');
  if(['AIUC-NTF-03','AIRS-NTF-03','AIRS-NTF-04','AIRS-NTF-05','AIRS-NTF-06'].includes(template.code)&&(!n.workflowTaskId||!await tx.workflowTask.findFirst({where:{id:n.workflowTaskId,status:{in:['pending','in_progress']}}})))throw new ForbiddenException('The native AI task no longer requires this delivery');
  const preferences=await tx.governanceNotificationPreference.findMany({where:{OR:[{userId:n.assigneeUserId},{userId:null,roleCode:n.targetRoleCode}]}});
  const pref=preferences.find(p=>p.userId===n.assigneeUserId&&p.channel===a.channel)??preferences.find(p=>p.userId===null&&p.roleCode===n.targetRoleCode&&p.channel===a.channel);
  const rank={info:0,success:0,warning:1,critical:2};if(pref&&(!pref.isEnabled||rank[pref.minimumSeverity]>rank[n.severity]))throw new ForbiddenException('AI recipient suppresses this delivery');
  const notBefore=typeof payload['notBefore']==='string'?new Date(payload['notBefore']):a.createdAt;
  if(!Number.isFinite(notBefore.getTime())||now<notBefore||a.nextRetryAt&&now<a.nextRetryAt)throw new ForbiddenException('AI digest delivery window has not opened');
  if(aiDeliveryNotBefore(now,'immediate',pref?.quietHoursJson)>now)throw new ForbiddenException('AI recipient is in Saudi quiet hours');
}

export async function processAiTriageSignals(db:PrismaService,audit:AuditService,now:Date) {
  if(!Number.isFinite(now.getTime()))throw new BadRequestException('Valid triage observation instant required');
  const active=await db.governanceNotificationTemplate.findFirst({where:{code:'AIUC-NTF-03',sourceType:'ai_use_case',isActive:true}});
  if(!active)return {created:0};
  const holidays=await db.ksaHoliday.findMany(),dates=holidays.filter(h=>!h.isRecurring).map(h=>h.date.toISOString().slice(0,10)),recurring=holidays.filter(h=>h.isRecurring).map(h=>h.date.toISOString().slice(5,10));
  let cursor:string|undefined,created=0;
  do {
    const rows=await db.workflowTask.findMany({where:{status:{in:['pending','in_progress']},dueDate:{not:null},templateStage:{code:'aiuc-triage',isActive:true,template:{isActive:true,deletedAt:null}},case:{type:'AIUC',status:'submitted',aiUseCase:{deletedAt:null,isSampleData:false}}},orderBy:{id:'asc'},take:50,...(cursor?{cursor:{id:cursor},skip:1}:{})});
    if(!rows.length)break;
    for(const row of rows)created+=await governanceTransaction(db,async tx=>{
      await tx.$executeRaw`SELECT id FROM workflow_tasks WHERE id=${row.id} FOR UPDATE`;
      const task=await tx.workflowTask.findUniqueOrThrow({where:{id:row.id},include:{case:true}});
      if(!task.dueDate||!['pending','in_progress'].includes(task.status)||task.case.status!=='submitted')return 0;
      const shift=(d:Date)=>new Date(d.getTime()+KSA),total=businessDaysBetween(shift(task.createdAt),shift(task.dueDate),dates,recurring),elapsed=businessDaysBetween(shift(task.createdAt),shift(now),dates,recurring);
      const thresholds=now>=task.dueDate?[50,80,95,100]:total>0?[50,80,95].filter(t=>elapsed/total*100>=t):[];
      let count=0;
      for(const threshold of thresholds){const ids=await notifyAiTargets(tx,audit,'AIUC-NTF-03',task.caseId,task.id,`ai-triage:${task.id}:${threshold}`,[{role:'AI_WORKING_GROUP'},...(threshold===100?[{role:'AI_GOVERNANCE_OFFICER'}]:[])],await aiVariables(tx,task.caseId,{due_date:aiDualDue(task.dueDate),sla_pct:String(threshold)}),task.id,now,threshold===100?'critical':'warning');count+=ids.length;}
      return count;
    });
    cursor=rows[rows.length-1].id;if(rows.length<50)break;
  }while(cursor);
  return {created};
}

export async function processAiNotificationClosures(db:PrismaService,audit:AuditService,riskId?:string) {
  let cursor:string|undefined,archived=0;
  do {
    const rows=await db.governanceNotification.findMany({where:{sourceType:{in:AI_NOTIFICATION_SOURCES},...(riskId?{workflowCase:{aiRisk:{id:riskId}}}:{}),OR:[{status:'archived',deliveryAttempts:{some:{status:{in:['planned','failed']}}}},{sourceType:{in:['ai_use_case','ai_risk_review']},status:{not:'archived'},workflowTask:{status:{notIn:['pending','in_progress']}}}]},orderBy:{id:'asc'},take:50,...(cursor?{cursor:{id:cursor},skip:1}:{})});
    if(!rows.length)break;
    for(const row of rows)archived+=await governanceTransaction(db,async tx=>{
      await tx.$executeRaw`SELECT id FROM governance_notifications WHERE id=${row.id} FOR UPDATE`;
      const n=await tx.governanceNotification.findUniqueOrThrow({where:{id:row.id},include:{workflowTask:true}});
      const obsolete=n.dedupeKey?.startsWith('ai-triage:')||n.dedupeKey?.startsWith('ai-review-window:');
      if(n.status!=='archived'&&(!obsolete||!n.workflowTask||['pending','in_progress'].includes(n.workflowTask.status)))return 0;
      const changed=n.status==='archived'?0:(await tx.governanceNotification.updateMany({where:{id:n.id,status:{not:'archived'}},data:{status:'archived'}})).count;
      const skipped=await tx.governanceNotificationDeliveryAttempt.updateMany({where:{notificationId:n.id,status:{in:['planned','failed']}},data:{status:'skipped',nextRetryAt:null,errorMessage:'Native AI work completed or superseded'}});
      if(changed||skipped.count)await audit.logRequired({actor:'system:ai-notifications',action:'ai.notification.closed',entityType:'governance_notification',entityId:n.id,metadata:{workflowCaseId:n.workflowCaseId,archived:changed,skipped:skipped.count,externalDelivery:false}},tx);
      return changed;
    });
    cursor=rows[rows.length-1].id;if(rows.length<50)break;
  }while(cursor);
  return {archived};
}
