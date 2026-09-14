import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { AiDashboardReportsService } from '../src/ai-governance/ai-dashboard-reports.service';
import { governanceDigest } from '../src/ai-governance/ai-governance-ledger';

// Synthetic immutable observations are inserted only into the isolated test database.
export async function testReportTrends(db:PrismaClient,app:INestApplication,f:{officerId:string;auditorId:string;riskOwnerId:string},snapshotId:string,execId:string,assetId:string){
 const reports=app.get(AiDashboardReportsService),base=await db.aiDashboardSnapshot.findUniqueOrThrow({where:{id:snapshotId}}),unitId=base.organizationUnitId;
 const observation=await reports.trend(f.officerId,unitId);
 assert.equal(observation.readOnly,true);assert.equal(observation.historicalReconstruction,false);assert.equal(observation.missingObservationsInterpolated,false);
 const sources=base.sourceMembers as Record<string,Array<{id:string;version:number}>>;
 const projection=base.projection as Record<string,unknown>,cards=projection['cards'] as Array<Record<string,unknown>>;
 const fixtures:Array<{id:string;value:number|null;date:string;version:string}>=[
  {id:randomUUID(),value:10,date:'2030-01-01',version:'ai-dashboard-v2'},
  {id:randomUUID(),value:12,date:'2030-02-01',version:'ai-dashboard-v2'},
  {id:randomUUID(),value:null,date:'2030-03-01',version:'ai-dashboard-v2'},
  {id:randomUUID(),value:14,date:'2030-04-01',version:'ai-dashboard-v3'},
  {id:'fffffff0-0000-4000-8000-000000000001',value:15,date:'2030-05-01',version:'ai-dashboard-v3'},
  {id:'fffffff1-0000-4000-8000-000000000001',value:16,date:'2030-05-01',version:'ai-dashboard-v3'}
 ];
 for(const [index,o] of fixtures.entries()){
  const sourceMembers=JSON.parse(JSON.stringify(sources)) as typeof sources;
  if(index===0){const kind=Object.keys(sourceMembers).find(k=>sourceMembers[k].length>0)!;sourceMembers[kind]=sourceMembers[kind].slice(1);}
  else if(index===2)for(const kind of Object.keys(sourceMembers))for(const member of sourceMembers[kind])member.version+=1;
  const saved={...projection,projectionVersion:o.version,cards:cards.map(k=>k['id']==='GEN-85'?{...k,value:o.value}:k['id']==='GEN-101'?{...k,value:index===0?20:35}:k)};
  await db.aiDashboardSnapshot.create({data:{id:o.id,organizationUnitId:unitId,frequency:'monthly',periodKey:index===5?'2030-06':o.date.slice(0,7),asOf:new Date(o.date+'T00:00:00Z'),createdBy:f.officerId,sourceMembers:sourceMembers as Prisma.InputJsonObject,projection:saved as Prisma.InputJsonObject,digest:governanceDigest({sourceMembers,projection:saved})}});
 }
 const all=await reports.trend(f.auditorId,unitId,'GEN-85','monthly',1,100),rows=all.rows.filter(r=>fixtures.some(o=>o.id===r.snapshotId));
 assert.equal(rows.length,6);assert.equal(rows[0].delta,null);assert.equal(rows[1].delta,1);assert.equal(rows[2].delta,null);assert.equal(rows[3].delta,null);assert.equal(rows[4].delta,2);assert.equal(rows[4].cohortChanged,true);assert.equal(rows[3].cohortChanged,false);
 const firstPage=await reports.trend(f.officerId,unitId,'GEN-85','monthly',1,5),nextPage=await reports.trend(f.officerId,unitId,'GEN-85','monthly',2,5);
 assert.equal(firstPage.rows[4].delta,2);assert.equal(firstPage.rows[4].snapshotId,rows[4].snapshotId);assert.equal(nextPage.rows[0].snapshotId,rows[5].snapshotId);
 const percent=await reports.trend(f.officerId,unitId,'GEN-101','monthly',1,100);assert.equal(percent.rows.find(r=>r.snapshotId===fixtures[1].id)!.delta,15);assert.equal(percent.rows[0].deltaUnit,'percentage_points');
 const executive=await reports.trend(execId,unitId);assert.equal(executive.aggregateOnly,true);assert.equal(executive.availableKpis.length,9);
 for(const secret of ['sourceMembers','createdBy','operatorUserId','referencePins'])assert.ok(!JSON.stringify(executive).includes(secret));
 await assert.rejects(reports.trend(execId,unitId,'GEN-81'),/outside your live/);await assert.rejects(reports.trend(f.riskOwnerId,unitId),/register visibility|authority/);
 await assert.rejects(reports.trend(f.officerId,unitId,'GEN-999'),/supported KPI/);await assert.rejects(reports.trend(f.officerId,unitId,'GEN-85','weekly'),/supported KPI/);
 const role=await db.role.findUniqueOrThrow({where:{code:'AI_GOVERNANCE_OFFICER'}}),scope=await db.roleDataScope.create({data:{roleId:role.id,scopeType:'data_domain',refId:randomUUID()}});
 try{await assert.rejects(reports.trend(f.officerId,unitId),/full domain|visibility/);}finally{await db.roleDataScope.delete({where:{id:scope.id}});}
 await db.dataAsset.update({where:{id:assetId},data:{isActive:false}});try{await assert.rejects(reports.trend(f.officerId,unitId),/outside current register/);}finally{await db.dataAsset.update({where:{id:assetId},data:{isActive:true}});}
 await db.user.update({where:{id:f.officerId},data:{isActive:false}});try{await assert.rejects(reports.trend(f.officerId,unitId),/inactive|not found|eligible|active/);}finally{await db.user.update({where:{id:f.officerId},data:{isActive:true}});}
 const url=(await app.getUrl())+'/api/ai/dashboard-reports/units/'+unitId+'/trend',jwt=app.get(JwtService),headers={authorization:'Bearer '+jwt.sign({sub:f.officerId,tokenVersion:0,roles:['system_admin']})};
 assert.equal((await fetch(url,{headers})).status,200);assert.equal((await fetch(url)).status,401);
 for(const query of ['?page=0','?page=x','?pageSize=x','?page=2147483648','?pageSize=101','?kpiId=GEN-999','?frequency=weekly'])assert.equal((await fetch(url+query,{headers})).status,400,query);
 const forbidden={authorization:'Bearer '+jwt.sign({sub:execId,tokenVersion:0,roles:['AI_GOVERNANCE_OFFICER']})};assert.equal((await fetch(url+'?kpiId=GEN-81',{headers:forbidden})).status,403);
 assert.equal((await reports.trend(f.officerId,unitId,'GEN-85','daily',999,20)).rows.length,0);
 console.log('Saved report trends passed: dated captures, stable page-boundary changes, null/tied/version comparisons, percentage points, population versus version changes, live scope/revocation, executive privacy, HTTP bounds and no reconstructed periods.');
}
