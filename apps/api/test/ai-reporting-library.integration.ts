import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { AiDashboardReportsService, reportCsvCell, reportSlots } from '../src/ai-governance/ai-dashboard-reports.service';
import { AiDashboardService } from '../src/ai-governance/ai-dashboard.service';
import { AiAnnualReviewService } from '../src/ai-governance/ai-annual-review.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiRiskLibraryService } from '../src/ai-governance/ai-risk-library.service';
import { AiRiskInitiationService } from '../src/ai-governance/ai-risk-initiation.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { governanceDigest } from '../src/ai-governance/ai-governance-ledger';
import { jsonRecord } from '../src/ai-governance/ai-risk-scoring';

export async function testReportingLibrary(db:PrismaClient,f:{riskId:string;riskOwnerId:string;officerId:string;auditorId:string}){
 const app=await NestFactory.create(AppModule,{logger:false});
 try{
  app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');
  const reports=app.get(AiDashboardReportsService),library=app.get(AiRiskLibraryService),initiation=app.get(AiRiskInitiationService),intake=app.get(AiRiskIntakeService);
  const risk=await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId},include:{useCase:true}}),unitId=risk.useCase.organizationUnitId!,assetId=risk.useCase.assetId!;
  const exec=await db.user.findFirstOrThrow({where:{isActive:true,userRoles:{some:{role:{code:'AI_EXECUTIVE_TEAM',isActive:true}}}}}),admin=await db.user.findFirstOrThrow({where:{isActive:true,userRoles:{some:{role:{code:'dmo_admin',isActive:true}}}}}),ev=await db.ndiEvidence.findFirstOrThrow({where:{deletedAt:null}});
  assert.deepEqual(reportSlots(new Date('2025-12-31T21:00:00Z')),{daily:'2026-01-01',monthly:'2025-12'});
  assert.deepEqual(reportSlots(new Date('2024-02-29T20:59:59Z')),{daily:'2024-02-29',monthly:'2024-01'});
  assert.equal(governanceDigest({b:1,a:{z:2,y:3}}),governanceDigest({a:{y:3,z:2},b:1}));
  assert.equal(reportCsvCell('=SUM(A1:A2)'),`"'=SUM(A1:A2)"`);assert.equal(reportCsvCell('  @command'),`"'  @command"`);assert.equal(reportCsvCell(-12.5),'-12.5');assert.equal(reportCsvCell('عربي "quote"'),'"عربي ""quote"""');
  assert.equal((await reports.processDue()).captured,0);assert.equal((await reports.schedule(f.officerId,unitId)).latest,null);
  const first=await reports.capture(f.officerId,unitId),saved=await reports.get(f.auditorId,first.id);
  assert.equal(saved.readOnly,true);assert.equal(saved.projection.cards.length,21);assert.equal(saved.projection['observationBasis'],'current_scope_at_capture');assert.equal(saved.projection['periodMeaning'],'cadence_slot');assert.ok(!JSON.stringify(saved).includes('sourceMembers'));assert.equal(saved.projection['topRisks'] instanceof Array,true);
  const executive=await reports.get(exec.id,first.id);assert.equal(executive.aggregateOnly,true);assert.equal(executive.projection.cards.length,9);assert.equal(executive.projection['governance'],null);assert.deepEqual(executive.projection['distribution'],[]);assert.ok(!JSON.stringify(executive).includes(risk.riskRef!));
  await assert.rejects(reports.capture(f.auditorId,unitId),/explicit eligible|operator/);await assert.rejects(reports.capture(exec.id,unitId),/explicit eligible|operator/);await assert.rejects(reports.get(f.riskOwnerId,first.id),/register visibility|authority/);await assert.rejects(reports.schedule(exec.id,unitId),/schedule visibility/);
  await assert.rejects(db.aiDashboardSnapshot.update({where:{id:first.id},data:{periodKey:'tampered'}}),/append-only/);await assert.rejects(db.aiDashboardSnapshot.delete({where:{id:first.id}}),/append-only/);
  const failedAudit={logRequired:async()=>{throw new Error('Injected governance ledger audit failure');}} as unknown as AuditService;
  const failedReports=new AiDashboardReportsService(db as PrismaService,app.get(AiDashboardService),app.get(AiAnnualReviewService),app.get(AiAuthorizationService),failedAudit),count=await db.aiDashboardSnapshot.count();
  await assert.rejects(failedReports.capture(f.officerId,unitId),/Injected/);assert.equal(await db.aiDashboardSnapshot.count(),count);
  const daily=await Promise.all([reports.capture(f.officerId,unitId,'daily'),reports.capture(f.officerId,unitId,'daily')]);assert.equal(daily[0].id,daily[1].id);assert.equal(daily.filter(r=>r.created).length,1);
  const policy={expectedRound:0,dailyEnabled:true,monthlyEnabled:true,justification:'Engineering reporting schedule fixture',evidenceIds:[ev.id]};
  await assert.rejects(failedReports.configure(f.officerId,unitId,policy),/Injected/);assert.equal(await db.aiDashboardScheduleVersion.count(),0);
  const schedule=await reports.configure(f.officerId,unitId,policy);await assert.rejects(reports.configure(f.officerId,unitId,policy),/changed/);await assert.rejects(reports.configure(f.auditorId,unitId,{...policy,expectedRound:1}),/explicit eligible|operator/);
  await assert.rejects(db.aiDashboardScheduleVersion.update({where:{id:schedule.id},data:{dailyEnabled:false}}),/append-only/);
  const cycle=await Promise.all([reports.processDue(),reports.processDue()]);assert.equal(cycle.reduce((n,r)=>n+r.captured,0),1);assert.equal((await reports.processDue()).captured,0);
  const runs=await db.aiDashboardScheduleRun.findMany();assert.equal(runs.length,2);assert.ok(runs.every(r=>r.status==='success'&&!!r.snapshotId));await assert.rejects(db.aiDashboardScheduleRun.delete({where:{id:runs[0].id}}),/append-only/);
  const nextDay=new Date(Date.now()+86400000),exhaustDay=new Date(Date.now()+172800000);
  await db.user.update({where:{id:f.officerId},data:{isActive:false}});
  try{await reports.processDue(nextDay);assert.equal((await db.aiDashboardScheduleRun.findFirstOrThrow({where:{periodKey:reportSlots(nextDay).daily}})).errorCode,'ACCESS_UNAVAILABLE');await reports.processDue(new Date(nextDay.getTime()+60000));assert.equal(await db.aiDashboardScheduleRun.count({where:{periodKey:reportSlots(nextDay).daily}}),1);
   for(let n=0;n<4;n++)await reports.processDue(new Date(exhaustDay.getTime()+n*300000));assert.equal(await db.aiDashboardScheduleRun.count({where:{periodKey:reportSlots(exhaustDay).daily}}),3);
  }finally{await db.user.update({where:{id:f.officerId},data:{isActive:true}});}
  assert.equal((await reports.processDue(new Date(nextDay.getTime()+300000))).captured,1);
  const disabled=await reports.configure(f.officerId,unitId,{...policy,expectedRound:1,dailyEnabled:false,monthlyEnabled:false});assert.equal((await reports.processDue(new Date(Date.now()+259200000))).captured,0);const operation=await reports.schedule(f.auditorId,unitId);assert.equal(operation.canManage,false);assert.equal(operation.history.length,2);assert.ok(operation.runs.some(r=>r.status==='failed'));assert.equal(operation.latest!.round,disabled.round);
  await db.dataAsset.update({where:{id:assetId},data:{isActive:false}});await assert.rejects(reports.get(f.officerId,first.id),/outside current register/);await db.dataAsset.update({where:{id:assetId},data:{isActive:true}});
  const officerRole=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}}),restricted=await db.roleDataScope.create({data:{roleId:officerRole.id,scopeType:'data_domain',refId:randomUUID()}});await assert.rejects(reports.get(f.officerId,first.id),/full domain|visibility/);await db.roleDataScope.delete({where:{id:restricted.id}});

  const lookups=await library.lookups(f.officerId),content:Record<string,string>={titleEn:'Synthetic governed library risk',titleAr:'خطر اصطناعي لاختبار المكتبة',risk_domain:'Engineering fixture',description:'Documented hypothetical event',probable_causes:'Potential engineering fixture cause',probable_impacts:'Potential engineering fixture effect',example_controls:'Suggested controls, not confirmed actual controls',attention_indicators:'Review engineering evidence'};
  for(const l of lookups.lists)content[l.field]=l.values[0].code;
  const proposal={expectedRound:0,content,justification:'Engineering governed library fixture',evidenceIds:[ev.id]};
  const v1=await library.propose(f.officerId,proposal);assert.match(v1.libraryRef,/^AIRL-\d{3,}$/u);assert.equal((await library.list(f.riskOwnerId)).total,0);
  await assert.rejects(library.publish(f.officerId,v1.versionId,'Officer cannot publish',[ev.id]),/explicit eligible/);await assert.rejects(library.propose(f.auditorId,proposal),/explicit eligible/);await assert.rejects(library.propose(f.officerId,{...proposal,content:{...content,computedScore:'16'}}),/computed library fields/);
  const key=randomUUID(),draftRequest={useCaseId:risk.useCaseId,libraryVersionId:v1.versionId,initiationKey:key,justification:'Engineering library instantiation'};
  await assert.rejects(initiation.create(f.riskOwnerId,draftRequest),/published library/);
  const failedLibrary=new AiRiskLibraryService(db as PrismaService,app.get(AiAuthorizationService),intake,app.get((await import('../src/ai-governance/ai-identifiers.service')).AiIdentifiersService),failedAudit);
  await assert.rejects(failedLibrary.publish(admin.id,v1.versionId,'Reviewed publication',[ev.id]),/Injected/);assert.equal(await db.aiRiskLibraryPublication.count(),0);
  await library.publish(admin.id,v1.versionId,'Independent reviewed engineering publication',[ev.id]);assert.equal((await library.list(f.auditorId,1,1,'اصطناعي')).total,1);
  const draft=await Promise.all([initiation.create(f.riskOwnerId,draftRequest),initiation.create(f.riskOwnerId,draftRequest)]);assert.equal(draft[0].id,draft[1].id);assert.equal(draft.filter(r=>r.created).length,1);
  const item=await intake.get(f.riskOwnerId,draft[0].id);assert.equal(item.riskRef,null);assert.equal(item.canEdit,true);assert.equal(item.libraryVersion!.entry.libraryRef,v1.libraryRef);assert.equal(item.libraryVersion!.round,1);assert.equal(jsonRecord(item.intakeData)['event'],'');assert.equal(jsonRecord(item.intakeData)['current_controls'],'');assert.equal(item.assessments.length,0);
  await assert.rejects(intake.submit(f.riskOwnerId,item.id,item.version),/validation/);assert.equal((await db.aiRisk.findUniqueOrThrow({where:{id:item.id}})).riskRef,null);
  await assert.rejects(initiation.create(f.riskOwnerId,{...draftRequest,useCaseId:randomUUID()}),/not found/);await assert.rejects(initiation.create(f.auditorId,{...draftRequest,initiationKey:randomUUID()}),/explicit eligible/);
  await assert.rejects(db.aiRisk.update({where:{id:item.id},data:{libraryVersionId:null}}),/provenance is immutable/);await assert.rejects(db.aiRiskLibraryVersion.update({where:{id:v1.versionId},data:{content:{titleAr:'Tampered'}}}),/append-only/);
  const lists=await intake.lookups(f.riskOwnerId),patch:Record<string,unknown>={title:'Identified library test risk',cause:content.probable_causes,event:'Confirmed engineering event',effect:content.probable_impacts,current_controls:'Confirmed actual engineering controls',third_party_involved:false,evidence:[ev.id]};for(const l of lists.lists)patch[l.field]=l.values[0].code;
  const edited=await intake.save(f.riskOwnerId,item.id,item.version,patch),submitted=await intake.submit(f.riskOwnerId,item.id,edited.version);assert.match(submitted.riskRef,/^AIR-\d{3,}$/u);assert.equal((await intake.get(f.riskOwnerId,item.id)).libraryVersion!.id,v1.versionId);
  const second=await reports.capture(f.officerId,unitId),comparison=await reports.compare(f.auditorId,first.id,second.id);assert.equal(comparison.rows.find(k=>k.id==='GEN-86')!.delta,1);assert.equal(comparison.rows.find(k=>k.id==='GEN-101')!.deltaUnit,'percentage_points');assert.equal(comparison.populationMayChange,true);await assert.rejects(reports.compare(f.officerId,first.id,daily[0].id),/same register and frequency/);
  const page1=await reports.list(f.officerId,unitId,1,1),page2=await reports.list(f.officerId,unitId,2,1);assert.equal(page1.total,page2.total);assert.notEqual(page1.rows[0].id,page2.rows[0].id);const csv=await reports.csv(exec.id,first.id);assert.ok(csv.includes('GEN-85'));assert.ok(!csv.includes('GEN-100'));assert.ok(csv.startsWith('\uFEFF'));
  const v2=await library.propose(f.officerId,{...proposal,entryId:v1.entryId,expectedRound:1,content:{...content,titleAr:'إصدار ثانٍ اصطناعي'}});await library.publish(admin.id,v2.versionId,'Reviewed second version',[ev.id]);await assert.rejects(initiation.create(f.riskOwnerId,{...draftRequest,initiationKey:randomUUID()}),/publication changed/);assert.equal((await intake.get(f.riskOwnerId,item.id)).libraryVersion!.round,1);
  const wg=await db.user.findFirstOrThrow({where:{isActive:true,userRoles:{some:{role:{code:'AI_WORKING_GROUP',isActive:true}}}}}),manual=await initiation.create(wg.id,{useCaseId:risk.useCaseId,initiationKey:randomUUID(),justification:'Workshop engineering fixture'});assert.equal((await intake.get(wg.id,manual.id)).canAssignOwner,true);assert.equal((await intake.get(wg.id,manual.id)).riskRef,null);assert.equal((await intake.get(wg.id,manual.id)).libraryVersion,null);
  const failedInitiation=new AiRiskInitiationService(db as PrismaService,app.get((await import('../src/access/scope.service')).ScopeService),app.get(AiAuthorizationService),intake,library,app.get((await import('../src/ai-governance/ai-identifiers.service')).AiIdentifiersService),app.get((await import('../src/ai-governance/ai-workflow-routing.service')).AiWorkflowRoutingService),failedAudit),riskCount=await db.aiRisk.count();await assert.rejects(failedInitiation.create(wg.id,{useCaseId:risk.useCaseId,initiationKey:randomUUID(),justification:'Rollback fixture'}),/Injected/);assert.equal(await db.aiRisk.count(),riskCount);
  const rejectedParent=await db.aiUseCase.findFirstOrThrow({where:{operationalStatusCode:'ARCHIVED'}});await assert.rejects(initiation.create(f.riskOwnerId,{useCaseId:rejectedParent.id,initiationKey:randomUUID(),justification:'Retired parent forbidden'}),/not found/);

  const base=await app.getUrl(),jwt=app.get(JwtService),headers={authorization:'Bearer '+jwt.sign({sub:f.officerId,tokenVersion:0,roles:['system_admin']}),'content-type':'application/json'};
  assert.equal((await fetch(base+'/api/ai/dashboard-reports/snapshots/'+first.id,{headers})).status,200);assert.equal((await fetch(base+'/api/ai/dashboard-reports/snapshots/'+first.id+'/export',{headers})).headers.get('content-type')!.includes('text/csv'),true);
  assert.equal((await fetch(base+'/api/ai/dashboard-reports/snapshots',{method:'POST',headers,body:JSON.stringify({organizationUnitId:unitId,frequency:'manual',asOf:new Date()})})).status,400);
  assert.equal((await fetch(base+'/api/ai/risks',{method:'POST',headers,body:JSON.stringify({...draftRequest,initiationKey:randomUUID(),riskRef:'AIR-001',score:16})})).status,400);assert.equal((await fetch(base+'/api/ai/risk-library',{headers})).status,200);assert.equal((await fetch(base+'/api/ai/risks/initiation',{headers})).status,200);assert.equal((await fetch(base+'/api/ai/dashboard-reports/snapshots/'+first.id)).status,401);
  const pins=jsonRecord((await db.aiRiskLibraryVersion.findUniqueOrThrow({where:{id:v2.versionId}})).referencePins),ethicsId=String(jsonRecord(pins['ethics_principle'])['versionId']);
  const v3=await library.propose(f.officerId,{...proposal,entryId:v1.entryId,expectedRound:2});await db.governedReferenceVersion.update({where:{id:ethicsId},data:{state:'retired',effectiveTo:new Date()}});await assert.rejects(library.publish(admin.id,v3.versionId,'Stale references blocked',[ev.id]),/published R_ETHICS|publication changed/);await assert.rejects(initiation.create(f.riskOwnerId,{...draftRequest,libraryVersionId:v2.versionId,initiationKey:randomUUID()}),/published R_ETHICS|reviewed publication/);
  console.log('Ten phases 3X–4G passed: immutable scoped 21-KPI captures/digests, existing-worker daily/month slots/exactly-once/retry/exhaustion, archive/privacy/reconciliation/comparison/CSV, versioned schedule history/audit rollback, independent pinned library proposal/publication/browse, stale source exclusion, idempotent scoped workshop/library drafts, owner completion/submit and immutable AIRL→AIR provenance, HTTP field protection.');
 }finally{await app.close();}
}
