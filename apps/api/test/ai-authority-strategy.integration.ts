import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiRiskStrategyService, StrategyAction, AI_COUNCILS } from '../src/ai-governance/ai-risk-strategy.service';
import { AiRiskReviewService } from '../src/ai-governance/ai-risk-review.service';
import { AiRiskAssessmentService } from '../src/ai-governance/ai-risk-assessment.service';
import { AiRiskAdoptionService } from '../src/ai-governance/ai-risk-adoption.service';
import { AiRiskResponseService } from '../src/ai-governance/ai-risk-response.service';
import { AiWorkflowRoutingService, AIRS_TEMPLATE_CODE } from '../src/ai-governance/ai-workflow-routing.service';
import { computeInherentRisk, jsonRecord } from '../src/ai-governance/ai-risk-scoring';

export async function testAuthorityStrategy(db:PrismaClient,f:{riskId:string;riskOwnerId:string;officerId:string;auditorId:string}){
 const app=await NestFactory.create(AppModule,{logger:false});
 try{
  const strategy=app.get(AiRiskStrategyService),reviews=app.get(AiRiskReviewService),scoring=app.get(AiRiskAssessmentService),adoption=app.get(AiRiskAdoptionService),responses=app.get(AiRiskResponseService),routing=app.get(AiWorkflowRoutingService);
  // Services in this isolated app use the same test database as the fixture client.
  const baseRisk=await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId},include:{useCase:true}}),evidence=await db.ndiEvidence.findFirstOrThrow({where:{deletedAt:null}});
  const actors:Record<string,string>={AI_GOVERNANCE_OFFICER:f.officerId};
  for(const council of AI_COUNCILS.slice(1))actors[council.role]=(await db.user.findFirstOrThrow({where:{email:`${council.role}@phase3g.test`}})).id;
  const dto=(version:number)=>({expectedVersion:version,justification:'Independent evidence-backed operational outcome',evidenceIds:[evidence.id]});
  let index=0;
  async function source(strategyCode:'AVOID'|'ESCALATE'){
   const uc=await db.aiUseCase.create({data:{name:'Synthetic operational outcome test',createdBy:f.riskOwnerId,requesterUserId:f.riskOwnerId,ownerPersonId:baseRisk.useCase.ownerPersonId,organizationUnitId:baseRisk.useCase.organizationUnitId,assetId:baseRisk.useCase.assetId}});
   const wc=await db.workflowCase.create({data:{code:`AIRS-OUTCOME-${++index}`,title:'Synthetic operational outcome',type:'AIRS',status:'under_review',createdBy:f.riskOwnerId,templateId:(await routing.binding(db as PrismaService,AIRS_TEMPLATE_CODE)).id}});
   const risk=await db.aiRisk.create({data:{riskRef:`AIR-${990+index}`,useCaseId:uc.id,workflowCaseId:wc.id,ownerPersonId:baseRisk.ownerPersonId,title:'Synthetic outcome',cause:'Synthetic cause',event:'Synthetic event',effect:'Synthetic effect',createdBy:f.riskOwnerId,intakeData:baseRisk.intakeData as Prisma.InputJsonObject}});
   const cfg=await scoring.configuration(db as PrismaService),prior=await db.aiAssessmentRound.findFirstOrThrow({where:{riskId:f.riskId,kind:'inherent'},orderBy:{round:'desc'}});
   const dimensions=(jsonRecord(prior.inputs)['dimensions'] as Parameters<typeof computeInherentRisk>[1]).map(d=>({...d,value:2}));
   const assessment=await db.aiAssessmentRound.create({data:{riskId:risk.id,useCaseId:uc.id,kind:'inherent',round:1,createdBy:f.riskOwnerId,engineVersion:'airs-inherent-max8-v1',ruleReferenceVersionId:cfg.referenceVersions.R_LEVEL,inputs:{...jsonRecord(prior.inputs),configuration:cfg,dimensions,likelihood:{value:2,justification:'Synthetic probability'}} as unknown as Prisma.InputJsonObject,result:computeInherentRisk(2,dimensions,cfg) as unknown as Prisma.InputJsonObject}});
   await routing.openRiskAssessmentGate(db as PrismaService,wc.id,assessment.id,false,risk.riskRef!,new Date());
   const ac=await adoption.context(f.officerId,risk.id);await adoption.review(f.officerId,risk.id,ac.tasks[0].id,{...dto(ac.version),decision:'approve'});
   let rc=await responses.context(f.riskOwnerId,risk.id);await responses.propose(f.riskOwnerId,risk.id,{...dto(rc.version),strategyCode,offshoreProcessing:false});
   rc=await responses.context(f.officerId,risk.id);await responses.decide(f.officerId,risk.id,rc.tasks.find(t=>t.kind==='officer')!.id,{...dto(rc.version),decision:'approve'});
   return risk;
  }
  async function act(id:string,user:string,action:StrategyAction,extra={}){const c=await strategy.context(user,id);return strategy.act(user,id,{...dto(c.version),action,...extra});}
  const avoid=await source('AVOID');let c=await strategy.context(f.riskOwnerId,avoid.id);assert.equal(c.canPropose,true);
  await assert.rejects(strategy.act(f.officerId,avoid.id,{...dto(c.version),action:'close'}));
  await assert.rejects(strategy.act(f.riskOwnerId,avoid.id,{...dto(c.version),action:'propose',avoidanceAction:'scope_change',scopeChange:' ',evidenceIds:[]}));
  await act(avoid.id,f.riskOwnerId,'propose',{avoidanceAction:'scope_change',scopeChange:'Removed risky inputs; verified restricted processing scope'});
  c=await strategy.context(f.officerId,avoid.id);assert.equal(c.canReview,true);
  await assert.rejects(strategy.act(f.officerId,avoid.id,{...dto(c.version-1),action:'approve'}),/changed/);
  await act(avoid.id,f.officerId,'return');assert.equal((await strategy.context(f.riskOwnerId,avoid.id)).canPropose,true);
  await act(avoid.id,f.riskOwnerId,'propose',{avoidanceAction:'scope_change',scopeChange:'Independent retest confirms risky feature removed'});
  await assert.rejects(act(avoid.id,f.auditorId,'approve'));
  // Required audit failure rolls back ledger, task and version together.
  const liveAudit=app.get(AuditService),saved=liveAudit.logRequired;
  liveAudit.logRequired=async()=>{throw new Error('Injected operational audit failure');};
  const before=await strategy.context(f.officerId,avoid.id);
  const notificationsBefore=await db.governanceNotification.count({where:{sourceType:'ai_risk_strategy'}});
  await assert.rejects(act(avoid.id,f.officerId,'approve'),/Injected operational audit/);
  liveAudit.logRequired=saved;
  assert.deepEqual(await strategy.context(f.officerId,avoid.id),before);
  assert.equal(await db.governanceNotification.count({where:{sourceType:'ai_risk_strategy'}}),notificationsBefore,'Required audit rollback also rolls back native notifications');
  await act(avoid.id,f.officerId,'approve');await act(avoid.id,f.officerId,'close');
  assert.equal((await db.workflowCase.findUniqueOrThrow({where:{id:avoid.workflowCaseId!}})).status,'closed');
  assert.equal((await db.aiUseCase.findUniqueOrThrow({where:{id:avoid.useCaseId}})).operationalStatusCode,null);
  assert.equal(await db.aiAssessmentRound.count({where:{riskId:avoid.id,kind:'residual'}}),0);
  const stop=await source('AVOID');
  const pausedCase=await db.workflowCase.create({data:{code:'AIRS-STOP-PAUSED',title:'Pre-existing intake retained after stop',type:'AIRS',status:'draft',createdBy:f.riskOwnerId}});
  await db.aiRisk.create({data:{useCaseId:stop.useCaseId,workflowCaseId:pausedCase.id,ownerPersonId:baseRisk.ownerPersonId,title:'Retained draft',createdBy:f.riskOwnerId,intakeData:{}}});
  await act(stop.id,f.riskOwnerId,'propose',{avoidanceAction:'stop_use_case',scopeChange:'Entire use case stopped; processing and rollout disabled with evidence'});await act(stop.id,f.officerId,'approve');
  assert.equal((await strategy.context(f.officerId,stop.id)).canClose,false);await act(stop.id,actors.STEERING_COMMITTEE,'close');
  const stopped=await db.aiUseCase.findUniqueOrThrow({where:{id:stop.useCaseId}});assert.equal(stopped.operationalStatusCode,'ARCHIVED');assert.ok(stopped.operationalStrategyEventId);
  await assert.rejects(db.aiUseCase.update({where:{id:stopped.id},data:{operationalStatusCode:null,operationalStrategyEventId:null,version:{increment:1}}}));
  const escalated=await source('ESCALATE');await act(escalated.id,f.officerId,'open-escalation');
  for(let i=0;i<AI_COUNCILS.length;i++){
   const council=AI_COUNCILS[i],user=actors[council.role];c=await strategy.context(user,escalated.id);assert.equal(c.escalation!.level,council.level);assert.equal(c.canResolveEscalation,true);
   if(i===0){
    const role=await db.role.findUniqueOrThrow({where:{code:council.role}}),permission=await db.permission.findUniqueOrThrow({where:{resource_action:{resource:'airs.strategy',action:'decide'}}});
    await db.rolePermission.delete({where:{roleId_permissionId:{roleId:role.id,permissionId:permission.id}}});
    assert.equal((await strategy.context(user,escalated.id)).canResolveEscalation,false);await assert.rejects(act(escalated.id,user,'advance'));
    await db.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});
   }
   if(i===1){
    const esc=c.escalation!,task=await db.workflowTask.findFirstOrThrow({where:{caseId:escalated.workflowCaseId!,status:'pending',templateStage:{code:'airs-escalation-gate'}}});
    const prior=c.events.at(-1)!;
    await assert.rejects(db.governanceEscalation.update({where:{id:esc.id},data:{ownerRoleCode:'AI_GOVERNANCE_OFFICER'}}), /latest council event/);
    await db.workflowTask.update({where:{id:task.id},data:{assigneeRoleCode:'AI_GOVERNANCE_OFFICER'}});
    assert.equal((await strategy.context(f.officerId,escalated.id)).canResolveEscalation,false);
    await assert.rejects(db.aiRiskStrategyEvent.create({data:{responseId:prior.responseId,round:prior.round+1,kind:'escalation_outcome',outcome:'advance',taskId:task.id,basisEventId:prior.id,escalationId:esc.id,payload:{councilLevel:esc.level},actorId:f.officerId,actorRoleCode:'AI_GOVERNANCE_OFFICER',justification:'Forged council role must be rejected by database',evidenceIds:[evidence.id]}}));
    assert.equal((await db.governanceEscalation.findUniqueOrThrow({where:{id:esc.id}})).ownerRoleCode,council.role);
    await db.workflowTask.update({where:{id:task.id},data:{assigneeRoleCode:council.role}});
   }
   if(i<3){await assert.rejects(act(escalated.id,actors[AI_COUNCILS[i+1].role],'advance'));await act(escalated.id,user,'advance');}
   else {assert.equal(c.canAdvance,false);await assert.rejects(act(escalated.id,user,'advance'));await act(escalated.id,user,'return-for-response');}
  }
  assert.equal((await strategy.context(f.officerId,escalated.id)).escalation!.status,'resolved');
  assert.equal((await responses.context(f.riskOwnerId,escalated.id)).canPropose,true);assert.equal(await db.aiAssessmentRound.count({where:{riskId:escalated.id,kind:'residual'}}),0);
  const event=(await strategy.context(f.officerId,avoid.id)).events[0];await assert.rejects(db.aiRiskStrategyEvent.update({where:{id:event.id},data:{outcome:'stop_use_case'}}));await assert.rejects(db.aiRiskStrategyEvent.delete({where:{id:event.id}}));
  // Higher-authority reversal starts a new round and supersedes pending monitoring.
  const high=await db.aiRisk.findUniqueOrThrow({where:{riskRef:'AIR-972'}});
  const sourceTask=await routing.createStageTask(db as PrismaService,high.workflowCaseId!,'airs-identification',new Date(),{templateCode:AIRS_TEMPLATE_CODE,assigneeUserId:f.riskOwnerId,formDataJson:{submittedIntake:high.intakeData as Prisma.InputJsonObject}});
  await db.workflowTask.update({where:{id:sourceTask.id},data:{status:'completed',completedAt:new Date(),formSubmittedBy:f.riskOwnerId,formSubmittedAt:new Date()}});
  const prior=await reviews.context(actors.STEERING_COMMITTEE,high.id);assert.equal(prior.canReverseAuthority,true);
  await assert.rejects(reviews.reverseAuthority(actors.AI_EXECUTIVE_TEAM,high.id,dto(prior.version)),/higher actual/);
  const assessmentBefore=await db.aiAssessmentRound.findMany({where:{riskId:high.id},orderBy:{createdAt:'asc'}});
  const concurrent=await Promise.allSettled([reviews.reverseAuthority(actors.STEERING_COMMITTEE,high.id,dto(prior.version)),reviews.reverseAuthority(actors.STEERING_COMMITTEE,high.id,dto(prior.version))]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  const reopened=await reviews.context(actors.STEERING_COMMITTEE,high.id);assert.equal(reopened.canReverseAuthority,false);assert.equal(reopened.history[0].status,'superseded');assert.equal(reopened.reversals[0].authorityLevel,4);assert.equal(reopened.reversals[0].previousAuthorityLevel,3);
  assert.deepEqual(await db.aiAssessmentRound.findMany({where:{riskId:high.id},orderBy:{createdAt:'asc'}}),assessmentBefore);
  await assert.rejects(db.aiRiskAuthorityReversal.delete({where:{id:reopened.reversals[0].id}}));
  const fresh=await scoring.context(f.riskOwnerId,high.id);assert.equal(fresh.canStart,true);assert.equal(fresh.tasks.length,0);
  app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');
  const base=await app.getUrl(),jwt=app.get(JwtService),headers={authorization:`Bearer ${jwt.sign({sub:f.officerId,tokenVersion:0,roles:['STEERING_COMMITTEE']})}`,'content-type':'application/json'};
  assert.equal((await fetch(`${base}/api/ai/risks/${stop.id}/strategy`)).status,401);
  assert.equal((await fetch(`${base}/api/ai/risks/${stop.id}/strategy`,{method:'POST',headers,body:JSON.stringify({...dto(1),action:'close',actorRoleCode:'STEERING_COMMITTEE',riskAccepted:true,score:1})})).status,400);
  assert.equal((await fetch(`${base}/api/ai/risks/${high.id}/reviews/reverse-authority`,{method:'POST',headers,body:JSON.stringify({...dto(1),authorityLevel:4})})).status,400);
  console.log('Authority/AVOID/ESCALATE integration passed: fresh reopening, preserved decisions, superseded reviews, evidence-backed avoidance return/closure/Steering stop, four independent live councils and fresh response routing, SoD/grants/stale inputs, audit rollback, immutable ledgers and protected HTTP inputs.');
 } finally{await app.close();}
 await testOutcomeDenialAudit(db);
}

export async function testOutcomeDenialAudit(db:PrismaClient){
 const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
 const low=await db.aiRisk.findUniqueOrThrow({where:{riskRef:'AIR-971'},include:{useCase:{include:{owner:true}}}});
 const actorId=low.useCase.owner!.userId!,role=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}});
 const existing=await db.userRole.findUnique({where:{userId_roleId:{userId:actorId,roleId:role.id}}});
 try{
  if(!existing)await db.userRole.create({data:{userId:actorId,roleId:role.id}});
  const audit=app.get(AuditService),saved=audit.logRequired;let blocks=0;
  audit.logRequired=async function(...args:Parameters<AuditService['logRequired']>){const result=await saved.apply(this,args);if(args[0].action==='ai.sod.blocked')blocks++;return result;};
  const dto={expectedVersion:low.version,justification:'Own decision cannot be reversed',evidenceIds:[(await db.ndiEvidence.findFirstOrThrow({where:{deletedAt:null}})).id]};
  await assert.rejects(app.get(AiRiskReviewService).reverseAuthority(actorId,low.id,dto),/higher actual/);
  const stop=await db.aiRisk.findFirstOrThrow({where:{responses:{some:{strategyCode:'AVOID',strategyEvents:{some:{kind:'avoidance_closed',outcome:'stop_use_case'}}}}}});
  await assert.rejects(app.get(AiRiskStrategyService).act(actorId,stop.id,{...dto,expectedVersion:stop.version,action:'approve'}),/WF-05/);
  assert.equal(blocks,2);assert.equal((await db.aiRisk.findUniqueOrThrow({where:{id:low.id}})).version,low.version);
  audit.logRequired=saved;
  console.log('Operational denial audits passed: independently persisted SoD blocks, unchanged risk version and no implicit authority from combined roles.');
 }finally{
  if(!existing)await db.userRole.delete({where:{userId_roleId:{userId:actorId,roleId:role.id}}});
  await app.close();
 }
}
