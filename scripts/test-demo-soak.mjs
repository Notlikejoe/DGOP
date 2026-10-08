// Explicit engineering availability soak with normal local simulation workers enabled.
import assert from 'node:assert/strict';
import {readFileSync,openSync,closeSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {demoConfig,readManifest,atomicJson} from './demo-profile.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),config=demoConfig(root),manifest=readManifest(config);
assert.equal(config.env.NODE_ENV,'test');assert.equal(config.env.DGOP_DEMO_QA,'true');assert.equal(manifest.qaOnly,true);
const log=openSync(join(config.installationRoot,'logs/soak-runtime.log'),'a');
const env={...config.env,DGOP_DEMO_ADAPTER_SCHEDULER:'true'};
const child=spawn(process.execPath,[join(root,'apps/api/dist/main.js')],{cwd:root,env,stdio:['ignore',log,log],windowsHide:true});closeSync(log);
let runner=null;
async function stop(process){if(!process||process.exitCode!==null||process.signalCode!==null)return;const ended=new Promise(done=>process.once('exit',done));process.kill();await Promise.race([ended,delay(5000)]);if(process.exitCode===null&&process.signalCode===null){process.kill('SIGKILL');await Promise.race([ended,delay(5000)]);}}
try{
 let healthy=false;for(let n=0;n<60;n++){assert.equal(child.exitCode,null,'Soak API stopped early');try{const response=await fetch(config.base+'/api/health',{signal:AbortSignal.timeout(1000)});healthy=response.ok&&(await response.json()).database?.status==='up';if(healthy)break;}catch{}await delay(500);}assert.ok(healthy);
 runner=spawn(process.execPath,[join(root,'scripts/demo.mjs'),'soak','--profile',config.env.DGOP_ENV_FILE],{cwd:root,env,stdio:'inherit',windowsHide:true});
 const result=await new Promise(done=>{runner.once('error',()=>done(-1));runner.once('exit',code=>done(code));});assert.equal(result,0,'Engineering soak failed; preserve progress and logs');
 const report=JSON.parse(readFileSync(join(config.installationRoot,'soak.json'),'utf8'));
 assert.equal(report.availabilitySoakPassed,true);assert.equal(report.releaseSoakPassed,false);
 atomicJson(join(config.installationRoot,'engineering-soak-verification.json'),{qaOnly:true,demoOnly:true,isLicensedDemoAcceptance:false,availabilitySoakPassed:true,completedAt:new Date().toISOString(),normalLocalSimulationWorkersEnabled:true});
 console.log('60-minute engineering availability soak passed. Licensed demo acceptance remains separate.');
}finally{await stop(runner);await stop(child);}
