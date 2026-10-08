const c=require('./populate-dgop-common.cjs'),{spawnSync}=require('node:child_process');
const {acquireVerificationLease}=require('./verification-lease.cjs');
const lease=acquireVerificationLease({purpose:'Focused synthetic compatibility tests and API build'});
const dir=c.folder+'/runs/'+new Date().toISOString().replace(/[:.]/g,'-')+'-compatibility';c.fs.mkdirSync(dir,{recursive:true});
const receipt={startedAt:new Date().toISOString(),status:'running',checks:[]};
try{c.loadConfig();const api=c.root+'/apps/api';
 for(const file of (process.argv.includes('--exports')?['open-data.service.spec.ts','audit-packs.service.spec.ts']:['synthetic-population-profile.spec.ts','evidence.service.spec.ts'])){
  const p=spawnSync(process.execPath,[api+'/node_modules/ts-node/dist/bin.js',api+'/test/'+file],{cwd:api,encoding:'utf8',windowsHide:true,timeout:90000});
  c.fs.writeFileSync(dir+'/'+file+'.log',(p.stdout??'')+(p.stderr??''));c.assert.equal(p.status,0,file+' failed; inspect log');receipt.checks.push({name:file,passed:true,at:new Date().toISOString()});console.log('PASS '+file);
 }
 const b=spawnSync(process.execPath,[api+'/node_modules/@nestjs/cli/bin/nest.js','build'],{cwd:api,env:{...process.env,PATH:c.path.dirname(process.execPath)+c.path.delimiter+process.env.PATH},encoding:'utf8',windowsHide:true,timeout:120000});
 c.fs.writeFileSync(dir+'/build.log',(b.stdout??'')+(b.stderr??''));c.assert.equal(b.status,0,'API build failed; inspect log');receipt.checks.push({name:'API build',passed:true,at:new Date().toISOString()});receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=e.message;process.exitCode=1;console.error(e.message);}finally{receipt.finishedAt=new Date().toISOString();c.atomic(dir+'/receipt.json',receipt);lease.release();console.log(dir+'/receipt.json');}
