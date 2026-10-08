// Large-register checks use native draft creation in a dedicated engineering restore.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,openSync,closeSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {demoConfig,applyDemoEnvironment,readManifest,atomicJson,assertDemoFixtureWrite} from './demo-profile.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),config=demoConfig(root);
assertDemoFixtureWrite(config,'--qa-fixture');
assert.match(config.database,/^dgop_ai_test_restore_\d+$/,'Use a separately restored engineering database, preserving the main journey and soak fixtures');
assert.equal(JSON.parse(readFileSync(join(config.installationRoot,'restored-runtime-verification.json'),'utf8')).backendAndAllPersonaSmokePassed,true);
const manifest=readManifest(config);applyDemoEnvironment(config);process.env.DGOP_DEMO_ADAPTER_SCHEDULER='false';
const require=createRequire(join(root,'apps/api/package.json')),load=(file,name)=>require(join(root,'apps/api/dist',file+'.js'))[name];
const app=await require('@nestjs/core').NestFactory.createApplicationContext(load('app.module','AppModule'),{logger:false});
const prefix='SYNTHETIC QA REGISTER '+config.env.DGOP_DEMO_INSTALLATION_ID.slice(0,8),userId=manifest.actors.showcase;
try{
 const db=app.get(load('prisma/prisma.service','PrismaService')),intake=app.get(load('ai-governance/ai-intake.service','AiIntakeService')),initiation=app.get(load('ai-governance/ai-risk-initiation.service','AiRiskInitiationService')),risks=app.get(load('ai-governance/ai-risk-intake.service','AiRiskIntakeService'));
 manifest.largeRegister??={qaOnly:true,prefix,useCases:[],risks:[]};assert.equal(manifest.largeRegister.prefix,prefix);assert.equal(manifest.largeRegister.qaOnly,true);
 const saved=()=>atomicJson(config.manifestPath,manifest);
 for(let index=0;index<105;index++){
  const suffix=String(index+1).padStart(3,'0');
  const existing=manifest.largeRegister.useCases[index];
  if(existing){const row=await db.aiUseCase.findUniqueOrThrow({where:{id:existing}});assert.equal(row.requesterUserId,userId);assert.equal(row.name,prefix+' AIUC '+suffix);}else{const row=await intake.createDraft(userId,{usecase_name:prefix+' AIUC '+suffix,proposed_owner:manifest.actors.owner});manifest.largeRegister.useCases[index]=row.id;saved();}
  let risk=manifest.largeRegister.risks[index];
  if(!risk){risk={id:(await initiation.create(userId,{useCaseId:manifest.cases[0].useCaseId,initiationKey:randomUUID(),justification:'Synthetic engineering register pagination fixture; no compliance decision or external action'})).id,complete:false};manifest.largeRegister.risks[index]=risk;saved();}
  let row=await db.aiRisk.findUniqueOrThrow({where:{id:risk.id}});assert.equal(row.createdBy,userId);assert.equal(row.useCaseId,manifest.cases[0].useCaseId);
  if(!risk.complete){
   if(!row.ownerPersonId){await risks.assign(manifest.actors.working,row.id,{expectedVersion:row.version,ownerUserId:manifest.actors.riskOwner,justification:'Independent owner assignment for synthetic register browser testing'});row=await db.aiRisk.findUniqueOrThrow({where:{id:row.id}});}
   assert.equal((await db.person.findUniqueOrThrow({where:{id:row.ownerPersonId}})).userId,manifest.actors.riskOwner);
   await risks.save(manifest.actors.riskOwner,row.id,row.version,{title:prefix+' AIRS '+suffix});risk.complete=true;saved();
  }else assert.equal(row.title,prefix+' AIRS '+suffix);
 }
 const chain=await app.get(load('audit/audit.service','AuditService')).verifyChain();assert.equal(chain.valid,true);assert.equal(chain.legacyRows,0);assert.equal(chain.truncated,false);
}finally{await app.close();}
function playwright(){for(const location of [join(root,'apps/web/package.json'),join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/node_modules/dgop-playwright.js'),join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/dgop-playwright.js')])for(const name of ['playwright','playwright-core'])try{return createRequire(location)(name);}catch{}throw Error('Install the documented Playwright runtime');}
const log=openSync(join(config.installationRoot,'logs/large-register-api.log'),'a'),child=spawn(process.execPath,[join(root,'apps/api/dist/main.js')],{cwd:root,env:{...config.env,DGOP_DEMO_ADAPTER_SCHEDULER:'false'},stdio:['ignore',log,log],windowsHide:true});closeSync(log);
let browser;
try{
 let healthy=false;for(let n=0;n<60;n++){assert.equal(child.exitCode,null);try{const response=await fetch(config.base+'/api/health',{signal:AbortSignal.timeout(1000)});healthy=response.ok&&(await response.json()).database?.status==='up';if(healthy)break;}catch{}await delay(500);}assert.ok(healthy);
 browser=await playwright().chromium.launch({headless:true,...(config.env.DGOP_BROWSER_EXE?{executablePath:config.env.DGOP_BROWSER_EXE}:{})});
 const page=await browser.newPage(),errors=[],failed=[],license=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning'&&message.text().startsWith('[PrimeUI]'))license.push(message.text());});page.on('response',response=>{if(response.status()>=400)failed.push({status:response.status(),url:response.url()});});
 const credentials=JSON.parse(readFileSync(config.credentialsPath,'utf8')).accounts.find(row=>row.purpose==='showcase');
 await page.goto(config.base+'/login');await page.locator('input[name="email"]').fill(credentials.email);await page.locator('input[name="password"]').fill(credentials.password);await Promise.all([page.waitForURL('**/dashboard'),page.locator('button[type="submit"]').click()]);
 const outcomes=[];
 for(const [kind,route,api,searchSelector,rowSelector,metric] of [['AIUC','/governance/ai-use-cases','/api/ai/use-cases','.case-search input','.case-row','.aiuc-metrics strong'],['AIRS','/governance/ai-risks','/api/ai/risks','.risk-search input','.risk-register-table .p-datatable-tbody tr','.risk-metrics strong']]){
  await page.goto(config.base+route,{waitUntil:'networkidle'});const input=page.locator(searchSelector);
  const responseFor=(search,pageNumber)=>page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname===api&&url.searchParams.get('search')===search&&Number(url.searchParams.get('page'))===pageNumber&&response.status()===200;});
  const search=prefix+' '+kind,firstPromise=responseFor(search,1);await input.fill(search);const first=await (await firstPromise).json();assert.equal(first.total,105);assert.equal(first.summary.total,105);assert.equal(first.data.length,25);assert.equal(first.totalPages,5);
  await page.waitForFunction(({rowSelector,metric})=>document.querySelectorAll(rowSelector).length===25&&document.querySelector(metric)?.textContent.trim()==='105',{rowSelector,metric});
  const oldestId=kind==='AIUC'?manifest.largeRegister.useCases[0]:manifest.largeRegister.risks[0].id;assert.ok(!first.data.some(row=>row.id===oldestId));
  const lastPromise=responseFor(search,5);await page.locator('button.p-paginator-last').click();const last=await (await lastPromise).json();assert.equal(last.data.length,5);assert.ok(last.data.some(row=>row.id===oldestId));
  const target=search+' 001',singlePromise=responseFor(target,1);await input.fill(target);const single=await (await singlePromise).json();assert.equal(single.total,1);assert.equal(single.data[0].id,oldestId);assert.equal(single.summary.total,1);await page.waitForFunction(({rowSelector,target})=>document.querySelectorAll(rowSelector).length===1&&document.querySelector(rowSelector)?.textContent.includes(target),{rowSelector,target});
  assert.ok((await page.locator(rowSelector).first().innerText()).includes(target));outcomes.push({kind,nativeRows:105,pages:5,oldestBeyondFirst100Found:true,serverSearchAndFullSummaryPassed:true});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 atomicJson(join(config.installationRoot,'large-register-browser-verification.json'),{qaOnly:true,demoOnly:true,isLicensedDemoAcceptance:false,completedAt:new Date().toISOString(),browserVersion:browser.version(),functionalPassed:true,licensedAcceptancePassed:license.length===0&&await page.locator('#p-license-host').count()===0,licenseWarningCount:license.length,outcomes});
 console.log('Both native 105-record registers passed browser pagination, oldest-record discovery, search and scoped summary checks. License acceptance remains separate.');
}finally{if(browser)await browser.close();if(child.exitCode===null&&child.signalCode===null){const ended=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([ended,delay(5000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}}
