import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

async function main(){
  const startedAt=new Date().toISOString(),database=new URL(process.env.DATABASE_URL??'').pathname.slice(1);
  assert.match(database,/^dgop_ai_test_repair_batch1_\d+$/u);assert.equal(process.env.NODE_ENV,'test');
  const accounts=JSON.parse(readFileSync(process.env.DGOP_DEMO_CREDENTIALS!,'utf8')).accounts;
  const manifest=JSON.parse(readFileSync(process.env.DGOP_DEMO_MANIFEST!,'utf8'));
  const app=await NestFactory.create(AppModule,{logger:false}),checks:string[]=[];
  let passed=false,error:string|null=null;
  try{
    app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    async function login(purpose:string){const account=accounts.find((row:any)=>row.purpose===purpose);assert.ok(account);const result=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:account.email,password:account.password})});assert.equal(result.status,201);const cookie=result.headers.getSetCookie().map(row=>row.split(';')[0]).join('; ');const me=await fetch(base+'/api/auth/me',{headers:{Cookie:cookie}});assert.equal((await me.json() as any).id,manifest.actors[purpose]);return cookie;}
    const cookie=await login('administrator');
    const paths=['triage','classification/queue','classification/verification/queue','classification/reviews/queue','decisions/queue','registration/queue'];
    async function get(path:string){return fetch(base+'/api/ai/use-cases/'+path,{headers:{Cookie:cookie},signal:AbortSignal.timeout(5000)});}
    for(const path of paths){
      const response=await get(path);assert.equal(response.status,200,path);const body=await response.json() as any;
      assert.equal(body.page,1);assert.equal(body.pageSize,25);assert.equal(body.totalPages,Math.max(1,Math.ceil(body.total/25)));assert.equal(body.summary.total,body.total);assert.equal(body.summary.pending+body.summary.inProgress,body.total);assert.ok(body.data.length<=25);assert.ok(Number.isFinite(Date.parse(body.evaluatedAt)));
      const all=await get(path+'?pageSize=200');assert.equal(all.status,200);assert.equal((await all.json() as any).total,body.total);
      if(body.data.length){const result=await get(path+'?search='+encodeURIComponent(body.data[0].useCaseRef??body.data[0].name));assert.equal(result.status,200);assert.ok((await result.json() as any).data.some((row:any)=>row.id===body.data[0].id));}
      checks.push(path+': authenticated oversight, default envelope, complete summaries and server search');
      for(const query of ['page=0','pageSize=201','pageSize=0','page=1.5','search='+encodeURIComponent('x'.repeat(201))])assert.equal((await get(path+'?'+query)).status,400,path+' '+query);
      assert.equal((await get(path+'?search='+encodeURIComponent('x'.repeat(200)))).status,200);checks.push(path+': HTTP pagination/search bounds are enforced');
    }
    const requester=await login('owner');for(const path of paths)assert.equal((await fetch(base+'/api/ai/use-cases/'+path,{headers:{Cookie:requester}})).status,403,path);checks.push('own-only case owner read denials remain explicit across all six queues');
    passed=true;console.log(JSON.stringify({passed,checks:checks.length,scenarios:checks}));
  }catch(cause){error=cause instanceof Error?cause.message:String(cause);throw cause;}
  finally{await app.close();if(process.env.DGOP_QUEUE_RECEIPT)writeFileSync(process.env.DGOP_QUEUE_RECEIPT,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),database,passed,checks:checks.length,scenarios:checks,error},null,2)+'\n');}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
