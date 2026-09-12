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
import { AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AiResidualAssessmentService, residualPrerequisite } from '../src/ai-governance/ai-residual-assessment.service';
import { RISK_DIMENSIONS, RISK_DIMENSION_ROLES, jsonRecord } from '../src/ai-governance/ai-risk-scoring';
import { riskScoringFixture } from './ai-risk-scoring.fixture';
import { testPhase3G } from './ai-phase3g.integration';
export async function testPhase3F2(db:PrismaClient,f:{riskId:string;riskOwnerId:string;officerId:string;auditorId:string}) {
 const prisma=db as PrismaService,audit=new AuditService(prisma),auth=new AiAuthorizationService(prisma,audit),routing=new AiWorkflowRoutingService(prisma),risks=new AiRiskIntakeService(prisma,auth,new ScopeService(prisma),routing,new AiIdentifiersService(),audit),scoring=new AiRiskAssessmentService(prisma,auth,risks,routing,audit);
 const service=new AiResidualAssessmentService(prisma,auth,risks,scoring,routing,audit),failed=new AiResidualAssessmentService(prisma,auth,risks,scoring,routing,{logRequired:async()=>{throw new Error('Injected residual audit failure');}} as unknown as AuditService);
 assert.match(residualPrerequisite('MITIGATE','HIGH',2,0)!,/RM-24/);assert.match(residualPrerequisite('ACCEPT','CRITICAL',0,0)!,/RM-24/);assert.equal(residualPrerequisite('ACCEPT','MEDIUM',0,0),null);assert.match(residualPrerequisite('TRANSFER','LOW',2,1)!,/All approved/);
 const risk=await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId}}),inherent=await db.aiAssessmentRound.findMany({where:{riskId:f.riskId,kind:'inherent'}}),actions=await db.aiTreatmentAction.findMany({where:{riskId:f.riskId},include:{workflowTask:true}});
 let version=(await service.context(f.riskOwnerId,f.riskId)).version;
 // Immutable progress alone cannot satisfy RM-24 if the native task is not completed.
 for(const a of actions)await db.workflowTask.update({where:{id:a.workflowTaskId!},data:{status:'in_progress'}});
 await assert.rejects(service.start(f.riskOwnerId,f.riskId,version),/RM-24/);
 for(const a of actions)await db.workflowTask.update({where:{id:a.workflowTaskId!},data:{status:'completed'}});
 await assert.rejects(service.start(f.riskOwnerId,f.riskId,version),/configuration/);
 const fixture=riskScoringFixture();
 async function publish(listCode:string,values:Array<{code:string;labelEn:string;labelAr:string;metadata:Prisma.InputJsonObject}>) {
  await db.governedReferenceVersion.updateMany({where:{listCode,state:'published'},data:{state:'retired',effectiveTo:new Date()}});
  const prior=await db.governedReferenceVersion.aggregate({where:{listCode},_max:{version:true}}),v=await db.governedReferenceVersion.create({data:{listCode,version:(prior._max.version??0)+1,createdBy:'phase3f2-synthetic-fixture',values:{create:values.map((value,index)=>({...value,sortOrder:index+1}))}}});
  await db.governedReferenceVersion.update({where:{id:v.id},data:{state:'published',effectiveFrom:new Date('2020-01-01'),approvedAt:new Date('2020-01-01'),approvedBy:'phase3f2-synthetic-fixture'}});return v.id;
 }
 const scoreValues=fixture.scores.map(({code,labelEn,labelAr,...metadata})=>({code,labelEn,labelAr,metadata}));
 await publish('R_SCORE14',scoreValues);await publish('R_IMPD',fixture.dimensions.map(({code,labelEn,labelAr,...metadata})=>({code,labelEn,labelAr,metadata})));await publish('R_LEVEL',fixture.bands.map(({code,labelEn,labelAr,...metadata})=>({code,labelEn,labelAr,metadata})));
 const person=await db.person.findUniqueOrThrow({where:{id:risk.ownerPersonId!}});await db.person.update({where:{id:person.id},data:{isActive:false}});await assert.rejects(service.start(f.riskOwnerId,f.riskId,version),/active assigned/);await db.person.update({where:{id:person.id},data:{isActive:true}});
 await assert.rejects(service.start(f.officerId,f.riskId,version),/explicit eligible/);
 await assert.rejects(failed.start(f.riskOwnerId,f.riskId,version),/Injected residual audit failure/);
 assert.equal(await db.workflowTask.count({where:{caseId:risk.workflowCaseId!,status:'pending',templateStage:{code:'airs-residual-assessment'}}}),0);
 const starts=await Promise.allSettled([service.start(f.riskOwnerId,f.riskId,version),service.start(f.riskOwnerId,f.riskId,version)]);assert.equal(starts.filter(r=>r.status==='fulfilled').length,1);version++;
 let context=await service.context(f.riskOwnerId,f.riskId);assert.equal(context.tasks.length,8);assert.equal(context.canComplete,false);assert.ok(context.tasks.every(t=>t.score===null));
 const owners:Record<string,string>={};for(const role of new Set(Object.values(RISK_DIMENSION_ROLES))){const task=context.tasks.find(t=>t.assessorRoleCode===role)!;const assigned=await db.workflowTask.findUniqueOrThrow({where:{id:task.id}});owners[role]=assigned.assigneeUserId??(await db.user.findFirstOrThrow({where:{isActive:true,userRoles:{some:{role:{code:role}}}},orderBy:{email:'asc'}})).id;}
 const privacy=context.tasks.find(t=>t.dimension==='dim_privacy')!;
 await assert.rejects(service.contribute(f.riskOwnerId,f.riskId,privacy.id,{expectedVersion:version,value:2,justification:'Wrong role'}),/competent/);
 await assert.rejects(service.contribute(f.auditorId,f.riskId,privacy.id,{expectedVersion:version,value:2,justification:'Auditor attempt'}),/explicit eligible/);
 await assert.rejects(failed.contribute(owners['privacy_officer'],f.riskId,privacy.id,{expectedVersion:version,value:2,justification:'Privacy reassessment'}),/Injected residual audit failure/);
 await service.contribute(owners['privacy_officer'],f.riskId,privacy.id,{expectedVersion:version++,value:2,justification:'Privacy reassessment after completed controls'});
 const scoreVersion=context.configuration.referenceVersions.R_SCORE14;await db.governedReferenceVersion.update({where:{id:scoreVersion},data:{state:'retired',effectiveTo:new Date()}});
 context=await service.context(f.riskOwnerId,f.riskId);assert.equal(context.referencesCurrent,false);assert.equal(context.canComplete,false);
 await publish('R_SCORE14',scoreValues);await assert.rejects(service.start(f.riskOwnerId,f.riskId,version,undefined,true,''),/justification/);
 await assert.rejects(failed.start(f.riskOwnerId,f.riskId,version,undefined,true,'References changed'),/Injected residual audit failure/);
 await service.start(f.riskOwnerId,f.riskId,version++,undefined,true,'Reassess every dimension against current approved anchors');
 assert.equal((await db.workflowTask.findUniqueOrThrow({where:{id:privacy.id}})).status,'completed');context=await service.context(f.riskOwnerId,f.riskId);assert.ok(context.tasks.every(t=>t.score===null));
 const privacyRole=await db.role.findUniqueOrThrow({where:{code:'privacy_officer'}}),excluded=await db.roleDataScope.create({data:{roleId:privacyRole.id,scopeType:'org_unit',refId:'excluded-residual-org',includeDescendants:false}});
 await assert.rejects(service.context(owners['privacy_officer'],f.riskId),/not found/);await db.roleDataScope.delete({where:{id:excluded.id}});
 for(const task of context.tasks)await service.contribute(owners[task.assessorRoleCode!],f.riskId,task.id,{expectedVersion:version++,value:2,justification:`Fresh ${task.dimension} residual impact`});
 context=await service.context(f.riskOwnerId,f.riskId);assert.equal(context.canComplete,true);
 const complete={expectedVersion:version,likelihood:2,justification:'Fresh residual probability from test/incident evidence',currentControls:'Implemented, tested and evidenced post-treatment controls',controlEffectivenessCode:context.controlReference.values[0].code};
 await assert.rejects(service.complete(f.riskOwnerId,f.riskId,{...complete,currentControls:''}),/controls/);await assert.rejects(service.complete(f.riskOwnerId,f.riskId,{...complete,controlEffectivenessCode:'UNPUBLISHED'}),/choice/);
 await assert.rejects(failed.complete(f.riskOwnerId,f.riskId,complete),/Injected residual audit failure/);assert.equal(await db.aiAssessmentRound.count({where:{riskId:f.riskId,kind:'residual'}}),0);
 const done=await Promise.allSettled([service.complete(f.riskOwnerId,f.riskId,complete),service.complete(f.riskOwnerId,f.riskId,complete)]);assert.equal(done.filter(r=>r.status==='fulfilled').length,1);version++;
 const round=await db.aiAssessmentRound.findFirstOrThrow({where:{riskId:f.riskId,kind:'residual'}}),result=jsonRecord(round.result);assert.equal(result['score'],4);assert.equal(result['impactFinal'],2);assert.equal(result['bandCode'],'MEDIUM');assert.equal(result['riskReductionPct'],50);assert.equal(result['riskAccepted'],false);
 await assert.rejects(db.aiAssessmentRound.update({where:{id:round.id},data:{result:{score:1}}}));await assert.rejects(db.aiAssessmentRound.delete({where:{id:round.id}}));
 await assert.rejects(service.start(f.riskOwnerId,f.riskId,version),/already started\/scored/);assert.deepEqual(await db.aiAssessmentRound.findMany({where:{riskId:f.riskId,kind:'inherent'}}),inherent);
 assert.equal(await db.workflowTask.count({where:{caseId:risk.workflowCaseId!,status:'pending',templateStage:{code:'airs-residual-adoption'}}}),1);assert.equal((await db.workflowCase.findUniqueOrThrow({where:{id:risk.workflowCaseId!}})).status,'under_review');
 assert.equal((await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId}})).version,version);
 // ACCEPT at inherent Medium requires fresh residual scores even with no treatment plan.
 const accepted=await db.aiRisk.findUniqueOrThrow({where:{riskRef:'AIR-901'}});let v=(await service.context(f.riskOwnerId,accepted.id)).version;
 await service.start(f.riskOwnerId,accepted.id,v++);let c=await service.context(f.riskOwnerId,accepted.id);assert.equal(c.tasks.length,8);
 for(const t of c.tasks)await service.contribute(owners[t.assessorRoleCode!],accepted.id,t.id,{expectedVersion:v++,value:4,justification:'Residual deterioration must not be hidden'});
 c=await service.context(f.riskOwnerId,accepted.id);const critical=await service.complete(f.riskOwnerId,accepted.id,{...complete,expectedVersion:v,likelihood:4,controlEffectivenessCode:c.controlReference.values[0].code});assert.equal(critical.result.bandCode,'CRITICAL');assert.equal(critical.result.riskReductionPct,-300);assert.equal(critical.result.riskAccepted,false);
 const mitigated=await db.aiRisk.findUniqueOrThrow({where:{riskRef:'AIR-900'}});await assert.rejects(service.start(f.riskOwnerId,mitigated.id,(await service.context(f.riskOwnerId,mitigated.id)).version),/All approved treatment actions/);
 const app=await NestFactory.create(AppModule,{logger:false});try{app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');const base=await app.getUrl(),jwt=app.get(JwtService),headers={authorization:`Bearer ${jwt.sign({sub:f.riskOwnerId,tokenVersion:0,roles:['system_admin']})}`,'content-type':'application/json'};
 assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/residual`)).status,401);assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/residual`,{headers})).status,200);assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/residual/complete`,{method:'POST',headers,body:JSON.stringify({...complete,expectedVersion:version,score:1,riskAccepted:true,authorityRole:'AI_RISK_OWNER'})})).status,400);
 }finally{await app.close();}
 await testPhase3G(db,f);
 console.log('Phase 3F2 passed: completed-action/native-task/evidence prerequisites, High/Critical RM-24, fresh competent-role residual dimensions, controls without numeric modifiers, publication restart, immutable history, role/scope/Auditor/audit rollback, concurrent exactly-once start/scoring, ACCEPT deterioration, officer-review routing and HTTP protection.');
}
