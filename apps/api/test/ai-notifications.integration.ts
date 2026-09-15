import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { GovernanceOperationsService } from '../src/governance-operations/governance-operations.service';
import { AI_NOTIFICATION_CATALOG, aiDeliveryNotBefore, aiVariables, emitAiNotice, ensureAiNotificationTemplates, assertAiDeliveryEligible, logAiRequired, validateAiNotificationTemplate } from '../src/ai-governance/ai-notifications';
import { governanceTransaction } from '../src/ai-governance/ai-governance-ledger';

export async function testAiNotifications(db:PrismaClient,app:INestApplication,officerId:string) {
 const prisma=db as PrismaService,audit=app.get(AuditService),ops=app.get(GovernanceOperationsService);
 await ensureAiNotificationTemplates(prisma);
 const drafts=await db.governanceNotificationTemplate.findMany({where:{code:{in:AI_NOTIFICATION_CATALOG.map(c=>c[0])}}});
 assert.equal(drafts.length,13);
 for(const t of drafts)validateAiNotificationTemplate(t.code,t.sourceType!,t.titleTemplate,t.messageTemplate,t.digestCadence);
 assert.throws(()=>validateAiNotificationTemplate('AIUC-NTF-01','ai_risk_event','Wrong','English / عربي','immediate'));
 assert.throws(()=>validateAiNotificationTemplate('AIUC-NTF-99','ai_use_case','Wrong','English / عربي','immediate'));
 assert.equal(aiDeliveryNotBefore(new Date('2026-09-14T20:00:00Z'),'immediate',{start:'22:00',end:'07:00'}).toISOString(),'2026-09-15T04:00:00.000Z');
 assert.equal(aiDeliveryNotBefore(new Date('2026-09-14T04:00:00Z'),'daily',null).toISOString(),'2026-09-14T05:00:00.000Z');
 assert.equal(aiDeliveryNotBefore(new Date('2026-09-14T05:00:00Z'),'daily',null).toISOString(),'2026-09-15T05:00:00.000Z');
 assert.equal(aiDeliveryNotBefore(new Date('2026-09-14T04:00:00Z'),'weekly',null).toISOString(),'2026-09-20T05:00:00.000Z');
 assert.throws(()=>aiDeliveryNotBefore(new Date(),'immediate',{start:'bad',end:'07:00'}));
 const uc=await db.aiUseCase.findFirstOrThrow({where:{deletedAt:null,isSampleData:false,assetId:{not:null},workflowCaseId:{not:null},intakeRevisions:{some:{submittedAt:{not:null}}}}});
 const before=await db.aiUseCase.findUniqueOrThrow({where:{id:uc.id}}),variables=await db.$transaction(tx=>aiVariables(tx,uc.workflowCaseId!));
 const template=drafts.find(t=>t.code==='AIUC-NTF-01')!;
 await db.governanceNotificationTemplate.update({where:{id:template.id},data:{isActive:true}});
 const key='isolated-ai-notice:'+randomUUID(),input={code:template.code,sourceType:'ai_use_case',sourceId:uc.id,caseId:uc.workflowCaseId!,dedupeKey:key,userId:officerId,role:'AI_GOVERNANCE_OFFICER',variables,severity:'info' as const};
 const preference=await db.governanceNotificationPreference.create({data:{userId:officerId,channel:'email',isEnabled:false}});
 try {
  await assert.rejects(governanceTransaction(prisma,tx=>emitAiNotice(tx,{logRequired:async()=>{throw Error('Injected notification audit failure');}} as unknown as AuditService,input)),/Injected notification audit/);
  assert.equal(await db.governanceNotification.count({where:{dedupeKey:key}}),0);
  const noticeId=await governanceTransaction(prisma,tx=>emitAiNotice(tx,audit,input));assert.ok(noticeId);
  assert.equal(await governanceTransaction(prisma,tx=>emitAiNotice(tx,audit,input)),null);
  const n=await db.governanceNotification.findUniqueOrThrow({where:{id:noticeId},include:{deliveryAttempts:true}});
  assert.equal(n.title,AI_NOTIFICATION_CATALOG[0][2]+'\n'+AI_NOTIFICATION_CATALOG[0][3]);
  assert.ok(n.message.includes(variables.case_number)&&n.message.includes('الحالة'));
  assert.deepEqual(n.deliveryAttempts.map(a=>a.channel),['in_app']);assert.equal(n.deliveryAttempts[0].deliveredAt,null);
  await governanceTransaction(prisma,tx=>assertAiDeliveryEligible(tx,n.deliveryAttempts[0].id,new Date()));
  const user=await db.user.findUniqueOrThrow({where:{id:officerId}}),auth={id:officerId,email:user.email,roles:['AI_GOVERNANCE_OFFICER']};
  assert.equal((await ops.planNotificationDelivery(n.id,auth)).createdAttempts,0,'The ordinary planner cannot restore a suppressed AI channel');
  await assert.rejects(ops.updateNotificationDelivery(n.id,n.deliveryAttempts[0].id,{status:'sent',target:'another-user'},auth),/native AI recipient/);
  await ops.updateNotificationDelivery(n.id,n.deliveryAttempts[0].id,{status:'sent'},auth);
  await assert.rejects(ops.updateNotificationDelivery(n.id,n.deliveryAttempts[0].id,{status:'sent'},auth),/cannot be replayed/);
  const role=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}}),scope=await db.roleDataScope.create({data:{roleId:role.id,scopeType:'org_unit',refId:randomUUID()}});
  try {assert.equal(await governanceTransaction(prisma,tx=>emitAiNotice(tx,audit,{...input,dedupeKey:key+':scope'})),null);}finally{await db.roleDataScope.delete({where:{id:scope.id}});}
  const grant=await db.rolePermission.findFirstOrThrow({where:{roleId:role.id,permission:{resource:'case.view.aiuc',action:'org'}}});
  await db.rolePermission.delete({where:{roleId_permissionId:{roleId:grant.roleId,permissionId:grant.permissionId}}});
  try {assert.equal(await governanceTransaction(prisma,tx=>emitAiNotice(tx,audit,{...input,dedupeKey:key+':revoked'})),null);}finally{await db.rolePermission.create({data:{roleId:grant.roleId,permissionId:grant.permissionId}});}
  const auditorRole=await db.role.findUniqueOrThrow({where:{code:'auditor'}});
  await db.userRole.create({data:{userId:officerId,roleId:auditorRole.id}});
  try {assert.equal(await governanceTransaction(prisma,tx=>emitAiNotice(tx,audit,{...input,dedupeKey:key+':auditor'})),null);}finally{await db.userRole.delete({where:{userId_roleId:{userId:officerId,roleId:auditorRole.id}}});}
  await db.governanceNotificationPreference.update({where:{id:preference.id},data:{isEnabled:true,digestCadence:'daily'}});
  const digestId=await governanceTransaction(prisma,tx=>emitAiNotice(tx,audit,{...input,dedupeKey:key+':digest'}));assert.ok(digestId);
  const digest=await db.governanceNotificationDeliveryAttempt.findFirstOrThrow({where:{notificationId:digestId,channel:'email'}});
  await assert.rejects(governanceTransaction(prisma,tx=>assertAiDeliveryEligible(tx,digest.id,digest.createdAt)),/window has not opened/);
  await assert.rejects(ops.updateNotificationDelivery(digestId,digest.id,{status:'sent'},auth),/window has not opened|verified connector receipt/);
  const eventCount=await db.governanceNotification.count({where:{workflowCaseId:uc.workflowCaseId,sourceType:'ai_use_case'}});
  await governanceTransaction(prisma,tx=>logAiRequired(audit,{actor:officerId,action:'aiuc.intake.submitted',entityType:'ai_use_case',entityId:uc.id,metadata:{syntheticIntegrationObservation:true}},tx));
  assert.ok(await db.governanceNotification.count({where:{workflowCaseId:uc.workflowCaseId,sourceType:'ai_use_case'}})>eventCount,'Native successful audit hook emits eligible template-addressed notices');
  assert.deepEqual(await db.aiUseCase.findUniqueOrThrow({where:{id:uc.id}}),before,'Observations leave business records unchanged');
 }finally {
  await db.governanceNotificationPreference.delete({where:{id:preference.id}});
  await db.governanceNotificationTemplate.update({where:{id:template.id},data:{isActive:template.isActive}});
 }
 console.log('Governed AI notifications passed: 13 exact bilingual subjects/bodies, source validation, Saudi digest and quiet hours, scoped actual recipients, live grant revocation, Auditor suppression, no fallback planning, atomic audit rollback, delivery window/recipient/replay protection, native action hooks and unchanged business state.');
}
