import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AiWorkflowProjectionService } from '../src/ai-governance/ai-workflow-projection.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiRiskInitiationService } from '../src/ai-governance/ai-risk-initiation.service';
import { AiHistoryService } from '../src/ai-governance/ai-history.service';
import { GovernanceOperationsService } from '../src/governance-operations/governance-operations.service';
import { WorkflowService } from '../src/workflow/workflow.service';

export async function testAiSharedOperational(db: PrismaClient, officerId: string, riskOwnerId: string) {
  const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
  try {
    const intake=app.get(AiRiskIntakeService),projection=app.get(AiWorkflowProjectionService),operations=app.get(GovernanceOperationsService);
    const actor=await db.user.findUniqueOrThrow({where:{id:officerId},include:{userRoles:{include:{role:true}}}});
    const user={id:actor.id,email:actor.email,roles:actor.userRoles.map(r=>r.role.code)};
    const risks=await db.aiRisk.findMany({where:{riskRef:{in:['AIR-971','AIR-972','AIR-991','AIR-992','AIR-993']}},include:{workflowCase:true}});
    const low=risks.find(r=>r.riskRef==='AIR-971')!,reopened=risks.find(r=>r.riskRef==='AIR-972')!,closed=risks.find(r=>r.riskRef==='AIR-991')!;
    const ids=risks.map(r=>r.workflowCaseId!),map=await projection.forCases(officerId,ids);
    assert.equal((map.get(low.workflowCaseId!) as any).severityCode,'P4');
    assert.equal((map.get(low.workflowCaseId!) as any).assessmentKind,'residual');
    assert.equal((map.get(reopened.workflowCaseId!) as any).severityCode,null,'Reopening cannot retain the previous residual severity');
    assert.equal((map.get(closed.workflowCaseId!) as any).severityCode,'P3','AVOID closure does not fabricate residual scoring');
    assert.equal((map.get(closed.workflowCaseId!) as any).acceptanceInferred,false);
    const outsider=await db.user.create({data:{email:`ai-shared-outsider-${randomUUID()}@example.test`,displayName:'No AI grants',passwordHash:'not-a-login'}});
    assert.equal((await projection.forCases(outsider.id,ids)).size,0,'Generic workflow access does not grant AIRS calculation visibility');
    const officerRole=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}});
    try {await db.role.update({where:{id:officerRole.id},data:{maxClassificationRank:0}});assert.equal((await projection.forCases(officerId,ids)).size,0);}
    finally {await db.role.update({where:{id:officerRole.id},data:{maxClassificationRank:officerRole.maxClassificationRank}});}
    const native=await app.get(WorkflowService).getCase(user.roles,low.workflowCaseId!,user);
    assert.equal((native.aiGovernance as any).severityCode,'P4','Shared case response carries the same scoped calculation');
    const paused=await db.aiRisk.findFirstOrThrow({where:{workflowCase:{code:'AIRS-STOP-PAUSED'}}});
    assert.equal((await intake.get(riskOwnerId,paused.id)).canEdit,false);
    assert.equal((await intake.get(officerId,paused.id)).canAssignOwner,false);
    await assert.rejects(intake.save(riskOwnerId,paused.id,paused.version,{title:'Blocked edit'}),/suspended or archived/);
    await assert.rejects(db.aiRisk.update({where:{id:paused.id},data:{title:'Direct bypass'}}),/operational AI use case/);
    await assert.rejects(db.aiRisk.create({data:{useCaseId:paused.useCaseId,createdBy:riskOwnerId,title:'New stopped intake'}}),/operational AI use case/);
    await assert.rejects(app.get(AiRiskInitiationService).create(riskOwnerId,{useCaseId:paused.useCaseId,initiationKey:randomUUID(),justification:'Blocked stopped use case'}),/Active scoped/);
    assert.equal((await db.aiRisk.findUniqueOrThrow({where:{id:paused.id}})).version,paused.version);
    const suspended=await db.aiUseCase.findFirstOrThrow({where:{operationalStatusCode:'SUSPENDED'}});
    await assert.rejects(db.aiRisk.create({data:{useCaseId:suspended.id,createdBy:riskOwnerId,title:'Suspended intake'}}),/operational AI use case/);
    const escalation=await db.governanceEscalation.findFirstOrThrow({where:{sourceType:'ai_risk_strategy'}});
    await assert.rejects(operations.updateEscalation(escalation.id,{status:'acknowledged'},user),/assigned AI strategy council/);
    await assert.rejects(db.governanceEscalation.update({where:{id:escalation.id},data:{status:'acknowledged'}}),/must resolve|stays open/);
    await assert.rejects(db.governanceEscalation.update({where:{id:escalation.id},data:{sourceType:'workflow_task'}}),/provenance is immutable/);
    const signals=await db.governanceNotification.findMany({where:{sourceType:'ai_risk_strategy'},include:{deliveryAttempts:true}});
    assert.ok(signals.length>=10);assert.ok(signals.every(n=>n.deliveryAttempts.length===1&&n.deliveryAttempts[0].channel==='in_app'&&n.deliveryAttempts[0].status==='planned'&&!n.emailSentAt));
    const closeSignal=signals.find(n=>n.assigneeUserId===riskOwnerId&&n.status==='unread')!;assert.ok(closeSignal);
    const otherOwner=await db.user.findFirstOrThrow({where:{id:{not:riskOwnerId},userRoles:{some:{role:{code:'AI_RISK_OWNER'}}}}});
    // Same role is not sufficient for an individually addressed AI notice.
    const recipientWhere=await (operations as any).notificationVisibilityWhere('all',{id:otherOwner.id,email:otherOwner.email,roles:['AI_RISK_OWNER']});
    assert.equal(await db.governanceNotification.count({where:{AND:[{id:closeSignal.id},recipientWhere]}}),0);
    const ownWhere=await (operations as any).notificationVisibilityWhere('all',{id:riskOwnerId,email:'fixture@example.test',roles:['AI_RISK_OWNER']});
    assert.equal(await db.governanceNotification.count({where:{AND:[{id:closeSignal.id},ownWhere]}}),1);
    // Named native test anchors make the outcome ledgers visible through the real journey contract.
    for (const risk of risks) {
      const parent=await db.aiUseCase.findUniqueOrThrow({where:{id:risk.useCaseId}});
      if(!parent.useCaseRef)await db.aiUseCase.update({where:{id:parent.id},data:{useCaseRef:risk.riskRef!.replace('AIR-','AI-'),version:{increment:1}}});
    }
    const history=await app.get(AiHistoryService).list(officerId,1,50);
    assert.ok(history.rows.flatMap(r=>r.risks).some(r=>r.authorityReversals.length));
    assert.ok(history.rows.flatMap(r=>r.risks).some(r=>r.responses.some(response=>response.strategyEvents.some(event=>event.kind==='avoidance_closed'))));
    assert.ok(history.rows.flatMap(r=>r.risks).some(r=>r.responses.some(response=>response.strategyEvents.some(event=>event.kind==='escalation_outcome'))));
    assert.ok(history.rows.flatMap(r=>r.risks).every(r=>r.auditEvents.every(e=>!('metadata' in e)&&!('actor' in e)&&!('hash' in e))));
    assert.ok(history.rows.flatMap(r=>r.risks).some(r=>r.auditEvents.length));
    assert.equal(history.historyLimits.auditEvents,20);
    console.log('Shared AI operational integration passed: live scoped native workflow severity, stale reopening exclusion, suspended/archived intake guards with retained drafts, protected native councils, atomic in-app-only notifications, individual recipients and scoped metadata-free audit history.');
  } finally {await app.close();}
}
