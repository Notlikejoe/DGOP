import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiIntakeService } from '../src/ai-governance/ai-intake.service';
import { AiClassificationService } from '../src/ai-governance/ai-classification.service';
import { AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AuditService } from '../src/audit/audit.service';

export async function testAiRequestLifecycle(db:PrismaClient) {
 const app=await NestFactory.create(AppModule,{logger:false});
 try {
  const intake=app.get(AiIntakeService),classification=app.get(AiClassificationService),routing=app.get(AiWorkflowRoutingService),ids=app.get(AiIdentifiersService),audit=app.get(AuditService);
  const requester=await db.user.findUniqueOrThrow({where:{email:'intake-requester@phase2a.test'}}),officer=await db.user.findUniqueOrThrow({where:{email:'intake-officer@phase2a.test'}}),higher=await db.user.findUniqueOrThrow({where:{email:'intake-sponsor@phase2a.test'}}),assessor=await db.user.findUniqueOrThrow({where:{email:'intake-triage@phase2a.test'}});
  const original=await db.aiUseCase.findFirstOrThrow({where:{assetId:{not:null},deletedAt:null,isSampleData:false},include:{intakeRevisions:{orderBy:{revision:'desc'},take:1}}}),evidence=await db.ndiEvidence.findFirstOrThrow({where:{deletedAt:null}});
  const template=await routing.binding(db as PrismaService),tier=await db.governedReferenceVersion.findFirstOrThrow({where:{listCode:'R_SDAIA_TIER',state:'published'}});
  async function source(status:'submitted'|'awaiting_information'|'under_review',classified=false) {
   return db.$transaction(async tx=>{
    const wc=await tx.workflowCase.create({data:{code:'AIUC-LIFECYCLE-'+randomUUID(),type:'AIUC',title:'Synthetic request lifecycle',status,createdBy:requester.id,templateId:template.id}});
    const uc=await tx.aiUseCase.create({data:{workflowCaseId:wc.id,requesterUserId:requester.id,createdBy:requester.id,name:'Synthetic request lifecycle',organizationUnitId:original.organizationUnitId,ownerPersonId:original.ownerPersonId,...(classified?{useCaseRef:await ids.nextUseCaseRef(tx)}:{})}});
    await tx.aiIntakeRevision.create({data:{useCaseId:uc.id,revision:1,createdBy:requester.id,submittedAt:new Date(),payload:original.intakeRevisions[0].payload as Prisma.InputJsonValue}});
    return uc;
   });
  }
  const withdrawn=await source('submitted'),openTask=await routing.createStageTask(db as PrismaService,withdrawn.workflowCaseId!,'aiuc-triage',new Date());
  assert.equal((await intake.closureContext(requester.id,withdrawn.id)).canWithdraw,true);
  await assert.rejects(intake.closeRequest(officer.id,withdrawn.id,withdrawn.version,'withdraw','Independent evidence',[evidence.id]));
  const saved=audit.logRequired;audit.logRequired=async()=>{throw Error('Injected lifecycle audit failure');};
  try{await assert.rejects(intake.closeRequest(requester.id,withdrawn.id,withdrawn.version,'withdraw','Request no longer needed',[evidence.id]),/Injected lifecycle audit/);}finally{audit.logRequired=saved;}
  assert.equal((await db.workflowTask.findUniqueOrThrow({where:{id:openTask.id}})).status,'pending');
  const simultaneous=await Promise.allSettled([intake.closeRequest(requester.id,withdrawn.id,withdrawn.version,'withdraw','Request no longer needed',[evidence.id]),intake.closeRequest(requester.id,withdrawn.id,withdrawn.version,'withdraw','Request no longer needed',[evidence.id])]);assert.equal(simultaneous.filter(v=>v.status==='fulfilled').length,1);
  assert.equal((await db.workflowCase.findUniqueOrThrow({where:{id:withdrawn.workflowCaseId!}})).status,'closed');assert.equal((await db.aiUseCase.findUniqueOrThrow({where:{id:withdrawn.id}})).useCaseRef,null);assert.equal(await db.aiRisk.count({where:{useCaseId:withdrawn.id}}),0);
  const closure=await db.workflowTask.findFirstOrThrow({where:{caseId:withdrawn.workflowCaseId!,title:'AI request closure'}});
  await assert.rejects(db.workflowTask.update({where:{id:closure.id},data:{decisionComment:'Tamper'}}),/closure history is immutable/);
  const expired=await source('awaiting_information'),information=await routing.createStageTask(db as PrismaService,expired.workflowCaseId!,'aiuc-completion',new Date(),{assigneeUserId:requester.id});
  await assert.rejects(intake.closeRequest(officer.id,expired.id,expired.version,'closed_no_action','No reply after deadline',[evidence.id]));
  await db.workflowTask.update({where:{id:information.id},data:{dueDate:new Date(Date.now()-86400000)}});
  assert.equal((await intake.closureContext(officer.id,expired.id)).canCloseNoAction,true);
  await intake.closeRequest(officer.id,expired.id,expired.version,'closed_no_action','No reply after deadline',[evidence.id]);
  assert.equal((await db.workflowCase.findUniqueOrThrow({where:{id:expired.workflowCaseId!}})).status,'closed');
  const reversal=await source('under_review',true);
  const root=await db.aiAssessmentRound.create({data:{useCaseId:reversal.id,kind:'classification',round:1,ruleReferenceVersionId:tier.id,engineVersion:'AIUC_CLASSIFICATION_MAX_V1',createdBy:assessor.id,inputs:{synthetic:true},result:{scoreMax:5,proposedTierCode:'HIGH',approvedTierCode:'HIGH',routingFacts:{personalDataInvolved:true,sensitiveDataInvolved:false}}}});
  const decision=await db.aiAssessmentRound.create({data:{useCaseId:reversal.id,kind:'classification',round:2,ruleReferenceVersionId:tier.id,engineVersion:'AIUC_CLASSIFICATION_DECISION_V1',createdBy:officer.id,inputs:root.inputs as Prisma.InputJsonValue,result:{scoreMax:5,proposedTierCode:'HIGH',approvedTierCode:'LIMITED',sourceAssessmentId:root.id,officerDecision:{decisionType:'override',actorRole:'AI_GOVERNANCE_OFFICER',verifiedBy:officer.id,evidenceIds:[evidence.id],justification:'Synthetic override evidence',authorityReference:'Synthetic approval minute'}}}});
  const oldTask=await routing.createStageTask(db as PrismaService,reversal.workflowCaseId!,'aiuc-ethics-review',new Date(),{formDataJson:{classificationDecisionId:decision.id}});
  assert.equal((await classification.reversalContext(higher.id,reversal.id)).canReverse,true);
  await assert.rejects(classification.reverseOverride(officer.id,reversal.id,reversal.version,'Restore pinned tier',[evidence.id],'Higher minute'));
  const higherRole=await db.role.findUniqueOrThrow({where:{code:'AI_EXECUTIVE_TEAM'}}),grant=await db.rolePermission.findFirstOrThrow({where:{roleId:higherRole.id,permission:{resource:'aiuc.classify',action:'reverse'}}});
  await db.rolePermission.delete({where:{roleId_permissionId:{roleId:grant.roleId,permissionId:grant.permissionId}}});
  try{assert.equal((await classification.reversalContext(higher.id,reversal.id)).canReverse,false);await assert.rejects(classification.reverseOverride(higher.id,reversal.id,reversal.version,'Restore pinned tier',[evidence.id],'Higher minute'));}finally{await db.rolePermission.create({data:{roleId:grant.roleId,permissionId:grant.permissionId}});}
  // Compensating an old decision consumes the immutable original pin after retirement.
  await db.governedReferenceVersion.update({where:{id:tier.id},data:{state:'retired',effectiveTo:new Date()}});
  audit.logRequired=async()=>{throw Error('Injected reversal audit failure');};
  try{await assert.rejects(classification.reverseOverride(higher.id,reversal.id,reversal.version,'Restore pinned tier',[evidence.id],'Higher minute'),/Injected reversal audit/);}finally{audit.logRequired=saved;}
  assert.equal(await db.aiAssessmentRound.count({where:{useCaseId:reversal.id}}),2);assert.equal((await db.workflowTask.findUniqueOrThrow({where:{id:oldTask.id}})).status,'pending');
  const reversed=await classification.reverseOverride(higher.id,reversal.id,reversal.version,'Restore pinned tier',[evidence.id],'Higher minute');
  const result=await db.aiAssessmentRound.findUniqueOrThrow({where:{id:reversed.assessmentId}});
  assert.equal((result.result as Record<string,unknown>).approvedTierCode,'HIGH');assert.equal((result.result as Record<string,unknown>).scoreMax,5);assert.deepEqual(result.inputs,root.inputs);assert.equal(result.ruleReferenceVersionId,tier.id);
  assert.deepEqual(await db.aiAssessmentRound.findUniqueOrThrow({where:{id:decision.id}}),decision);assert.equal((await db.workflowTask.findUniqueOrThrow({where:{id:oldTask.id}})).status,'cancelled');
  assert.ok(await db.workflowTask.count({where:{caseId:reversal.workflowCaseId!,status:'pending',templateStage:{code:'aiuc-ethics-review'}}}));
  await assert.rejects(classification.reverseOverride(higher.id,reversal.id,reversed.version,'Replay',[evidence.id],'Higher minute'));
  await assert.rejects(db.aiAssessmentRound.update({where:{id:result.id},data:{result:{approvedTierCode:'LIMITED'}}}),/append-only/);
  assert.equal((await classification.reversalContext(higher.id,original.id)).registeredReassessmentRequired,true);
  console.log('AI request lifecycle passed: actual-requester withdrawal, expired-information Officer closure, immutable native resolution, no asset/risk fabrication, scope/grant and replay gates, atomic audit rollback, concurrent exactly-once closure, higher independent tier compensation, retired original pins, preserved scores/decisions and fresh specialist gates. Registered retirement/reclassification acceptance remains separate.');
 }finally{await app.close();}
}
