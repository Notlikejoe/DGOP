const fs=require('node:fs'),assert=require('node:assert/strict'),net=require('node:net'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process');
const {binding}=require('./verification-binding.cjs'),{acquireVerificationLease}=require('./verification-lease.cjs');
const state='C:/Users/Youss/Documents/Codex/work/dgop-access-sync',file=state+'/checkpoint.json',cp=JSON.parse(fs.readFileSync(file));
const lease=acquireVerificationLease({purpose:'Access sync Batch 2 prerequisite check'});
(async()=>{let db;try{
 assert.equal(process.versions.node,'24.19.0');assert.equal(cp.status,'batch-1-complete');const current=binding(cp.root);assert.equal(current.apiLockSha256,cp.candidateIdentity.apiLockSha256);assert.equal(current.webLockSha256,cp.candidateIdentity.webLockSha256);assert.deepEqual(binding(cp.original),cp.baseline);
 const branch=spawnSync('git',['-c','safe.directory='+cp.original,'-C',cp.original,'branch','--show-current'],{encoding:'utf8',windowsHide:true});assert.equal(branch.stdout.trim(),'main');
 const blockers=[];let originalHealth=null;try{const health=await fetch('http://127.0.0.1:4206/api/health',{signal:AbortSignal.timeout(5000)});assert.equal(health.status,200);originalHealth=await health.json();assert.equal(originalHealth.database.name,'dgop_dev');}catch{blockers.push('Original app not answering on 4206 at Batch 2 preflight. Its files and configuration remain unchanged.');}
 await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(4208,'127.0.0.1',()=>server.close(resolve));});
 const config=JSON.parse(fs.readFileSync(state+'/private/database.json'));const url=new URL(config.url);assert.equal(url.pathname,'/dgop_access_sync_qa_20261007');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55436');assert.equal(config.profile,'access-sync-test');
 url.searchParams.set('connect_timeout','2');const req=createRequire(cp.root+'/apps/api/package.json'),{PrismaClient}=req('@prisma/client');db=new PrismaClient({datasources:{db:{url:url.href}}});
 const accounts=JSON.parse(fs.readFileSync(cp.credentialRef)).accounts;assert.equal(accounts.length,8);
 let users=[];try{users=await db.user.findMany({where:{email:{in:accounts.map(a=>a.email)}},include:{userRoles:{include:{role:true}}}});assert.equal(users.length,8);}catch{blockers.push('Separate database on 55436 unavailable; database-backed acceptance must wait for local service recovery.');}
 for(const user of users){assert(user.isActive);assert.equal(user.userRoles.some(r=>r.role.code==='system_admin'),user.email==='qa.admin@dgop.local');}
 fs.copyFileSync(file,state+'/checkpoint-batch-1.json');fs.copyFileSync(state+'/evidence-ledger.json',state+'/evidence-ledger-batch-1.json');
 const receipt={batch:2,at:new Date().toISOString(),status:blockers.length?'functional-work-can-proceed-runtime-blocked':'passed',blockers,binding:cp.candidateIdentity,database:cp.database,profile:cp.profile,accounts:users.map(u=>u.email),originalHealth,previewPortAvailable:true,licenseConfigured:false};
 fs.writeFileSync(state+'/batch-2-preflight.json',JSON.stringify(receipt,null,2));cp.batch=2;cp.status='batch-2-in-progress';cp.startedBatch2At=receipt.at;cp.runtimeBlockers=blockers;fs.writeFileSync(file,JSON.stringify(cp,null,2));console.log(JSON.stringify({status:receipt.status,blockers,sourceAndBuildsPreserved:true,previewPortAvailable:true,licenseConfigured:false}));
}finally{await db?.$disconnect();lease.release();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
