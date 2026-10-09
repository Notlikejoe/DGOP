'use strict';
const c=require('./populate-dgop-common.cjs'), {spawn,spawnSync}=require('node:child_process');
const {binding}=require('./verification-binding.cjs'), {acquireVerificationLease}=require('./verification-lease.cjs');
const {fs,path,assert,state,root,folder,atomic}=c;
const config=c.loadConfig(), lease=acquireVerificationLease({purpose:'Population preview '+process.argv[2]});
const manifest=JSON.parse(fs.readFileSync(folder+'/manifest.json'));
const command=process.argv[2];
const health=async()=>{const r=await fetch('http://127.0.0.1:4208/api/health',{signal:AbortSignal.timeout(3000)});assert(r.ok);const body=await r.json();assert.equal(body.database.name,manifest.database);return body;};
(async()=>{try{
 assert.deepEqual(binding(config.checkpoint.original),config.checkpoint.baseline);
 if(command==='stop'){
  const saved=JSON.parse(fs.readFileSync(state+'/preview.runtime.json'));
  assert.equal(saved.root.replaceAll('\\','/'),root);assert.equal(saved.port,4208);assert.equal(saved.database,manifest.database);
  const p=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(saved.pid)}' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true});
  assert.equal(p.status,0);const actual=JSON.parse(p.stdout),norm=x=>x.replaceAll('\\','/').toLowerCase();
  assert.equal(norm(actual.ExecutablePath),norm(process.execPath));assert(norm(actual.CommandLine).includes(norm(root+'/apps/api/dist/main.js')));
  await health();process.kill(saved.pid);for(let i=0;i<40;i++){try{process.kill(saved.pid,0);}catch(e){if(e.code==='ESRCH')break;throw e;}assert(i<39);await new Promise(r=>setTimeout(r,100));}
  console.log('Owned preview stopped; original preserved.');
 } else if(command==='start'){
  const env=c.runtimeEnvironment(config.env,config.url,process.env);
  env.DGOP_SYNTHETIC_POPULATION_MANIFEST=folder+'/manifest.json';
  env.AI_MIGRATION_SOURCE_DIR=folder+'/sources';env.AI_MIGRATION_SOURCE_MANIFEST=folder+'/sources/manifest.json';
  env.PATH=path.dirname(process.execPath)+path.delimiter+process.env.PATH;
  const fd=fs.openSync(state+'/preview.runtime.log','a');
  const child=spawn(process.execPath,[root+'/apps/api/dist/main.js'],{cwd:root,env,stdio:['ignore',fd,fd],detached:true,windowsHide:true});child.unref();fs.closeSync(fd);
  fs.writeFileSync(state+'/preview.runtime.json',JSON.stringify({pid:child.pid,node:process.execPath,root,port:4208,database:manifest.database,startedAt:new Date().toISOString(),externalDelivery:false}));
  for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,250));try{await health();console.log('Preview healthy: http://localhost:4208');return;}catch(e){if(i===59)throw e;}}
 } else if(command==='bind'){
  const current=binding(root);assert.equal(current.apiLockSha256,manifest.sourceIdentity.apiLockSha256);assert.equal(current.webLockSha256,manifest.sourceIdentity.webLockSha256);
  assert.deepEqual(current.webBuild,manifest.sourceIdentity.webBuild);
  manifest.populationIdentity=current;atomic(folder+'/manifest.json',manifest);console.log('Population source/build identity saved; prior acceptance retained separately.');
 } else throw Error('Use stop, start or bind');
}catch(e){console.error(e.message);process.exitCode=1;}finally{lease.release();}})();
