import { testPhase3J } from './ai-phase3j.integration';
import assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { ScopeService } from '../src/access/scope.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiRiskAssessmentService } from '../src/ai-governance/ai-risk-assessment.service';
import { AiResidualAssessmentService } from '../src/ai-governance/ai-residual-assessment.service';
import { AiResidualDecisionService } from '../src/ai-governance/ai-residual-decision.service';
import { AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AiRiskReviewService, aiReviewDue, aiReviewThresholds, aiReviewStatus } from '../src/ai-governance/ai-risk-review.service';
import { GovernanceOperationsService } from '../src/governance-operations/governance-operations.service';

export async function testPhase3HI(db:PrismaClient,f:{riskId:string;riskOwnerId:string;officerId:string;auditorId:string}) {
 const prisma=db as PrismaService,audit=new AuditService(prisma),auth=new AiAuthorizationService(prisma,audit),routing=new AiWorkflowRoutingService(prisma),scope=new ScopeService(prisma);
 const risks=new AiRiskIntakeService(prisma,auth,scope,routing,new AiIdentifiersService(),audit),scoring=new AiRiskAssessmentService(prisma,auth,risks,routing,audit),residual=new AiResidualAssessmentService(prisma,auth,risks,scoring,routing,audit),decisions=new AiResidualDecisionService(prisma,auth,risks,residual,scoring,routing,audit);
 const service=new AiRiskReviewService(prisma,auth,risks,decisions,routing,audit),failed=new AiRiskReviewService(prisma,auth,risks,decisions,routing,{logRequired:async()=>{throw new Error('Injected review audit failure');}} as unknown as AuditService);
 const gov=new GovernanceOperationsService(prisma,audit,scope),evidence=await db.ndiEvidence.findFirstOrThrow({where:{deletedAt:null}});
 const dto=(expectedVersion:number)=>({expectedVersion,justification:'Reviewed control evidence, incidents and continued conditions',evidenceIds:[evidence.id]});
 const officerRole=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}}),permission=await db.permission.findUniqueOrThrow({where:{resource_action:{resource:'airs.cadence',action:'manage'}}});
 await db.rolePermission.createMany({data:[{roleId:officerRole.id,permissionId:permission.id}],skipDuplicates:true});
 assert.equal(aiReviewDue(new Date('2026-01-01T22:00:00Z'),30).toISOString(),'2026-02-01T20:59:59.999Z');
 assert.equal(aiReviewStatus(false,new Date('2026-01-18T20:59:59Z'),new Date('2026-01-12T00:00:00Z')),'due_soon');
 assert.equal(aiReviewStatus(true,new Date('2026-01-01'),new Date('2026-01-12')),'completed');
 assert.deepEqual(aiReviewThresholds(new Date('2026-01-04T00:00:00Z'),new Date('2026-01-18T20:59:59Z'),new Date('2026-01-11T00:00:00Z')),[50]);
 assert.ok(!aiReviewThresholds(new Date('2026-01-04T00:00:00Z'),new Date('2026-01-18T20:59:59Z'),new Date('2026-01-18T18:00:00Z')).includes(100));
 // Published generic values are insufficient; no fallback intervals or write-on-GET.
 const before=await db.aiRiskReview.count(),current=await service.context(f.officerId,f.riskId);
 assert.equal(current.cadenceReady,false);await assert.rejects(service.register(f.officerId,f.riskId,current.version),/four-band/);assert.equal(await db.aiRiskReview.count(),before);
 const old=await db.governedReferenceVersion.findMany({where:{listCode:'R_LEVEL_DAYS',state:'published'}});for(const v of old)await db.governedReferenceVersion.update({where:{id:v.id},data:{state:'retired',effectiveTo:new Date()}});
 await db.governedReferenceList.upsert({where:{code:'R_LEVEL_DAYS'},create:{code:'R_LEVEL_DAYS',nameEn:'Review intervals',nameAr:'فترات المراجعة',ownerRoleCode:'AI_GOVERNANCE_OFFICER'},update:{}});
 async function publish(low=365) {
  const max=await db.governedReferenceVersion.aggregate({where:{listCode:'R_LEVEL_DAYS'},_max:{version:true}}),v=await db.governedReferenceVersion.create({data:{listCode:'R_LEVEL_DAYS',version:(max._max.version??0)+1,createdBy:'phase3hi-synthetic',values:{create:[['LOW',low],['MEDIUM',180],['HIGH',90],['CRITICAL',30]].map(([code,intervalDays],i)=>({code:code as string,labelEn:`${intervalDays} days`,labelAr:`${intervalDays} يوم`,sortOrder:i,metadata:{intervalDays,firstReviewImmediate:code==='CRITICAL'}}))}}});
  return db.governedReferenceVersion.update({where:{id:v.id},data:{state:'published',effectiveFrom:new Date('2020-01-01'),approvedBy:'phase3hi-synthetic',approvedAt:new Date()}});
 }
 const version=await publish();let c=await service.context(f.officerId,f.riskId);assert.equal(c.canRegister,true);
 await db.rolePermission.delete({where:{roleId_permissionId:{roleId:officerRole.id,permissionId:permission.id}}});assert.equal((await service.context(f.officerId,f.riskId)).canRegister,false);await assert.rejects(service.register(f.officerId,f.riskId,c.version),/explicit eligible/);await db.rolePermission.create({data:{roleId:officerRole.id,permissionId:permission.id}});
 await db.userRole.create({data:{userId:f.auditorId,roleId:officerRole.id}});await assert.rejects(service.register(f.auditorId,f.riskId,c.version),/explicit eligible/);await db.userRole.delete({where:{userId_roleId:{userId:f.auditorId,roleId:officerRole.id}}});
 const excluded=await db.roleDataScope.create({data:{roleId:officerRole.id,scopeType:'org_unit',refId:'excluded-review',includeDescendants:false}});await assert.rejects(service.context(f.officerId,f.riskId),/not found/);await db.roleDataScope.delete({where:{id:excluded.id}});
 await assert.rejects(failed.register(f.officerId,f.riskId,c.version),/Injected review audit failure/);assert.equal(await db.aiRiskReview.count(),before);
 const simultaneous=await Promise.allSettled([service.register(f.officerId,f.riskId,c.version),service.register(f.officerId,f.riskId,c.version)]);assert.equal(simultaneous.filter(v=>v.status==='fulfilled').length,1);
 c=await service.context(f.riskOwnerId,f.riskId);const medium=c.history[0];assert.equal(medium.intervalDays,180);assert.equal(medium.canComplete,true);assert.equal(medium.referenceVersionId,version.id);
 const snapshot=await db.aiRiskReview.findUniqueOrThrow({where:{id:medium.id}});assert.equal((await db.workflowCase.findUniqueOrThrow({where:{id:(await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId}})).workflowCaseId!}})).status,'implemented');
 await assert.rejects(db.aiRiskReview.update({where:{id:medium.id},data:{intervalDays:1}}),/append-only/);await assert.rejects(db.aiRiskReview.delete({where:{id:medium.id}}),/append-only/);
 await assert.rejects(db.workflowTask.update({where:{id:snapshot.taskId},data:{dueDate:new Date()}}),/protected/);await assert.rejects(db.complianceCalendarOccurrence.update({where:{id:snapshot.calendarOccurrenceId},data:{status:'completed',completedAt:new Date()}}),/protected/);
 await assert.rejects(gov.updateTemplate(snapshot.calendarTemplateId,{cadence:'monthly'},f.officerId),/protected AI/);
 await assert.rejects(db.complianceCalendarTemplate.update({where:{id:snapshot.calendarTemplateId},data:{nextRunAt:new Date()}}),/engine dates/);
 await assert.rejects(db.complianceCalendarTemplate.update({where:{id:snapshot.calendarTemplateId},data:{status:'paused'}}),/calendar (configuration is|engine dates are) protected/);
 await assert.rejects(service.complete(f.officerId,f.riskId,medium.id,dto(c.version)),/explicit eligible|Only/);await assert.rejects(service.complete(f.riskOwnerId,f.riskId,medium.id,{...dto(c.version),evidenceIds:[]}),/evidence/);
 await assert.rejects(service.complete(f.riskOwnerId,f.riskId,medium.id,dto(c.version-1)),/version changed/);await assert.rejects(failed.complete(f.riskOwnerId,f.riskId,medium.id,dto(c.version)),/Injected review audit failure/);assert.equal(await db.aiRiskReviewCompletion.count({where:{reviewId:medium.id}}),0);
 const owner=await db.person.findUniqueOrThrow({where:{id:(await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId}})).ownerPersonId!}});await db.person.update({where:{id:owner.id},data:{isActive:false}});assert.equal((await service.context(f.riskOwnerId,f.riskId)).history[0].canComplete,false);await assert.rejects(service.complete(f.riskOwnerId,f.riskId,medium.id,dto(c.version)),/active actual/);await db.person.update({where:{id:owner.id},data:{isActive:true}});
 // All bands consume metadata; Critical restriction remains unaccepted with immediate first review.
 for(const [ref,band,days] of [['AIR-971','LOW',365],['AIR-972','HIGH',90],['AIR-901','CRITICAL',30]] as const) {
  const risk=await db.aiRisk.findUniqueOrThrow({where:{riskRef:ref}}),g=await service.context(f.officerId,risk.id);await service.register(f.officerId,risk.id,g.version);const r=(await service.context(f.officerId,risk.id)).history[0];assert.equal(r.bandCode,band);assert.equal(r.intervalDays,days);
  if(band==='CRITICAL'){assert.equal(r.dueAt.getTime(),r.anchorAt.getTime());assert.equal((await decisions.context(f.officerId,risk.id)).riskAccepted,false);}
 }
 // Catch-up sweep emits each threshold once, persists native alerts/escalation, never dispatches email.
 const now=new Date(snapshot.dueAt.getTime()+20*86400000);
 await assert.rejects(failed.processSignals(now,f.riskId),/Injected review audit failure/);assert.equal(await db.aiRiskReviewSignal.count({where:{reviewId:medium.id}}),0);
 assert.equal((await service.processSignals(now,f.riskId)).created,4);assert.equal((await service.processSignals(now,f.riskId)).created,0);
 const signals=await db.aiRiskReviewSignal.findMany({where:{reviewId:medium.id},orderBy:{threshold:'asc'}});assert.deepEqual(signals.map(s=>s.threshold),[50,80,95,100]);
 assert.equal(await db.governanceNotification.count({where:{sourceType:'ai_risk_review',sourceId:medium.id}}),12);assert.equal(await db.governanceNotification.count({where:{sourceId:medium.id,emailSentAt:{not:null}}}),0);
 const escalation=await db.governanceEscalation.findFirstOrThrow({where:{sourceType:'ai_risk_review',sourceId:medium.id}});assert.equal(escalation.level,'executive_steering_committee');
 assert.equal(await db.governanceNotificationDeliveryAttempt.count({where:{notification:{sourceId:medium.id},status:'planned'}}),24);
 assert.equal(await db.governanceNotification.count({where:{sourceId:medium.id,title:{contains:'مراجعة'}}}),12);
 await assert.rejects(db.governanceEscalation.delete({where:{id:escalation.id}}),/Foreign key|foreign key/);
 await assert.rejects(db.aiRiskReviewSignal.update({where:{id:signals[0].id},data:{threshold:100}}),/append-only/);
 // Publication change applies to the next occurrence only; missing publication rolls the completion back.
 await db.governedReferenceVersion.update({where:{id:version.id},data:{state:'retired',effectiveTo:new Date()}});await assert.rejects(service.complete(f.riskOwnerId,f.riskId,medium.id,dto(c.version)),/four-band/);assert.equal(await db.aiRiskReviewCompletion.count({where:{reviewId:medium.id}}),0);
 const replacement=await publish(366);const done=await service.complete(f.riskOwnerId,f.riskId,medium.id,dto(c.version));const next=await db.aiRiskReview.findUniqueOrThrow({where:{id:done.nextReviewId}}),completion=await db.aiRiskReviewCompletion.findUniqueOrThrow({where:{reviewId:medium.id}});
 assert.equal(next.referenceVersionId,replacement.id);assert.equal(next.dueAt.toISOString(),aiReviewDue(completion.completedAt,180).toISOString());assert.deepEqual(await db.aiRiskReview.findUniqueOrThrow({where:{id:medium.id}}),snapshot);
 assert.equal(await db.governanceNotification.count({where:{sourceId:medium.id,status:{not:'archived'}}}),0);assert.equal((await db.governanceEscalation.findUniqueOrThrow({where:{id:escalation.id}})).status,'resolved');await assert.rejects(db.aiRiskReviewCompletion.delete({where:{id:completion.id}}),/append-only/);
 await assert.rejects(service.complete(f.riskOwnerId,f.riskId,medium.id,dto(done.version)),/gate\/version/);
 const low=await db.aiRisk.findUniqueOrThrow({where:{riskRef:'AIR-971'}}),lc=await service.context(f.riskOwnerId,low.id);const lowNext=await service.complete(f.riskOwnerId,low.id,lc.history[0].id,dto(lc.version));assert.equal((await db.aiRiskReview.findUniqueOrThrow({where:{id:lowNext.nextReviewId}})).intervalDays,366);assert.equal((await db.aiRiskReview.findUniqueOrThrow({where:{id:lc.history[0].id}})).intervalDays,365);
 const critical=await db.aiRisk.findUniqueOrThrow({where:{riskRef:'AIR-901'}}),cc=await service.context(f.riskOwnerId,critical.id),cr=cc.history[0];
 const sweep=await Promise.allSettled([service.processSignals(new Date(),critical.id),service.processSignals(new Date(),critical.id)]);assert.ok(sweep.some(v=>v.status==='fulfilled'));assert.equal(await db.aiRiskReviewSignal.count({where:{reviewId:cr.id}}),1);assert.equal((await db.aiRiskReviewSignal.findFirstOrThrow({where:{reviewId:cr.id}})).threshold,100);
 const criticalNext=await service.complete(f.riskOwnerId,critical.id,cr.id,dto(cc.version)),cn=await db.aiRiskReview.findUniqueOrThrow({where:{id:criticalNext.nextReviewId}});assert.equal(cn.dueAt.toISOString(),aiReviewDue(cn.anchorAt,30).toISOString());assert.equal((await db.aiUseCase.findUniqueOrThrow({where:{id:critical.useCaseId}})).operationalStatusCode,'SUSPENDED');assert.equal((await decisions.context(f.officerId,critical.id)).riskAccepted,false);
 const app=await NestFactory.create(AppModule,{logger:false});try{app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');const base=await app.getUrl(),jwt=app.get(JwtService),headers={authorization:`Bearer ${jwt.sign({sub:f.officerId,tokenVersion:0,roles:['system_admin']})}`,'content-type':'application/json'};
  assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/reviews`)).status,401);assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/reviews`,{headers})).status,200);
  assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/reviews/register`,{method:'POST',headers,body:JSON.stringify({expectedVersion:done.version,dueAt:'2026-01-01',intervalDays:1,bandCode:'LOW',actorId:f.officerId})})).status,400);
 }finally{await app.close();}
 await testPhase3J(db,f);
 console.log('Phases 3H/3I passed: four-band publication gates, KSA deadlines, actual-owner calendar completion and next occurrence, pinning/future publication updates, immutable native/AI history, role/scope/Auditor/stale-write blocks, audit rollback and concurrent registration, 50/80/95/100 catch-up dedupe, native escalation and archival, no email dispatch, HTTP field protection.');
}
