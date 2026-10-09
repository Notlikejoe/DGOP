import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import { toPaged } from '../common/pagination';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiIntakeService } from './ai-intake.service';
import { AiClassificationService } from './ai-classification.service';
import { AiRiskAssessmentService } from './ai-risk-assessment.service';
import { AiWorkflowRoutingService,AIUC_STAGE,AIRS_STAGE,AIRS_TEMPLATE_CODE } from './ai-workflow-routing.service';
import { AiIdentifiersService } from './ai-identifiers.service';
import { governanceDigest,governanceText,governanceTransaction } from './ai-governance-ledger';
import { AiPermission,splitAiPermission } from './ai-permissions';
import { AiReviewQueryDto,aiReviewParams } from './ai-review-query.dto';
import { AI_CLASSIFICATION_CRITERIA,assertCalculationInputV1 } from './ai-governance.contracts';
import { computeInherentRisk,jsonRecord,RiskDimension,RiskScoringConfiguration } from './ai-risk-scoring';
import { lifecycleTransition,lifecycleTier,independentLifecycleActor,operationalUseAllowed } from './ai-lifecycle.logic';
import { ProposeAiLifecycleDto,AssessAiLifecycleDto,DecideAiLifecycleDto } from './ai-lifecycle.dto';
const open=['assessment','review','authority','confirmation'];
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const ucInclude={owner:true,asset:{include:{classification:true}},effectiveConfiguration:true,
 intakeRevisions:{orderBy:{revision:'desc' as const},take:1},assessments:{where:{kind:'classification' as const},orderBy:{round:'desc' as const},take:1},
 risks:{where:{deletedAt:null,isSampleData:false},orderBy:{id:'asc' as const},include:{owner:true,assessments:{where:{kind:{in:['inherent' as const,'residual' as const]}},orderBy:{createdAt:'desc' as const},take:1}}},obligations:{where:{deletedAt:null},orderBy:{id:'asc' as const}}} satisfies Prisma.AiUseCaseInclude;
type Uc=Prisma.AiUseCaseGetPayload<{include:typeof ucInclude}>;
const purpose=(role:string):AiPermission=>role==='data_owner'?'aiuc.asset.approve':role==='AI_WORKING_GROUP'?'aiuc.classify.assess':
 ['AI_EXECUTIVE_TEAM','STEERING_COMMITTEE','AI_GOVERNANCE_OFFICER'].includes(role)?'case.approve.aiuc':role==='AI_ETHICS_COMMITTEE'?'case.view.aiuc.org':'airs.risk.assess';
@Injectable()
export class AiLifecycleService {
 constructor(private readonly db:PrismaService,private readonly authorization:AiAuthorizationService,private readonly intake:AiIntakeService,
 private readonly classification:AiClassificationService,private readonly riskAssessment:AiRiskAssessmentService,private readonly routing:AiWorkflowRoutingService,
 private readonly ids:AiIdentifiersService,private readonly audit:AuditService){}
 private async current(tx:Prisma.TransactionClient,id:string){
  const uc=await tx.aiUseCase.findFirst({where:{id,deletedAt:null,isSampleData:false,assetId:{not:null}},include:ucInclude});
  if(!uc?.asset||uc.asset.deletedAt)throw new NotFoundException('Registered AI use case not found');return uc;
 }
 private pins(uc:Uc){return {asset:{id:uc.asset!.id,updatedAt:uc.asset!.updatedAt.toISOString()},ownerPersonId:uc.ownerPersonId,
  risks:uc.risks.map(r=>({id:r.id,version:r.version,ownerPersonId:r.ownerPersonId})),obligations:uc.obligations.map(o=>({id:o.id,version:o.version,operationalState:o.operationalState}))};}
 private baseline(uc:Uc){const assessment=uc.assessments[0],result=jsonRecord(assessment?.result),payload=uc.intakeRevisions[0]?.payload;
  if(!payload||!uc.owner?.userId||!uc.owner.isActive||uc.owner.deletedAt||!result['approvedTierCode'])throw new ConflictException('Registered intake, active ownership and classification history are required');
  return {payload,tierCode:String(result['approvedTierCode']),referencePins:jsonRecord(result['referenceVersions']),assessmentSnapshot:{...assessment,assurance:'historical_proof_review_needed'},riskSnapshot:json(this.pins(uc).risks),obligationSnapshot:json(uc.obligations)};
 }
 private async nominee(tx:Prisma.TransactionClient,uc:Uc,role:string,id:unknown){
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/iu.test(id))throw new ConflictException('Name an eligible '+role+' assignee');
  const actor=await this.authorization.authorizeBusiness(id,purpose(role),tx,uc.id);
  if(!actor.roles.includes(role)||!await tx.person.findFirst({where:{userId:id,isActive:true,deletedAt:null},select:{id:true}}))throw new ForbiddenException('The named '+role+' assignee lacks an active role, scope or directory profile');return id;
 }
 private async task(tx:Prisma.TransactionClient,uc:Uc,requestId:string,caseId:string,kind:string,role:string,assignments:Record<string,unknown>,extra:Record<string,unknown>={}){
  const id=role==='data_owner'?jsonRecord(uc.intakeRevisions[0].payload)['data_owner']:role==='AI_USECASE_OWNER'?uc.owner?.userId:assignments[role];
  const assigneeUserId=await this.nominee(tx,uc,role,id);
  return this.routing.createStageTask(tx,caseId,['classification','verification'].includes(kind)?AIUC_STAGE.classification:kind==='authority'?AIUC_STAGE.decision:kind==='confirmation'?AIUC_STAGE.assetApproval:
   kind==='privacy'?AIUC_STAGE.privacy:kind==='security'?AIUC_STAGE.security:kind==='ethics'?AIUC_STAGE.ethics:AIRS_STAGE.inherent,new Date(),{
    ...(kind==='dimension'||kind==='likelihood'?{templateCode:AIRS_TEMPLATE_CODE}:{}),title:'Registered AI lifecycle: '+kind+(extra['dimension']?' / '+extra['dimension']:''),assigneeRoleCode:role,assigneeUserId,
    formDataJson:json({lifecycleRequestId:requestId,kind,...extra}) as Prisma.InputJsonObject });
 }
 async context(userId:string,id:string,query:AiReviewQueryDto=new AiReviewQueryDto()){
  await this.intake.getVisible(userId,id);const p=aiReviewParams(query);
  return this.db.$transaction(async tx=>{const uc=await this.current(tx,id),actor=await this.authorization.authorizeAny(userId,['case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all'],tx);
   const where={useCaseId:id,...(query.search?{justification:{contains:query.search,mode:'insensitive' as const}}:{})};
   const [rows,total]=await Promise.all([tx.aiLifecycleRequest.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:p.skip,take:p.take,include:{decisions:{orderBy:{createdAt:'asc'}},workflowCase:{include:{tasks:{orderBy:{createdAt:'asc'}}}}}}),tx.aiLifecycleRequest.count({where})]);
   const businessRoles=actor.roles.filter(role=>role!=='system_admin'&&role!=='auditor');
   const [pending,completed,grants]=await Promise.all([tx.aiLifecycleRequest.count({where:{useCaseId:id,status:{in:open}}}),tx.aiLifecycleRequest.count({where:{useCaseId:id,status:'applied'}}),tx.rolePermission.findMany({where:{role:{code:{in:businessRoles},isActive:true,deletedAt:null}},select:{role:{select:{code:true}},permission:{select:{resource:true,action:true}}}})]);
   const holds=(role:string,permission:string)=>grants.some(g=>g.role.code===role&&g.permission.resource+'.'+g.permission.action===permission);
   const canPropose=pending===0&&uc.lifecycleState!=='retired'&&(actor.administratorOverride||businessRoles.some(role=>holds(role,'case.create.aiuc'))&&!actor.roles.includes('auditor')&&(uc.requesterUserId===userId||uc.owner?.userId===userId||actor.roles.some(r=>['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER'].includes(r))));
   const data=rows.map(r=>{const contributors=r.workflowCase.tasks.filter(t=>['classification','dimension','likelihood'].includes(String(jsonRecord(t.formDataJson)['kind']))).map(t=>t.formSubmittedBy).filter((id):id is string=>!!id);return {...r,canWithdraw:open.includes(r.status)&&(actor.administratorOverride||[r.proposerId,uc.owner?.userId].includes(userId)),proposedUseAllowed:false,tasks:r.workflowCase.tasks.map(t=>{const kind=String(jsonRecord(t.formDataJson)['kind']),role=t.assigneeRoleCode??'',final=['verification','privacy','security','ethics','authority','confirmation'].includes(kind);return {...t,canAct:open.includes(r.status)&&t.status==='pending'&&(actor.administratorOverride||t.assigneeUserId===userId&&!actor.roles.includes('auditor')&&businessRoles.includes(role)&&holds(role,purpose(role))&&(!final||independentLifecycleActor(userId,uc.requesterUserId,uc.owner?.userId??null,r.proposerId,['verification','authority','confirmation'].includes(kind)?contributors:[],kind==='confirmation'?r.authorityActorId??undefined:undefined)))};})};});
   return {...toPaged(data,total,p),summary:{pending,completed},
    useCaseId:id,useCaseVersion:uc.version,state:uc.lifecycleState,effectiveUseAllowed:operationalUseAllowed(uc.lifecycleState,uc.operationalStatusCode),canPropose,
    effective:uc.effectiveConfiguration??{...this.baseline(uc),origin:'legacy_registration_review_needed'},baselineAssurance:uc.effectiveConfiguration?.sourceRequestId?'approved_snapshot':'review_needed'};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 async nominees(userId:string,id:string,query:AiReviewQueryDto=new AiReviewQueryDto()){
  const context=await this.context(userId,id);if(!context.canPropose)throw new ForbiddenException('Lifecycle nominations require scoped proposal access');
  const roles=['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER','AI_EXECUTIVE_TEAM','STEERING_COMMITTEE','AI_ETHICS_COMMITTEE','privacy_officer','security_reviewer','AI_MODEL_OWNER','AI_MLOPS_LEAD','business_steward'];
  const uc=await this.current(this.db,id),eligible:string[]=[];
  for(const role of roles){const scope=await new ScopeService(this.db).resolve([role]);if((scope.orgUnits==='all'||!!uc.organizationUnitId&&scope.orgUnits.includes(uc.organizationUnitId))&&(scope.domains==='all'||!!uc.asset!.domainId&&scope.domains.includes(uc.asset!.domainId))&&(scope.maxClassRank===null||!!uc.asset!.classification&&uc.asset!.classification.rank<=scope.maxClassRank))eligible.push(role);}
  const p=aiReviewParams(query),where:Prisma.UserWhereInput={isActive:true,person:{is:{isActive:true,deletedAt:null}},userRoles:{some:{role:{is:{isActive:true,deletedAt:null,OR:eligible.map(code=>({code,permissions:{some:{permission:splitAiPermission(purpose(code))}}}))}}},none:{role:{code:'auditor',isActive:true,deletedAt:null}}},...(query.search?{person:{is:{isActive:true,deletedAt:null,OR:[{fullNameEn:{contains:query.search,mode:'insensitive'}},{fullNameAr:{contains:query.search,mode:'insensitive'}}]}}}:{})};
  const [users,total]=await Promise.all([this.db.user.findMany({where,select:{id:true,person:{select:{fullNameEn:true,fullNameAr:true}},userRoles:{where:{role:{is:{code:{in:eligible},isActive:true,deletedAt:null}}},select:{role:{select:{code:true}}}}},orderBy:{id:'asc'},skip:p.skip,take:p.take}),this.db.user.count({where})]);
  return {...toPaged(users.map(u=>({id:u.id,nameEn:u.person!.fullNameEn,nameAr:u.person!.fullNameAr,roles:u.userRoles.map(r=>r.role.code)})),total,p),roles:eligible,summary:{total}};
 }
 async propose(userId:string,id:string,dto:ProposeAiLifecycleDto){
  const justification=governanceText(dto.justification);
  return governanceTransaction(this.db,async tx=>{const actor=await this.authorization.authorizeBusiness(userId,'case.create.aiuc',tx,id),uc=await this.current(tx,id);
   if(uc.version!==dto.expectedVersion)throw new ConflictException('AI use case changed; reload');
   if(!actor.administratorOverride&&![uc.requesterUserId,uc.owner?.userId].includes(userId)&&!actor.roles.some(r=>['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER'].includes(r)))throw new ForbiddenException('Only its requester, owner or scoped governance staff may propose lifecycle work');
   try{lifecycleTransition(uc.lifecycleState,dto.action);}catch(e){throw new ConflictException((e as Error).message);}
   if(await tx.aiLifecycleRequest.count({where:{useCaseId:id,status:{in:open}}}))throw new ConflictException('Complete or return the existing lifecycle request first');
   if(!dto.assignments||Object.keys(dto.assignments).length>15)throw new BadRequestException('Provide bounded named assignments');
   const baseline=uc.effectiveConfiguration??await tx.aiEffectiveConfiguration.create({data:{useCaseId:id,sequence:1,...this.baseline(uc),createdBy:'system:registered-history',payload:json(this.baseline(uc).payload),referencePins:json(this.baseline(uc).referencePins),assessmentSnapshot:json(this.baseline(uc).assessmentSnapshot)}});
   const prior=jsonRecord(baseline.payload),changes=dto.changes??{};
   if(dto.action!=='change'&&Object.keys(changes).length)throw new BadRequestException('Configuration changes belong only to a change request');
   if(['requester','proposed_owner','data_owner','request_date'].some(k=>k in changes&&changes[k]!==prior[k]))throw new BadRequestException('Directory ownership handover requires its separate governance workflow');
   const payload={...prior,...changes};if(dto.action==='change'&&governanceDigest(payload)===governanceDigest(prior))throw new BadRequestException('The change must alter the configuration');
   const validated=await this.intake.validateLifecycleConfiguration(tx,payload,uc.requesterUserId);
   const dataOwner=String(prior['data_owner']??'');await this.nominee(tx,uc,'data_owner',dataOwner);
   if(!actor.administratorOverride&&!independentLifecycleActor(dataOwner,uc.requesterUserId,uc.owner?.userId??null,userId))throw new ForbiddenException('The Data Owner must be independent of the lifecycle proposal');
   if(!uc.asset!.isActive)throw new ConflictException('Restore the governed asset through its native workflow before lifecycle changes');
   const classVersion=await tx.governedReferenceVersion.findUniqueOrThrow({where:{id:validated.references.versionPins['L_CLASS']},include:{values:true}});
   const classCode=jsonRecord(classVersion.values.find(v=>v.code===payload['data_classification'])?.metadata)['assetClassificationCode'];
   const mapped=await tx.classification.findFirst({where:{code:String(classCode??''),isActive:true,deletedAt:null}});
   if(!mapped||!uc.asset!.classification||mapped.rank>uc.asset!.classification.rank)throw new ConflictException('The proposed data requires a stronger asset classification; approve that asset change first');
   const template=await this.routing.binding(tx),year=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Riyadh',year:'numeric'}).format(new Date()));
   const wf=await tx.workflowCase.create({data:{code:await this.ids.nextCaseCode(tx,'AIUC',year),type:'AIUC',title:'Registered lifecycle: '+dto.action+' / '+uc.name,assetId:uc.assetId,createdBy:userId,status:'under_review',templateId:template.id,templateVersion:template.designerVersion}});
   const needsAssessment=['change','resume'].includes(dto.action);
   const currentTier=lifecycleTier(baseline.tierCode,baseline.tierCode,[...uc.risks.map(r=>String(jsonRecord(r.assessments[0]?.result)['severityCode']??'')),...(uc.operationalStatusCode==='SUSPENDED'?['P1']:[])]);
   const request=await tx.aiLifecycleRequest.create({data:{useCaseId:id,workflowCaseId:wf.id,action:dto.action,status:needsAssessment?'assessment':'authority',baseVersion:uc.version+1,baseConfigurationId:baseline.id,
    proposedPayload:json(payload),assignments:json(dto.assignments),sourceSnapshot:json({...this.pins(uc),referencePins:validated.references.versionPins,facts:validated.facts}),authorityTier:currentTier,proposerId:userId,justification}});
   if(needsAssessment){const c=await this.classification.lifecycleConfiguration(tx),riskConfig=await this.riskAssessment.configuration(tx);if(!c.ready||!riskConfig.ready)throw new ConflictException('Published classification and risk methodology must be complete');
    await this.task(tx,uc,request.id,wf.id,'classification','AI_WORKING_GROUP',dto.assignments,{configuration:c});
    for(const r of uc.risks){const assignment={...dto.assignments,AI_RISK_OWNER:r.owner?.userId};
     await this.task(tx,uc,request.id,wf.id,'likelihood','AI_RISK_OWNER',assignment,{riskId:r.id,configuration:riskConfig});
     for(const d of riskConfig.dimensions)await this.task(tx,uc,request.id,wf.id,'dimension',d.assessorRoleCode,assignment,{riskId:r.id,dimension:d.dimension,configuration:riskConfig});
    }
   }else await this.openAuthority(tx,uc,request.id,wf.id,currentTier,dto.assignments);
   if((await tx.aiUseCase.updateMany({where:{id,version:uc.version},data:{version:{increment:1},effectiveConfigurationId:baseline.id}})).count!==1)throw new ConflictException('Concurrent lifecycle proposal; reload');
   await this.event(tx,request.id,wf.id,userId,'proposed',{action:dto.action,justification,baseVersion:uc.version,proposedDigest:governanceDigest(payload)});
   return {id:request.id,useCaseId:id,version:1,useCaseVersion:uc.version+1};
  });
 }
 private async gate(tx:Prisma.TransactionClient,userId:string,id:string,version:number,taskId:string){
  await tx.$queryRaw`SELECT id FROM ai_lifecycle_requests WHERE id=${id} FOR UPDATE`;
  const r=await tx.aiLifecycleRequest.findUnique({where:{id}});if(!r)throw new NotFoundException('Lifecycle request not found');
  const uc=await this.current(tx,r.useCaseId);
  if(r.version!==version||!open.includes(r.status)||uc.version!==r.baseVersion||uc.effectiveConfigurationId!==r.baseConfigurationId)throw new ConflictException('Lifecycle request or effective configuration changed; reload');
  if(governanceDigest(this.pins(uc))!==governanceDigest({...jsonRecord(r.sourceSnapshot),referencePins:undefined,facts:undefined})){
   const s=jsonRecord(r.sourceSnapshot);if(governanceDigest(this.pins(uc))!==governanceDigest({asset:s['asset'],ownerPersonId:s['ownerPersonId'],risks:s['risks'],obligations:s['obligations']}))throw new ConflictException('Asset, risk, ownership or obligations changed; return this request and reassess');
  }
  const actor=await this.authorization.authorizeAny(userId,['case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all'],tx);
  const task=await tx.workflowTask.findFirst({where:{id:taskId,caseId:r.workflowCaseId,status:'pending',...(actor.administratorOverride?{}:{assigneeUserId:userId})}});
  if(!task||jsonRecord(task.formDataJson)['lifecycleRequestId']!==id)throw new ForbiddenException('Act only on your named active lifecycle task');
  const role=task.assigneeRoleCode!;if(!actor.administratorOverride)await this.nominee(tx,uc,role,userId);
  const pins=jsonRecord(r.sourceSnapshot)['referencePins'];const referenceIds=Object.values(jsonRecord(pins));
  await this.currentReferences(tx,referenceIds as string[]);
  return {r,uc,task,role,actor,form:jsonRecord(task.formDataJson)};
 }
 private async currentReferences(tx:Prisma.TransactionClient,ids:string[]){if(!ids.length)throw new ConflictException('Pinned reference provenance is required');const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM governed_reference_versions WHERE id IN (${Prisma.join(ids)}) AND state='published' AND "effectiveFrom"<=CURRENT_TIMESTAMP AND ("effectiveTo" IS NULL OR "effectiveTo">CURRENT_TIMESTAMP) FOR SHARE`;if(rows.length!==new Set(ids).size)throw new ConflictException('Pinned references changed; return this lifecycle request and reassess');}
 async assess(userId:string,id:string,taskId:string,dto:AssessAiLifecycleDto){const justification=governanceText(dto.justification);
  return governanceTransaction(this.db,async tx=>{const g=await this.gate(tx,userId,id,dto.expectedVersion,taskId),kind=String(g.form['kind']);if(g.r.status!=='assessment'||!['classification','dimension','likelihood'].includes(kind))throw new ConflictException('This task is not awaiting assessment');
   let contribution:unknown;if(kind==='classification'){try{assertCalculationInputV1(dto.input);}catch(e){throw new BadRequestException((e as Error).message);}if(dto.input!.kind!=='classification')throw new BadRequestException('Six-criterion classification is required');contribution=dto.input;const c=jsonRecord(g.form['configuration']);await this.currentReferences(tx,[String(c['scoreVersionId']),String(c['tierVersionId'])]);}
   else {if(!Number.isInteger(dto.score)||dto.score!<1||dto.score!>4)throw new BadRequestException('A justified score from 1 to 4 is required');contribution={score:dto.score,justification};await this.currentReferences(tx,Object.values((g.form['configuration'] as RiskScoringConfiguration).referenceVersions));}
   await tx.workflowTask.update({where:{id:taskId},data:{status:'completed',completedAt:new Date(),formSubmittedAt:new Date(),formSubmittedBy:userId,decisionComment:justification,formDataJson:json({...g.form,contribution})}});
   await tx.aiLifecycleRequest.update({where:{id},data:{version:{increment:1}}});
   await this.event(tx,id,g.r.workflowCaseId,userId,'assessment.recorded',{taskId,kind,justification});
   if(!await tx.workflowTask.count({where:{caseId:g.r.workflowCaseId,status:'pending'}}))await this.finishAssessment(tx,g.uc,g.r);
   return {id,version:dto.expectedVersion+1};
  });
 }
 private async finishAssessment(tx:Prisma.TransactionClient,uc:Uc,r:Prisma.AiLifecycleRequestGetPayload<{}>){
  const tasks=await tx.workflowTask.findMany({where:{caseId:r.workflowCaseId,status:'completed'}}),classification=tasks.find(t=>jsonRecord(t.formDataJson)['kind']==='classification')!;
  const cf=jsonRecord(classification.formDataJson),config=cf['configuration'] as Awaited<ReturnType<AiClassificationService['lifecycleConfiguration']>>,input=jsonRecord(cf['contribution']);
  const scores=input['scores'] as {value:number;justification:string}[],max=Math.max(...scores.map(s=>s.value)),tier=config.tiers.find(t=>t.automatic&&max>=t.minScore!&&max<=t.maxScore!);if(!tier)throw new ConflictException('Pinned tier bands cannot resolve this assessment');
  const riskSnapshot=uc.risks.map(risk=>{const dimensions=tasks.filter(t=>jsonRecord(t.formDataJson)['riskId']===risk.id&&jsonRecord(t.formDataJson)['kind']==='dimension'),likelihood=tasks.find(t=>jsonRecord(t.formDataJson)['riskId']===risk.id&&jsonRecord(t.formDataJson)['kind']==='likelihood')!;
   const l=jsonRecord(likelihood.formDataJson),riskConfig=l['configuration'] as RiskScoringConfiguration;
   const contributions=dimensions.map(t=>{const f=jsonRecord(t.formDataJson),c=jsonRecord(f['contribution']);return {dimension:f['dimension'] as RiskDimension,value:Number(c['score']),justification:String(c['justification'])};});
   return {riskId:risk.id,version:risk.version,configurationDigest:governanceDigest(r.proposedPayload),...computeInherentRisk(Number(jsonRecord(l['contribution'])['score']),contributions,riskConfig),contributors:dimensions.map(t=>({taskId:t.id,actorId:t.formSubmittedBy,role:t.assigneeRoleCode})),likelihoodTaskId:likelihood.id};});
  const authorityTier=lifecycleTier(r.authorityTier,tier.code,riskSnapshot.map(s=>s.severityCode)),snapshot={configurationDigest:governanceDigest(r.proposedPayload),scoreMax:max,tierCode:tier.code,criteria:AI_CLASSIFICATION_CRITERIA.map((criterion,i)=>({criterion,...scores[i]})),referenceVersions:{R_SDAIA_SCORE:config.scoreVersionId,R_SDAIA_TIER:config.tierVersionId},taskId:classification.id,actorId:classification.formSubmittedBy};
  await tx.aiLifecycleRequest.update({where:{id:r.id},data:{assessmentSnapshot:json(snapshot),riskSnapshot:json(riskSnapshot),authorityTier,status:'review'}});
  await this.task(tx,uc,r.id,r.workflowCaseId,'verification','AI_GOVERNANCE_OFFICER',jsonRecord(r.assignments));
 }
 private async openAuthority(tx:Prisma.TransactionClient,uc:Uc,id:string,caseId:string,tier:string,assignments:Record<string,unknown>){const authority=await this.routing.decisionAssignment(tx,tier);await this.task(tx,uc,id,caseId,'authority',authority.role,assignments,{assignmentRuleId:authority.ruleId,tierCode:tier});await tx.aiLifecycleRequest.update({where:{id},data:{status:'authority',authorityRole:authority.role}});}
 async decide(userId:string,id:string,taskId:string,dto:DecideAiLifecycleDto){const justification=governanceText(dto.justification);
  if(!Array.isArray(dto.evidenceIds)||!dto.evidenceIds.length||dto.evidenceIds.length>20||new Set(dto.evidenceIds).size!==dto.evidenceIds.length)throw new BadRequestException('Verified distinct evidence is required');
  if(!['approve','return','reject'].includes(dto.decision))throw new BadRequestException('Unsupported lifecycle decision');
  return governanceTransaction(this.db,async tx=>{const g=await this.gate(tx,userId,id,dto.expectedVersion,taskId),kind=String(g.form['kind']);
   if(!['verification','privacy','security','ethics','authority','confirmation'].includes(kind))throw new ConflictException('Complete reassessment before deciding');
   const contributors=(await tx.workflowTask.findMany({where:{caseId:g.r.workflowCaseId,formSubmittedBy:{not:null}},select:{formSubmittedBy:true,formDataJson:true}})).filter(t=>['classification','dimension','likelihood'].includes(String(jsonRecord(t.formDataJson)['kind']))).map(t=>t.formSubmittedBy!);
   if(!g.actor.administratorOverride&&!independentLifecycleActor(userId,g.uc.requesterUserId,g.uc.owner?.userId??null,g.r.proposerId,['verification','authority','confirmation'].includes(kind)?contributors:[],kind==='confirmation'?g.r.authorityActorId??undefined:undefined))throw new ForbiddenException('Lifecycle business decisions must be independent of request, ownership, proposal and reassessment');
   if(kind==='authority'){const authority=await this.routing.decisionAssignment(tx,g.r.authorityTier);if(g.role!==authority.role||g.form['assignmentRuleId']!==authority.ruleId)throw new ConflictException('Configured tier authority changed; return and reassess');}
   if(!g.actor.administratorOverride&&kind==='confirmation'&&userId!==jsonRecord(g.r.proposedPayload)['data_owner'])throw new ForbiddenException('The nominated Data Owner must separately confirm this lifecycle decision');
   if(dto.conditions?.length&&kind!=='authority')throw new BadRequestException('Only the tier authority can add approval obligations');
   const conditions=(dto.conditions??[]).map(s=>s.trim());if(conditions.some(s=>!s||s.length>1000)||new Set(conditions).size!==conditions.length)throw new BadRequestException('Approval obligations must be distinct non-empty conditions');
   if(dto.decision==='approve'&&['change','resume'].includes(g.r.action)&&g.r.authorityTier==='UNACCEPTABLE')throw new ConflictException('Unacceptable or critical reassessment cannot activate a changed or resumed configuration');
   const decided=await tx.aiLifecycleDecision.create({data:{requestId:id,taskId,stage:kind,decision:dto.decision,actorId:userId,actorRole:g.role,justification,evidenceIds:json(dto.evidenceIds),snapshot:json({configurationDigest:governanceDigest(g.r.proposedPayload),assessment:g.r.assessmentSnapshot,risks:g.r.riskSnapshot,conditions})}});
   await tx.workflowTask.update({where:{id:taskId},data:{status:'completed',decision:dto.decision==='approve'?'approved':'rejected',decisionComment:justification,completedAt:new Date(),formSubmittedAt:new Date(),formSubmittedBy:userId}});
   if(dto.decision!=='approve'){await tx.workflowTask.updateMany({where:{caseId:g.r.workflowCaseId,status:{in:['pending','in_progress']}},data:{status:'cancelled',completedAt:new Date()}});await tx.aiLifecycleRequest.update({where:{id},data:{status:dto.decision==='return'?'returned':'rejected',completedAt:new Date(),version:{increment:1}}});await tx.workflowCase.update({where:{id:g.r.workflowCaseId},data:{status:dto.decision==='return'?'closed':'rejected'}});}
   else if(kind==='authority'){await tx.aiLifecycleRequest.update({where:{id},data:{status:'confirmation',authorityActorId:userId,approvedConditions:json(conditions),version:{increment:1}}});await this.task(tx,g.uc,id,g.r.workflowCaseId,'confirmation','data_owner',jsonRecord(g.r.assignments));}
   else if(kind==='confirmation'){await this.apply(tx,g.uc,g.r,userId);}
   else if(kind==='verification'){
    await tx.aiLifecycleRequest.update({where:{id},data:{version:{increment:1}}});
    const reviews=await this.routing.requiredReviews(tx,String(jsonRecord(g.r.assessmentSnapshot)['tierCode']),g.r.authorityTier,jsonRecord(g.r.sourceSnapshot)['facts'] as {personalDataInvolved:boolean;sensitiveDataInvolved:boolean});
    for(const review of reviews){if(!review.role)throw new ConflictException('Specialist review configuration lacks an eligible role');await this.task(tx,g.uc,id,g.r.workflowCaseId,review.stageCode===AIUC_STAGE.privacy?'privacy':review.stageCode===AIUC_STAGE.security?'security':'ethics',review.role,jsonRecord(g.r.assignments));}
    if(!reviews.length)await this.openAuthority(tx,g.uc,id,g.r.workflowCaseId,g.r.authorityTier,jsonRecord(g.r.assignments));
   }
   else {await tx.aiLifecycleRequest.update({where:{id},data:{version:{increment:1}}});if(!await tx.workflowTask.count({where:{caseId:g.r.workflowCaseId,status:'pending'}}))await this.openAuthority(tx,g.uc,id,g.r.workflowCaseId,g.r.authorityTier,jsonRecord(g.r.assignments));}
   await this.event(tx,id,g.r.workflowCaseId,userId,kind+'.'+dto.decision,{taskId,decisionId:decided.id,evidenceIds:dto.evidenceIds,justification,configurationDigest:governanceDigest(g.r.proposedPayload),authorityTier:g.r.authorityTier});
   return {id,version:dto.expectedVersion+1};
  });
 }
 private async apply(tx:Prisma.TransactionClient,uc:Uc,r:Prisma.AiLifecycleRequestGetPayload<{}>,actor:string){
  let state:string;try{state=lifecycleTransition(uc.lifecycleState,r.action);}catch(e){throw new ConflictException((e as Error).message);}
  const needsAssessment=['change','resume'].includes(r.action);if(needsAssessment&&(!r.assessmentSnapshot||!r.riskSnapshot))throw new ConflictException('A complete reassessment is required');
  if(r.action==='resume'&&['SUSPENDED','ARCHIVED'].includes(uc.operationalStatusCode??''))throw new ConflictException('Resolve the separate AIRS operating restriction through its native reassessment before resumption');
  const conditions=r.approvedConditions as string[];
  if(conditions.length&&!uc.risks.length)throw new ConflictException('Approval obligations require a linked active AIRS risk');
  for(const [i,description]of conditions.entries())for(const risk of uc.risks)await tx.aiApprovalObligation.create({data:{useCaseId:uc.id,riskId:risk.id,assetId:uc.assetId,sourceKey:'lifecycle:'+r.id+':'+i+':'+risk.id,description,createdBy:actor}});
  let effectiveConfigurationId=uc.effectiveConfigurationId;
  if(needsAssessment){const previous=await tx.aiEffectiveConfiguration.aggregate({where:{useCaseId:uc.id},_max:{sequence:true}}),config=await tx.aiEffectiveConfiguration.create({data:{useCaseId:uc.id,sequence:(previous._max.sequence??0)+1,payload:r.proposedPayload as Prisma.InputJsonValue,tierCode:String(jsonRecord(r.assessmentSnapshot)['tierCode']),referencePins:json(jsonRecord(r.sourceSnapshot)['referencePins']),assessmentSnapshot:r.assessmentSnapshot as Prisma.InputJsonValue,riskSnapshot:r.riskSnapshot as Prisma.InputJsonValue,obligationSnapshot:json({retained:uc.obligations,additional:conditions}),sourceRequestId:r.id,createdBy:actor}});effectiveConfigurationId=config.id;
   if(r.action==='change'){const revision=(uc.intakeRevisions[0]?.revision??0)+1;await tx.aiIntakeRevision.create({data:{useCaseId:uc.id,revision,payload:r.proposedPayload as Prisma.InputJsonValue,submittedAt:new Date(),createdBy:actor}});}
  }
  if(r.action==='retire'){
   const riskIds=uc.risks.map(risk=>risk.id),risks=await tx.aiRisk.findMany({where:{id:{in:riskIds}},select:{workflowCaseId:true}}),caseIds=risks.map(risk=>risk.workflowCaseId).filter((s):s is string=>!!s);
   await tx.aiApprovalObligation.updateMany({where:{useCaseId:uc.id,deletedAt:null},data:{operationalState:'retired',version:{increment:1}}});
   const reviews=await tx.aiRiskReview.findMany({where:{riskId:{in:riskIds},completion:{is:null},cancellation:{is:null},retirement:{is:null}},select:{id:true,taskId:true,calendarOccurrenceId:true,calendarTemplateId:true}});
   for(const review of reviews){const retired=await tx.aiLifecycleReviewRetirement.create({data:{reviewId:review.id,requestId:r.id}});await tx.workflowTask.update({where:{id:review.taskId},data:{status:'cancelled',completedAt:retired.createdAt}});}
   await tx.workflowTask.updateMany({where:{caseId:{in:caseIds},status:{in:['pending','in_progress']}},data:{status:'cancelled',completedAt:new Date()}});
   await tx.workflowCase.updateMany({where:{id:{in:caseIds}},data:{status:'closed'}});
   await tx.complianceCalendarOccurrence.updateMany({where:{id:{in:reviews.map(x=>x.calendarOccurrenceId)}},data:{status:'archived',completedAt:null}});
   await tx.complianceCalendarTemplate.updateMany({where:{id:{in:reviews.map(x=>x.calendarTemplateId)}},data:{status:'paused',updatedBy:actor}});
   await tx.governanceNotification.updateMany({where:{sourceType:'ai_risk_review',sourceId:{in:reviews.map(x=>x.id)}},data:{status:'archived'}});
   await tx.governanceNotificationDeliveryAttempt.updateMany({where:{notification:{sourceType:'ai_risk_review',sourceId:{in:reviews.map(x=>x.id)}},status:{in:['planned','failed']}},data:{status:'skipped',nextRetryAt:null,errorMessage:'Registered use case retired through lifecycle '+r.id}});
   await tx.governanceEscalation.updateMany({where:{sourceType:'ai_risk_review',sourceId:{in:reviews.map(x=>x.id)},status:{not:'resolved'}},data:{status:'resolved',resolvedAt:new Date(),updatedBy:actor}});
   for(const caseId of caseIds)await tx.workflowEvent.create({data:{caseId,actor,action:'aiuc.lifecycle.retired',comment:r.id+' / '+r.justification}});
  }
  const payload=jsonRecord(r.proposedPayload);
  if((await tx.aiUseCase.updateMany({where:{id:uc.id,version:r.baseVersion,effectiveConfigurationId:r.baseConfigurationId},data:{version:{increment:1},lifecycleState:state,effectiveConfigurationId,...(r.action==='change'?{name:String(payload['usecase_name']),description:String(payload['problem_desc'])}:{})}})).count!==1)throw new ConflictException('Concurrent lifecycle completion; reload');
  await tx.aiLifecycleRequest.update({where:{id:r.id},data:{status:'applied',version:{increment:1},completedAt:new Date()}});await tx.workflowCase.update({where:{id:r.workflowCaseId},data:{status:'closed'}});
 }
 async withdraw(userId:string,id:string,version:number,reason:string){
  const preliminary=await this.db.aiLifecycleRequest.findUnique({where:{id}});if(!preliminary)throw new NotFoundException('Lifecycle request not found');await this.intake.getVisible(userId,preliminary.useCaseId);
  return governanceTransaction(this.db,async tx=>{await tx.$queryRaw`SELECT id FROM ai_lifecycle_requests WHERE id=${id} FOR UPDATE`;const r=await tx.aiLifecycleRequest.findUniqueOrThrow({where:{id}}),uc=await this.current(tx,r.useCaseId);
   if(![r.proposerId,uc.owner?.userId].includes(userId))throw new ForbiddenException('Only the proposer or current owner may withdraw pending work');
   if(r.version!==version||!open.includes(r.status))throw new ConflictException('Pending lifecycle work changed; reload');
   await tx.workflowTask.updateMany({where:{caseId:r.workflowCaseId,status:{in:['pending','in_progress']}},data:{status:'cancelled',completedAt:new Date()}});
   await tx.aiLifecycleRequest.update({where:{id},data:{status:'withdrawn',version:{increment:1},completedAt:new Date()}});await tx.workflowCase.update({where:{id:r.workflowCaseId},data:{status:'closed'}});
   await this.event(tx,id,r.workflowCaseId,userId,'withdrawn',{justification:governanceText(reason),staleSourceRetained:true});return {id,version:version+1};
  });
 }
 private async event(tx:Prisma.TransactionClient,id:string,caseId:string,actor:string,action:string,metadata:Record<string,unknown>){await tx.workflowEvent.create({data:{caseId,actor,action:'aiuc.lifecycle.'+action,comment:String(metadata['justification']??action)}});await this.audit.logRequired({actor,action:'aiuc.lifecycle.'+action,entityType:'ai_lifecycle_request',entityId:id,metadata},tx);}
}
