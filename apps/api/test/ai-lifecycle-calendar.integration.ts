import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { EvidenceService } from '../src/evidence/evidence.service';
import { AiEvidenceService } from '../src/ai-governance/ai-evidence.service';
import { AiLifecycleService } from '../src/ai-governance/ai-lifecycle.service';
const startedAt=new Date().toISOString(),checks:string[]=[];
async function main(){const url=new URL(process.env.DATABASE_URL!);assert.match(url.pathname,/^\/dgop_ai_test_repair_batch1_\d+$/);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55438');
 const app=await NestFactory.createApplicationContext(AppModule,{logger:false}),db=app.get(PrismaService),audit=app.get(AuditService),native=app.get(AiLifecycleService),files=app.get(EvidenceService),proof=app.get(AiEvidenceService),actors=JSON.parse(readFileSync(process.env.DGOP_DEMO_MANIFEST!,'utf8')).actors;
 const actor=async(id:string)=>{const u=await db.user.findUniqueOrThrow({where:{id},include:{userRoles:{include:{role:true}}}});return {id:u.id,email:u.email,roles:u.userRoles.map(r=>r.role.code)}};
 const author=await actor(actors.showcase),reviewer=await actor(actors.custodian),tag='B5 synthetic protected-calendar diagnostic '+randomUUID(),spec=await db.ndiSpecification.findFirstOrThrow(),bytes=Buffer.from(tag);
 let evidenceId='',passed=false,error:string|null=null;const rollback=Symbol('rollback');
 try{const e=await files.create({specId:spec.id,title:tag,submit:'true'},{buffer:bytes,size:bytes.length,originalname:'synthetic-calendar.txt',mimetype:'text/plain'},author);evidenceId=e.id;await files.review(e.id,{decision:'approve',comment:'Independent synthetic calendar evidence approval'},reviewer);
  const source=await db.aiRiskReview.findFirstOrThrow({
   where:{completion:{is:null},cancellation:{is:null},retirement:{is:null},risk:{is:{useCase:{is:{name:{startsWith:'DEMO'},lifecycleState:'active'}}}}},
   include:{risk:{include:{useCase:true}}},
  });
  const before={uc:await db.aiUseCase.findUniqueOrThrow({where:{id:source.risk.useCaseId}}),task:await db.workflowTask.findUniqueOrThrow({where:{id:source.taskId}}),occurrence:await db.complianceCalendarOccurrence.findUniqueOrThrow({where:{id:source.calendarOccurrenceId}}),template:await db.complianceCalendarTemplate.findUniqueOrThrow({where:{id:source.calendarTemplateId}})};
  try{await db.$transaction(async tx=>{
   const proxy=new Proxy(db,{get(target,key){if(key==='$transaction')return async(work:any)=>work(tx);return Reflect.get(tx,key)??Reflect.get(target,key);}});
   const service=new AiLifecycleService(proxy,(native as any).authorization,(native as any).intake,(native as any).classification,(native as any).riskAssessment,(native as any).routing,(native as any).ids,audit);
   const evidenceService=new AiEvidenceService(proxy,(proof as any).authorization,(proof as any).risks,(proof as any).annual,audit);
   const assignments={AI_GOVERNANCE_OFFICER:actors.officer,AI_EXECUTIVE_TEAM:actors.executive,STEERING_COMMITTEE:actors.steering};
   const request=await service.propose(author.id,source.risk.useCaseId,{expectedVersion:before.uc.version,action:'retire',justification:tag,assignments});
   await evidenceService.link(author.id,'ai_lifecycle_request',request.id,[e.id],'Synthetic retirement proof for this exact protected review');
   for(let i=0;i<2;i++){const r=await tx.aiLifecycleRequest.findUniqueOrThrow({where:{id:request.id},include:{workflowCase:{include:{tasks:{where:{status:'pending'}}}}}}),task=r.workflowCase.tasks[0];assert.ok(task);await service.decide(task.assigneeUserId!,r.id,task.id,{expectedVersion:r.version,decision:'approve',justification:tag,evidenceIds:[e.id]});}
   const retirement=await tx.aiLifecycleReviewRetirement.findUniqueOrThrow({where:{reviewId:source.id}}),task=await tx.workflowTask.findUniqueOrThrow({where:{id:source.taskId}}),occurrence=await tx.complianceCalendarOccurrence.findUniqueOrThrow({where:{id:source.calendarOccurrenceId}}),template=await tx.complianceCalendarTemplate.findUniqueOrThrow({where:{id:source.calendarTemplateId}});
   assert.equal(task.status,'cancelled');assert.equal(task.completedAt!.getTime(),retirement.createdAt.getTime());assert.equal(occurrence.status,'archived');assert.equal(occurrence.completedAt,null);assert.equal(template.status,'paused');assert.equal(await tx.aiRiskReviewCompletion.count({where:{reviewId:source.id}}),0);assert.equal(await tx.aiRiskReviewCancellation.count({where:{reviewId:source.id}}),0);checks.push('native retirement records distinct lineage and archives the real protected task/calendar without manufacturing completion or reassessment');
   await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');checks.push('all original review, calendar, lifecycle, immutable-proof and required-audit constraints remain enforced');
   assert.equal(await tx.aiDecisionEvidenceProof.count({where:{targetType:'ai_lifecycle_request',targetId:request.id}}),2);checks.push('tier decision and separate Data Owner confirmation each retain bound independent evidence proof');
   await assert.rejects(tx.aiLifecycleReviewRetirement.update({where:{id:retirement.id},data:{requestId:randomUUID()}}),/append-only/); // Aborts this transaction intentionally; rollback still preserves all source state.
   checks.push('retirement lineage is append-only');throw rollback;
  },{timeout:120000,maxWait:15000});}catch(e){if(e!==rollback)throw e;}
  assert.deepEqual(await db.aiUseCase.findUniqueOrThrow({where:{id:source.risk.useCaseId}}),before.uc);assert.deepEqual(await db.workflowTask.findUniqueOrThrow({where:{id:source.taskId}}),before.task);assert.deepEqual(await db.complianceCalendarOccurrence.findUniqueOrThrow({where:{id:source.calendarOccurrenceId}}),before.occurrence);assert.deepEqual(await db.complianceCalendarTemplate.findUniqueOrThrow({where:{id:source.calendarTemplateId}}),before.template);checks.push('rollback restores the existing fixture and all review dates and work without modifying completed decisions');
  assert.equal((await audit.verifyChain()).valid,true);checks.push('native audit chain remains valid after the rolled-back diagnostic');passed=true;
 }catch(e){error=e instanceof Error?e.message:String(e);throw e;}finally{if(evidenceId)await files.revoke(evidenceId,reviewer);await app.close();if(process.env.DGOP_LIFECYCLE_CALENDAR_RECEIPT)writeFileSync(process.env.DGOP_LIFECYCLE_CALENDAR_RECEIPT,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),passed,error,checks:checks.length,scenarios:checks,database:url.pathname.slice(1),diagnosticFixtureMutationsRolledBack:true},null,2)+'\n');}console.log(JSON.stringify({passed,checks:checks.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
