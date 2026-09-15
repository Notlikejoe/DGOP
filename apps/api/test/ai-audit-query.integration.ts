import assert from 'node:assert/strict';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { AiAuditQueryService } from '../src/ai-governance/ai-audit-query.service';
export async function testAuditQuery(db:PrismaClient,app:INestApplication,officerId:string,riskOwnerId:string){
 const audit=app.get(AiAuditQueryService),all=await audit.query(officerId,{pageSize:100});assert.ok(all.total>20);
 const first=await audit.query(officerId,{pageSize:1}),second=await audit.query(officerId,{page:2,pageSize:1});
 assert.equal(first.total,all.total);assert.notEqual(first.rows[0].id,second.rows[0].id);
 const nativeRisk=all.rows.find(e=>e.entityType==='ai_risk')!;
 const risk=await db.aiRisk.findUniqueOrThrow({where:{id:nativeRisk.entityId!},include:{useCase:true}});
 const scoped=await audit.query(officerId,{caseId:risk.workflowCaseId!});assert.ok(scoped.rows.filter(e=>e.entityType==='ai_risk').every(e=>e.entityId===risk.id));
 const byAsset=await audit.query(officerId,{assetId:risk.useCase.assetId!});assert.ok(byAsset.total>=scoped.total);
 const event=await db.auditLog.findUniqueOrThrow({where:{id:first.rows[0].id}});
 assert.ok((await audit.query(officerId,{actorId:event.actor})).rows.every(e=>e.action));
 const serialized=JSON.stringify(all);for(const key of ['clientIp','passwordHash','prevHash','hash','evidenceIds'])assert.ok(!serialized.includes('"'+key+'"'));
 await assert.rejects(audit.query(riskOwnerId));await assert.rejects(audit.query(officerId,{page:0}));await assert.rejects(audit.query(officerId,{pageSize:101}));
 await assert.rejects(audit.query(officerId,{from:'2026-01-01'}));
 const role=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}}),scope=await db.roleDataScope.create({data:{roleId:role.id,scopeType:'data_domain',refId:'excluded-audit-domain'}});
 try{assert.equal((await audit.query(officerId,{caseId:risk.workflowCaseId!})).total,0);}finally{await db.roleDataScope.delete({where:{id:scope.id}});}
 const headers={authorization:'Bearer '+app.get(JwtService).sign({sub:officerId,tokenVersion:0,roles:['system_admin']})},url=(await app.getUrl())+'/api/ai/audit';
 assert.equal((await fetch(url,{headers})).status,200);assert.equal((await fetch(url)).status,401);
 for(const query of ['?page=x','?page=0','?pageSize=101','?caseId=invalid','?actorId=invalid','?from=invalid','?score=1'])assert.equal((await fetch(url+query,{headers})).status,400,query);
 assert.ok((await audit.csv(officerId,{pageSize:1})).startsWith('\ufeff'));assert.equal((await fetch(url+'/export',{headers})).status,200);
 const useCases=await audit.query(officerId,{kind:'aiuc',pageSize:100});assert.ok(useCases.total>0);assert.ok(useCases.rows.some(e=>e.entityType==='ai_use_case'));
 const combined=await audit.query(officerId,{kind:'all',pageSize:100});assert.equal(combined.total,all.total+useCases.total);
 const useCase=await db.aiUseCase.findUniqueOrThrow({where:{id:useCases.rows.find(e=>e.entityType==='ai_use_case')!.entityId!}});
 assert.ok((await audit.query(officerId,{kind:'aiuc',caseId:useCase.workflowCaseId!})).rows.filter(e=>e.entityType==='ai_use_case').every(e=>e.entityId===useCase.id));
 const assetTrail=await audit.query(officerId,{kind:'all',assetId:risk.useCase.assetId!});assert.ok(assetTrail.total>=byAsset.total);
 await assert.rejects(audit.query(officerId,{kind:'all',detail:'full'}),/live Auditor/);
 const auditorRole=await db.role.findUniqueOrThrow({where:{code:'auditor'}}),auditor=await db.user.create({data:{email:'full-audit-'+Date.now()+'@isolated.test',displayName:'Synthetic native Auditor',passwordHash:'not-a-login',userRoles:{create:{roleId:auditorRole.id}}}});
 const full=await audit.query(auditor.id,{kind:'all',detail:'full',assetId:risk.useCase.assetId!});assert.ok(full.total>0);assert.equal(full.metadataRedacted,false);
 const exact=await db.auditLog.findUniqueOrThrow({where:{id:full.rows[0].id}});assert.equal(full.rows[0].actor,exact.actor);assert.equal(full.rows[0].entryHash,exact.entryHash);assert.deepEqual(full.rows[0].metadata,exact.metadata);
 const census=await audit.census(auditor.id,{kind:'all',assetId:risk.useCase.assetId!});assert.equal(census.total,full.total);assert.equal(census.actions.reduce((n,a)=>n+a.events,0),census.total);assert.equal(census.historicalMetadataReconstructed,false);
 await assert.rejects(audit.census(officerId),/live Auditor/);
 const chain=await audit.verifyGlobalChain(auditor.id);assert.equal(chain.scope,'global_dgop_chain');assert.equal(chain.truncated,false);assert.equal(chain.valid,true);
 await assert.rejects(audit.verifyGlobalChain(officerId));
 const auditScope=await db.roleDataScope.create({data:{roleId:auditorRole.id,scopeType:'data_domain',refId:'excluded-full-audit-domain'}});
 try{assert.equal((await audit.query(auditor.id,{kind:'all',detail:'full',assetId:risk.useCase.assetId!})).total,0);assert.equal((await audit.census(auditor.id,{kind:'all'})).total,0);await assert.rejects(audit.verifyGlobalChain(auditor.id),/unrestricted/);}finally{await db.roleDataScope.delete({where:{id:auditScope.id}});}
 const grant=await db.rolePermission.findFirstOrThrow({where:{roleId:auditorRole.id,permission:{resource:'case.view.aiuc',action:'all'}}});
 await db.rolePermission.delete({where:{roleId_permissionId:{roleId:grant.roleId,permissionId:grant.permissionId}}});
 try{await assert.rejects(audit.query(auditor.id,{kind:'all',detail:'full'}),/explicit eligible role grant/);}finally{await db.rolePermission.create({data:{roleId:grant.roleId,permissionId:grant.permissionId}});}
 for(const query of ['?kind=unknown','?detail=unknown'])assert.equal((await fetch(url+query,{headers})).status,400);
 assert.equal((await fetch(url+'?kind=all&detail=full',{headers})).status,403);
 assert.equal((await fetch(url+'/census',{headers})).status,403);assert.equal((await fetch(url+'/chain/verify',{headers})).status,403);
 const requester=await db.user.findUniqueOrThrow({where:{email:'intake-requester@phase2a.test'}}),requestHeaders={authorization:'Bearer '+app.get(JwtService).sign({sub:requester.id,tokenVersion:0,roles:['system_admin']}),'content-type':'application/json','x-forwarded-for':'198.51.100.23'};
 const request=await fetch((await app.getUrl())+'/api/ai/use-cases',{method:'POST',headers:requestHeaders,body:JSON.stringify({payload:{usecase_name:'Synthetic HTTP audit context'}})});assert.equal(request.status,201);
 const created=await request.json() as {id:string},httpAudit=await db.auditLog.findFirstOrThrow({where:{entityId:created.id,action:'aiuc.intake.draft.created'}}),metadata=httpAudit.metadata as Record<string,unknown>;
 assert.equal(metadata.actorOrigin,'http');assert.equal(metadata.authenticatedActorId,requester.id);assert.notEqual(metadata.clientIp,'198.51.100.23');assert.ok(String(metadata.clientIp).includes('127.0.0.1'));assert.equal(metadata.requestMethod,'POST');
 console.log('AI audit query passed: complete native scoped trail, stable pagination, case/asset/actor filters, current domain scope, metadata redaction, CSV and HTTP bounds.');
 console.log('Native AIUC/asset audit passed: combined populations, exact native Auditor metadata/chain fields, scope, live grant revocation and Officer full-detail denial.');
}
