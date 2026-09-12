import { testPhase3RSTU } from './ai-phase3rstu.integration';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiAnnualReviewService } from '../src/ai-governance/ai-annual-review.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AiReviewDisplayService } from '../src/ai-governance/ai-review-display.service';
import { AiRiskReviewService } from '../src/ai-governance/ai-risk-review.service';
import { AiReviewReportService, reviewMeasures } from '../src/ai-governance/ai-review-report.service';
import { AiMonthlyReviewService, monthlyReviewWindow } from '../src/ai-governance/ai-monthly-review.service';
import { ScopeService } from '../src/access/scope.service';

export async function testPhase3NOPQ(db:PrismaClient,f:{riskId:string;riskOwnerId:string;officerId:string;auditorId:string}){
 const app=await NestFactory.create(AppModule,{logger:false});
 try{
  app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');
  const prisma=db as PrismaService,annual=app.get(AiAnnualReviewService),reviews=app.get(AiRiskReviewService),display=app.get(AiReviewDisplayService),reports=app.get(AiReviewReportService),monthly=app.get(AiMonthlyReviewService),evidence=await db.ndiEvidence.findFirstOrThrow({where:{deletedAt:null}}),risk=await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId},include:{useCase:true}}),unitId=risk.useCase.organizationUnitId!;
  const failing={logRequired:async()=>{throw new Error('Continuity audit failure');}} as unknown as AuditService;
  const failedAnnual=new AiAnnualReviewService(prisma,app.get(AiAuthorizationService),app.get(ScopeService),app.get(AiRiskIntakeService),app.get(AiWorkflowRoutingService),new AiIdentifiersService(),failing),failedMonthly=new AiMonthlyReviewService(prisma,annual,failing);
  assert.equal((await display.configuration()).ready,false);
  async function publish(low:number,label:string){
   await db.governedReferenceList.upsert({where:{code:'R_CADENCE'},create:{code:'R_CADENCE',nameEn:'Review cadence',nameAr:'دورية المراجعة',ownerRoleCode:'AI_GOVERNANCE_OFFICER'},update:{}});
   for(const v of await db.governedReferenceVersion.findMany({where:{listCode:'R_CADENCE',state:'published'}}))await db.governedReferenceVersion.update({where:{id:v.id},data:{state:'retired',effectiveTo:new Date()}});
   const max=await db.governedReferenceVersion.aggregate({where:{listCode:'R_CADENCE'},_max:{version:true}}),v=await db.governedReferenceVersion.create({data:{listCode:'R_CADENCE',version:(max._max.version??0)+1,createdBy:'phase3n-synthetic',values:{create:[['LOW',low,'ANNUAL',label,'سنوي'],['MEDIUM',180,'SEMIANNUAL','Semiannual','نصف سنوي'],['HIGH',90,'QUARTERLY','Quarterly','ربع سنوي'],['CRITICAL',30,'MONTHLY','Monthly','شهري']].map(([band,intervalDays,code,en,ar],i)=>({code:String(code),labelEn:String(en),labelAr:String(ar),sortOrder:i,metadata:{residualBandCode:band,intervalDays}}))}}});
   return db.governedReferenceVersion.update({where:{id:v.id},data:{state:'published',effectiveFrom:new Date('2020-01-01'),approvedBy:'phase3n-synthetic',approvedAt:new Date()}});
  }
  await publish(365,'Unmatched annual');assert.equal((await display.configuration()).ready,false);
  const firstVersion=await publish(366,'Approved annual A');assert.equal((await display.configuration()).ready,true);
  let ctx=await reviews.context(f.riskOwnerId,f.riskId);await reviews.complete(f.riskOwnerId,f.riskId,ctx.history[0].id,{expectedVersion:ctx.version,justification:'Review with approved cadence label provenance',evidenceIds:[evidence.id]});
  const pinned=(await reviews.context(f.riskOwnerId,f.riskId)).history[0];assert.equal(pinned.cadenceReferenceVersionId,firstVersion.id);assert.equal(pinned.displayCadenceLabelEn,'Approved annual A');
  const secondVersion=await publish(366,'Approved annual B');assert.equal((await reports.detail(f.officerId,pinned.id)).displayCadenceLabelEn,'Approved annual A');
  await assert.rejects(db.aiRiskReview.update({where:{id:pinned.id},data:{displayCadenceLabelEn:'Forged label'}}),/append-only/);
  ctx=await reviews.context(f.riskOwnerId,f.riskId);await reviews.complete(f.riskOwnerId,f.riskId,ctx.history[0].id,{expectedVersion:ctx.version,justification:'Next review pins the newly approved display version',evidenceIds:[evidence.id]});assert.equal((await reviews.context(f.riskOwnerId,f.riskId)).history[0].cadenceReferenceVersionId,secondVersion.id);

  const officerRole=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}}),nominee=await db.user.create({data:{email:`continuity-${randomUUID()}@phase3o.test`,displayName:'Eligible continuity officer',passwordHash:'synthetic-test-only',userRoles:{create:{roleId:officerRole.id}}}}),old=(await annual.context(f.officerId,unitId)).history[0],handover={expectedHandoverRound:0,toOfficerId:nominee.id,justification:'Officer continuity; preserve original review deadline and scope',evidenceIds:[evidence.id]};
  await assert.rejects(failedAnnual.handover(f.officerId,old.id,handover),/Continuity audit/);assert.equal(await db.aiAnnualReviewHandover.count(),0);
  await assert.rejects(annual.handover(f.auditorId,old.id,handover),/explicit eligible/);
  await db.user.update({where:{id:nominee.id},data:{isActive:false}});await assert.rejects(annual.handover(f.officerId,old.id,handover),/explicit eligible/);await db.user.update({where:{id:nominee.id},data:{isActive:true}});
  // A different eligible officer can recover a review from an inactive incumbent.
  await db.user.update({where:{id:f.officerId},data:{isActive:false}});const race=await Promise.allSettled([annual.handover(nominee.id,old.id,handover),annual.handover(nominee.id,old.id,handover)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);await db.user.update({where:{id:f.officerId},data:{isActive:true}});
  const moved=(await annual.context(nominee.id,unitId)).history[0];assert.equal(moved.assignedOfficerId,f.officerId);assert.equal(moved.currentOfficerId,nominee.id);assert.equal(moved.handoverRound,1);assert.equal(moved.dueAt.toISOString(),old.dueAt.toISOString());assert.equal(moved.canComplete,true);
  await assert.rejects(db.aiAnnualReviewHandover.delete({where:{id:moved.handovers[0].id}}),/append-only/);await assert.rejects(db.workflowTask.update({where:{id:moved.taskId},data:{assigneeUserId:f.officerId}}),/Protected annual/);
  const completion={expectedRound:moved.round,expectedHandoverRound:1,trendsSummary:'Continuity trend findings',controlEffectivenessSummary:'Controls independently reviewed',nonconformitySummary:'Evidence-backed findings retained',evidenceIds:[evidence.id]};
  await assert.rejects(annual.complete(f.officerId,moved.id,{...completion,expectedHandoverRound:0}),/gate changed/);await annual.complete(nominee.id,moved.id,completion);const next=(await annual.context(nominee.id,unitId)).history[0];assert.equal(next.assignedOfficerId,nominee.id);assert.equal(next.handoverRound,0);

  const allRows=await db.aiRiskReview.findMany({where:{risk:{is:{deletedAt:null,isSampleData:false,riskRef:{not:null},useCase:{is:{deletedAt:null,isSampleData:false,asset:{is:{isActive:true,deletedAt:null}}}}}}},include:{completion:true,cancellation:true}}),all=await reports.report(f.officerId,1,1,'all');assert.deepEqual(all.periodic,reviewMeasures(allRows,all.asOf));assert.equal(all.calendarTotal,all.periodic.total);assert.equal(all.calendar.length,1);
  const page2=await reports.report(f.officerId,2,1,'all');assert.notEqual(page2.calendar[0].id,all.calendar[0].id);assert.equal(page2.periodic.total,all.periodic.total);
  for(const filter of ['completed','superseded','overdue']){const r=await reports.report(f.officerId,1,100,filter);assert.ok(r.calendar.every(c=>c.status===filter));}
  const exec=await db.user.findFirstOrThrow({where:{isActive:true,userRoles:{some:{role:{code:'AI_EXECUTIVE_TEAM',isActive:true}}}}});await assert.rejects(reports.detail(exec.id,pinned.id),/aggregate/);
  const excluded=await db.roleDataScope.create({data:{roleId:officerRole.id,scopeType:'org_unit',refId:randomUUID()}});await assert.rejects(reports.detail(f.officerId,pinned.id),/not found/);await db.roleDataScope.delete({where:{id:excluded.id}});assert.equal((await reports.detail(f.auditorId,pinned.id)).readOnly,true);

  assert.equal(monthlyReviewWindow('2024-02').end.toISOString(),'2024-02-29T20:59:59.999Z');assert.equal(monthlyReviewWindow('2025-12').end.toISOString(),'2025-12-31T20:59:59.999Z');
  const ksa=new Date(Date.now()+10800000),previous=new Date(Date.UTC(ksa.getUTCFullYear(),ksa.getUTCMonth()-1,1)).toISOString().slice(0,7),current=ksa.toISOString().slice(0,7);
  await assert.rejects(monthly.capture(f.officerId,unitId,current),/completed Saudi/);await assert.rejects(monthly.capture(f.auditorId,unitId,previous),/explicit eligible/);await assert.rejects(failedMonthly.capture(f.officerId,unitId,previous),/Continuity audit/);assert.equal(await db.aiMonthlyReviewReport.count(),0);
  const captured=await Promise.allSettled([monthly.capture(f.officerId,unitId,previous),monthly.capture(f.officerId,unitId,previous)]);assert.equal(captured.filter(r=>r.status==='fulfilled').length,1);
  // Also exercise SQL month arithmetic when the prior month has only 30 days.
  await monthly.capture(f.officerId,unitId,'2025-12');const monthlyRow=await db.aiMonthlyReviewReport.findUniqueOrThrow({where:{organizationUnitId_periodMonth:{organizationUnitId:unitId,periodMonth:previous}}}),snapshot=await monthly.get(f.auditorId,monthlyRow.id);assert.equal(snapshot.readOnly,true);assert.ok(!JSON.stringify(snapshot).includes('members'));assert.deepEqual(snapshot.measures,monthlyRow.measures);
  await assert.rejects(db.aiMonthlyReviewReport.update({where:{id:monthlyRow.id},data:{periodMonth:'2000-01'}}),/append-only/);
  const assetId=risk.useCase.assetId!;await db.dataAsset.update({where:{id:assetId},data:{isActive:false}});await assert.rejects(monthly.get(f.officerId,monthlyRow.id),/outside current register/);await db.dataAsset.update({where:{id:assetId},data:{isActive:true}});assert.deepEqual((await monthly.get(f.officerId,monthlyRow.id)).measures,snapshot.measures);
  const base=await app.getUrl(),jwt=app.get(JwtService),headers={authorization:`Bearer ${jwt.sign({sub:f.officerId,tokenVersion:0,roles:['system_admin']})}`,'content-type':'application/json'};
  assert.equal((await fetch(`${base}/api/ai/review-operations/cadence-config`,{headers})).status,200);assert.equal((await fetch(`${base}/api/ai/review-operations/report?filter=POSTED_STATUS`,{headers})).status,400);
  assert.equal((await fetch(`${base}/api/ai/review-operations/annual/${next.id}/handover`,{method:'POST',headers,body:JSON.stringify({...handover,actorId:f.officerId})})).status,400);assert.equal((await fetch(`${base}/api/ai/review-operations/monthly`,{method:'POST',headers,body:JSON.stringify({organizationUnitId:unitId,periodMonth:previous,capturedAt:new Date(),measures:{overdue:0}})})).status,400);
  await testPhase3RSTU(db,f);
  console.log('Phases 3N/3O/3P/3Q passed: approved cadence pins/version history, immutable officer handover/inactive recovery, scoped filtered SQL aggregates and read-only drilldown, closed-Saudi-month snapshots/visibility, evidence/audit rollback, concurrent exactly-once operations and HTTP input/privacy guards.');
 }finally{await app.close();}
}
