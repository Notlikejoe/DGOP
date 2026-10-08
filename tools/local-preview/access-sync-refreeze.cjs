const fs=require('node:fs'),assert=require('node:assert/strict');
const {binding}=require('./verification-binding.cjs'),{acquireVerificationLease}=require('./verification-lease.cjs');
const state='C:/Users/Youss/Documents/Codex/work/dgop-access-sync',file=state+'/checkpoint.json',cp=JSON.parse(fs.readFileSync(file));
const lease=acquireVerificationLease({purpose:'Access sync Batch 3 freeze after focused search repair'});
try{
 const current=binding(cp.root);assert.deepEqual(binding(cp.original),cp.baseline);assert.deepEqual(current.apiBuild,cp.candidateIdentity.apiBuild);assert.equal(current.apiLockSha256,cp.candidateIdentity.apiLockSha256);assert.equal(current.webLockSha256,cp.candidateIdentity.webLockSha256);
 const receipts=fs.readdirSync(state+'/evidence').map(f=>state+'/evidence/'+f+'/receipt.json').filter(f=>fs.existsSync(f)).map(file=>({file,...JSON.parse(fs.readFileSync(file))}));
 const fresh=group=>{const r=receipts.filter(r=>r.batch===3&&r.group===group).sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];assert(r&&r.status==='passed');assert.deepEqual(r.binding.source,current.source);return r;};
 const regression=fresh('boundary'),build=fresh('webBuild');assert(fs.statSync(cp.root+'/apps/web/dist/web/browser/index.html').mtimeMs>=Date.parse(build.startedAt));
 for(const name of ['checkpoint','evidence-ledger']){const target=state+'/'+name+'-batch-2.json';if(!fs.existsSync(target))fs.copyFileSync(state+'/'+name+'.json',target);}
 cp.batch=3;cp.status='batch-3-in-progress';cp.previousIdentity=cp.candidateIdentity;cp.candidateIdentity=current;cp.sourceFrozenAt=new Date().toISOString();cp.batch3Repair={reason:'Typing into a global-search input that retained focus after access reset did not reopen results.',files:['apps/web/src/app/layout/shell.ts','apps/web/src/app/layout/shell.spec.ts'],regression:regression.file,webBuild:build.file,apiReuseReason:'No backend source, API lock or API build changed.'};
 fs.writeFileSync(file,JSON.stringify(cp,null,2)+'\n');console.log(JSON.stringify({source:current.source.sha256,webBuild:current.webBuild.sha256,apiBuildReused:true,status:cp.status}));
}finally{lease.release();}
