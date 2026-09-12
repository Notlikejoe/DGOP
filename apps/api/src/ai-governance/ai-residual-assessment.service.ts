import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService, riskSelect } from './ai-risk-intake.service';
import { AiRiskAssessmentService } from './ai-risk-assessment.service';
import { AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { CompleteResidualAssessmentDto, RiskDimensionScoreDto } from './ai-risk-assessment.dto';
import { computeInherentRisk, jsonRecord, RiskDimension, RiskScoringConfiguration, scoringConfigurationIssues } from './ai-risk-scoring';
const STAGE='airs-residual-assessment', REVIEW='airs-residual-adoption';
const options={isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000,maxWait:15000};
function justified(value:number,reason:string){if(!Number.isInteger(value)||value<1||value>4||typeof reason!=='string'||!reason.trim()||reason.length>5000)throw new BadRequestException('A justified 1–4 residual grade is required');}
export function residualPrerequisite(strategy:string,band:string,planned:number,completed:number):string|null {
 if(!['LOW','MEDIUM','HIGH','CRITICAL'].includes(band))return 'The adopted inherent band is invalid';
 if(['HIGH','CRITICAL'].includes(band)&&completed===0)return 'RM-24: inherent High/Critical requires a completed treatment action';
 if(['MITIGATE','TRANSFER'].includes(strategy)&&(planned===0||completed!==planned))return 'All approved treatment actions must complete before residual assessment';
 if(!['MITIGATE','TRANSFER','ACCEPT'].includes(strategy))return 'This response requires its separate avoidance/escalation path';
 return null;
}
@Injectable()
export class AiResidualAssessmentService {
 constructor(private readonly prisma:PrismaService,private readonly authorization:AiAuthorizationService,private readonly risks:AiRiskIntakeService,
  private readonly scoring:AiRiskAssessmentService,private readonly routing:AiWorkflowRoutingService,private readonly audit:AuditService){}
 private async gate(tx:Prisma.TransactionClient,userId:string,id:string){
  const access=await this.risks.visibility(userId,tx),risk=await tx.aiRisk.findFirst({where:{AND:[access.where,{id}]},select:riskSelect});
  if(!risk)throw new NotFoundException('AI risk not found');
  const inherent=risk.assessments[0],adopted=inherent?.decisions.some(d=>d.kind==='adoption'&&d.decision==='approve');
  const response=inherent?await tx.aiRiskResponse.findFirst({where:{riskId:id,assessmentId:inherent.id,decisions:{some:{kind:'officer',decision:'approve'}}},orderBy:{round:'desc'},include:{decisions:true}}):null;
  const plan=response?await tx.aiTreatmentPlan.findFirst({where:{responseId:response.id,decision:{is:{decision:'approve'}}},include:{decision:true},orderBy:{round:'desc'}}):null;
  const actions=response?await tx.aiTreatmentAction.findMany({where:{responseId:response.id,deletedAt:null},include:{workflowTask:{include:{templateStage:{select:{code:true,templateId:true,isActive:true}}}},progress:{orderBy:{round:'desc'},take:1}}}):[];
  let completed=0,integrity=true;
  for(const action of actions){
   const task=action.workflowTask,data=jsonRecord(task?.formDataJson),record=action.progress[0];
   const saved=(jsonRecord(plan?.snapshot)['actions'] as Array<Record<string,unknown>>|undefined)?.find(value=>value['id']===action.id);
   const actionData=jsonRecord(action.planData);
   const valid=!!plan&&!!task&&task.caseId===risk.workflowCase?.id&&task.templateStage?.code==='airs-treatment'&&task.templateStage.isActive&&task.templateStage.templateId===risk.workflowCase.templateId
    &&data['actionId']===action.id&&data['planId']===plan.id&&data['planDecisionId']===plan.decision!.id&&task.assigneeUserId===actionData['assigneeUserId']&&task.assigneeRoleCode===actionData['executorRole']
    &&saved?.['title']===action.title&&saved?.['targetDate']===action.targetDate?.toISOString()&&isDeepStrictEqual(saved?.['planData'],action.planData)&&task.dueDate?.getTime()===action.targetDate!.getTime()+21*3600000-1;
   integrity=integrity&&valid;
   if(valid&&record?.completionPct===100&&record.taskId===task!.id&&record.completedAt&&task!.status==='completed'&&task!.completedAt
    &&data['progressId']===record.id&&task!.formSubmittedBy===record.actorId&&record.actorId===actionData['assigneeUserId']&&record.actorId!==plan!.decision!.actorId){
    const evidence=record.evidenceIds as string[],required=['PREVENTIVE','CORRECTIVE'].includes(jsonRecord(action.planData)['actionType'] as string);
    if((required&&!evidence.length)||await tx.ndiEvidence.count({where:{id:{in:evidence},deletedAt:null}})!==evidence.length)integrity=false;else completed++;
   }
  }
  if(plan){const ids=jsonRecord(plan.snapshot)['actionIds'];if(!Array.isArray(ids)||ids.length!==actions.length||actions.some(a=>!ids.includes(a.id)))integrity=false;}
  const reason=response&&inherent?residualPrerequisite(response.strategyCode,jsonRecord(inherent.result)['bandCode'] as string,actions.length,completed):'An adopted inherent assessment and approved response are required';
  const tasks=risk.workflowCase?.templateId?await tx.workflowTask.findMany({where:{caseId:risk.workflowCase.id,templateStage:{is:{templateId:risk.workflowCase.templateId,code:STAGE,isActive:true,template:{is:{code:AIRS_TEMPLATE_CODE,isActive:true,deletedAt:null}}}}}}):[];
  const coordinators=tasks.filter(t=>(t.status===TaskStatus.pending||t.status===TaskStatus.in_progress)&&!jsonRecord(t.formDataJson)['dimension']&&jsonRecord(t.formDataJson)['responseId']===response?.id&&t.assigneeRoleCode==='AI_RISK_OWNER'&&t.assigneeUserId===risk.owner?.userId);
  const coordinator=coordinators.length===1?coordinators[0]:null;
  const rounds=await tx.aiAssessmentRound.findMany({where:{riskId:id,kind:'residual'},orderBy:{round:'desc'},take:20});
  const hasRound=rounds.some(round=>jsonRecord(round.inputs)['responseId']===response?.id);
  const acceptanceTasks=response?await tx.workflowTask.findMany({where:{caseId:risk.workflowCase!.id,status:TaskStatus.pending,templateStage:{code:'airs-acceptance-gate'}}}):[];
  const acceptance=response?.strategyCode!=='ACCEPT'||!!coordinator||hasRound||acceptanceTasks.filter(t=>jsonRecord(t.formDataJson)['responseId']===response.id).length===1;
  const ready=!!adopted&&!!response&&risk.workflowCase?.status==='under_review'&&!reason&&integrity&&acceptance&&(!['MITIGATE','TRANSFER'].includes(response.strategyCode)||!!plan);
  const ownerActive=!!await tx.person.findFirst({where:{id:risk.ownerPersonId??'',isActive:true,deletedAt:null},select:{id:true}});
  return {...access,risk,inherent,response,plan,actions,completed,reason:!integrity?'Treatment completion provenance/evidence is inconsistent':reason,ready,tasks,coordinator,rounds,hasRound,acceptanceTasks,ownerActive};
 }
 private owner(gate:Awaited<ReturnType<AiResidualAssessmentService['gate']>>){if(!gate.ownerActive||!gate.permissions.has('airs.risk.assess')||!gate.actor.roles.includes('AI_RISK_OWNER')||gate.actor.roles.includes('auditor')||gate.actor.id!==gate.risk.owner?.userId)throw new ForbiddenException('Only the active assigned Risk Owner coordinates residual assessment');}
 private version(gate:{ready:boolean;reason:string|null;risk:{version:number}},version:number){if(!gate.ready)throw new ConflictException(gate.reason??'Approved treatment prerequisites are required');if(gate.risk.version!==version)throw new ConflictException('AI risk changed; reload before residual scoring');}
 private async controls(tx:Prisma.TransactionClient){const now=new Date(),versions=await tx.governedReferenceVersion.findMany({where:{listCode:'R_CTRLEFF',state:'published',effectiveFrom:{lte:now},OR:[{effectiveTo:null},{effectiveTo:{gt:now}}]},include:{values:{orderBy:{sortOrder:'asc'}}},take:2});const v=versions.length===1?versions[0]:null;return {versionId:v?.id??'',values:v?.values.map(value=>({code:value.code,labelEn:value.labelEn,labelAr:value.labelAr}))??[]};}
 private async current(tx:Prisma.TransactionClient,config:RiskScoringConfiguration,controlsVersion:string,lock=false){
  if(!await this.scoring.referencesCurrent(tx,config,lock))return false;
  const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM governed_reference_versions WHERE id=${controlsVersion} AND "listCode"='R_CTRLEFF' AND state='published' AND "effectiveFrom"<=CURRENT_TIMESTAMP AND ("effectiveTo" IS NULL OR "effectiveTo">CURRENT_TIMESTAMP) FOR SHARE`;
  return rows.length===1;
 }
 async context(userId:string,id:string){return this.prisma.$transaction(async tx=>{
  const gate=await this.gate(tx,userId,id),data=jsonRecord(gate.coordinator?.formDataJson),pinned=data['configuration'] as RiskScoringConfiguration|undefined;
  const config=pinned?{...pinned,ready:!scoringConfigurationIssues(pinned).length,issues:scoringConfigurationIssues(pinned)}:await this.scoring.configuration(tx);
  const controls=pinned?data['controlReference'] as Awaited<ReturnType<AiResidualAssessmentService['controls']>>:await this.controls(tx);
  const current=!!pinned&&await this.current(tx,pinned,controls.versionId),owner=gate.ownerActive&&gate.actor.id===gate.risk.owner?.userId&&gate.actor.roles.includes('AI_RISK_OWNER')&&gate.permissions.has('airs.risk.assess')&&!gate.actor.roles.includes('auditor');
  const contributions=gate.coordinator?gate.tasks.filter(task=>jsonRecord(task.formDataJson)['coordinatorTaskId']===gate.coordinator!.id):[];
  return {version:gate.risk.version,eligible:!!gate.response,prerequisite:gate.reason,planned:gate.actions.length,completed:gate.completed,configuration:config,controlReference:controls,started:!!pinned,referencesCurrent:current,
   canStart:owner&&gate.ready&&!gate.coordinator&&!gate.hasRound&&config.ready&&!!controls.versionId&&!!controls.values.length,
   canRestart:owner&&gate.ready&&!!pinned&&!gate.hasRound,canComplete:owner&&gate.ready&&current&&contributions.length===8&&contributions.every(t=>t.status==='completed'),
   tasks:contributions.map(task=>{const data=jsonRecord(task.formDataJson),mapping=config.dimensions.find(value=>value.dimension===data['dimension']);return {id:task.id,dimension:data['dimension'],status:task.status,assessorRoleCode:task.assigneeRoleCode,score:data['score']??null,
    canContribute:gate.ready&&current&&gate.permissions.has('airs.risk.assess')&&!gate.actor.roles.includes('auditor')&&!!mapping&&task.status==='pending'&&gate.actor.roles.includes(mapping.assessorRoleCode)&&(!task.assigneeUserId||task.assigneeUserId===userId)&&(mapping.assessorRoleCode!=='AI_RISK_OWNER'||owner)};}),rounds:gate.rounds};
 },options);}
 async start(userId:string,id:string,expectedVersion:number,clientIp?:string,restart=false,justification=''){
  if(restart&&(!justification.trim()||justification.length>2000))throw new BadRequestException('Residual restart requires written justification');
  return this.prisma.$transaction(async tx=>{
   await this.authorization.authorize(userId,'airs.risk.assess',tx);const gate=await this.gate(tx,userId,id);this.owner(gate);this.version(gate,expectedVersion);
   if(gate.hasRound||(!restart&&gate.coordinator)||restart&&!jsonRecord(gate.coordinator?.formDataJson)['configuration'])throw new ConflictException('Residual assessment already started/scored or has no round to restart');
   const config=await this.scoring.configuration(tx),controls=await this.controls(tx);
   if(!config.ready||!controls.versionId||!controls.values.length)throw new BadRequestException('Published residual scoring/control-effectiveness configuration is required');
   if(!await this.current(tx,config,controls.versionId,true))throw new ConflictException('Residual references changed');
   const ownerId=gate.risk.useCase.owner?.userId;
   if(!ownerId)throw new BadRequestException('Use-Case Owner is required for fresh reputation assessment');
   const nominee=await this.authorization.authorize(ownerId,'airs.risk.assess',tx),person=await tx.person.findFirst({where:{userId:ownerId,isActive:true,deletedAt:null}});
   if(!person||!nominee.roles.includes('AI_USECASE_OWNER'))throw new BadRequestException('Use-Case Owner is not eligible');
   const visible=await this.risks.visibility(ownerId,tx);if(!await tx.aiRisk.findFirst({where:{AND:[visible.where,{id}]},select:{id:true}}))throw new ForbiddenException('Use-Case Owner must have scope to this risk');
   if(restart)await tx.workflowTask.updateMany({where:{id:{in:[gate.coordinator!.id,...gate.tasks.filter(t=>jsonRecord(t.formDataJson)['coordinatorTaskId']===gate.coordinator!.id).map(t=>t.id)]},status:{in:[TaskStatus.pending,TaskStatus.in_progress]}},data:{status:TaskStatus.cancelled}});
   const previous=await tx.aiAssessmentRound.aggregate({where:{riskId:id,kind:'residual'},_max:{round:true}}),round=(previous._max.round??0)+1;
   const task=await this.routing.createStageTask(tx,gate.risk.workflowCase!.id,STAGE,new Date(),{templateCode:AIRS_TEMPLATE_CODE,assigneeUserId:userId,assigneeRoleCode:'AI_RISK_OWNER',formDataJson:{responseId:gate.response!.id,inherentAssessmentId:gate.inherent!.id,planId:gate.plan?.id??null,configuration:config,controlReference:controls,assessmentRound:round,restartedFromTaskId:restart?gate.coordinator!.id:null,completedActionIds:gate.actions.filter(a=>a.progress[0]?.completionPct===100).map(a=>a.id)} as Prisma.InputJsonObject});
   if(!restart)for(const old of gate.acceptanceTasks.filter(t=>jsonRecord(t.formDataJson)['responseId']===gate.response!.id))await tx.workflowTask.update({where:{id:old.id},data:{status:TaskStatus.completed,completedAt:new Date()}});
   for(const mapping of config.dimensions)await this.routing.createStageTask(tx,gate.risk.workflowCase!.id,STAGE,new Date(),{templateCode:AIRS_TEMPLATE_CODE,title:`Residual: ${mapping.labelEn} / ${mapping.labelAr}`,assigneeRoleCode:mapping.assessorRoleCode,assigneeUserId:mapping.assessorRoleCode==='AI_RISK_OWNER'?userId:mapping.assessorRoleCode==='AI_USECASE_OWNER'?ownerId:undefined,formDataJson:{responseId:gate.response!.id,coordinatorTaskId:task.id,dimension:mapping.dimension,assessmentRound:round}});
   await this.commit(tx,gate.risk,expectedVersion,userId,restart?'airs.residual.restarted':'airs.residual.started',{coordinatorTaskId:task.id,referenceVersions:config.referenceVersions,controlVersionId:controls.versionId,justification:restart?justification.trim():null,clientIp:clientIp??null});return {id,version:expectedVersion+1};
  },options);
 }
 private async writable(tx:Prisma.TransactionClient,userId:string,id:string,version:number){
  const actor=await this.authorization.authorize(userId,'airs.risk.assess',tx),gate=await this.gate(tx,userId,id);this.version(gate,version);
  const config=jsonRecord(gate.coordinator?.formDataJson)['configuration'] as RiskScoringConfiguration|undefined,controls=jsonRecord(gate.coordinator?.formDataJson)['controlReference'] as Awaited<ReturnType<AiResidualAssessmentService['controls']>>;
  const provenance=jsonRecord(gate.coordinator?.formDataJson);
  if(!gate.coordinator||provenance['inherentAssessmentId']!==gate.inherent?.id||provenance['planId']!==(gate.plan?.id??null)||gate.hasRound||!config||scoringConfigurationIssues(config).length||!controls||!await this.current(tx,config,controls.versionId,true))throw new ConflictException('A current pinned residual coordinator is required; restart changed references');
  return {...gate,actor,config,controls};
 }
 async contribute(userId:string,id:string,taskId:string,dto:RiskDimensionScoreDto,clientIp?:string){justified(dto.value,dto.justification);return this.prisma.$transaction(async tx=>{
  const gate=await this.writable(tx,userId,id,dto.expectedVersion),task=gate.tasks.find(t=>t.id===taskId&&jsonRecord(t.formDataJson)['coordinatorTaskId']===gate.coordinator!.id),mapping=gate.config.dimensions.find(m=>m.dimension===jsonRecord(task?.formDataJson)['dimension']);
  if(!task||task.status!=='pending'||!mapping||task.assigneeRoleCode!==mapping.assessorRoleCode)throw new ConflictException('Active residual dimension task is required');
  if(!gate.actor.roles.includes(mapping.assessorRoleCode)||task.assigneeUserId&&task.assigneeUserId!==userId||mapping.assessorRoleCode==='AI_RISK_OWNER'&&gate.risk.owner?.userId!==userId)throw new ForbiddenException('Only the competent assigned residual assessor can contribute');
  await tx.workflowTask.update({where:{id:taskId},data:{status:TaskStatus.completed,assigneeUserId:userId,completedAt:new Date(),formSubmittedAt:new Date(),formSubmittedBy:userId,formDataJson:{...jsonRecord(task.formDataJson),score:{value:dto.value,justification:dto.justification.trim()},assessedBy:userId,assessedRoleCode:mapping.assessorRoleCode} as Prisma.InputJsonObject}});
  await this.commit(tx,gate.risk,dto.expectedVersion,userId,'airs.residual.dimension.scored',{taskId,dimension:mapping.dimension,value:dto.value,justification:dto.justification.trim(),clientIp:clientIp??null});return {id,version:dto.expectedVersion+1};
 },options);}
 async complete(userId:string,id:string,dto:CompleteResidualAssessmentDto,clientIp?:string){justified(dto.likelihood,dto.justification);if(typeof dto.currentControls!=='string'||!dto.currentControls.trim()||dto.currentControls.length>5000)throw new BadRequestException('Current post-treatment controls are required');return this.prisma.$transaction(async tx=>{
  const gate=await this.writable(tx,userId,id,dto.expectedVersion);this.owner(gate);
  const choice=gate.controls.values.find(v=>v.code===dto.controlEffectivenessCode);if(!choice)throw new BadRequestException('A published control-effectiveness choice is required');
  const tasks=gate.tasks.filter(t=>jsonRecord(t.formDataJson)['coordinatorTaskId']===gate.coordinator!.id);if(tasks.length!==8||tasks.some(t=>t.status!=='completed'))throw new BadRequestException('All eight fresh residual dimension assessments must complete');
  const dimensions=tasks.map(task=>{const data=jsonRecord(task.formDataJson),score=jsonRecord(data['score']),mapping=gate.config.dimensions.find(m=>m.dimension===data['dimension']);
   if(!mapping||task.assigneeRoleCode!==mapping.assessorRoleCode||data['assessedRoleCode']!==mapping.assessorRoleCode||!task.formSubmittedBy||task.formSubmittedBy!==task.assigneeUserId||data['assessedBy']!==task.formSubmittedBy)throw new ConflictException('Residual dimension provenance is inconsistent');justified(score['value'] as number,score['justification'] as string);
   return {dimension:mapping.dimension as RiskDimension,value:score['value'] as number,justification:score['justification'] as string,assessedBy:task.formSubmittedBy,assessedRoleCode:mapping.assessorRoleCode,taskId:task.id};});
  const computed=computeInherentRisk(dto.likelihood,dimensions,gate.config),inherentScore=jsonRecord(gate.inherent!.result)['score'] as number;
  const result={...computed,riskReductionPct:(inherentScore-computed.score)/inherentScore*100,adopted:false,riskAccepted:false};
  const data=jsonRecord(gate.coordinator!.formDataJson),round=data['assessmentRound'] as number;if(!Number.isInteger(round)||round<1)throw new ConflictException('Residual round number is missing');
  const assessment=await tx.aiAssessmentRound.create({data:{riskId:id,useCaseId:gate.risk.useCase.id,kind:'residual',round,engineVersion:'airs-residual-max8-v1',ruleReferenceVersionId:gate.config.referenceVersions.R_LEVEL,createdBy:userId,
   inputs:{responseId:gate.response!.id,inherentAssessmentId:gate.inherent!.id,planId:gate.plan?.id??null,coordinatorTaskId:gate.coordinator!.id,configuration:gate.config,likelihood:{value:dto.likelihood,justification:dto.justification.trim(),assessedBy:userId},dimensions,currentControls:dto.currentControls.trim(),controlEffectiveness:{...choice,referenceVersionId:gate.controls.versionId},completedProgressIds:gate.actions.map(a=>a.progress[0]?.id).filter(Boolean)} as Prisma.InputJsonObject,result:result as Prisma.InputJsonObject}});
  await tx.workflowTask.update({where:{id:gate.coordinator!.id},data:{status:TaskStatus.completed,completedAt:new Date(),formSubmittedAt:new Date(),formSubmittedBy:userId,formDataJson:{...data,assessmentId:assessment.id} as Prisma.InputJsonObject}});
  const review=await this.routing.createStageTask(tx,gate.risk.workflowCase!.id,REVIEW,new Date(),{templateCode:AIRS_TEMPLATE_CODE,formDataJson:{assessmentId:assessment.id,responseId:gate.response!.id,inherentAssessmentId:gate.inherent!.id,residualBand:computed.bandCode,riskAccepted:false,authorityDecisionPending:true}});
  await this.commit(tx,gate.risk,dto.expectedVersion,userId,'airs.residual.scored',{assessmentId:assessment.id,round,result,reviewTaskId:review.id,clientIp:clientIp??null});return {id,version:dto.expectedVersion+1,assessmentId:assessment.id,result};
 },options);}
 private async commit(tx:Prisma.TransactionClient,risk:Prisma.AiRiskGetPayload<{select:typeof riskSelect}>,version:number,actor:string,action:string,metadata:Record<string,unknown>){if((await tx.aiRisk.updateMany({where:{id:risk.id,version},data:{version:{increment:1}}})).count!==1)throw new ConflictException('AI risk changed; reload');await tx.workflowEvent.create({data:{caseId:risk.workflowCase!.id,actor,action}});await this.audit.logRequired({actor,action,entityType:'ai_risk',entityId:risk.id,metadata},tx);}
}
