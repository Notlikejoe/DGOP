import 'reflect-metadata';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { aiReviewParams, AiReviewQueryDto } from '../src/ai-governance/ai-review-query.dto';
import { readAiReviewQueue } from '../src/ai-governance/ai-review-queue';

async function main() {
  let checks=0;
  for(const invalid of [{page:0},{page:1.1},{page:1000001},{pageSize:201},{pageSize:0},{search:'x'.repeat(201)}]) {
    assert.throws(()=>aiReviewParams(Object.assign(new AiReviewQueryDto(),invalid)),BadRequestException); checks++;
  }
  assert.deepEqual(aiReviewParams(new AiReviewQueryDto()),{page:1,pageSize:25,skip:0,take:25}); checks++;
  const rows=Array.from({length:301},(_,i)=>({id:String(i).padStart(4,'0'),updatedAt:new Date(0),
    workflowCase:{tasks:[{status:i%2?'in_progress':'pending',dueDate:i%3?null:new Date(0)}]}}));
  let payloadReads=0,probes=0;
  const tx={aiUseCase:{findMany:async(args:any)=>{
    if(args.where.id){payloadReads++; return rows.filter(row=>args.where.id.in.includes(row.id)).reverse();}
    probes++; assert.equal(args.take,200); assert.deepEqual(args.orderBy,[{updatedAt:'asc'},{id:'asc'}]);
    assert.ok(args.where.AND.some((part:any)=>part.organizationUnitId?.in.includes('allowed')));
    assert.equal(args.where.AND.at(-1).OR[0].name.contains,'عربي');
    return rows.slice(args.cursor?Number(args.cursor.id)+1:0,(args.cursor?Number(args.cursor.id)+1:0)+args.take);
  }}};
  const prisma={$transaction:async(work:any,options:any)=>{assert.equal(options.isolationLevel,'RepeatableRead');return work(tx);}};
  const authorization={queueReadScope:async()=>({where:{organizationUnitId:{in:['allowed']}},filter:async(rows:any[])=>rows.filter(row=>Number(row.id)>=200)})};
  const query=Object.assign(new AiReviewQueryDto(),{page:2,search:'  عربي  '});
  const result=await readAiReviewQueue(prisma as any,authorization as any,{id:'actor',roles:[],administratorOversight:false},query,{}, {},{id:true},async rows=>rows.filter(row=>row.id!=='0250'));
  assert.equal(result.total,100); assert.equal(result.totalPages,4); assert.equal(result.data.length,25);
  assert.deepEqual(result.data.map((row:any)=>row.id),rows.slice(225,250).map(row=>row.id)); checks++;
  assert.equal(result.summary.pending+result.summary.inProgress,100); assert.equal(result.summary.overdue,34); checks++;
  assert.equal(probes,2); assert.equal(payloadReads,1); checks++;
  query.page=5; const empty=await readAiReviewQueue(prisma as any,authorization as any,{id:'actor',roles:[],administratorOversight:false},query,{}, {},{id:true});
  assert.equal(empty.total,101); assert.equal(empty.data.length,1); checks++;
  query.page=6; const beyond=await readAiReviewQueue(prisma as any,authorization as any,{id:'actor',roles:[],administratorOversight:false},query,{}, {},{id:true});
  assert.equal(beyond.data.length,0); assert.equal(beyond.total,101); checks++;
  const failure=new Error('scope repository unavailable');
  await assert.rejects(readAiReviewQueue(prisma as any,{queueReadScope:async()=>{throw failure;}} as any,{id:'actor',roles:[],administratorOversight:false},query,{}, {},{id:true}),error=>error===failure); checks++;
  console.log(JSON.stringify({passed:true,checks,scenarios:'bounded probes, scope and duty before paging/counts, stable order, exact summaries, Arabic search, defaults/bounds, beyond page, errors propagate'}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
