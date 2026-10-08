import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {demoConfig,readManifest,atomicJson} from './demo-profile.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const config=demoConfig(root),manifest=readManifest(config);
const credentials=JSON.parse(readFileSync(config.credentialsPath,'utf8'));
assert.equal(credentials.installationId,manifest.installationId);
assert.ok(credentials.accounts.length&&Object.keys(manifest.actors).length===credentials.accounts.length,'All installed personas must have preserved local credentials');
const reports=join(config.installationRoot,'browser-qa');mkdirSync(reports,{recursive:true});
const reportIndex=process.argv.indexOf('--report-name'),reportName=reportIndex<0?'report.json':process.argv[reportIndex+1];
assert.match(reportName,/^[a-zA-Z0-9-]{1,80}\.json$/,'Use a simple report name inside this installation');
const readRoutes=[['data_assets.view','/assets'],['assignments.view','/governance/ownership'],['workflow_tasks.view','/governance/workflow'],['ndi_specifications.view','/governance/ndi/specifications'],['ndi_scoring.view','/governance/ndi/readiness'],['data_quality_issues.view','/governance/data-quality'],['privacy_operations.view','/governance/privacy'],['access_grants.view','/governance/access']];
const aiRoutes=[['useCases','/governance/ai-use-cases'],['risks','/governance/ai-risks'],['review','/governance/ai-review'],['reviewOperations','/governance/ai-reviews'],['dashboard','/governance/ai-dashboard'],['migration','/governance/ai-migration']];
const outcomes=[];
const personaIndex=process.argv.indexOf('--personas'),selected=personaIndex<0?null:new Set((process.argv[personaIndex+1]??'').split(',').filter(Boolean));
if(selected)assert.ok(selected.size&&[...selected].every(purpose=>credentials.accounts.some(account=>account.purpose===purpose)),'Choose installed personas');
for(const account of credentials.accounts.filter(account=>!selected||selected.has(account.purpose))){
 const login=await fetch(config.base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:account.email,password:account.password}),signal:AbortSignal.timeout(15000)});
 assert.equal(login.status,201,`Persona ${account.purpose} must log in`);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie,'HTTP-only session cookie required');
 const api=async path=>{const response=await fetch(config.base+path,{headers:{cookie},signal:AbortSignal.timeout(10000)});assert.equal(response.status,200,`Persona ${account.purpose} cannot read ${path}`);return response.json();};
 const user=await api('/api/auth/me'),caps=await api('/api/ai/capabilities');assert.equal(user.email,account.email);
 const routes=['/dashboard',...readRoutes.filter(([permission])=>user.permissions.includes('*')||user.permissions.includes(permission)).map(([,route])=>route),...aiRoutes.filter(([screen])=>caps.screens[screen]).map(([,route])=>route)];
 const deniedRoutes=aiRoutes.filter(([screen])=>!caps.screens[screen]).map(([,route])=>route);
 const receiptPath=join(reports,account.purpose+'.'+randomUUID()+'.json');
 const childEnv={...config.env,DGOP_ENV_FILE:config.env.DGOP_ENV_FILE,DGOP_UI_BASE_URL:config.env.NODE_ENV==='test'?config.base:config.publicUrl,DGOP_SMOKE_EMAIL:account.email,DGOP_SMOKE_PASSWORD:account.password,DGOP_SMOKE_ROUTES:routes.join(','),DGOP_SMOKE_DENIED_ROUTES:deniedRoutes.join(','),DGOP_SMOKE_MATRIX:'1',DGOP_SMOKE_REPORT:receiptPath};
 delete childEnv.NODE_OPTIONS;delete childEnv.NODE_PATH;
 const result=spawnSync(process.execPath,[join(root,'scripts/ui-smoke.mjs')],{cwd:root,env:childEnv,encoding:'utf8',windowsHide:true,timeout:15*60*1000,maxBuffer:12*1024*1024});
 const log=String(result.stdout??'')+String(result.stderr??'');
 // Logs contain no passwords or session cookies; never serialize the child environment.
 writeFileSync(join(reports,account.purpose+'.log'),log,{mode:0o600});
 let details;try{details=JSON.parse(readFileSync(receiptPath,'utf8'));}catch{}
 outcomes.push({persona:account.purpose,routes,deniedRoutes,receipt:receiptPath,passed:result.status===0&&!result.error,navigationP95Ms:details?.navigationP95Ms??null,functionalPassed:details?.functionalPassed===true,licensedAcceptancePassed:details?.licensedAcceptancePassed===true,checks:details?.checks??0,browserVersion:details?.browserVersion??null});
 atomicJson(join(reports,reportName),{demoOnly:true,fixtureVersion:manifest.fixtureVersion,evaluatedAt:new Date().toISOString(),outcomes,passed:outcomes.length===credentials.accounts.length&&outcomes.every(row=>row.passed),coverage:'Authenticated role navigation, complete screen loads, EN/AR, RTL, light/dark, desktop/mobile. Native write journeys and cross-scope API checks are separate gates.'});
}
if(selected||outcomes.some(row=>!row.passed))throw Error('Full licensed browser acceptance is incomplete. Review the installation browser report before presentation.');
console.log('Every installed persona passed its allowed screens, both languages/themes and desktop/mobile layout checks.');
