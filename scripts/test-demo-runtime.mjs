// Runs only an explicitly managed engineering database. Licensed demo acceptance is separate.
import assert from 'node:assert/strict';
import {readFileSync,openSync,closeSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {demoConfig,readManifest,atomicJson} from './demo-profile.mjs';
import {runDemoProcess} from './demo-process.mjs';
import {demoFetch as fetch} from './demo-http.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),config=demoConfig(root),manifest=readManifest(config);
assert.equal(config.env.NODE_ENV,'test');assert.equal(config.env.DGOP_DEMO_QA,'true');assert.equal(manifest.qaOnly,true);
const credentials=JSON.parse(readFileSync(config.credentialsPath,'utf8'));
const env={...config.env,DGOP_DEMO_ADAPTER_SCHEDULER:'false'};
const cycles=[];let browserStatus=null;
const countIndex=process.argv.indexOf('--cycles'),cycleCount=countIndex<0?3:Number(process.argv[countIndex+1]);assert.ok(Number.isInteger(cycleCount)&&cycleCount>=1&&cycleCount<=3);
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const ended=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([ended,delay(5000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await Promise.race([ended,delay(5000)]);}assert.ok(child.exitCode!==null||child.signalCode!==null,'Owned test API must stop');}
try{
for(let cycle=1;cycle<=cycleCount;cycle++){
 const log=openSync(join(config.installationRoot,'logs/runtime-cycle-'+cycle+'.log'),'a');
 const child=spawn(process.execPath,[join(root,'apps/api/dist/main.js')],{cwd:root,env,stdio:['ignore',log,log],windowsHide:true});closeSync(log);
 try{
 let healthy=false;for(let n=0;n<60;n++){assert.equal(child.exitCode,null,'Test API stopped during startup');try{const response=await fetch(config.base+'/api/health',{signal:AbortSignal.timeout(1000)});healthy=response.ok&&(await response.json()).database?.status==='up';if(healthy)break;}catch{}await delay(500);}assert.ok(healthy,'Test API must become healthy');
 for(const account of credentials.accounts){const response=await fetch(config.base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-dgop-csrf':'same-origin'},body:JSON.stringify({email:account.email,password:account.password})});assert.equal(response.status,201,'Installed persona '+account.purpose+' must log in');const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');for(const path of ['/api/auth/me','/api/ai/capabilities','/api/ndi/scoring/context']){const read=await fetch(config.base+path,{headers:{cookie}});assert.equal(read.status,200,account.purpose+' '+path);}}
 await runDemoProcess([join(root,'scripts/demo.mjs'),'check','--profile',config.env.DGOP_ENV_FILE],{cwd:root,env,stdio:'inherit'});
 cycles.push({cycle,healthy:true,personas:credentials.accounts.length,verifiedNativeHttp:true});
 if(cycle===cycleCount&&process.argv.includes('--browser')){const extra=process.argv.includes('--all-browser-personas')?[]:['--personas','administrator'];const browser=spawnSync(process.execPath,[join(root,'scripts/demo-browser-qa.mjs'),...extra],{cwd:root,env,stdio:'inherit',windowsHide:true});browserStatus=browser.status;}
 }finally{await stop(child);}
}
atomicJson(join(config.installationRoot,'runtime-verification.json'),{qaOnly:true,demoOnly:true,isLicensedDemoAcceptance:false,completedAt:new Date().toISOString(),cycles,allPersonasPassed:true,browserExitStatus:browserStatus});
console.log(cycles.length+' engineering start/check/stop cycles and all preserved persona logins passed. Licensed presentation acceptance remains separate.');
}catch(error){atomicJson(join(config.installationRoot,'runtime-verification.json'),{qaOnly:true,demoOnly:true,isLicensedDemoAcceptance:false,cycles,passed:false,message:error.message});throw error;}
