import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { ScopeService } from '../src/access/scope.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiWorkflowRoutingService, AIRS_TEMPLATE_CODE } from '../src/ai-governance/ai-workflow-routing.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiAnnualReviewService } from '../src/ai-governance/ai-annual-review.service';
import { AiMonthlyReviewService } from '../src/ai-governance/ai-monthly-review.service';
import { AiReviewReportService } from '../src/ai-governance/ai-review-report.service';
import { AiHistoryService } from '../src/ai-governance/ai-history.service';
import { AiEvidenceService } from '../src/ai-governance/ai-evidence.service';
import { EvidenceService } from '../src/evidence/evidence.service';

async function main(){
  const startedAt=new Date().toISOString(),url=new URL(process.env.DGOP_AI_TEST_DATABASE_URL??'');
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55438');assert.match(url.pathname,/^\/dgop_ai_test_repair_batch1_\d+$/u);assert.equal(process.env.NODE_ENV,'test');
  const db=new PrismaClient({datasources:{db:{url:url.href}}}),checks:string[]=[],rollback=Symbol('verified rollback');let passed=false,error:string|null=null;
  try{try{await db.$transaction(async tx=>{
    const tag='B3-'+randomUUID(),unit=await tx.organizationUnit.create({data:{code:tag,nameEn:tag,nameAr:'وحدة سجل تجريبي'}}),foreign=await tx.organizationUnit.create({data:{code:tag+'-F',nameEn:tag+' foreign',nameAr:'خارج النطاق'}}),denied=await tx.organizationUnit.create({data:{code:tag+'-D',nameEn:tag+' denied',nameAr:'ممنوع'}});
    const roles=await tx.role.findMany({where:{code:{in:['AI_GOVERNANCE_OFFICER','AI_WORKING_GROUP','auditor']}}});assert.equal(roles.length,3);
    await tx.roleDataScope.deleteMany({where:{roleId:{in:roles.map(r=>r.id)}}});await tx.role.updateMany({where:{id:{in:roles.map(r=>r.id)}},data:{maxClassificationRank:null}});
    await tx.roleDataScope.createMany({data:roles.map(r=>({roleId:r.id,scopeType:'org_unit',refId:unit.id,includeDescendants:false}))});
    const officerRole=roles.find(r=>r.code==='AI_GOVERNANCE_OFFICER')!,workingRole=roles.find(r=>r.code==='AI_WORKING_GROUP')!,auditorRole=roles.find(r=>r.code==='auditor')!;
    const actor=await tx.user.create({data:{email:tag+'-reader@synthetic.invalid',displayName:'Synthetic officer',passwordHash:'unusable-synthetic',userRoles:{create:[officerRole,workingRole].map(r=>({roleId:r.id}))}}});
    const auditor=await tx.user.create({data:{email:tag+'-audit@synthetic.invalid',displayName:'Synthetic auditor',passwordHash:'unusable-synthetic',userRoles:{create:{roleId:auditorRole.id}}}});
    const useCaseRef='AI-'+BigInt('0x'+randomUUID().replaceAll('-','')).toString();
    const source=await tx.aiUseCase.findFirstOrThrow({where:{assetId:{not:null},deletedAt:null},include:{asset:true}}),asset=await tx.dataAsset.create({data:{code:tag,nameEn:tag,nameAr:'أصل تجريبي',assetType:'ai_data_product',typeMetadataJson:{aiUseCaseRef:useCaseRef},orgUnitId:unit.id,domainId:source.asset!.domainId,classificationId:source.asset!.classificationId}});
    const template=await tx.workflowTemplate.findUniqueOrThrow({where:{code:AIRS_TEMPLATE_CODE}});
    const useCase=await tx.aiUseCase.create({data:{name:tag,useCaseRef,organizationUnitId:unit.id,assetId:asset.id,requesterUserId:actor.id,createdBy:actor.id}});
    const workflow=await tx.workflowCase.create({data:{code:tag,title:tag,type:'AIRS',status:'implemented',templateId:template.id,createdBy:actor.id}});
    const risk=await tx.aiRisk.create({data:{useCaseId:useCase.id,workflowCaseId:workflow.id,riskRef:'AIR-'+BigInt('0x'+randomUUID().replaceAll('-','')).toString(),title:tag,cause:'Synthetic cause',event:'Synthetic event',effect:'Synthetic effect',createdBy:actor.id}});
    const facade:any=new Proxy(tx,{get(t,k){if(k==='$transaction')return(work:any)=>work(tx);return Reflect.get(t,k);}}),audit=new AuditService(facade),auth=new AiAuthorizationService(facade,audit),scope=new ScopeService(facade),routing=new AiWorkflowRoutingService(facade),ids=new AiIdentifiersService(),risks=new AiRiskIntakeService(facade,auth,scope,routing,ids,audit),annual=new AiAnnualReviewService(facade,auth,scope,risks,routing,ids,audit),monthly=new AiMonthlyReviewService(facade,annual,audit),reports=new AiReviewReportService(facade,auth,scope,risks),history=new AiHistoryService(facade,auth,reports);
    const proof=new AiEvidenceService(facade,auth,risks,annual,audit),files=new EvidenceService(facade,audit);
    const owner=await tx.person.create({data:{userId:actor.id,email:actor.email,fullNameEn:tag,fullNameAr:'مسؤول أدلة تجريبية'}}),domain=await tx.ndiDomain.findFirstOrThrow();
    const spec=await tx.ndiSpecification.create({data:{code:tag,domainId:domain.id,ownerPersonId:owner.id,nameEn:tag,nameAr:'دليل سجل تجريبي'}});
    const manifest=JSON.parse(readFileSync(process.env.DGOP_DEMO_MANIFEST!,'utf8')),custodian=await tx.user.findUniqueOrThrow({where:{id:manifest.actors.custodian},include:{userRoles:{include:{role:true}}}});
    const body=Buffer.from('Synthetic history, continuity and retained snapshot assurance: '+tag),uploaded=await files.create({specId:spec.id,title:tag,submit:'true'},{buffer:body,size:body.length,originalname:'synthetic-history.txt',mimetype:'text/plain'},{id:actor.id,email:actor.email,roles:[officerRole.code,workingRole.code]});
    const evidence=await files.review(uploaded.id,{decision:'approve',comment:'Independent synthetic history evidence review'},{id:custodian.id,email:custodian.email,roles:custodian.userRoles.map(r=>r.role.code)});
    let opened=await annual.register(actor.id,unit.id),oldId=opened.reviewId;
    for(let i=1;i<=100;i++){await proof.link(actor.id,'ai_annual_review',opened.reviewId,[evidence.id],'Synthetic proof for this exact retained review round '+i);const result=await annual.complete(actor.id,opened.reviewId,{expectedRound:i,expectedHandoverRound:0,trendsSummary:i===1?'بحث قديم محفوظ':'Synthetic round '+i,controlEffectivenessSummary:'Synthetic retained controls',nonconformitySummary:'Synthetic retained findings',evidenceIds:[evidence.id]});opened={reviewId:result.nextReviewId};}
    let a=await annual.context(actor.id,unit.id);assert.equal(a.total,101);assert.deepEqual(a.summary,{total:101,completed:100,pending:1,overdue:0});assert.equal(a.data.length,25);assert.equal(a.totalPages,5);assert.equal(a.data[0].round,101);checks.push('101 annual rounds: default page, complete summary and newest-first order');
    const tail=await annual.context(auditor.id,unit.id,{page:5,pageSize:25,search:''});assert.equal(tail.data[0].id,oldId);assert.equal(tail.data[0].round,1);assert.equal(tail.data[0].canComplete,false);checks.push('old annual round beyond 100 is discoverable by scoped read-only auditor');
    const search=await annual.context(actor.id,unit.id,{page:1,pageSize:25,search:'بحث قديم'});assert.equal(search.total,1);assert.equal(search.data[0].id,oldId);assert.equal(search.canRegister,false);checks.push('Arabic annual findings search and calendar existence independent of search');
    const absent=await annual.context(actor.id,unit.id,{page:1,pageSize:25,search:'missing-no-match'});assert.equal(absent.total,0);assert.equal(absent.canRegister,false);checks.push('empty search cannot reopen an existing calendar');
    for(let i=0;i<101;i++)await monthly.capture(actor.id,unit.id,new Date(Date.UTC(2000, i,1)).toISOString().slice(0,7));
    const m=await monthly.list(actor.id,unit.id);assert.equal(m.total,101);assert.deepEqual(m.summary,{total:101,sourceCount:101});assert.equal(m.data.length,25);assert.equal(m.totalPages,5);checks.push('101 monthly snapshots: complete summary and bounded pages');
    const oldest=await monthly.list(auditor.id,unit.id,{page:5,pageSize:25,search:''});assert.equal(oldest.data[0].periodMonth,'2000-01');const saved=await monthly.get(auditor.id,oldest.data[0].id);assert.equal(saved.readOnly,true);assert.equal(saved.sourceCount,1);checks.push('old monthly snapshot beyond 24 and 100 is readable with immutable totals');
    const monthSearch=await monthly.list(actor.id,unit.id,{page:1,pageSize:25,search:'2000-01'});assert.equal(monthSearch.total,1);checks.push('monthly server search matches the complete history');
    // Move only the officer role scope; users with the working-group role retain full coverage.
    await tx.roleDataScope.updateMany({where:{roleId:officerRole.id},data:{refId:foreign.id}});
    const nomineeIds=Array.from({length:101},()=>randomUUID());
    await tx.user.createMany({data:nomineeIds.map((id,i)=>({id,email:tag+'-nominee-'+String(i).padStart(3,'0')+'@synthetic.invalid',displayName:'Synthetic nominee',passwordHash:'unusable-synthetic'}))});
    await tx.userRole.createMany({data:[...nomineeIds.map(userId=>({userId,roleId:officerRole.id})),{userId:nomineeIds[100],roleId:workingRole.id}]});
    const nominees=await annual.nomineeList(actor.id,unit.id,{page:1,pageSize:25,search:tag+'-nominee-'});assert.equal(nominees.total,1);assert.equal(nominees.data[0].id,nomineeIds[100]);checks.push('eligibility before pagination discovers the only scoped officer after 100 excluded candidates');
    await assert.rejects(annual.nomineeList(auditor.id,unit.id),/explicit eligible|owned by/);checks.push('auditor cannot enumerate business handover nominees');
    a=await annual.context(actor.id,unit.id);const live=a.data[0],payload={expectedHandoverRound:0,toOfficerId:nomineeIds[100],justification:'Synthetic independent continuity',evidenceIds:[evidence.id]};
    await proof.link(actor.id,'ai_annual_review',live.id,[evidence.id],'Synthetic proof for this exact named continuity handover');await annual.handover(actor.id,live.id,payload);const moved=(await annual.context(nomineeIds[100],unit.id)).data[0];assert.equal(moved.handoverRound,1);assert.equal(moved.currentOfficerId,nomineeIds[100]);assert.equal(moved.dueAt.getTime(),live.dueAt.getTime());assert.equal(moved.canComplete,true);assert.equal((await annual.context(actor.id,unit.id)).data[0].canComplete,false);checks.push('handover changes the named officer, preserves deadline and displays retained history');
    await assert.rejects(annual.handover(actor.id,live.id,payload),/gate changed/);checks.push('stale handover round is rejected');
    await tx.dataAsset.update({where:{id:asset.id},data:{isActive:false,lifecycleStatus:'retired'}});
    assert.deepEqual((await monthly.get(auditor.id,oldest.data[0].id)).measures,saved.measures);assert.equal((await annual.context(auditor.id,unit.id)).total,101);assert.equal((await history.list(auditor.id,1,50)).rows.some(r=>r.id===useCase.id),true);assert.equal((await risks.list(actor.id)).data.some(r=>r.id===risk.id),false);checks.push('retired asset remains in authorized snapshots/journey; live risk register stays inactive');
    await tx.organizationUnit.update({where:{id:unit.id},data:{isActive:false}});assert.equal((await annual.units(auditor.id)).units.some(u=>u.id===unit.id),true);assert.equal((await annual.context(actor.id,unit.id)).data[0].canHandover,false);checks.push('retired unit with history remains discoverable with business actions disabled');
    await assert.rejects(annual.context(actor.id,denied.id),/not found/);await assert.rejects(monthly.list(auditor.id,denied.id),/not found/);checks.push('foreign organization history remains denied');
    await tx.role.update({where:{id:auditorRole.id},data:{maxClassificationRank:0}});await assert.rejects(monthly.get(auditor.id,oldest.data[0].id),/classification coverage/);await assert.rejects(annual.context(auditor.id,unit.id),/classification coverage/);assert.equal((await history.list(auditor.id)).total,0);checks.push('stricter current classification authority applies to historical reads');
    await tx.role.update({where:{id:auditorRole.id},data:{maxClassificationRank:null}});
    await tx.dataAsset.update({where:{id:asset.id},data:{deletedAt:new Date()}});assert.equal((await monthly.list(auditor.id,unit.id)).total,0);assert.equal((await annual.context(auditor.id,unit.id)).total,0);await assert.rejects(monthly.get(auditor.id,oldest.data[0].id),/outside current register/);checks.push('untraceable/deleted source is excluded before totals; direct snapshot read denied');
    const chain=await audit.verifyChain();assert.equal(chain.valid,true);assert.equal(chain.truncated,false);checks.push('all native capture/completion/handover audit entries remain valid');
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');checks.push('database native lineage and deferred constraints remain enforced');
    throw rollback;
  },{timeout:180000,maxWait:15000});}catch(cause){if(cause!==rollback)throw cause;}
  passed=true;console.log(JSON.stringify({passed,checks:checks.length,scenarios:checks}));
  }catch(cause){error=cause instanceof Error?cause.message:String(cause);throw cause;}
  finally{await db.$disconnect();if(process.env.DGOP_HISTORY_RECEIPT)writeFileSync(process.env.DGOP_HISTORY_RECEIPT,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),database:url.pathname.slice(1),passed,checks:checks.length,scenarios:checks,error,diagnosticFixturesRolledBack:true},null,2)+'\n');}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
