import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AiOperationalAlertsService } from '../src/ai-governance/ai-operational-alerts.service';
import { GovernanceOperationsService } from '../src/governance-operations/governance-operations.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AuditService } from '../src/audit/audit.service';

async function main(){
 const url=new URL(process.env.DATABASE_URL??'');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55436');assert.match(url.pathname,/^\/dgop_ai_restore_\d+$/);
 process.env.NODE_ENV='test';process.env.WORKFLOW_EXECUTION_SCHEDULER='false';process.env.GOVERNANCE_OPERATIONS_SCHEDULER='false';
 const db=new PrismaClient({datasources:{db:{url:url.href}}}),app=await NestFactory.create(AppModule,{logger:false});
 try{
  const alerts=app.get(AiOperationalAlertsService),ops=app.get(GovernanceOperationsService),audit=app.get(AuditService);
  const risks=await db.aiRisk.findMany({where:{riskRef:{in:['AIR-001','AIR-002']}},include:{useCase:{include:{assessments:{where:{kind:'classification',riskId:null},orderBy:{round:'desc'},take:1}}}}});
  assert.equal(risks.length,2);const match=risks.find(r=>r.riskRef==='AIR-001')!,mismatch=risks.find(r=>r.riskRef==='AIR-002')!;
  const business=await db.aiAssessmentRound.findMany({where:{useCaseId:{in:risks.map(r=>r.useCaseId)}},orderBy:{id:'asc'}});
  const role=await db.role.findUniqueOrThrow({where:{code:'dmo_admin'}}),admin=await db.user.create({data:{email:'harmony-config-'+Date.now()+'@isolated.test',displayName:'Synthetic restored-demo configuration actor',passwordHash:'not-a-login',userRoles:{create:{roleId:role.id}}}});
  const template={code:'AIX-NTF-03',name:'Synthetic independent model harmony review',sourceType:'ai_risk_harmony',titleTemplate:'Review model classification discrepancy / مراجعة اختلاف تصنيف النموذج',messageTemplate:'DEMONSTRATION ONLY: {{usecase_id}} · {{tier}} · {{residual_level}} / عرض توضيحي فقط: مراجعة مستقلة دون تغيير الدرجات',defaultChannelsJson:['in_app','email'],isActive:false};
  await ops.upsertNotificationTemplate(template,{id:admin.id,email:admin.email,roles:[]});assert.equal((await alerts.process(new Date(),mismatch.id)).created,0);
  await ops.upsertNotificationTemplate({...template,isActive:true},{id:admin.id,email:admin.email,roles:[]});
  assert.equal((await alerts.process(new Date(),match.id)).created,0,'Matching Limited/Low models have no discrepancy');
  const saved=audit.logRequired;audit.logRequired=async()=>{throw new Error('Injected harmony audit failure');};
  try{await assert.rejects(alerts.process(new Date(),mismatch.id),/Injected harmony audit/);}finally{audit.logRequired=saved;}
  assert.equal(await db.governanceNotification.count({where:{sourceType:'ai_risk_harmony'}}),0);
  const concurrent=await Promise.all([alerts.process(new Date(),mismatch.id),alerts.process(new Date(),mismatch.id)]);assert.ok(concurrent.reduce((n,r)=>n+r.created,0)>0);
  const notices=await db.governanceNotification.findMany({where:{sourceType:'ai_risk_harmony',sourceId:mismatch.useCaseId},include:{deliveryAttempts:true}});assert.ok(notices.length>0);assert.ok(notices.every(n=>n.assigneeUserId&&n.targetRoleCode==='AI_GOVERNANCE_OFFICER'&&n.message.includes('HIGH')&&n.message.includes('LOW/MEDIUM')));
  assert.ok(notices.every(n=>n.deliveryAttempts.every(a=>a.status==='planned'&&a.deliveredAt===null)));assert.equal((await alerts.process(new Date(),mismatch.id)).created,0);
  assert.deepEqual(await db.aiAssessmentRound.findMany({where:{useCaseId:{in:risks.map(r=>r.useCaseId)}},orderBy:{id:'asc'}}),business,'Harmony review never alters either model');
  // A registered linked risk without an eligible assessment makes harmony unavailable, never a fabricated Low.
  const ids=new AiIdentifiersService();await db.$transaction(async tx=>tx.aiRisk.create({data:{useCaseId:mismatch.useCaseId,riskRef:await ids.nextRiskRef(tx),title:'Synthetic missing assessment negative fixture',cause:'Test-only missing information',event:'No current calculation',effect:'Harmony unavailable',createdBy:admin.id}}));
  const unavailable=await alerts.process(new Date(),mismatch.id);assert.equal(unavailable.created,0);assert.equal(unavailable.archived,notices.length);
  assert.equal(await db.governanceNotification.count({where:{id:{in:notices.map(n=>n.id)},status:'archived'}}),notices.length);assert.equal(await db.governanceNotificationDeliveryAttempt.count({where:{notificationId:{in:notices.map(n=>n.id)},status:{in:['planned','failed']}}}),0);
  assert.equal((await alerts.process(new Date(),mismatch.id)).archived,0);
  console.log('Restored native harmony passed: matching models, independent High/Medium review, governed content, audit rollback, concurrent dedupe, unchanged models and fail-closed missing linked assessment with unsent archival.');
 }finally{await app.close();await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
