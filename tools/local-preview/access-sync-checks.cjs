const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {acquireVerificationLease}=require('./verification-lease.cjs'),{binding}=require('./verification-binding.cjs');
const state='C:/Users/Youss/Documents/Codex/work/dgop-access-sync',root=state+'/source',node=process.execPath;
const group=process.argv[2],groups={
 sessionBoundary:[{name:'session-and-boundary',args:['scripts/web.mjs','test','--watch=false','--include=src/app/core/auth.service.spec.ts','--include=src/app/layout/shell.spec.ts'],cwd:root}],
 boundary:[{name:'protected-page-boundary',args:['scripts/web.mjs','test','--watch=false','--include=src/app/layout/shell.spec.ts'],cwd:root}],
 ui:[{name:'live-access-ui',args:['scripts/web.mjs','test','--watch=false','--include=src/app/core/auth.service.spec.ts','--include=src/app/core/auth.interceptor.spec.ts','--include=src/app/core/page-access.spec.ts','--include=src/app/layout/shell.spec.ts','--include=src/app/pages/governance/ownership/ownership.spec.ts','--include=src/app/pages/governance/ai-review/ai-review.spec.ts'],cwd:root}],
 webBuild:[{name:'web-build',args:['scripts/web.mjs','build'],cwd:root}],
 ownership:[{name:'ownership-optional-references',args:['scripts/web.mjs','test','--watch=false','--include=src/app/pages/governance/ownership/ownership.spec.ts'],cwd:root}],
 webTypes:[{name:'web-typecheck',args:['node_modules/typescript/bin/tsc','-p','tsconfig.app.json','--noEmit'],cwd:root+'/apps/web'}],
 auth:['auth.service','access-snapshot'].map(name=>({name,args:['node_modules/ts-node/dist/bin.js','test/'+name+'.spec.ts'],cwd:root+'/apps/api'})),
 snapshot:[{name:'access-snapshot',args:['node_modules/ts-node/dist/bin.js','test/access-snapshot.spec.ts'],cwd:root+'/apps/api'}],
 api:['auth.service','access.service','scope.service','access-snapshot'].map(name=>({name,args:['node_modules/ts-node/dist/bin.js','test/'+name+'.spec.ts'],cwd:root+'/apps/api'})),
 web:[{name:'auth-refresh',args:['scripts/web.mjs','test','--watch=false','--include=src/app/core/auth.service.spec.ts','--include=src/app/core/auth.interceptor.spec.ts'],cwd:root}],
 apiBuild:[{name:'api-build',args:['node_modules/@nestjs/cli/bin/nest.js','build'],cwd:root+'/apps/api'}],
};
if(!groups[group])throw Error('Unknown focused check group');
const batch=Number(process.env.DGOP_ACCESS_BATCH??2);
const lease=acquireVerificationLease({purpose:'Access sync Batch '+batch+' '+group});
const dir=state+'/evidence/'+new Date().toISOString().replaceAll(':','-')+'-'+group;fs.mkdirSync(dir,{recursive:true});
const receipt={batch,group,startedAt:new Date().toISOString(),binding:binding(root),node,checks:[],status:'running'};
try{for(const check of groups[group]){
 const start=new Date().toISOString(),r=spawnSync(node,check.args,{cwd:check.cwd,encoding:'utf8',windowsHide:true,env:{...process.env,DGOP_NODE_EXE:node},maxBuffer:15*1024*1024});
 const output=(r.stdout??'')+(r.stderr??'');fs.writeFileSync(dir+'/'+check.name+'.log',output);
 receipt.checks.push({name:check.name,args:check.args,cwd:check.cwd,startedAt:start,finishedAt:new Date().toISOString(),exitCode:r.status,error:r.error?.message});
 console.log(check.name+': '+(r.status===0?'PASS':'FAIL'));
 if(r.status!==0){console.log(output.split('\n').slice(-65).join('\n'));receipt.status='failed';process.exitCode=1;break;}
}if(receipt.status==='running')receipt.status='passed';}finally{receipt.finishedAt=new Date().toISOString();fs.writeFileSync(dir+'/receipt.json',JSON.stringify(receipt,null,2));lease.release();console.log('Receipt: '+dir+'/receipt.json');}
