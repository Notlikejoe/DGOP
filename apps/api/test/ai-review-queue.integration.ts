import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIntakeService } from '../src/ai-governance/ai-intake.service';
import { AiClassificationService } from '../src/ai-governance/ai-classification.service';
import { AiDecisionService } from '../src/ai-governance/ai-decision.service';
import { AiRegistrationService } from '../src/ai-governance/ai-registration.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AiReviewQueryDto } from '../src/ai-governance/ai-review-query.dto';
import { ScopeService } from '../src/access/scope.service';

async function main(){
  const startedAt=new Date().toISOString(),url=new URL(process.env.DGOP_AI_TEST_DATABASE_URL??'');
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55438');assert.match(url.pathname,/^\/dgop_ai_test_repair_batch1_\d+$/u);assert.equal(process.env.NODE_ENV,'test');
  const manifest=JSON.parse(readFileSync(process.env.DGOP_DEMO_MANIFEST!,'utf8'));
  const db=new PrismaClient({datasources:{db:{url:url.href}}}),checks:string[]=[],rollback=Symbol('successful diagnostic rollback');
  let passed=false,error:string|null=null;
  try{
    try{await db.$transaction(async tx=>{
      const tag='B2-'+randomUUID(),roles=await tx.role.findMany({where:{code:{in:['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER','privacy_officer','data_owner']}}});assert.equal(roles.length,4);
      const unit=await tx.organizationUnit.create({data:{code:tag,nameEn:tag,nameAr:'وحدة اختبار'}});
      const foreign=await tx.organizationUnit.create({data:{code:tag+'-outside',nameEn:tag+' outside',nameAr:'خارج النطاق'}});
      // This enclosing transaction rolls back fixtures AND these temporary scope changes.
      await tx.roleDataScope.deleteMany({where:{roleId:{in:roles.map(role=>role.id)}}});
      await tx.roleDataScope.createMany({data:roles.map(role=>({roleId:role.id,scopeType:'org_unit',refId:unit.id,includeDescendants:false}))});
      await tx.role.updateMany({where:{id:{in:roles.map(role=>role.id)}},data:{maxClassificationRank:null}});
      const actor=await tx.user.create({data:{email:tag+'@synthetic-test.invalid',displayName:'Synthetic queue reader',passwordHash:'unusable-synthetic-account',userRoles:{create:roles.map(role=>({roleId:role.id}))}}});
      const ownerUser=await tx.user.create({data:{email:tag+'-owner@synthetic-test.invalid',displayName:'Synthetic independent owner',passwordHash:'unusable-synthetic-account'}});
      const owner=await tx.person.create({data:{fullNameEn:tag,fullNameAr:'مالك تجريبي',organization:unit.code,userId:ownerUser.id}});
      const template=await tx.workflowTemplate.findUniqueOrThrow({where:{code:'AIUC_APPROVAL_V1'},include:{stages:true}});
      const basis=await tx.aiAssessmentRound.findFirstOrThrow({where:{kind:'classification'}});
      const facade:any=new Proxy(tx,{get(target,key){if(key==='$transaction')return (work:any)=>work(tx);return Reflect.get(target,key);}});
      const audit=new AuditService(facade),authorization=new AiAuthorizationService(facade,audit),routing=new AiWorkflowRoutingService(facade);
      const intake=new AiIntakeService(facade,authorization,new AiIdentifiersService(),audit,routing);
      const classification=new AiClassificationService(facade,authorization,audit,routing);
      const decisions=new AiDecisionService(facade,authorization,audit,routing);
      const registrations=new AiRegistrationService(facade,authorization,routing,null!,new AiIdentifiersService(),audit,new ScopeService(facade));
      const stages=[
        ['triage','aiuc-triage','AI_WORKING_GROUP','submitted',()=>intake.triageQueue.bind(intake)],
        ['classification','aiuc-classification','AI_WORKING_GROUP','under_review',()=>classification.queue.bind(classification)],
        ['verification','aiuc-classification','AI_GOVERNANCE_OFFICER','under_review',()=>classification.verificationQueue.bind(classification)],
        ['specialist','aiuc-privacy-review','privacy_officer','under_review',()=>classification.reviewQueue.bind(classification)],
        ['decision','aiuc-decision','AI_GOVERNANCE_OFFICER','under_review',()=>decisions.queue.bind(decisions)],
        ['registration','aiuc-asset-approval','data_owner','approved',()=>registrations.queue.bind(registrations)],
      ] as const;
      for(const [name,stageCode,role,status,method] of stages){
        const stage=template.stages.find(stage=>stage.code===stageCode);assert.ok(stage,stageCode);
        const items=Array.from({length:203},(_,index)=>({id:randomUUID(),caseId:randomUUID(),index}));
        const eligible=items.slice(100,201),excludedDuty=items.slice(201);
        await tx.workflowCase.createMany({data:items.map(item=>({id:item.caseId,code:tag+'-'+name+'-'+item.index,title:'Synthetic queue diagnostic',type:'AIUC',status,templateId:template.id,templateVersion:template.designerVersion,createdBy:manifest.actors.showcase}))});
        await tx.aiUseCase.createMany({data:items.map(item=>({id:item.id,name:tag+' '+name+' '+item.index,description:item.index===200?'بحث عربي مميز':null,useCaseRef:'AI-'+BigInt('0x'+item.id.replaceAll('-','')).toString(),
          workflowCaseId:item.caseId,requesterUserId:item.index>=201&&name==='decision'?actor.id:manifest.actors.showcase,ownerPersonId:owner.id,organizationUnitId:item.index<100?foreign.id:unit.id,
          createdBy:manifest.actors.showcase,updatedAt:new Date(item.index<100?'2000-01-01':'2001-01-01')}))});
        await tx.aiAssessmentRound.createMany({data:items.map(item=>({useCaseId:item.id,kind:'classification',round:1,schemaVersion:basis.schemaVersion,engineVersion:basis.engineVersion,ruleReferenceVersionId:basis.ruleReferenceVersionId,inputs:basis.inputs as any,result:basis.result as any,createdBy:basis.createdBy}))});
        await tx.workflowTask.createMany({data:items.map(item=>({caseId:item.caseId,templateStageId:stage.id,title:name==='verification'?'AIUC classification verification':name==='classification'?'AIUC classification assessment':'Synthetic '+name,type:'approval',status:item.index%2&&(name==='decision'||name==='registration')?'in_progress':'pending',assigneeRoleCode:role,
          assigneeUserId:item.index>=201&&name==='specialist'?manifest.actors.administrator:actor.id,dueDate:item.index%2?null:new Date('2000-01-01'),
          formDataJson:name==='registration'?{registrationProposal:{registeredBy:item.index>=201?actor.id:manifest.actors.showcase}}:{}}))});
        const expected=eligible.map(item=>item.id).sort(),read=method();
        // Non-decision queues have no independent-duty exclusion for these two extra records.
        if(!['decision','registration','specialist'].includes(name)){await tx.workflowTask.updateMany({where:{caseId:{in:excludedDuty.map(item=>item.caseId)}},data:{status:'cancelled'}});}
        const query=Object.assign(new AiReviewQueryDto(),{search:tag+' '+name});
        const first=await read(actor.id,query);assert.equal(first.total,101,name);assert.equal(first.data.length,25);assert.equal(first.totalPages,5);assert.deepEqual(first.data.map(row=>row.id),expected.slice(0,25));
        assert.equal(first.summary.total,101);assert.equal(first.summary.pending+first.summary.inProgress,101);assert.equal(first.summary.overdue,51);checks.push(name+': 100 older out-of-scope cases, assignment/duty exclusions, full counts and stable first page');
        const all:string[]=[];
        for(let page=1;page<=5;page++){const result=await read(actor.id,Object.assign(new AiReviewQueryDto(),{search:query.search,page}));all.push(...result.data.map(row=>row.id));assert.equal(result.total,101);}
        assert.deepEqual(all,expected);assert.equal(new Set(all).size,101);checks.push(name+': five pages cover every eligible record exactly once');
        const arabic=await read(actor.id,Object.assign(new AiReviewQueryDto(),{search:'بحث عربي مميز'}));assert.ok(arabic.data.some(row=>row.id===items[200].id));checks.push(name+': server Arabic description search discovers record beyond 100');
        const beyond=await read(actor.id,Object.assign(new AiReviewQueryDto(),{search:query.search,page:6}));assert.equal(beyond.total,101);assert.equal(beyond.data.length,0);
        const maximum=await read(actor.id,Object.assign(new AiReviewQueryDto(),{search:query.search,pageSize:200}));assert.equal(maximum.data.length,101);checks.push(name+': maximum page and empty beyond-range page preserve totals');
      }
      // Compare the special unregistered classification ceiling against authoritative detail checks.
      const privacyRole=roles.find(role=>role.code==='privacy_officer')!,limited=await tx.user.create({data:{email:tag+'-ceiling@synthetic-test.invalid',displayName:'Synthetic limited reader',passwordHash:'unusable',userRoles:{create:{roleId:privacyRole.id}}}});
      const version=await tx.governedReferenceVersion.findFirstOrThrow({where:{listCode:'L_CLASS',state:'published'},include:{values:true},orderBy:{effectiveFrom:'desc'}});
      assert.ok(version.effectiveFrom);
      const mappedCodes=version.values.map(value=>(value.metadata as any)?.assetClassificationCode).filter((code):code is string=>typeof code==='string');
      const classRow=await tx.classification.findFirstOrThrow({where:{code:{in:mappedCodes},isActive:true,deletedAt:null},orderBy:{rank:'asc'}});
      await tx.role.update({where:{id:privacyRole.id},data:{maxClassificationRank:classRow.rank}});
      const value=version.values.find(value=>(value.metadata as any)?.assetClassificationCode===classRow.code);assert.ok(value);
      const target=await tx.aiUseCase.findFirstOrThrow({where:{name:{startsWith:tag+' specialist '},organizationUnitId:unit.id}});
      await tx.aiIntakeRevision.createMany({data:[{useCaseId:target.id,revision:1,payload:{data_classification:value.code},submittedAt:new Date(Math.max(Date.now(),version.effectiveFrom.getTime())),createdBy:actor.id},{useCaseId:target.id,revision:2,payload:{data_classification:'invalid-draft'},createdBy:actor.id}]});
      await authorization.authorizeBusiness(limited.id,'case.view.aiuc.org',tx,target.id);
      const scope=await authorization.queueReadScope({roles:['privacy_officer'],administratorOversight:false},tx);
      assert.deepEqual((await scope.filter([{id:target.id}])).map(row=>row.id),[target.id]);checks.push('classification ceiling: latest submitted proof is shared with detail checks; draft cannot replace it');
      await tx.aiIntakeRevision.create({data:{useCaseId:target.id,revision:3,payload:{data_classification:'unmapped-submitted-code'},submittedAt:new Date(),createdBy:actor.id}});
      await assert.rejects(authorization.authorizeBusiness(limited.id,'case.view.aiuc.org',tx,target.id),/scope/);
      assert.equal((await scope.filter([{id:target.id}])).length,0);
      await tx.aiIntakeRevision.create({data:{useCaseId:target.id,revision:4,payload:{data_classification:value.code},submittedAt:new Date(),createdBy:actor.id}});
      await tx.workflowTask.updateMany({where:{caseId:target.workflowCaseId!,assigneeRoleCode:'privacy_officer'},data:{assigneeUserId:limited.id}});
      assert.equal((await classification.reviewQueue(limited.id,Object.assign(new AiReviewQueryDto(),{search:target.name}))).total,1);
      await tx.roleDataScope.create({data:{roleId:privacyRole.id,scopeType:'data_domain',refId:randomUUID(),includeDescendants:false}});
      const denied=await classification.reviewQueue(limited.id,Object.assign(new AiReviewQueryDto(),{search:tag}));assert.equal(denied.total,0);checks.push('restricted data-domain scope denies unregistered cases before counting');
      await tx.person.update({where:{id:owner.id},data:{userId:null}});
      assert.equal((await decisions.queue(actor.id,Object.assign(new AiReviewQueryDto(),{search:tag+' decision'}))).total,101);
      checks.push('nullable directory linkage does not silently hide independent decision work');
      throw rollback;
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:15000,timeout:60000});}catch(cause){if(cause!==rollback)throw cause;}
    const proof=await new AuditService(db as any).verifyChain();assert.equal(proof.valid,true);assert.equal(proof.truncated,false);assert.equal(proof.totalRowsRead,proof.totalRows);checks.push('existing complete audit chain preserved after diagnostic rollback');
    passed=true;console.log(JSON.stringify({passed,checks:checks.length,scenarios:checks,diagnosticFixturesRolledBack:true}));
  }catch(cause){error=cause instanceof Error?cause.message:String(cause);throw cause;}
  finally{await db.$disconnect();if(process.env.DGOP_QUEUE_RECEIPT)writeFileSync(process.env.DGOP_QUEUE_RECEIPT,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),database:url.pathname.slice(1),passed,checks:checks.length,scenarios:checks,error,diagnosticFixturesRolledBack:true},null,2)+'\n');}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
