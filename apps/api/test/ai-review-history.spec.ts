import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { scopedHistoryPage, snapshotMemberIds, visibleSnapshots } from '../src/ai-governance/ai-review-history';
import { AiReviewQueryDto } from '../src/ai-governance/ai-review-query.dto';
import { AiMonthlyReviewService } from '../src/ai-governance/ai-monthly-review.service';
import { AiAnnualReviewService } from '../src/ai-governance/ai-annual-review.service';

async function main(){
  let checks=0;
  assert.deepEqual(snapshotMemberIds([{id:'one',version:1}]),['one']);assert.deepEqual(snapshotMemberIds([]),[]);checks++;
  for(const value of [null,{},[{id:''}],[{id:1}],[{id:'one'},{id:'one'}]])assert.equal(snapshotMemberIds(value as Prisma.JsonValue),null);checks++;
  const rows=Array.from({length:402},(_,i)=>({id:String(i),members:[{id:i<301?'foreign':'owned'}]}));
  const tx:any={aiRisk:{findMany:async()=>[{id:'owned'}]}};
  const page=await scopedHistoryPage({page:5,pageSize:25,search:''},async cursor=>rows.slice(cursor===undefined?0:Number(cursor)+1,cursor===undefined?200:Number(cursor)+201),part=>visibleSnapshots(tx,{},part,r=>r.members));
  assert.equal(page.envelope.total,101);assert.equal(page.envelope.totalPages,5);assert.deepEqual(page.ids,['401']);checks++;
  const empty=await scopedHistoryPage(new AiReviewQueryDto(),async()=>[],async part=>part);assert.equal(empty.envelope.total,0);assert.equal(empty.envelope.totalPages,1);checks++;
  for(const query of [{page:0},{pageSize:201},{search:'x'.repeat(201)}])await assert.rejects(scopedHistoryPage({...new AiReviewQueryDto(),...query},async()=>[],async part=>part));checks++;
  const bounded:any[]=[];await visibleSnapshots({aiRisk:{findMany:async(arg:any)=>{bounded.push(arg.where.AND[1].id.in.length);return [];}}} as any,{},[{members:Array.from({length:401},(_,i)=>({id:String(i)}))}],r=>r.members);
  assert.deepEqual(bounded,[200,200,1]);checks++;
  const annual:any={historyScope:async()=>({where:{}})};
  const reports=Array.from({length:26},(_,i)=>({id:String(i),periodMonth:'2024-'+i,capturedAt:new Date(),members:[{id:'owned'}]}));
  const db:any={$transaction:async(work:any)=>work({aiRisk:tx.aiRisk,aiMonthlyReviewReport:{findMany:async(arg:any)=>arg.where.id?reports.filter(r=>arg.where.id.in.includes(r.id)):reports}})};
  const monthly=new AiMonthlyReviewService(db,annual,null!);
  assert.equal((await monthly.list('reader','unit')).total,26);assert.equal((await monthly.list('reader','unit',{page:2,pageSize:25,search:''})).data[0].id,'25');checks++;
  const failing=new AiMonthlyReviewService({$transaction:async()=>{throw Error('database unavailable');}} as any,annual,null!);
  await assert.rejects(failing.list('reader','unit'),/database unavailable/);checks++;
  // Import the actual annual service to type-check its changed orchestration alongside the helper tests.
  assert.equal(typeof AiAnnualReviewService.prototype.nomineeList,'function');checks++;
  console.log(JSON.stringify({passed:true,checks}));
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
