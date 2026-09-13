import { AiControlDomainsService } from './ai-control-domains.service';
import { requiredInherentRound } from './ai-reassessment-state';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, TaskStatus, TaskDecision } from '@prisma/client';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService, aiDutyViolation } from './ai-authorization.service';
import { AiIdentifiersService } from './ai-identifiers.service';
import { AiRiskIntakeService, riskSelect } from './ai-risk-intake.service';
import { AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { jsonRecord } from './ai-risk-scoring';
import { ACTION_TYPES, RecordTreatmentProgressDto, SaveTreatmentActionDto } from './ai-treatment.dto';
import { ReviewRiskAssessmentDto } from './ai-risk-adoption.dto';
const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 15000 };
const EXECUTORS = ['AI_MODEL_OWNER','AI_MLOPS_LEAD','privacy_officer','security_reviewer','technical_steward'];
const PREPARE = 'airs-treatment-plan', APPROVE = 'airs-plan-approval';
function text(value: unknown, max = 5000, required = true): string {
 if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new BadRequestException('Treatment text/justification is required within supported limits');
 return value.trim();
}
function date(value: unknown): Date {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new BadRequestException('Use a valid calendar date');
 const result = new Date(`${value}T00:00:00Z`);
 if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0,10) !== value) throw new BadRequestException('Use a valid calendar date');
 return result;
}
function ids(value: unknown, required = false): string[] {
 if (!Array.isArray(value) || value.length > 20 || (required && !value.length) || value.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))) throw new BadRequestException('Use existing DGOP evidence identifiers');
 return [...new Set(value as string[])];
}
@Injectable()
export class AiTreatmentService {
 constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService, private readonly risks: AiRiskIntakeService,
  private readonly routing: AiWorkflowRoutingService, private readonly identifiers: AiIdentifiersService, private readonly scope: ScopeService, private readonly audit: AuditService,private readonly controls?:AiControlDomainsService) {}
 private async gate(tx: Prisma.TransactionClient, userId: string, id: string) {
  const access = await this.risks.visibility(userId,tx), risk = await tx.aiRisk.findFirst({where:{AND:[access.where,{id}]},select:riskSelect});
  if (!risk) throw new NotFoundException('AI risk not found');
  const requiredRound=await requiredInherentRound(tx,id);
  if(risk.assessments[0]?.round<requiredRound)risk.assessments=[];
  const response = await tx.aiRiskResponse.findFirst({where:{riskId:id,strategyCode:{in:['MITIGATE','TRANSFER']},decisions:{some:{kind:'officer',decision:'approve'}}},orderBy:{round:'desc'},include:{decisions:true}});
  const tasks = response && risk.workflowCase?.templateId ? await tx.workflowTask.findMany({where:{caseId:risk.workflowCase.id,status:TaskStatus.pending,
   templateStage:{is:{templateId:risk.workflowCase.templateId,isActive:true,code:{in:[PREPARE,APPROVE]},template:{is:{code:AIRS_TEMPLATE_CODE,isActive:true,deletedAt:null}}}}},include:{templateStage:{select:{code:true}}}}) : [];
  const bound = tasks.filter(task=>jsonRecord(task.formDataJson)['responseId']===response?.id);
  const task = bound.length===1 ? bound[0] : null;
  const active = !!response && risk.workflowCase?.status==='under_review' && response.assessmentId===risk.assessments[0]?.id && !!task
   && task.assigneeRoleCode===(task.templateStage?.code===PREPARE?'AI_RISK_OWNER':'AI_GOVERNANCE_OFFICER');
  const actions = response ? await tx.aiTreatmentAction.findMany({where:{responseId:response.id,deletedAt:null},orderBy:{createdAt:'asc'},include:{assignee:{select:{userId:true,fullNameEn:true,fullNameAr:true,isActive:true,deletedAt:true}},workflowTask:true,progress:{orderBy:{round:'desc'},take:10}}}) : [];
  return {...access,risk,response,task,active,actions};
 }
 private owner(gate: Awaited<ReturnType<AiTreatmentService['gate']>>) {
  if (!gate.permissions.has('airs.risk.assess') || !gate.actor.roles.includes('AI_RISK_OWNER') || gate.actor.roles.includes('auditor') || gate.actor.id!==gate.risk.owner?.userId) throw new ForbiddenException('Only the assigned Risk Owner prepares the treatment plan');
 }
 private version(gate: {active:boolean;risk:{version:number}}, expected: number) {
  if (!gate.active) throw new ConflictException('One active approved-strategy treatment gate is required');
  if (gate.risk.version!==expected) throw new ConflictException('AI risk changed; reload the treatment plan');
 }
 private async references(tx: Prisma.TransactionClient) {
  const now=new Date();
  const lists=await Promise.all(['R_ACTTYPE','R_PRIORITY'].map(async listCode=>{
   const versions=await tx.governedReferenceVersion.findMany({where:{listCode,state:'published',effectiveFrom:{lte:now},OR:[{effectiveTo:null},{effectiveTo:{gt:now}}]},include:{values:{orderBy:{sortOrder:'asc'}}},take:2});
   const v=versions.length===1?versions[0]:null;
   return {listCode,versionId:v?.id??null,values:v?.values.map(value=>({code:value.code,labelEn:value.labelEn,labelAr:value.labelAr,metadata:jsonRecord(value.metadata)}))??[]};
  }));
  const types=lists[0], priorities=lists[1], mappings=priorities.values.map(value=>value.metadata['dgopPriorityCode']);
  return {ready:types.values.length===4 && ACTION_TYPES.every(code=>types.values.some(value=>value.code===code)) && priorities.values.length===4
   && ['LOW','NORMAL','HIGH','CRITICAL'].every(code=>mappings.filter(mapping=>mapping===code).length===1),lists};
 }
 private async current(tx: Prisma.TransactionClient, versionId: unknown) {
  if(typeof versionId!=='string') throw new ConflictException('Treatment reference publication is missing');
  const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM governed_reference_versions WHERE id=${versionId} AND state='published' AND "effectiveFrom"<=CURRENT_TIMESTAMP AND ("effectiveTo" IS NULL OR "effectiveTo">CURRENT_TIMESTAMP) FOR SHARE`;
  if(rows.length!==1) throw new ConflictException('Treatment references changed; return and update the action');
 }
 private async evidence(tx: Prisma.TransactionClient, values: string[]) {
  if(await tx.ndiEvidence.count({where:{id:{in:values},deletedAt:null}})!==values.length) throw new BadRequestException('Every evidence identifier must exist in DGOP');
 }
 private async executor(tx: Prisma.TransactionClient, userId: string, assetId: string) {
  const actor=await this.authorization.authorize(userId,'airs.risk.assess',tx), role=EXECUTORS.find(code=>actor.roles.includes(code));
  if(!role || actor.roles.includes('auditor')) throw new BadRequestException('Select an eligible treatment executor');
  const person=await tx.person.findFirst({where:{userId,isActive:true,deletedAt:null}});
  if(!person) throw new BadRequestException('Executor requires an active directory person');
  const asset=await tx.dataAsset.findUniqueOrThrow({where:{id:assetId},include:{classification:true}}), scope=await this.scope.resolve(actor.roles);
  if((scope.orgUnits!=='all' && (!asset.orgUnitId||!scope.orgUnits.includes(asset.orgUnitId))) || (scope.domains!=='all'&&(!asset.domainId||!scope.domains.includes(asset.domainId)))
   || (scope.maxClassRank!==null && (!asset.classification||asset.classification.rank>scope.maxClassRank))) throw new ForbiddenException('Executor must have scope to the linked asset');
  return {actor,person,role};
 }
 async context(userId: string,id: string) {
  return this.prisma.$transaction(async tx=>{
   const gate=await this.gate(tx,userId,id), refs=await this.references(tx), canEdit=gate.active&&gate.task?.templateStage?.code===PREPARE
    &&gate.permissions.has('airs.risk.assess')&&gate.actor.roles.includes('AI_RISK_OWNER')&&!gate.actor.roles.includes('auditor')&&gate.actor.id===gate.risk.owner?.userId;
   const planId=jsonRecord(gate.task?.formDataJson)['planId'];
   const plan=typeof planId==='string'?await tx.aiTreatmentPlan.findFirst({where:{id:planId,responseId:gate.response?.id},include:{decision:true}}):null;
   const facts={planExecutorIds:gate.actions.map(action=>action.assignee?.userId).filter((id):id is string=>!!id),riskOwnerId:gate.risk.owner?.userId??undefined,useCaseOwnerId:gate.risk.useCase.owner?.userId??undefined,assessmentAssessorIds:plan?[plan.submittedBy]:[]};
   const eligible=gate.active&&!!plan&&!plan.decision&&gate.actor.roles.includes('AI_GOVERNANCE_OFFICER')&&gate.permissions.has('case.approve.airs')
    &&!aiDutyViolation(userId,gate.actor.roles,'approve_plan',facts)&&!aiDutyViolation(userId,gate.actor.roles,'adopt_assessment',facts)
    &&(!gate.task?.assigneeUserId||gate.task.assigneeUserId===userId);
   const referencesCurrent=gate.actions.every(action=>{const pinned=jsonRecord(jsonRecord(action.planData)['referenceVersions']);return refs.lists.every(list=>!!list.versionId&&pinned[list.listCode]===list.versionId);});
   const approved=gate.response?await tx.aiTreatmentPlan.findFirst({where:{responseId:gate.response.id,decision:{is:{decision:'approve'}}},include:{decision:true},orderBy:{round:'desc'}}):null;
   const executionActions=gate.actions.map(action=>{
    const latest=action.progress[0], task=action.workflowTask, data=jsonRecord(action.planData);
    const complete=latest?.completionPct===100, overdue=!complete&&!!task?.dueDate&&task.dueDate<new Date();
    const canExecute=!!approved&&gate.response?.assessmentId===gate.risk.assessments[0]?.id&&gate.risk.workflowCase?.status==='under_review'
     &&gate.permissions.has('airs.risk.assess')&&gate.actor.id===action.assignee?.userId&&action.assignee.isActive&&!action.assignee.deletedAt
     &&task?.assigneeUserId===userId&&['pending','in_progress'].includes(task.status)&&gate.actor.roles.includes(data['executorRole'] as string)
     &&!aiDutyViolation(userId,gate.actor.roles,'execute_plan',{planApproverIds:[approved.decision!.actorId]});
    return {...action,completionPct:latest?.completionPct??0,overdue,closureDate:latest?.completedAt?new Date(latest.completedAt.getTime()+3*3600000).toISOString().slice(0,10):null,canExecute:!!canExecute};
   });
   return {version:gate.risk.version,canEdit:!!canEdit,canSubmit:!!canEdit&&refs.ready&&referencesCurrent&&gate.actions.length>0,canReview:!!eligible,canApprove:!!eligible&&refs.ready&&referencesCurrent,referencesCurrent,taskId:plan?gate.task?.id:null,plan,
    references:refs,actions:executionActions,completionPct:executionActions.length?executionActions.reduce((sum,action)=>sum+action.completionPct,0)/executionActions.length:null,executors:canEdit?await tx.person.findMany({where:{isActive:true,deletedAt:null,user:{is:{isActive:true,userRoles:{none:{role:{is:{code:'auditor',isActive:true,deletedAt:null}}},some:{role:{is:{code:{in:EXECUTORS},isActive:true,deletedAt:null,permissions:{some:{permission:{is:{resource:'airs.risk',action:'assess'}}}}}}}}}}},select:{userId:true,fullNameEn:true,fullNameAr:true},take:500}):[],
    history:await tx.aiTreatmentPlan.findMany({where:{response:{is:{riskId:id}}},include:{decision:true},orderBy:{createdAt:'desc'},take:20})};
  },options);
 }
 async save(userId: string,id: string,dto: SaveTreatmentActionDto,actionId?: string,clientIp?: string) {
  const title=text(dto.title,200), description=text(dto.description), evidenceRequired=text(dto.evidenceRequired,5000,['PREVENTIVE','CORRECTIVE'].includes(dto.actionType)), evidenceIds=ids(dto.evidenceIds);
  const targetDate=date(dto.targetDate), startDate=dto.startDate?date(dto.startDate):null;
  if(targetDate.toISOString().slice(0,10)<new Date(Date.now()+3*3600000).toISOString().slice(0,10)||startDate&&startDate>targetDate) throw new BadRequestException('Target date must be current/future and not before the start date');
  if(!ACTION_TYPES.includes(dto.actionType)||!['investigation','evidence_upload','information'].includes(dto.taskType)) throw new BadRequestException('Invalid action or DGOP task type');
  return this.prisma.$transaction(async tx=>{
   const gate=await this.gate(tx,userId,id);this.owner(gate);this.version(gate,dto.expectedVersion);
   if(gate.task!.templateStage?.code!==PREPARE) throw new ConflictException('Submitted plan is frozen until returned');
   const refs=await this.references(tx), type=refs.lists[0].values.find(value=>value.code===dto.actionType), priority=refs.lists[1].values.find(value=>value.code===dto.priorityCode);
   if(!refs.ready||!type||!priority) throw new ConflictException('Published action types and priority mappings are required');
   for(const list of refs.lists) await this.current(tx,list.versionId);
   const nominee=await this.executor(tx,dto.assigneeUserId,gate.risk.useCase.assetId!);await this.evidence(tx,evidenceIds);
   const old=actionId?gate.actions.find(action=>action.id===actionId):null;
   if(actionId&&!old) throw new NotFoundException('Treatment action not found');
   if(!old&&gate.actions.length>=50) throw new BadRequestException('This plan supports up to 50 actions');
   const oldControls=jsonRecord(old?.planData)['controlDomains'];
   const controlDomains=this.controls?await this.controls.pins(tx,dto.controlVersionIds??(Array.isArray(oldControls)?oldControls.map(p=>String(jsonRecord(p)['versionId'])):[])):[];
   const planData={controlDomains,description,actionType:dto.actionType,typeLabel:{labelEn:type.labelEn,labelAr:type.labelAr},priorityCode:dto.priorityCode,priority:priority.metadata['dgopPriorityCode'],
    priorityLabel:{labelEn:priority.labelEn,labelAr:priority.labelAr},assigneeUserId:nominee.actor.id,executorRole:nominee.role,startDate:dto.startDate??null,evidenceRequired,evidenceIds,taskType:dto.taskType,
    referenceVersions:Object.fromEntries(refs.lists.map(list=>[list.listCode,list.versionId]))};
   const values={title,targetDate,assigneePersonId:nominee.person.id,planData:planData as Prisma.InputJsonObject};
   const action=old?await tx.aiTreatmentAction.update({where:{id:old.id},data:{...values,version:{increment:1}}}):await tx.aiTreatmentAction.create({data:{...values,riskId:id,responseId:gate.response!.id,actionRef:await this.identifiers.nextActionRef(tx),createdBy:userId}});
   await this.commit(tx,id,gate.risk.workflowCase!.id,dto.expectedVersion,userId,'airs.treatment.action.saved',{actionId:action.id,actionRef:action.actionRef,planData,clientIp:clientIp??null});
   return {id,version:dto.expectedVersion+1,actionId:action.id};
  },options);
 }
 private async validate(tx: Prisma.TransactionClient,gate: Awaited<ReturnType<AiTreatmentService['gate']>>) {
  if(!gate.actions.length) throw new ConflictException('At least one planned ACT action is required');
  for(const action of gate.actions) {
   const data=jsonRecord(action.planData), refs=jsonRecord(data['referenceVersions']);
   if(this.controls)await this.controls.verify(tx,data['controlDomains']??[]);
   await this.current(tx,refs['R_ACTTYPE']);await this.current(tx,refs['R_PRIORITY']);
   if(!action.targetDate||!action.assignee?.userId) throw new ConflictException('Action target and executor are required');
   const nominee=await this.executor(tx,action.assignee.userId,gate.risk.useCase.assetId!);
   if(nominee.role!==data['executorRole']) throw new ConflictException('Executor role changed; update the action');
   if(['PREVENTIVE','CORRECTIVE'].includes(data['actionType'] as string)) text(data['evidenceRequired']);
   await this.evidence(tx,ids(data['evidenceIds']));
  }
  if(gate.response!.strategyCode==='TRANSFER') {
   const data=jsonRecord(gate.response!.payload);text(data['provider'],400);await this.evidence(tx,ids(data['contractEvidenceIds'],true));
   if(data['consultationRequired']===true&&!['privacy','security'].every(kind=>gate.response!.decisions.some(d=>d.kind===kind&&d.decision==='approve'))) throw new ConflictException('Required transfer consultations are missing');
  }
 }
 async submit(userId: string,id: string,expectedVersion: number,clientIp?: string) {
  return this.prisma.$transaction(async tx=>{
   const gate=await this.gate(tx,userId,id);this.owner(gate);this.version(gate,expectedVersion);
   if(gate.task!.templateStage?.code!==PREPARE) throw new ConflictException('Plan is already submitted');
   await this.validate(tx,gate);
   const previous=await tx.aiTreatmentPlan.aggregate({where:{responseId:gate.response!.id},_max:{round:true}});
   const snapshot={riskId:id,riskRef:gate.risk.riskRef,riskTitle:gate.risk.title,responseId:gate.response!.id,actionIds:gate.actions.map(action=>action.id),actions:gate.actions.map(action=>({id:action.id,actionRef:action.actionRef,title:action.title,targetDate:action.targetDate!.toISOString(),planData:action.planData}))};
   const plan=await tx.aiTreatmentPlan.create({data:{responseId:gate.response!.id,round:(previous._max.round??0)+1,taskId:gate.task!.id,submittedBy:userId,snapshot:snapshot as Prisma.InputJsonObject}});
   await tx.workflowTask.update({where:{id:gate.task!.id},data:{status:TaskStatus.completed,completedAt:new Date(),formSubmittedAt:new Date(),formSubmittedBy:userId}});
   await this.routing.createStageTask(tx,gate.risk.workflowCase!.id,APPROVE,new Date(),{templateCode:AIRS_TEMPLATE_CODE,formDataJson:{responseId:gate.response!.id,planId:plan.id}});
   await this.commit(tx,id,gate.risk.workflowCase!.id,expectedVersion,userId,'airs.treatment.plan.submitted',{planId:plan.id,snapshot,clientIp:clientIp??null});return {id,version:expectedVersion+1,planId:plan.id};
  },options);
 }
 async review(userId: string,id: string,taskId: string,dto: ReviewRiskAssessmentDto,clientIp?: string) {
  const justification=text(dto.justification), evidenceIds=ids(dto.evidenceIds,true);
  if(!['approve','return'].includes(dto.decision)) throw new BadRequestException('Approve or Return is required');
  return this.prisma.$transaction(async tx=>{
   const gate=await this.gate(tx,userId,id);this.version(gate,dto.expectedVersion);
   if(gate.task?.id!==taskId||gate.task.templateStage?.code!==APPROVE||(gate.task.assigneeUserId&&gate.task.assigneeUserId!==userId)) throw new ConflictException('Active plan approval task not found');
   const actor=await this.authorization.authorize(userId,'case.approve.airs',tx);
   if(!actor.roles.includes('AI_GOVERNANCE_OFFICER')) throw new ForbiddenException('Responsible AI Officer role is required');
   const planId=jsonRecord(gate.task.formDataJson)['planId'],plan=typeof planId==='string'?await tx.aiTreatmentPlan.findFirst({where:{id:planId,responseId:gate.response!.id},include:{decision:true}}):null;
   if(!plan||plan.decision) throw new ConflictException('Unreviewed submitted plan is required');
   const snapshot=jsonRecord(plan.snapshot);
   const actual=gate.actions.map(action=>({id:action.id,actionRef:action.actionRef,title:action.title,targetDate:action.targetDate?.toISOString(),planData:action.planData}));
   if(!isDeepStrictEqual(snapshot['actions'],actual)) throw new ConflictException('Submitted plan action snapshot changed');
   const facts={planExecutorIds:gate.actions.map(action=>action.assignee?.userId).filter((id):id is string=>!!id),riskOwnerId:gate.risk.owner?.userId??undefined,useCaseOwnerId:gate.risk.useCase.owner?.userId??undefined,assessmentAssessorIds:[plan.submittedBy]};
   await this.authorization.enforceDuty(actor,'approve_plan',facts,id);await this.authorization.enforceDuty(actor,'adopt_assessment',facts,id);
   if(dto.decision==='approve') await this.validate(tx,gate);
   await this.evidence(tx,evidenceIds);
   const decision=await tx.aiTreatmentPlanDecision.create({data:{planId:plan.id,taskId,decision:dto.decision,actorId:userId,justification,evidenceIds,clientIp}});
   await tx.workflowTask.update({where:{id:taskId},data:{status:TaskStatus.completed,completedAt:new Date(),assigneeUserId:userId,decision:dto.decision==='approve'?TaskDecision.approved:TaskDecision.rejected,decisionComment:justification}});
   if(dto.decision==='return') await this.routing.createStageTask(tx,gate.risk.workflowCase!.id,PREPARE,new Date(),{templateCode:AIRS_TEMPLATE_CODE,assigneeUserId:gate.risk.owner!.userId!,formDataJson:{responseId:gate.response!.id,returnedPlanId:plan.id}});
   else for(const action of gate.actions) {
    const data=jsonRecord(action.planData), task=await this.routing.createStageTask(tx,gate.risk.workflowCase!.id,'airs-treatment',new Date(),{templateCode:AIRS_TEMPLATE_CODE,title:`${action.actionRef}: ${action.title}`,assigneeUserId:action.assignee!.userId!,assigneeRoleCode:data['executorRole'] as string,
     formDataJson:{actionId:action.id,actionRef:action.actionRef,planId:plan.id,planDecisionId:decision.id,planApproverId:userId,responseId:gate.response!.id,riskRef:gate.risk.riskRef,riskTitle:gate.risk.title,actionPlan:data as Prisma.InputJsonObject,executionAvailable:true,completionPct:0,slaAnchor:action.targetDate!.toISOString().slice(0,10),businessCalendar:'KSA'} as Prisma.InputJsonObject});
    // Date-only target is the KSA end of that date; it is never replaced by the stage's generic five-day deadline.
    await tx.workflowTask.update({where:{id:task.id},data:{type:data['taskType'] as string,dueDate:new Date(action.targetDate!.getTime()+21*3600000-1)}});
    await tx.aiTreatmentAction.update({where:{id:action.id},data:{workflowTaskId:task.id,version:{increment:1}}});
   }
   await this.commit(tx,id,gate.risk.workflowCase!.id,dto.expectedVersion,userId,`airs.treatment.plan.${dto.decision}`,{planId:plan.id,decisionId:decision.id,justification,evidenceIds,clientIp:clientIp??null});return {id,version:dto.expectedVersion+1};
  },options);
 }
 async execute(userId:string,id:string,actionId:string,dto:RecordTreatmentProgressDto,clientIp?:string) {
  const justification=text(dto.justification), evidenceIds=ids(dto.evidenceIds);
  if(!Number.isInteger(dto.completionPct)||dto.completionPct<0||dto.completionPct>100) throw new BadRequestException('Action progress must be an integer from 0 to 100');
  return this.prisma.$transaction(async tx=>{
   const actor=await this.authorization.authorize(userId,'airs.risk.assess',tx),gate=await this.gate(tx,userId,id),action=gate.actions.find(value=>value.id===actionId),task=action?.workflowTask;
   if(!action||!task||gate.risk.workflowCase?.status!=='under_review'||gate.response?.assessmentId!==gate.risk.assessments[0]?.id) throw new ConflictException('An action under the current adopted treatment plan is required');
   const data=jsonRecord(action.planData),taskData=jsonRecord(task.formDataJson),planId=taskData['planId'];
   const plan=typeof planId==='string'?await tx.aiTreatmentPlan.findFirst({where:{id:planId,responseId:action.responseId!},include:{decision:true}}):null;
   if(!plan||plan.decision?.decision!=='approve') throw new ConflictException('An approved treatment plan is required');
   await this.authorization.enforceDuty(actor,'execute_plan',{planApproverIds:[plan.decision.actorId]},id);
   if(task.caseId!==gate.risk.workflowCase.id||task.assigneeUserId!==userId||action.assignee?.userId!==userId||!action.assignee.isActive||action.assignee.deletedAt
    ||task.assigneeRoleCode!==data['executorRole']||!actor.roles.includes(data['executorRole'] as string)||!EXECUTORS.includes(data['executorRole'] as string)) throw new ForbiddenException('Only the active assigned executor with its original role can record progress');
   const stage=await tx.workflowTemplateStage.findFirst({where:{id:task.templateStageId??'',templateId:gate.risk.workflowCase.templateId!,code:'airs-treatment',isActive:true,template:{is:{code:AIRS_TEMPLATE_CODE,isActive:true,deletedAt:null}}}});
   const saved=(jsonRecord(plan.snapshot)['actions'] as Array<Record<string,unknown>>|undefined)?.find(value=>value['id']===actionId);
   if(!stage||taskData['actionId']!==actionId||taskData['responseId']!==action.responseId||taskData['planDecisionId']!==plan.decision.id||!saved
    ||saved['title']!==action.title||saved['targetDate']!==action.targetDate?.toISOString()||!isDeepStrictEqual(saved['planData'],action.planData)
    ||task.dueDate?.getTime()!==action.targetDate!.getTime()+21*3600000-1) throw new ConflictException('Action task or approved plan provenance changed');
   if(!['pending','in_progress'].includes(task.status)||action.progress[0]?.completionPct===100) throw new ConflictException('Completed action cannot be updated or replayed');
   if(gate.risk.version!==dto.expectedVersion) throw new ConflictException('AI risk changed; reload before progress');
   if(dto.completionPct===100&&['PREVENTIVE','CORRECTIVE'].includes(data['actionType'] as string)) {
    text(data['evidenceRequired']);if(!evidenceIds.length) throw new BadRequestException('Preventive and corrective completion requires execution evidence');
   }
   await this.evidence(tx,evidenceIds);
   const now=new Date(),completedAt=dto.completionPct===100?now:null;
   const progress=await tx.aiTreatmentProgress.create({data:{actionId,taskId:task.id,round:(action.progress[0]?.round??0)+1,completionPct:dto.completionPct,justification,evidenceIds,actorId:userId,completedAt}});
   await tx.workflowTask.update({where:{id:task.id},data:{status:completedAt?TaskStatus.completed:TaskStatus.in_progress,completedAt,formSubmittedAt:now,formSubmittedBy:userId,
    formDataJson:{...taskData,executionAvailable:!completedAt,completionPct:dto.completionPct,progressId:progress.id,evidenceIds,closureDate:completedAt?new Date(now.getTime()+3*3600000).toISOString().slice(0,10):null} as Prisma.InputJsonObject}});
   await tx.aiTreatmentAction.update({where:{id:actionId},data:{version:{increment:1}}});
   await this.commit(tx,id,gate.risk.workflowCase.id,dto.expectedVersion,userId,completedAt?'airs.treatment.action.completed':'airs.treatment.action.progress',{actionId,taskId:task.id,progressId:progress.id,completionPct:dto.completionPct,justification,evidenceIds,clientIp:clientIp??null});
   return {id,version:dto.expectedVersion+1,progressId:progress.id};
  },options);
 }
 private async commit(tx: Prisma.TransactionClient,id: string,caseId: string,version: number,actor: string,action: string,metadata: Record<string,unknown>) {
  if((await tx.aiRisk.updateMany({where:{id,version},data:{version:{increment:1}}})).count!==1) throw new ConflictException('AI risk changed; reload');
  await tx.workflowEvent.create({data:{caseId,actor,action}});await this.audit.logRequired({actor,action,entityType:'ai_risk',entityId:id,metadata},tx);
 }
}
