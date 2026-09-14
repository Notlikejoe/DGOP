import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AiOperationalAlertsService } from '../src/ai-governance/ai-operational-alerts.service';
import { GovernanceOperationsService } from '../src/governance-operations/governance-operations.service';
import { AuditService } from '../src/audit/audit.service';
export async function testOperationalAlerts(db:PrismaClient,riskId:string,executorId:string,officerId:string){
 const app=await NestFactory.create(AppModule,{logger:false});
 try{
  const alerts=app.get(AiOperationalAlertsService),ops=app.get(GovernanceOperationsService),risk=await db.aiRisk.findUniqueOrThrow({where:{id:riskId}});
  const action=await db.aiTreatmentAction.findFirstOrThrow({where:{response:{is:{riskId}},workflowTask:{is:{status:'pending'}}},include:{workflowTask:true}}),now=new Date(action.workflowTask!.dueDate!.getTime()+1);
  const template={code:'AIRS-NTF-04',name:'Synthetic approved alert template',sourceType:'ai_risk_treatment',titleTemplate:'Treatment action overdue / تأخر إجراء المعالجة عن المستهدف',messageTemplate:'Synthetic approved body: {{action_ref}} · {{risk_ref}} · {{sla_pct}}% · {{due_date}} / محتوى تجريبي معتمد',defaultChannelsJson:['in_app','email'],isActive:true};
  await assert.rejects(ops.upsertNotificationTemplate(template,{id:officerId,email:'forged@test',roles:['dmo_admin']}),/Only a live DMO_ADMIN/);
  const adminRole=await db.role.findUniqueOrThrow({where:{code:'dmo_admin'}}),admin=await db.user.create({data:{email:'alerts-config@isolated.test',displayName:'Synthetic notification administrator',passwordHash:'not-a-login',userRoles:{create:{roleId:adminRole.id}}}});
  assert.equal((await alerts.process(now,riskId)).created,0,'Missing governed template has no hard-coded body fallback');
  await ops.upsertNotificationTemplate(template,{id:admin.id,email:admin.email,roles:['dmo_admin']});
  const pref=await db.governanceNotificationPreference.create({data:{userId:executorId,channel:'email',isEnabled:false}});
  const audit=app.get(AuditService),saved=audit.logRequired;audit.logRequired=async()=>{throw new Error('Injected alert audit failure');};
  try{await assert.rejects(alerts.process(now,riskId),/Injected alert audit/);}finally{audit.logRequired=saved;}
  assert.equal(await db.governanceNotification.count({where:{sourceType:'ai_risk_treatment',sourceId:action.id}}),0);
  const concurrency=await Promise.all([alerts.process(now,riskId),alerts.process(now,riskId)]);assert.ok(concurrency.reduce((n,r)=>n+r.created,0)>0);
  assert.equal((await alerts.process(now,riskId)).created,0);
  const notifications=await db.governanceNotification.findMany({where:{sourceType:'ai_risk_treatment',sourceId:action.id,assigneeUserId:executorId},include:{deliveryAttempts:true}});
  assert.equal(notifications.length,4);assert.ok(notifications.every(n=>n.message.includes(action.actionRef)&&n.message.includes(risk.riskRef!)));
  assert.ok(notifications.every(n=>n.deliveryAttempts.some(a=>a.channel==='in_app')&&!n.deliveryAttempts.some(a=>a.channel==='email')));
  assert.ok(notifications.every(n=>n.deliveryAttempts.every(a=>a.status==='planned'&&a.deliveredAt===null)));
  const grant=await db.rolePermission.findFirstOrThrow({where:{role:{code:'AI_MODEL_OWNER'},permission:{resource:'airs.risk',action:'assess'}}});
  const scope=await db.roleDataScope.create({data:{roleId:grant.roleId,scopeType:'data_domain',refId:'excluded-alert-domain'}});
  try{assert.equal(await db.governanceNotification.count({where:{AND:[await alerts.visibility(executorId),{sourceType:'ai_risk_treatment',sourceId:action.id}]}}),0);}finally{await db.roleDataScope.delete({where:{id:scope.id}});}
  await db.governanceNotificationPreference.delete({where:{id:pref.id}});
  console.log('Operational alerts passed: governed DMO-only content, Saudi thresholds, scoped recipients, concurrent dedupe, email suppression, planned delivery and audit rollback.');
 }finally{await app.close();}
}
export async function testOperationalAlertResolution(db:PrismaClient,riskId:string){
 const app=await NestFactory.create(AppModule,{logger:false});
 try{
  const alerts=app.get(AiOperationalAlertsService),audit=app.get(AuditService);
  const risk=await db.aiRisk.findUniqueOrThrow({where:{id:riskId}}),before=await db.governanceNotification.findMany({where:{workflowCaseId:risk.workflowCaseId,sourceType:'ai_risk_treatment',status:{not:'archived'}}});
  assert.ok(before.length>0,'Previously issued notices await completion resolution');
  const saved=audit.logRequired;audit.logRequired=async()=>{throw new Error('Injected archive audit failure');};
  try{await assert.rejects(alerts.process(new Date(),riskId),/Injected archive audit/);}finally{audit.logRequired=saved;}
  assert.equal(await db.governanceNotification.count({where:{id:{in:before.map(n=>n.id)},status:{not:'archived'}}}),before.length,'Archive and unsent attempt updates roll back with their audit');
  const concurrency=await Promise.all([alerts.process(new Date(),riskId),alerts.process(new Date(),riskId)]);
  assert.equal(concurrency.reduce((n,r)=>n+r.archived,0),before.length,'Concurrent workers archive once');
  assert.equal(await db.governanceNotification.count({where:{id:{in:before.map(n=>n.id)},status:'archived'}}),before.length);
  assert.equal(await db.governanceNotificationDeliveryAttempt.count({where:{notificationId:{in:before.map(n=>n.id)},status:{in:['planned','failed']}}}),0);
  assert.ok(await db.governanceNotificationDeliveryAttempt.count({where:{notificationId:{in:before.map(n=>n.id)},status:'skipped',deliveredAt:null}}));
  assert.equal((await alerts.process(new Date(),riskId)).archived,0);
  assert.deepEqual(await db.aiRisk.findUniqueOrThrow({where:{id:riskId}}),risk,'Resolving notices never changes risk business records');
  console.log('Operational alert completion passed: native completion resolution, unsent attempts skipped, atomic audit rollback and concurrent idempotence.');
 }finally{await app.close();}
}
