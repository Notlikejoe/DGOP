import { testPhase3NOPQ } from './ai-phase3nopq.integration';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { ScopeService } from '../src/access/scope.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiAnnualReviewService } from '../src/ai-governance/ai-annual-review.service';
import { AiReviewReportService, reviewMeasures } from '../src/ai-governance/ai-review-report.service';
import { aiReviewDue } from '../src/ai-governance/ai-risk-review.service';
import { GovernanceOperationsService } from '../src/governance-operations/governance-operations.service';

export async function testPhase3KM(db:PrismaClient,f:{riskId:string;riskOwnerId:string;officerId:string;auditorId:string}) {
 const prisma=db as PrismaService,audit=new AuditService(prisma),auth=new AiAuthorizationService(prisma,audit),scope=new ScopeService(prisma),routing=new AiWorkflowRoutingService(prisma),ids=new AiIdentifiersService(),risks=new AiRiskIntakeService(prisma,auth,scope,routing,ids,audit);
 const service=new AiAnnualReviewService(prisma,auth,scope,risks,routing,ids,audit),failed=new AiAnnualReviewService(prisma,auth,scope,risks,routing,ids,{logRequired:async()=>{throw new Error('Annual audit failure');}} as unknown as AuditService),reports=new AiReviewReportService(prisma,auth,scope,risks),gov=new GovernanceOperationsService(prisma,audit,scope);
 const risk=await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId},include:{useCase:true}}),unitId=risk.useCase.organizationUnitId!,evidence=await db.ndiEvidence.findFirstOrThrow({where:{deletedAt:null}});
 assert.equal((await service.context(f.officerId,unitId)).canRegister,true);
 await assert.rejects(service.register(f.auditorId,unitId),/explicit eligible/);await assert.rejects(service.register(f.riskOwnerId,unitId),/register visibility/);
 await assert.rejects(failed.register(f.officerId,unitId),/Annual audit/);assert.equal(await db.aiAnnualReview.count(),0);
 const race=await Promise.allSettled([service.register(f.officerId,unitId),service.register(f.officerId,unitId)]);assert.equal(race.filter(v=>v.status==='fulfilled').length,1);
 const review=await db.aiAnnualReview.findFirstOrThrow({where:{organizationUnitId:unitId},include:{task:true,calendarTemplate:true}});
 assert.equal(review.dueAt.toISOString(),aiReviewDue(review.anchorAt,365).toISOString());assert.equal(review.task.assigneeUserId,f.officerId);assert.equal(review.calendarTemplate.type,'ai_annual_review');
 assert.equal((await service.context(f.auditorId,unitId)).history[0].canComplete,false);
 const officerRole=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}}),excluded=await db.roleDataScope.create({data:{roleId:officerRole.id,scopeType:'org_unit',refId:randomUUID()}});await assert.rejects(service.context(f.officerId,unitId),/not found/);await db.roleDataScope.delete({where:{id:excluded.id}});
 const domain=await db.roleDataScope.create({data:{roleId:officerRole.id,scopeType:'data_domain',refId:randomUUID()}});await assert.rejects(service.context(f.officerId,unitId),/full domain/);await db.roleDataScope.delete({where:{id:domain.id}});
 await assert.rejects(db.aiAnnualReview.update({where:{id:review.id},data:{dueAt:new Date()}}),/append-only/);await assert.rejects(db.workflowTask.update({where:{id:review.taskId},data:{dueDate:new Date()}}),/Protected annual/);await assert.rejects(db.complianceCalendarOccurrence.update({where:{id:review.calendarOccurrenceId},data:{status:'completed'}}),/Protected annual/);
 await assert.rejects(gov.updateTemplate(review.calendarTemplateId,{title:'Bypass annual'} as never,f.officerId),/protected AI/);
 const dto={expectedRound:1,trendsSummary:'Annual trend reviewed against the retained register snapshot',controlEffectivenessSummary:'Control evidence reviewed; improvements recorded',nonconformitySummary:'No unaddressed non-conformities in supplied evidence',evidenceIds:[evidence.id]};
 await assert.rejects(service.complete(f.officerId,review.id,{...dto,trendsSummary:' '}),/Written trends/);await assert.rejects(service.complete(f.officerId,review.id,{...dto,evidenceIds:[randomUUID()]}),/Every evidence/);
 await assert.rejects(failed.complete(f.officerId,review.id,dto),/Annual audit/);assert.equal(await db.aiAnnualReviewCompletion.count(),0);assert.equal(await db.aiAnnualReview.count(),1);
 const completed=await Promise.allSettled([service.complete(f.officerId,review.id,dto),service.complete(f.officerId,review.id,dto)]);assert.equal(completed.filter(v=>v.status==='fulfilled').length,1);
 const completion=await db.aiAnnualReviewCompletion.findUniqueOrThrow({where:{reviewId:review.id}}),next=await db.aiAnnualReview.findFirstOrThrow({where:{organizationUnitId:unitId,round:2}});assert.equal(next.calendarTemplateId,review.calendarTemplateId);assert.equal(next.anchorAt.toISOString(),completion.completedAt.toISOString());assert.equal(next.dueAt.toISOString(),aiReviewDue(completion.completedAt,365).toISOString());
 await assert.rejects(db.aiAnnualReviewCompletion.delete({where:{id:completion.id}}),/append-only/);await assert.rejects(db.workflowTask.update({where:{id:review.taskId},data:{status:'pending'}}),/Protected annual/);
 // Snapshot membership fails closed when an asset/member is no longer currently visible.
 const assetId=risk.useCase.assetId!;await db.dataAsset.update({where:{id:assetId},data:{isActive:false}});await assert.rejects(service.context(f.officerId,unitId),/outside current register/);await db.dataAsset.update({where:{id:assetId},data:{isActive:true}});
 const now=new Date('2026-09-12T09:00:00Z'),due=new Date(now.getTime()-1000);const metrics=reviewMeasures([{dueAt:due,completion:null},{dueAt:due,completion:{completedAt:due}},{dueAt:due,completion:{completedAt:now}},{dueAt:due,completion:null,cancellation:{id:'superseded'}}],now);assert.equal(metrics.overdue,1);assert.equal(metrics.due,3);assert.equal(metrics.onTimePercent,33.33);assert.equal(metrics.superseded,1);assert.equal(reviewMeasures([],now).onTimePercent,null);
 const actualRows=await db.aiRiskReview.findMany({where:{risk:{is:{deletedAt:null,isSampleData:false,riskRef:{not:null},useCase:{is:{isSampleData:false,deletedAt:null,asset:{is:{isActive:true,deletedAt:null}}}}}}},include:{completion:true,cancellation:true}}),report=await reports.report(f.officerId,1,1);assert.equal(report.periodic.total,actualRows.length);assert.ok(report.calendar.length<=1);assert.equal(report.calendarTotal,await db.aiRiskReview.count({where:{completion:{is:null},cancellation:{is:null},dueAt:{gte:report.asOf,lte:new Date(report.asOf.getTime()+30*86400000)},risk:{is:{deletedAt:null,isSampleData:false,riskRef:{not:null},useCase:{is:{isSampleData:false,deletedAt:null,asset:{is:{isActive:true,deletedAt:null}}}}}}}}));
 const owned=await reports.report(f.riskOwnerId);assert.equal(owned.mode,'risk_owner');for(const r of owned.calendar)assert.equal((await db.aiRisk.findUniqueOrThrow({where:{id:r.riskId},include:{owner:true}})).owner?.userId,f.riskOwnerId);const ownedRows=await db.aiRiskReview.count({where:{risk:{is:{deletedAt:null,isSampleData:false,riskRef:{not:null},owner:{is:{userId:f.riskOwnerId}},useCase:{is:{isSampleData:false,deletedAt:null,asset:{is:{isActive:true,deletedAt:null}}}}}}}});assert.equal(owned.periodic.total,ownedRows);
 const exec=await db.user.findFirstOrThrow({where:{isActive:true,userRoles:{some:{role:{code:'AI_EXECUTIVE_TEAM',isActive:true}}}}});const executive=await reports.report(exec.id);assert.equal(executive.aggregateOnly,true);assert.equal(executive.calendar.length,0);assert.ok(!JSON.stringify(executive).includes(risk.riskRef!));assert.equal((await reports.report(f.auditorId)).mode,'audit');
 const app=await NestFactory.create(AppModule,{logger:false});try{app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');const base=await app.getUrl(),jwt=app.get(JwtService),headers={authorization:`Bearer ${jwt.sign({sub:f.officerId,tokenVersion:0,roles:['system_admin']})}`,'content-type':'application/json'};assert.equal((await fetch(`${base}/api/ai/review-operations/annual`,{method:'POST',headers,body:JSON.stringify({organizationUnitId:unitId,dueAt:now,actorId:f.officerId})})).status,400);assert.equal((await fetch(`${base}/api/ai/review-operations/report?page=0`,{headers})).status,400);assert.equal((await fetch(`${base}/api/ai/review-operations/report`,{headers})).status,200);assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/reviews/triggers`,{method:'POST',headers,body:JSON.stringify({expectedVersion:0,triggerCode:'incident',justification:'Injected fields',evidenceIds:[evidence.id],requiredInherentRound:1})})).status,400);}finally{await app.close();}
 await testPhase3NOPQ(db,f);
 console.log('Phases 3K/3M passed: full-register annual officer review/findings, native 365-day calendar, scoped immutable snapshot, evidence/audit rollback, exactly-once next cycle, protected native history, complete-population due/on-time measures, actual-owner reporting, executive aggregate-only and Auditor read-only HTTP contracts.');
}
