import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { EvidenceService } from '../src/evidence/evidence.service';
import { AiEvidenceService } from '../src/ai-governance/ai-evidence.service';
import { AiAnnualReviewService } from '../src/ai-governance/ai-annual-review.service';
import { isManagedDemoProfile } from '../src/common/demo-profile';
import { isOperationalEvidence } from '../src/evidence/evidence-status';
import { AuthUser } from '../src/auth/auth.types';
const startedAt=new Date().toISOString(),checks:string[]=[];
async function main(){const url=new URL(process.env.DATABASE_URL??'');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55438');assert.match(url.pathname,/^\/dgop_ai_test_repair_batch1_\d+$/u);assert.equal(isManagedDemoProfile(),true);
 const manifest=JSON.parse(readFileSync(process.env.DGOP_DEMO_MANIFEST!,'utf8')),app=await NestFactory.createApplicationContext(AppModule,{logger:false}),db=app.get(PrismaService),audit=app.get(AuditService),files=app.get(EvidenceService),proof=app.get(AiEvidenceService),annual=app.get(AiAnnualReviewService);
 const actor=async(name:string):Promise<AuthUser>=>{const u=await db.user.findUniqueOrThrow({where:{id:manifest.actors[name]},include:{userRoles:{include:{role:true}}}});return{id:u.id,email:u.email,roles:u.userRoles.map(r=>r.role.code)}};
 const author=await actor('showcase'),reviewer=await actor('custodian'),administrator=await actor('administrator'),auditor=await actor('auditor');
 const tag='B4 synthetic evidence diagnostic '+randomUUID(),spec=await db.ndiSpecification.findFirstOrThrow();
 let passed=false,error:string|null=null;const created:string[]=[];
 async function doc(){const buffer=Buffer.from('Synthetic demo assurance record: '+tag);const e=await files.create({specId:spec.id,title:tag,submit:'true'},{buffer,size:buffer.length,originalname:'synthetic.txt',mimetype:'text/plain'},author);created.push(e.id);return files.review(e.id,{decision:'approve',comment:'Independent synthetic document review'},reviewer);}
 try {
  const e=await doc();assert.equal(e.provenance,'synthetic_demo');assert.equal(isOperationalEvidence(e),false);checks.push('native independent approval creates demo-only evidence with zero operational eligibility');
  const unit=await db.organizationUnit.create({data:{code:'B4-'+randomUUID(),nameEn:tag,nameAr:'وحدة اختبار الأدلة التجريبية'}});
  await annual.register(author.id,unit.id);const context=await annual.context(author.id,unit.id),pending=context.data.find(r=>r.canComplete);assert.ok(pending);
  const targetId=pending.id,entry={actor:author.id,action:'ai.annual.review.handover',entityType:'ai_annual_review',entityId:targetId,metadata:{evidenceIds:[e.id],diagnostic:true}};
  const baseline=await db.auditLog.count({where:{action:entry.action,entityId:targetId}});
  await assert.rejects(db.$transaction(tx=>audit.logRequired(entry,tx)),/explicit current link/);assert.equal(await db.auditLog.count({where:{action:entry.action,entityId:targetId}}),baseline);checks.push('unlinked approved proof rejects and rolls back the required audit');
  await assert.rejects(proof.link(auditor.id,'ai_annual_review',targetId,[e.id],'Synthetic relevance'),/eligible/);await assert.rejects(proof.link(administrator.id,'ai_annual_review',targetId,[e.id],'Synthetic relevance'),/eligible/);checks.push('auditor and platform-only administrator cannot assert business evidence relevance');
  await proof.link(author.id,'ai_annual_review',targetId,[e.id],'Synthetic proof explicitly supports this annual register review');
  await assert.rejects(proof.link(author.id,'ai_annual_review',targetId,[e.id,e.id],'Duplicate proof'),/distinct/);checks.push('duplicate document identifiers cannot inflate proof completeness');
  const same=await proof.link(author.id,'ai_annual_review',targetId,[e.id],'Repeated link');assert.equal(same.linkIds.length,1);assert.equal(await db.aiEvidenceLink.count({where:{evidenceId:e.id,targetId}}),1);checks.push('explicit pinned link creation is idempotent without rewriting the reason');
  const rollback=Symbol('rollback');try{await db.$transaction(async tx=>{await audit.logRequired(entry,tx);throw rollback;});}catch(cause){assert.equal(cause,rollback);}assert.equal(await db.aiDecisionEvidenceProof.count({where:{targetId,snapshot:{path:['documents','0','evidenceId'],equals:e.id}}}),0);checks.push('required audit and immutable proof roll back together');
  await assert.rejects(db.$transaction(async tx=>{const missingProof=new Proxy(tx,{get(t,k){if(k==='aiDecisionEvidenceProof')return new Proxy(t.aiDecisionEvidenceProof,{get(m,name){if(name==='create')return async()=>({});return Reflect.get(m,name);}});return Reflect.get(t,k);}});await audit.logRequired(entry,missingProof);}),/Required AI decision evidence proof missing/);checks.push('deferred database constraint prevents committing an audit without its required proof');
  const other=await annual.register(author.id,(await db.organizationUnit.create({data:{code:'B4-'+randomUUID(),nameEn:tag+' unrelated',nameAr:'اختبار مراجعة أخرى'}})).id);
  await assert.rejects(db.$transaction(tx=>audit.logRequired({...entry,entityId:other.reviewId},tx)),/explicit current link/);checks.push('a link to another review cannot authorize this decision');
  const beforeTask=await db.workflowTask.findUniqueOrThrow({where:{id:pending.taskId}}),beforeRounds=await db.aiAnnualReview.count({where:{organizationUnitId:unit.id}});
  const injectedAudit=new Proxy(audit,{get(t,k){if(k==='logRequired')return async()=>{throw new Error('Injected required audit failure');};const value=Reflect.get(t,k);return typeof value==='function'?value.bind(t):value;}});
  const broken=new AiAnnualReviewService(db,(annual as any).authorization,(annual as any).scope,(annual as any).risks,(annual as any).routing,(annual as any).identifiers,injectedAudit);
  await assert.rejects(broken.complete(author.id,targetId,{expectedRound:pending.round,expectedHandoverRound:pending.handoverRound,trendsSummary:tag,controlEffectivenessSummary:tag,nonconformitySummary:tag,evidenceIds:[e.id]}),/Injected required audit failure/);
  assert.equal(await db.aiAnnualReview.count({where:{organizationUnitId:unit.id}}),beforeRounds);assert.deepEqual(await db.workflowTask.findUniqueOrThrow({where:{id:pending.taskId}}),beforeTask);assert.equal(await db.aiAnnualReviewCompletion.count({where:{reviewId:targetId}}),0);checks.push('native audit failure rolls back completion, task, calendar and generated next round');
  await db.$transaction(tx=>audit.logRequired(entry,tx));const saved=await db.aiDecisionEvidenceProof.findFirstOrThrow({where:{targetId},orderBy:{createdAt:'desc'}});assert.equal(saved.demoOnly,true);
  const native=await annual.complete(author.id,targetId,{expectedRound:pending.round,expectedHandoverRound:pending.handoverRound,trendsSummary:tag,controlEffectivenessSummary:'Synthetic controls',nonconformitySummary:'Synthetic assurance findings',evidenceIds:[e.id]});assert.ok(native.nextReviewId);checks.push('native completion atomically advances the protected task, calendar, next round, audit and proof');
  let history=await proof.read(author.id,'ai_annual_review',targetId,{page:1,pageSize:25,search:''});assert.equal(history.data[0].assurance,'demo_verified');checks.push('successful decision binds immutable approval, file hash, revision and explicit relevance');
  await assert.rejects(db.aiDecisionEvidenceProof.update({where:{id:saved.id},data:{digest:'a'.repeat(64)}}),/append-only/);await assert.rejects(db.aiEvidenceLink.delete({where:{id:same.linkIds[0]}}),/append-only/);checks.push('database blocks proof mutation and relevance deletion');
  const previous=process.env.DGOP_DEMO;process.env.DGOP_DEMO='false';try{await assert.rejects(db.$transaction(tx=>audit.logRequired(entry,tx)),/provenance_not_allowed/);}finally{process.env.DGOP_DEMO=previous;}checks.push('demo identifiers cannot authorize decisions outside the managed demo profile');
  await files.revoke(e.id,reviewer);history=await proof.read(author.id,'ai_annual_review',targetId,{page:1,pageSize:25,search:''});assert.equal(history.data[0].assurance,'review_needed');assert.deepEqual((await db.aiDecisionEvidenceProof.findUniqueOrThrow({where:{id:saved.id}})).snapshot,saved.snapshot);await assert.rejects(db.$transaction(tx=>audit.logRequired(entry,tx)),/not_approved/);checks.push('revocation preserves historical proof, changes current assurance and denies future decisions');
  const e2=await doc();await proof.link(author.id,'ai_annual_review',targetId,[e2.id],'Synthetic race proof supports this exact annual review');const raceEntry={...entry,metadata:{evidenceIds:[e2.id],diagnostic:true}};
  // Hold the evidence lock in a real decision transaction while revocation waits.
  let release!:()=>void,locked!:()=>void;const barrier=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>locked=r);
  const decision=db.$transaction(async tx=>{await audit.logRequired(raceEntry,tx);locked();await barrier;},{timeout:20000});await ready;
  let revoked=false;const revoke=files.revoke(e2.id,reviewer).then(()=>revoked=true);await new Promise(r=>setTimeout(r,100));assert.equal(revoked,false);release();await Promise.all([decision,revoke]);await assert.rejects(db.$transaction(tx=>audit.logRequired(raceEntry,tx)),/not_approved/);checks.push('decision/revocation race serializes; late revocation cannot overwrite the captured proof');
  const expired=await doc();await db.ndiEvidence.update({where:{id:expired.id},data:{expiryDate:new Date(Date.now()-1)}});await assert.rejects(proof.link(author.id,'ai_annual_review',targetId,[expired.id],'Expired synthetic proof'),/expired/);checks.push('expiry at evaluation time is enforced before linking');
  const corrupt=await doc();await db.ndiEvidence.update({where:{id:corrupt.id},data:{sha256:'0'.repeat(64)}});await assert.rejects(proof.link(author.id,'ai_annual_review',targetId,[corrupt.id],'Corrupt synthetic proof'),/checksum/);checks.push('real file bytes are checked against the approved checksum');
  const stale=await doc();await proof.link(author.id,'ai_annual_review',targetId,[stale.id],'Synthetic stale revision');await db.ndiEvidence.update({where:{id:stale.id},data:{reviewComment:'Diagnostic revision changed'}});await assert.rejects(db.$transaction(tx=>audit.logRequired({...entry,metadata:{evidenceIds:[stale.id]}},tx)),/explicit current link/);checks.push('changed approval revision requires fresh relevance and never reuses the old link');
  const noTrail=await doc();await db.ndiEvidence.update({where:{id:noTrail.id},data:{reviewedAt:new Date(Date.now()-120000),submittedAt:new Date(Date.now()-180000)}});await assert.rejects(proof.link(author.id,'ai_annual_review',targetId,[noTrail.id],'Unverifiable historical approval'),/native upload and approval trail/);checks.push('historical approval metadata without a matching immutable native audit is not trusted');
  const legacy=await db.auditLog.findFirst({where:{entityType:'ai_annual_review',action:'ai.annual.review.complete',aiEvidenceProof:{is:null}}});if(legacy?.entityId){const old=await proof.read(author.id,'ai_annual_review',legacy.entityId,{page:1,pageSize:25,search:''});assert.ok(old.data.some(r=>r.assurance==='review_needed'&&r.reasons.includes('historical_proof_missing')));}else throw Error('Missing saved legacy diagnostic review');checks.push('historical decisions without trustworthy proof remain explicitly review needed');
  const after=await audit.verifyChain();assert.equal(after.valid,true);assert.equal(after.truncated,false);checks.push('native audit chain and protected lineage remain valid');
  passed=true;
 }catch(cause){error=cause instanceof Error?cause.message:String(cause);throw cause;}
 finally {for(const id of created){const row=await db.ndiEvidence.findUnique({where:{id}});if(row&&row.status==='approved')await files.revoke(id,reviewer);}await app.close();if(process.env.DGOP_EVIDENCE_RECEIPT)writeFileSync(process.env.DGOP_EVIDENCE_RECEIPT,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),database:url.pathname.slice(1),passed,error,checks:checks.length,scenarios:checks,diagnosticEvidenceIds:created},null,2)+'\n');}
 console.log(JSON.stringify({passed,checks:checks.length,scenarios:checks}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
