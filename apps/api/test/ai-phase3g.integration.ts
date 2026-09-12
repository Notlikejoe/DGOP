import assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { ScopeService } from '../src/access/scope.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiRiskAssessmentService } from '../src/ai-governance/ai-risk-assessment.service';
import { AiRiskAdoptionService } from '../src/ai-governance/ai-risk-adoption.service';
import { AiRiskResponseService } from '../src/ai-governance/ai-risk-response.service';
import { AiResidualAssessmentService } from '../src/ai-governance/ai-residual-assessment.service';
import { AiResidualDecisionService, residualAuthority } from '../src/ai-governance/ai-residual-decision.service';
import { DecideResidualRiskDto } from '../src/ai-governance/ai-residual-decision.dto';
import { AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { computeInherentRisk, jsonRecord, RiskScoringConfiguration } from '../src/ai-governance/ai-risk-scoring';
import { riskScoringFixture } from './ai-risk-scoring.fixture';

export async function testPhase3G(db:PrismaClient,f:{riskId:string;riskOwnerId:string;officerId:string;auditorId:string}) {
 const prisma=db as PrismaService,audit=new AuditService(prisma),auth=new AiAuthorizationService(prisma,audit),routing=new AiWorkflowRoutingService(prisma);
 const risks=new AiRiskIntakeService(prisma,auth,new ScopeService(prisma),routing,new AiIdentifiersService(),audit),scoring=new AiRiskAssessmentService(prisma,auth,risks,routing,audit);
 const residual=new AiResidualAssessmentService(prisma,auth,risks,scoring,routing,audit),service=new AiResidualDecisionService(prisma,auth,risks,residual,scoring,routing,audit);
 const failed=new AiResidualDecisionService(prisma,auth,risks,residual,scoring,routing,{logRequired:async()=>{throw new Error('Injected authority audit failure');}} as unknown as AuditService);
 const original=await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId},include:{useCase:{include:{owner:true}}}}),ownerId=original.useCase.owner!.userId!;
 const evidence=await db.ndiEvidence.findFirstOrThrow({where:{deletedAt:null}}),officerRole=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}});
 async function actor(roleCode:string) {const role=await db.role.findUniqueOrThrow({where:{code:roleCode}});return db.user.create({data:{email:`${roleCode}@phase3g.test`,displayName:roleCode,passwordHash:'not-a-login',userRoles:{create:{roleId:role.id}}}});}
 const ethics=await actor('AI_ETHICS_COMMITTEE'),executive=await actor('AI_EXECUTIVE_TEAM'),steering=await actor('STEERING_COMMITTEE'),otherOwner=await actor('AI_USECASE_OWNER');
 await db.userRole.create({data:{userId:otherOwner.id,roleId:(await db.role.findUniqueOrThrow({where:{code:'AI_COMPLIANCE_OFFICER'}})).id}});
 await db.rolePermission.createMany({data:[{roleId:(await db.role.findUniqueOrThrow({where:{code:'AI_EXECUTIVE_TEAM'}})).id,permissionId:(await db.permission.findUniqueOrThrow({where:{resource_action:{resource:'airs.risk.accept',action:'high'}}})).id},
  {roleId:(await db.role.findUniqueOrThrow({where:{code:'STEERING_COMMITTEE'}})).id,permissionId:(await db.permission.findUniqueOrThrow({where:{resource_action:{resource:'case.approve',action:'airs'}}})).id}],skipDuplicates:true});
 const dto=(version:number,decision:DecideResidualRiskDto['decision']='approve'):DecideResidualRiskDto=>({expectedVersion:version,decision,justification:'Independent review minutes and controls evidence',evidenceIds:[evidence.id],conditions:['Retain tested control evidence and review changes']});
 async function context(id:string,user=f.officerId) {return service.context(user,id);}
 async function task(id:string,kind:string,user=f.officerId) {const c=await context(id,user);return {c,t:c.tasks.find(t=>t.kind===kind)!};}
 async function decide(id:string,kind:string,user:string,decision:DecideResidualRiskDto['decision']) {const {c,t}=await task(id,kind,user);assert.ok(t,`${kind} missing`);return service.decide(user,id,t.id,dto(c.version,decision));}
 async function fresh(id:string,likelihood:number,impact:number) {
  let c=await residual.context(f.riskOwnerId,id),v=c.version;assert.equal(c.canStart,true);await residual.start(f.riskOwnerId,id,v++);c=await residual.context(f.riskOwnerId,id);assert.equal(c.tasks.length,8);assert.ok(c.tasks.every(t=>t.score===null));
  for(const t of c.tasks){const actual=await db.workflowTask.findUniqueOrThrow({where:{id:t.id}}),user=actual.assigneeUserId??(await db.user.findFirstOrThrow({where:{isActive:true,userRoles:{some:{role:{code:t.assessorRoleCode!}}}},orderBy:{email:'asc'}})).id;
   await residual.contribute(user,id,t.id,{expectedVersion:v++,value:impact,justification:`Fresh competent-role ${t.dimension} impact`});}
  c=await residual.context(f.riskOwnerId,id);return residual.complete(f.riskOwnerId,id,{expectedVersion:v,likelihood,justification:'Fresh evidence-based probability',currentControls:'Fresh controls reviewed after treatment',controlEffectivenessCode:c.controlReference.values[0].code});
 }
 assert.equal(residualAuthority('CRITICAL').accepted,false);assert.equal(residualAuthority('HIGH').level,3);assert.throws(()=>residualAuthority('POSTED_BAND'));
 let {c,t}=await task(f.riskId,'adoption');assert.deepEqual(t.outcomes,['approve']);assert.equal(c.riskAccepted,false);
 await assert.rejects(service.decide(f.officerId,f.riskId,t.id,{...dto(c.version),evidenceIds:[]}),/evidence/);
 await assert.rejects(service.decide(f.officerId,f.riskId,t.id,{...dto(c.version),conditions:[' ']}),/Conditions/);
 await db.userRole.create({data:{userId:f.riskOwnerId,roleId:officerRole.id}});await assert.rejects(service.decide(f.riskOwnerId,f.riskId,t.id,dto(c.version)),/WF-05/);await db.userRole.delete({where:{userId_roleId:{userId:f.riskOwnerId,roleId:officerRole.id}}});
 await db.userRole.create({data:{userId:f.auditorId,roleId:officerRole.id}});await assert.rejects(service.decide(f.auditorId,f.riskId,t.id,dto(c.version)),/explicit eligible/);await db.userRole.delete({where:{userId_roleId:{userId:f.auditorId,roleId:officerRole.id}}});
 const excluded=await db.roleDataScope.create({data:{roleId:officerRole.id,scopeType:'org_unit',refId:'excluded-residual-authority',includeDescendants:false}});await assert.rejects(context(f.riskId),/not found/);await db.roleDataScope.delete({where:{id:excluded.id}});
 // Retirement permits only a justified return; the fresh round cannot carry scores/decisions.
 const prior=await db.aiAssessmentRound.findUniqueOrThrow({where:{id:c.assessmentId!}}),config=jsonRecord(prior.inputs)['configuration'] as RiskScoringConfiguration;
 await db.governedReferenceVersion.update({where:{id:config.referenceVersions.R_SCORE14},data:{state:'retired',effectiveTo:new Date()}});
 assert.deepEqual((await context(f.riskId)).tasks[0].outcomes,[]);await assert.rejects(service.decide(f.officerId,f.riskId,t.id,dto(c.version)),/references changed/);
 await assert.rejects(failed.decide(f.officerId,f.riskId,t.id,dto(c.version,'return')),/Injected authority audit failure/);assert.equal(await db.aiRiskAssessmentDecision.count({where:{assessmentId:prior.id}}),0);
 await service.decide(f.officerId,f.riskId,t.id,dto(c.version,'return'));assert.equal((await context(f.riskId)).tasks.length,0);
 const fixture=riskScoringFixture(),old=await db.governedReferenceVersion.aggregate({where:{listCode:'R_SCORE14'},_max:{version:true}});
 const replacement=await db.governedReferenceVersion.create({data:{listCode:'R_SCORE14',version:old._max.version!+1,createdBy:'phase3g-fixture',values:{create:fixture.scores.map(({code,labelEn,labelAr,...metadata},i)=>({code,labelEn,labelAr,metadata,sortOrder:i+1}))}}});
 await db.governedReferenceVersion.update({where:{id:replacement.id},data:{state:'published',effectiveFrom:new Date('2020-01-01'),approvedBy:'phase3g-fixture',approvedAt:new Date()}});
 await fresh(f.riskId,2,2);const newRound=await db.aiAssessmentRound.findFirstOrThrow({where:{riskId:f.riskId,kind:'residual'},orderBy:{round:'desc'},include:{decisions:true}});assert.notEqual(newRound.id,prior.id);assert.equal(newRound.decisions.length,0);assert.deepEqual((await db.aiAssessmentRound.findUniqueOrThrow({where:{id:prior.id}})).result,prior.result);
 // Medium: owner decision then independent officer countersign; never self-acceptance.
 ({c,t}=await task(f.riskId,'adoption'));await assert.rejects(failed.decide(f.officerId,f.riskId,t.id,dto(c.version)),/Injected authority audit failure/);
 const ownerPerson=await db.person.findUniqueOrThrow({where:{id:original.useCase.ownerPersonId!}});await db.person.update({where:{id:ownerPerson.id},data:{isActive:false}});
 await assert.rejects(service.decide(f.officerId,f.riskId,t.id,dto(c.version)),/active actual Use-Case Owner/);assert.equal(await db.aiRiskAssessmentDecision.count({where:{assessmentId:newRound.id}}),0);await db.person.update({where:{id:ownerPerson.id},data:{isActive:true}});
 const adopted=await Promise.allSettled([service.decide(f.officerId,f.riskId,t.id,dto(c.version)),service.decide(f.officerId,f.riskId,t.id,dto(c.version))]);assert.equal(adopted.filter(r=>r.status==='fulfilled').length,1);
 ({c,t}=await task(f.riskId,'accept_owner',ownerId));assert.deepEqual(t.outcomes,['accept']);assert.equal(c.riskAccepted,false);assert.equal(c.tasks.some(t=>t.kind==='countersign'),false);
 const forged=await routing.createStageTask(prisma,original.workflowCaseId!,'airs-accept-medium-countersign',new Date(),{templateCode:AIRS_TEMPLATE_CODE,formDataJson:{assessmentId:newRound.id,responseId:jsonRecord(newRound.inputs)['responseId'],inherentAssessmentId:jsonRecord(newRound.inputs)['inherentAssessmentId']} as Prisma.InputJsonObject});
 await assert.rejects(db.aiRiskAssessmentDecision.create({data:{assessmentId:newRound.id,taskId:forged.id,kind:'countersign',decision:'accept',actorId:f.officerId,actorRoleCode:'AI_GOVERNANCE_OFFICER',justification:'Cannot bypass owner sequence',evidenceIds:[evidence.id]}}));await db.workflowTask.delete({where:{id:forged.id}});
 await assert.rejects(service.decide(otherOwner.id,f.riskId,t.id,dto(c.version,'accept')),/GEN-25/);
 await decide(f.riskId,'accept_owner',ownerId,'accept');assert.equal((await context(f.riskId)).riskAccepted,false);assert.equal((await db.workflowCase.findUniqueOrThrow({where:{id:original.workflowCaseId!}})).status,'under_review');
 ({c,t}=await task(f.riskId,'countersign'));await db.userRole.create({data:{userId:f.riskOwnerId,roleId:officerRole.id}});await assert.rejects(service.decide(f.riskOwnerId,f.riskId,t.id,dto(c.version,'accept')),/GEN-27/);await db.userRole.delete({where:{userId_roleId:{userId:f.riskOwnerId,roleId:officerRole.id}}});
 const ownerOfficer=await db.userRole.findUnique({where:{userId_roleId:{userId:ownerId,roleId:officerRole.id}}});if(!ownerOfficer)await db.userRole.create({data:{userId:ownerId,roleId:officerRole.id}});await assert.rejects(service.decide(ownerId,f.riskId,t.id,dto(c.version,'accept')),/band authority/);if(!ownerOfficer)await db.userRole.delete({where:{userId_roleId:{userId:ownerId,roleId:officerRole.id}}});
 // A directory ownership change cannot make the current owner their own countersigner.
 const currentOfficerPerson=await db.person.upsert({where:{userId:f.officerId},create:{userId:f.officerId,fullNameEn:'Officer test person',fullNameAr:'مسؤول الاختبار'},update:{}});
 await db.aiUseCase.update({where:{id:original.useCase.id},data:{ownerPersonId:currentOfficerPerson.id,version:{increment:1}}});assert.deepEqual((await context(f.riskId)).tasks[0].outcomes,[]);await assert.rejects(service.decide(f.officerId,f.riskId,t.id,dto(c.version,'accept')),/band authority/);
 await assert.rejects(db.aiRiskAssessmentDecision.create({data:{assessmentId:newRound.id,taskId:t.id,kind:'countersign',decision:'accept',actorId:f.officerId,actorRoleCode:'AI_GOVERNANCE_OFFICER',justification:'Current owner cannot countersign',evidenceIds:[evidence.id]}}));await db.aiUseCase.update({where:{id:original.useCase.id},data:{ownerPersonId:original.useCase.ownerPersonId,version:{increment:1}}});
 await assert.rejects(failed.decide(f.officerId,f.riskId,t.id,dto(c.version,'accept')),/Injected authority audit failure/);assert.equal((await context(f.riskId)).riskAccepted,false);
 const signed=await Promise.allSettled([service.decide(f.officerId,f.riskId,t.id,dto(c.version,'accept')),service.decide(f.officerId,f.riskId,t.id,dto(c.version,'accept'))]);assert.equal(signed.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await context(f.riskId)).riskAccepted,true);assert.equal((await db.workflowCase.findUniqueOrThrow({where:{id:original.workflowCaseId!}})).status,'decision_made');
 const immutable=await db.aiRiskAssessmentDecision.findFirstOrThrow({where:{assessmentId:newRound.id,kind:'countersign'}});assert.deepEqual(immutable.conditions,dto(0).conditions);await assert.rejects(db.aiRiskAssessmentDecision.update({where:{id:immutable.id},data:{decision:'return'}}));await assert.rejects(db.aiRiskAssessmentDecision.delete({where:{id:immutable.id}}));

 // Legal synthetic adopted ACCEPT sources exercise all remaining residual bands through real services.
 let fixtureIndex=0;
 async function source() {
  const uc=await db.aiUseCase.create({data:{name:'Phase 3G synthetic source',createdBy:ownerId,requesterUserId:ownerId,ownerPersonId:original.useCase.ownerPersonId,organizationUnitId:original.useCase.organizationUnitId,assetId:original.useCase.assetId}});
  const wc=await db.workflowCase.create({data:{code:`AIRS-TEST-3G-${++fixtureIndex}`,title:'Synthetic authority case',type:'AIRS',status:'under_review',createdBy:f.riskOwnerId,templateId:(await routing.binding(prisma,AIRS_TEMPLATE_CODE)).id}});
  const risk=await db.aiRisk.create({data:{riskRef:`AIR-${970+fixtureIndex}`,useCaseId:uc.id,workflowCaseId:wc.id,ownerPersonId:original.ownerPersonId,title:'Synthetic',cause:'Cause',event:'Event',effect:'Effect',createdBy:f.riskOwnerId,intakeData:original.intakeData as Prisma.InputJsonObject}});
  const cfg=await scoring.configuration(prisma),dimensions=(jsonRecord(newRound.inputs)['dimensions'] as Parameters<typeof computeInherentRisk>[1]).map(d=>({...d,value:2}));
  const inherent=await db.aiAssessmentRound.create({data:{riskId:risk.id,useCaseId:uc.id,kind:'inherent',round:1,createdBy:f.riskOwnerId,engineVersion:'airs-inherent-max8-v1',ruleReferenceVersionId:cfg.referenceVersions.R_LEVEL,
   inputs:{...jsonRecord(newRound.inputs),configuration:cfg,dimensions,likelihood:{value:2,justification:'Synthetic inherent probability'}} as unknown as Prisma.InputJsonObject,result:computeInherentRisk(2,dimensions,cfg) as unknown as Prisma.InputJsonObject}});
  await routing.openRiskAssessmentGate(prisma,wc.id,inherent.id,false,risk.riskRef!,new Date());
  const adoption=new AiRiskAdoptionService(prisma,auth,risks,routing,audit),ac=await adoption.context(f.officerId,risk.id);await adoption.review(f.officerId,risk.id,ac.tasks[0].id,{...dto(ac.version),decision:'approve'});
  const response=new AiRiskResponseService(prisma,auth,risks,routing,audit);let rc=await response.context(f.riskOwnerId,risk.id);await response.propose(f.riskOwnerId,risk.id,{expectedVersion:rc.version,strategyCode:'ACCEPT',justification:'Synthetic approved strategy',evidenceIds:[evidence.id],offshoreProcessing:false});
  rc=await response.context(f.officerId,risk.id);await response.decide(f.officerId,risk.id,rc.tasks.find(t=>t.kind==='officer')!.id,{...dto(rc.version),decision:'approve'});return risk;
 }
 const low=await source();await fresh(low.id,1,1);await decide(low.id,'adoption',f.officerId,'approve');({c,t}=await task(low.id,'accept_owner',ownerId));await assert.rejects(service.decide(otherOwner.id,low.id,t.id,dto(c.version,'accept')),/GEN-25/);await decide(low.id,'accept_owner',ownerId,'accept');assert.equal((await context(low.id)).riskAccepted,true);
 const high=await source();await fresh(high.id,3,3);await decide(high.id,'adoption',f.officerId,'approve');assert.equal((await context(high.id,executive.id)).tasks.some(t=>t.kind==='executive'),false);
 ({c,t}=await task(high.id,'ethics',ethics.id));const ethicsRole=await db.role.findUniqueOrThrow({where:{code:'AI_ETHICS_COMMITTEE'}}),ownerEthics=await db.userRole.findUnique({where:{userId_roleId:{userId:ownerId,roleId:ethicsRole.id}}});if(!ownerEthics)await db.userRole.create({data:{userId:ownerId,roleId:ethicsRole.id}});await assert.rejects(service.decide(ownerId,high.id,t.id,dto(c.version)),/GEN-29/);if(!ownerEthics)await db.userRole.delete({where:{userId_roleId:{userId:ownerId,roleId:ethicsRole.id}}});
 await decide(high.id,'ethics',ethics.id,'approve');({c,t}=await task(high.id,'executive',executive.id));await db.userRole.create({data:{userId:ethics.id,roleId:(await db.role.findUniqueOrThrow({where:{code:'AI_EXECUTIVE_TEAM'}})).id}});await assert.rejects(service.decide(ethics.id,high.id,t.id,dto(c.version,'accept')),/band authority/);await db.userRole.delete({where:{userId_roleId:{userId:ethics.id,roleId:(await db.role.findUniqueOrThrow({where:{code:'AI_EXECUTIVE_TEAM'}})).id}}});
 // Return after Ethics: replacement round must run fresh Ethics again.
 await decide(high.id,'executive',executive.id,'return');await fresh(high.id,3,3);await decide(high.id,'adoption',f.officerId,'approve');assert.equal((await context(high.id,ethics.id)).history[0].decisions.some(d=>d.kind==='ethics'),false);await decide(high.id,'ethics',ethics.id,'approve');
 ({c,t}=await task(high.id,'executive',executive.id));const execRole=await db.role.findUniqueOrThrow({where:{code:'AI_EXECUTIVE_TEAM'}}),execPermission=await db.permission.findUniqueOrThrow({where:{resource_action:{resource:'airs.risk.accept',action:'high'}}});
 await db.rolePermission.delete({where:{roleId_permissionId:{roleId:execRole.id,permissionId:execPermission.id}}});assert.deepEqual((await context(high.id,executive.id)).tasks[0].outcomes,[]);await assert.rejects(service.decide(executive.id,high.id,t.id,dto(c.version,'accept')),/explicit eligible/);await db.rolePermission.create({data:{roleId:execRole.id,permissionId:execPermission.id}});
 await decide(high.id,'executive',executive.id,'accept');assert.equal((await context(high.id)).riskAccepted,true);
 const critical=await db.aiRisk.findUniqueOrThrow({where:{riskRef:'AIR-901'}});await decide(critical.id,'adoption',f.officerId,'return');await fresh(critical.id,4,4);await decide(critical.id,'adoption',f.officerId,'approve');({c,t}=await task(critical.id,'steering',steering.id));assert.deepEqual(t.outcomes,['restrict','stop']);await assert.rejects(service.decide(steering.id,critical.id,t.id,dto(c.version,'accept')),/Critical cannot/);await assert.rejects(failed.decide(steering.id,critical.id,t.id,dto(c.version,'restrict')),/Injected authority audit failure/);assert.equal((await db.aiUseCase.findUniqueOrThrow({where:{id:critical.useCaseId}})).operationalStatusCode,null);
 await assert.rejects(db.aiRiskAssessmentDecision.create({data:{assessmentId:c.assessmentId!,taskId:t.id,kind:'steering',decision:'accept',actorId:steering.id,actorRoleCode:'STEERING_COMMITTEE',justification:'Plain Critical acceptance is forbidden',evidenceIds:[evidence.id]}}));
 await decide(critical.id,'steering',steering.id,'restrict');assert.equal((await context(critical.id)).riskAccepted,false);assert.equal((await db.aiUseCase.findUniqueOrThrow({where:{id:critical.useCaseId}})).operationalStatusCode,'SUSPENDED');
 const stop=await source();await fresh(stop.id,4,4);await decide(stop.id,'adoption',f.officerId,'approve');await decide(stop.id,'steering',steering.id,'stop');assert.equal((await db.aiUseCase.findUniqueOrThrow({where:{id:stop.useCaseId}})).operationalStatusCode,'ARCHIVED');await assert.rejects(db.aiUseCase.update({where:{id:stop.useCaseId},data:{operationalStatusCode:null,operationalDecisionId:null,version:{increment:1}}}));
 await assert.rejects(db.aiUseCase.update({where:{id:low.useCaseId},data:{operationalStatusCode:'SUSPENDED',operationalDecisionId:immutable.id,version:{increment:1}}}));
 const app=await NestFactory.create(AppModule,{logger:false});try{app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');const base=await app.getUrl(),jwt=app.get(JwtService),headers={authorization:`Bearer ${jwt.sign({sub:f.officerId,tokenVersion:0,roles:['STEERING_COMMITTEE']})}`,'content-type':'application/json'};
  assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/residual/review`)).status,401);assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/residual/review`,{headers})).status,200);assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/residual/decisions/${t.id}`,{method:'POST',headers,body:JSON.stringify({...dto(0),bandCode:'LOW',riskAccepted:true,actorRoleCode:'AI_EXECUTIVE_TEAM'})})).status,400);
 }finally{await app.close();}
 console.log('Phase 3G passed: residual officer review/return, fresh rounds without carried approvals, Low actual-owner acceptance, sequential independent Medium countersign, fresh independent High Ethics/Executive decisions, Critical restrict/stop with guarded use-case state, explicit grants/live scope/SoD/Auditor blocks, required-audit rollback, immutable decisions/conditions, exactly-once concurrency and protected HTTP inputs.');
}
