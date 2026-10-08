const c=require('./access-sync-common.cjs'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {binding}=require('./verification-binding.cjs'),{acquireVerificationLease}=require('./verification-lease.cjs');
const {chromium}=createRequire(c.root+'/apps/web/package.json')('playwright');
const lease=acquireVerificationLease({purpose:'Access sync Batch 3 timed live permission acceptance'});
const folder=c.state+'/evidence/'+new Date().toISOString().replaceAll(':','-')+'-live',file=folder+'/receipt.json';c.fs.mkdirSync(folder,{recursive:true});
const result={batch:3,group:'live',startedAt:new Date().toISOString(),binding:binding(c.root),profile:'access-sync-test',database:c.url.pathname.slice(1),base:c.base,checks:[],observations:[],timings:[]};
const save=()=>c.atomic(file,result),credentials=c.credentials.accounts,items=c.profileCheckpoint.items;
let browser,adminCookie,baseline,financeName,hrName,active='setup',expectedNetwork=false,contexts=[],requests=[];
const account=key=>credentials.find(a=>a.key===key);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function pace(){requests=requests.filter(t=>Date.now()-t<60000);if(requests.length>140){const delay=60050-(Date.now()-requests[0]);console.log('Pacing API window '+Math.ceil(delay/1000)+'s');await sleep(delay);requests=requests.filter(t=>Date.now()-t<60000);}}
async function api(method,route,body,cookie=adminCookie,expected=200){await pace();requests.push(Date.now());const r=await c.api(cookie,method,route,body);assert.equal(r.status,expected,method+' '+route+': '+JSON.stringify(r.data));return r.data;}
async function perms(codes){return api('PUT','/roles/'+items['role.finance']+'/permissions',{permissions:[...new Set(codes)],justification:'Isolated Batch 3 functional acceptance; restore baseline after scenario'});}
let basePerms=[];
async function snapshot(){
 const user=await c.db.user.findUniqueOrThrow({where:{id:items['user.finance']}}),role=await c.db.role.findUniqueOrThrow({where:{id:items['role.finance']}});
 return {user:{isActive:user.isActive,tokenVersion:user.tokenVersion},role:{isActive:role.isActive,maxClassificationRank:role.maxClassificationRank},memberships:await c.db.userRole.findMany({where:{userId:user.id},orderBy:{roleId:'asc'}}),grants:await c.db.rolePermission.findMany({where:{roleId:role.id},orderBy:{permissionId:'asc'}}),scopes:await c.db.roleDataScope.findMany({where:{roleId:role.id},orderBy:{id:'asc'}})};
}
async function restore(){if(!baseline)return;await c.db.$transaction(async tx=>{
 await tx.user.update({where:{id:items['user.finance']},data:baseline.user});await tx.role.update({where:{id:items['role.finance']},data:baseline.role});
 await tx.userRole.deleteMany({where:{userId:items['user.finance']}});await tx.userRole.createMany({data:baseline.memberships});
 await tx.rolePermission.deleteMany({where:{roleId:items['role.finance']}});await tx.rolePermission.createMany({data:baseline.grants});
 await tx.roleDataScope.deleteMany({where:{roleId:items['role.finance']}});await tx.roleDataScope.createMany({data:baseline.scopes});
 });assert.deepEqual(await snapshot(),baseline,'Scenario baseline was not restored');}
async function login(page,key){const a=account(key);await page.goto(c.base+'/login?returnUrl=/about');await page.locator('input[name=email]').fill(a.email);await page.locator('input[name=password]').fill(a.password);await page.locator('button[type=submit]').click();await page.waitForURL('**/about',{timeout:15000});await page.locator('.profile__btn').waitFor();await page.waitForTimeout(150);}
async function session(key='finance',route='/about'){
 await pace();const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
 await context.addInitScript(()=>{if(location.protocol!=='http:')return;localStorage.setItem('dgop.lang','en');localStorage.setItem('dgop.theme','light');});
 context.on('request',r=>{if(r.url().includes('/api/'))requests.push(Date.now());});
 context.on('page',page=>{page.on('pageerror',e=>result.observations.push({scenario:active,kind:'pageerror',message:e.message,expected:expectedNetwork,at:new Date().toISOString()}));page.on('console',m=>{if(m.type()==='error')result.observations.push({scenario:active,kind:'consoleerror',message:m.text(),expected:expectedNetwork,at:new Date().toISOString()});});page.on('response',r=>{if(r.status()>=400)result.observations.push({scenario:active,kind:'http',status:r.status(),url:r.url(),expected:expectedNetwork,at:new Date().toISOString()});});});
 const page=await context.newPage();await login(page,key);if(route!=='/about')await page.goto(c.base+route);return{context,page};
}
async function currentCookie(context){return(await context.cookies()).map(v=>v.name+'='+v.value).join('; ');}
async function timed(name,start,fn){await fn();const ms=Date.now()-start;assert(ms<=10000,name+' exceeded 10 seconds: '+ms);const timing={name,scenario:active,elapsedMs:ms,at:new Date().toISOString()};result.timings.push(timing);return timing;}
const aiLink=page=>page.locator('aside a[href="/ai-governance"]');
async function changed(page){await page.locator('.live-access-notice').waitFor({timeout:10000});}
async function check(name,fn){if(process.env.DGOP_ACCESS_SCENARIOS&&!process.env.DGOP_ACCESS_SCENARIOS.split(',').includes(name))return;active=name;const startedAt=new Date().toISOString();let detail;
 try{await restore();await pace();detail=await fn();result.checks.push({name,status:'pass',startedAt,finishedAt:new Date().toISOString(),detail});console.log('PASS '+name);}catch(e){const pages=[];for(const context of contexts)for(const page of context.pages())pages.push({url:page.url(),visibleText:(await page.locator('body').innerText().catch(()=>'' )).slice(0,1400)});result.checks.push({name,status:'fail',startedAt,finishedAt:new Date().toISOString(),error:e.stack,pages});console.log('FAIL '+name+': '+e.message);}
 finally{for(const context of contexts)await context.close();contexts=[];expectedNetwork=false;try{await restore();result.checks.at(-1).baselineRestored=true;}catch(e){result.restoreError=e.message;throw e;}save();}}
(async()=>{try{
 assert.deepEqual(result.binding,c.checkpoint.candidateIdentity);browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 baseline=await snapshot();c.atomic(c.state+'/private/batch3-live-restore.json',baseline);financeName=(await c.db.dataAsset.findUniqueOrThrow({where:{id:items['asset.finance']},select:{nameEn:true}})).nameEn;hrName=(await c.db.dataAsset.findUniqueOrThrow({where:{id:items['asset.hr']},select:{nameEn:true}})).nameEn;
 const role=await c.db.role.findUniqueOrThrow({where:{id:items['role.finance']},include:{permissions:{include:{permission:true}}}});assert(!role.isSystem);basePerms=role.permissions.map(g=>g.permission.resource+'.'+g.permission.action);
 const admin=await c.login(account('admin').email,account('admin').password);assert.equal(admin.status,201);adminCookie=admin.cookie;
 await check('ai_grant_revoke_tabs',async()=>{
  const {context,page}=await session();assert.equal(await aiLink(page).count(),0);const second=await context.newPage();await second.goto(c.base+'/about');await second.locator('.profile__btn').waitFor();
  await page.bringToFront();const visibleAtGrant=await page.evaluate(()=>document.visibilityState);await perms([...basePerms,'case.view.aiuc.own']);let start=Date.now();await timed('AI tool appears',start,()=>aiLink(page).waitFor());
  await page.goto(c.base+'/ai-governance');await page.locator('a.tool-node[href="/governance/ai-use-cases"]').waitFor();assert.equal(await page.locator('a.tool-node[href="/governance/ai-use-cases"]').count(),1);assert.equal(await page.locator('a.tool-node').count(),1);
  await second.bringToFront();start=Date.now();await timed('Returning tab receives current AI grant',start,()=>aiLink(second).waitFor());await second.goto(c.base+'/governance/ai-use-cases');await second.locator('h1').waitFor();
  const cookie=await currentCookie(context);await perms(basePerms);start=Date.now();const denied=await c.api(cookie,'GET','/ai/use-cases');assert.equal(denied.status,403);const apiDenialMs=Date.now()-start;
  await timed('AI page and menu removed',start,async()=>{await second.waitForURL('**/about');await aiLink(second).waitFor({state:'detached'});});
  await page.bringToFront();start=Date.now();await timed('Returning tab removes revoked AI tool',start,()=>aiLink(page).waitFor({state:'detached'}));assert.equal(await page.locator('a.tool-node').count(),0);
  return{visibleAtGrant,apiDenialMs,immediateApiStatus:denied.status,tabs:2};
 });
 await check('edit_revoke_draft',async()=>{
  await perms([...basePerms,'data_assets.edit']);const {context,page}=await session('finance','/assets');await page.locator('tbody button').filter({hasText:/^Edit$/}).first().click();await page.locator('input[name=nameEn]').fill('UNSAVED Batch 3 draft');
  const cookie=await currentCookie(context);await perms(basePerms);const start=Date.now();const denied=await c.api(cookie,'PATCH','/assets/'+items['asset.finance'],{nameEn:'must never persist'});assert.equal(denied.status,403);
  await timed('Editing stops and draft is discarded',start,async()=>{await page.locator('input[name=nameEn]').waitFor({state:'detached'});await page.locator('[role=status]').filter({hasText:/access.*changed|unsaved/i}).waitFor();});
  assert.equal(new URL(page.url()).pathname,'/assets');assert.equal(await page.getByRole('button',{name:'Edit',exact:true}).count(),0);assert(!JSON.stringify(await c.db.dataAsset.findUnique({where:{id:items['asset.finance']}})).includes('UNSAVED'));
  return{immediateWriteStatus:denied.status,readAccessPreserved:true,draftPersisted:false};
 });
 await check('scope_lists_details_search_badges',async()=>{
  await perms([...basePerms,'search.view']);const {context,page}=await session('finance','/assets');await page.getByText(financeName,{exact:true}).waitFor();const search=page.locator('.topbar-search input');await search.fill('QA Access');await page.locator('.topbar-search__result').first().waitFor();assert((await page.locator('.topbar-search__panel').innerText()).includes('Finance'));
  let badgeReads=0;page.on('request',r=>{if(r.url().includes('/api/workflow/tasks/mine'))badgeReads++;});
  const hr=await api('GET','/roles/'+items['role.hr']);await api('PUT','/roles/'+items['role.finance']+'/scopes',{scopes:hr.scopes,maxClassificationRank:hr.maxClassificationRank});const start=Date.now();
  await timed('Scope change clears Finance data and search',start,async()=>{await page.getByText(hrName,{exact:true}).waitFor();assert(!(await page.locator('main').innerText()).includes(financeName));await page.waitForFunction(()=>document.querySelector('.topbar-search input')?.value==='');});
  const cookie=await currentCookie(context),list=await api('GET','/assets?page=1&pageSize=200',undefined,cookie);assert(!JSON.stringify(list).includes(items['asset.finance']));assert(JSON.stringify(list).includes(items['asset.hr']));
  const denied=await c.api(cookie,'GET','/assets/'+items['asset.finance']);assert([403,404].includes(denied.status));
  await search.fill('QA Access');await page.locator('.topbar-search__result').first().waitFor();assert(!(await page.locator('.topbar-search__panel').innerText()).includes('QA Access Finance Dataset'));assert((await page.locator('.topbar-search__panel').innerText()).includes('HR'));
  const tasks=await api('GET','/workflow/tasks/mine?status=open&page=1&pageSize=1',undefined,cookie);assert(badgeReads>0);const badge=page.locator('.nav__badge').first();if(tasks.total>0)assert.equal(Number(await badge.innerText()),tasks.total);
  return{scopedAssetTotal:list.total,formerDetailStatus:denied.status,taskTotal:tasks.total,badgeReads,searchCleared:true};
 });
 await check('roles_overlap_status_and_membership',async()=>{
  const {context,page}=await session('finance','/assets');await page.getByText(financeName,{exact:true}).waitFor();
  await api('PUT','/users/'+items['user.finance']+'/roles',{roleCodes:['qa_access_owner_finance_v1','qa_access_owner_hr_v1']});let start=Date.now();await timed('Added role exposes HR scope',start,()=>page.getByText(hrName,{exact:true}).waitFor());
  await api('PATCH','/roles/'+items['role.finance'],{isActive:false});start=Date.now();await timed('Inactive role removes Finance while overlapping HR view remains',start,()=>page.getByText(financeName,{exact:true}).waitFor({state:'detached'}));assert.equal(new URL(page.url()).pathname,'/assets');await page.getByText(hrName,{exact:true}).waitFor();
  await api('PATCH','/roles/'+items['role.finance'],{isActive:true});start=Date.now();await timed('Role reactivation returns Finance',start,()=>page.getByText(financeName,{exact:true}).waitFor());
  await api('PUT','/users/'+items['user.finance']+'/roles',{roleCodes:['qa_access_owner_finance_v1']});start=Date.now();await timed('Removed membership removes HR',start,()=>page.getByText(hrName,{exact:true}).waitFor({state:'detached'}));
  const me=await api('GET','/auth/me',undefined,await currentCookie(context));assert(!me.roles.some(r=>r.code==='system_admin'));return{overlappingPermission:'data_assets.view',administrator:false};
 });
 await check('disable_session',async()=>{
  const {page,context}=await session();const cookie=await currentCookie(context);await api('PATCH','/users/'+items['user.finance'],{isActive:false});const start=Date.now();const denied=await c.api(cookie,'GET','/assets');assert.equal(denied.status,401);await timed('Disabled account returns to login',start,()=>page.waitForURL('**/login*'));return{immediateApiStatus:denied.status};
 });
 await check('failed_admin_save',async()=>{
  const {context,page}=await session('finance','/assets');await page.getByText(financeName,{exact:true}).waitFor();const cookie=await currentCookie(context),before=await api('GET','/auth/me',undefined,cookie);
  const bad=await c.api(adminCookie,'PUT','/roles/'+items['role.finance']+'/permissions',{permissions:[...basePerms,'invalid.not_in_catalog']});assert.equal(bad.status,400);await page.waitForTimeout(5500);const after=await api('GET','/auth/me',undefined,cookie);assert.equal(after.accessRevision,before.accessRevision);assert.equal(await aiLink(page).count(),0);return{failedSaveStatus:bad.status,revisionUnchanged:true};
 });
 await check('rapid_changes_delayed_snapshot',async()=>{
  const {context,page}=await session();let release,held,once=false;const ready=new Promise(r=>held=r),hold=new Promise(r=>release=r);
  await context.route('**/api/auth/session',async route=>{if(once){await route.continue();return;}once=true;const response=await route.fetch();held();await hold;try{await route.fulfill({response});}catch{/* Timed-out request is intentionally obsolete. */}});
  await ready;await perms([...basePerms,'case.view.aiuc.own']);await perms(basePerms);await perms([...basePerms,'case.view.aiuc.own']);let start=Date.now();release();await timed('Newest rapid grant wins after delayed old snapshot',start,()=>aiLink(page).waitFor());await context.unroute('**/api/auth/session');
  await perms(basePerms);start=Date.now();await timed('Newest revoke removes tool',start,()=>aiLink(page).waitFor({state:'detached'}));return{mutations:4,delayedSnapshot:true};
 });
 await check('connection_cover_recovery_keyboard',async()=>{
  await perms([...basePerms,'data_assets.edit']);const {context,page}=await session('finance','/assets');await page.locator('tbody button').filter({hasText:/^Edit$/}).first().click();await page.locator('input[name=nameEn]').fill('UNSAVED keep through connection outage');
  await page.evaluate(()=>{const state={verifiedAt:0,coverAt:0};window.__accessCoverTiming=state;new MutationObserver(()=>{if(state.verifiedAt&&!state.coverAt&&document.querySelector('.access-screen-cover'))state.coverAt=Date.now();}).observe(document.body,{childList:true,subtree:true});});
  const verified=await page.waitForResponse(r=>r.url().includes('/api/auth/session')&&r.status()===200);expectedNetwork=true;let writes=0;page.on('request',r=>{if(r.method()==='PATCH')writes++;});await context.route('**/api/auth/session',route=>route.abort('failed'));await verified.finished();
  await page.evaluate(()=>{window.__accessCoverTiming.verifiedAt=Date.now();});
  await page.locator('.access-screen-cover').waitFor({timeout:11000});const measurement=await page.evaluate(()=>({...window.__accessCoverTiming,automationObservedAt:Date.now()}));const elapsedMs=measurement.coverAt-measurement.verifiedAt;result.coverTiming={...measurement,actualCoverAfterMs:elapsedMs,automationObservationAfterMs:measurement.automationObservedAt-measurement.verifiedAt};save();assert(measurement.coverAt>0&&elapsedMs<=10500,'Observed DOM cover timing: '+JSON.stringify(result.coverTiming));assert.equal(await page.locator('.shell').getAttribute('inert'),'');
  assert(await page.locator('.access-screen-cover').evaluate(el=>el.contains(document.activeElement)));await page.keyboard.press('Tab');await page.keyboard.press('Tab');assert(await page.locator('.access-screen-cover').evaluate(el=>el.contains(document.activeElement)));
  assert.equal(await page.locator('input[name=nameEn]').isVisible(),false);assert.equal(writes,0);
  await context.unroute('**/api/auth/session');const start=Date.now();await page.locator('.access-screen-cover button').first().click();await timed('Connection recovery returns protected page',start,()=>page.locator('.access-screen-cover').waitFor({state:'detached'}));assert.equal(await page.locator('input[name=nameEn]').inputValue(),'UNSAVED keep through connection outage');expectedNetwork=false;return{coverAfterVerificationMs:elapsedMs,writesDuringOutage:writes,draftPreserved:true};
 });
 await check('polling_singleflight_hidden_return',async()=>{
  const {page}=await session();let inFlight=0,maxInFlight=0,count=0,ended=new Set();const at=[];
  page.on('request',r=>{if(r.url().includes('/api/auth/session')){inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);count++;at.push(Date.now());}});const end=r=>{if(r.url().includes('/api/auth/session')&&!ended.has(r)){ended.add(r);inFlight--;}};page.on('requestfinished',end);page.on('requestfailed',end);
  await page.waitForTimeout(16000);assert(count>=3&&count<=4,'Unexpected visible polling count: '+count);assert.equal(maxInFlight,1);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});const hiddenCount=count;await page.waitForTimeout(6000);assert.equal(count,hiddenCount);
  await perms([...basePerms,'case.view.aiuc.own']);const start=Date.now();await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await timed('Return event immediately verifies new access',start,()=>aiLink(page).waitFor());return{visibleWindowMs:16000,visibleProbes:hiddenCount,maxInFlight,hiddenProbes:count-hiddenCount-1,intervals:at.slice(1).map((v,i)=>v-at[i]),visibilityEventControlled:true};
 });
 await check('same_browser_admin_editor',async()=>{
  const {page}=await session('admin','/admin/roles');await page.locator('.role-row').filter({hasText:'qa_access_owner_finance_v1'}).click();await page.getByRole('button',{name:'Permissions',exact:true}).click();
  const input=page.locator('app-modal input[type=checkbox][aria-label="Data Assets Edit"]');await input.waitFor();assert.equal(await input.isChecked(),false);await input.check();await page.locator('input[name=permissionJustification]').fill('Batch 3 native UI save, isolated database');
  const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/roles/'+items['role.finance']+'/permissions'));
  let saveAt=0,probeAfter=0;page.on('response',r=>{if(r.request().method()==='PUT'&&r.url().endsWith('/permissions'))saveAt=Date.now();if(saveAt&&r.url().includes('/api/auth/session'))probeAfter=Date.now();});
  await page.locator('app-modal').getByRole('button',{name:'Save',exact:true}).click();assert.equal((await saved).status(),200);await page.waitForFunction(()=>!document.querySelector('app-modal'));await page.waitForTimeout(300);assert(probeAfter>=saveAt&&probeAfter-saveAt<3000,'Same-browser save did not refresh session promptly');return{nativeEditor:true,sessionRefreshAfterSaveMs:probeAfter-saveAt};
 });
 await check('scope_detail_delayed_response',async()=>{
  const {context,page}=await session('finance','/assets');await page.getByText(financeName,{exact:true}).waitFor();let held,release;const ready=new Promise(r=>held=r),resume=new Promise(r=>release=r);
  await context.route('**/api/assets/'+items['asset.finance'],async route=>{const response=await route.fetch();held();await resume;try{await route.fulfill({response});}catch{/* Old detail request was cancelled. */}});
  await page.getByRole('button',{name:financeName,exact:true}).click();await ready;const hr=await api('GET','/roles/'+items['role.hr']);await api('PUT','/roles/'+items['role.finance']+'/scopes',{scopes:hr.scopes,maxClassificationRank:hr.maxClassificationRank});const start=Date.now();
  await timed('Scope change drops the open pending detail',start,()=>page.getByText(hrName,{exact:true}).waitFor());release();await page.waitForTimeout(600);assert(!(await page.locator('main').innerText()).includes(financeName));return{staleDetailIgnored:true,authorizedListRestored:true};
 });
 await check('account_switch_delayed_data',async()=>{
  const {context,page}=await session();let once=false,held,release;const ready=new Promise(r=>held=r),resume=new Promise(r=>release=r);
  await context.route(url=>url.pathname==='/api/assets',async route=>{if(once){await route.continue();return;}once=true;const response=await route.fetch();held();await resume;try{await route.fulfill({response});}catch{/* Superseded account read was cancelled. */}});
  await page.goto(c.base+'/assets');await ready;await page.locator('.profile__btn').click();await page.locator('.profile__menu-item').click();await page.waitForURL('**/login*');await login(page,'hr');await page.goto(c.base+'/assets');await page.getByText(hrName,{exact:true}).waitFor();release();await page.waitForTimeout(600);assert(!(await page.locator('main').innerText()).includes(financeName));assert((await page.locator('.profile__btn').innerText()).includes('HR'));return{oldAccountDataIgnored:true,newIdentity:account('hr').email};
 });
 await check('arabic_dark_mobile_live_access',async()=>{
  const {page}=await session();await page.getByRole('button',{name:'العربية',exact:true}).click();await page.locator('html[dir=rtl]').waitFor();await page.getByRole('button',{name:/^تبديل السمة:/}).click();await page.locator('html[data-theme=dark]').waitFor();await page.setViewportSize({width:390,height:844});await page.locator('.topbar__nav-toggle').click();await page.locator('.shell__sidebar--open').waitFor();
  await perms([...basePerms,'case.view.aiuc.own']);let start=Date.now();await timed('Arabic mobile AI grant appears',start,()=>aiLink(page).waitFor());await aiLink(page).click();await page.locator('a.tool-node[href="/governance/ai-use-cases"]').waitFor();assert.equal(await page.locator('a.tool-node').count(),1);
  const artifact=__dirname+'/../output/playwright/access-sync-batch3-arabic-dark-mobile.png';c.fs.mkdirSync(c.path.dirname(artifact),{recursive:true});await page.screenshot({path:artifact,fullPage:true});
  await perms(basePerms);start=Date.now();await timed('Arabic mobile revoke redirects to About',start,()=>page.waitForURL('**/about'));assert.equal(await aiLink(page).count(),0);assert.equal(await page.locator('html').getAttribute('dir'),'rtl');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');return{rtl:true,theme:'dark',width:390,screenshot:artifact};
 });
 await check('business_eligibility_independence',async()=>{
  const {AiAuthorizationService}=c.req(c.root+'/apps/api/dist/ai-governance/ai-authorization.service.js'),{AuditService}=c.req(c.root+'/apps/api/dist/audit/audit.service.js');const service=new AiAuthorizationService(c.db,new AuditService(c.db));
  await assert.rejects(()=>service.authorize(items['user.finance'],'case.approve.aiuc'),/explicit eligible role grant/);const officer=await service.authorize(items['user.officer'],'case.approve.aiuc');
  await assert.rejects(()=>service.enforceDuty(officer,'approve_aiuc',{requesterId:officer.id},items['ai.officer']),/GEN-26/);
  const log=await c.db.auditLog.findFirst({where:{action:'ai.sod.blocked',entityId:items['ai.officer']},orderBy:{createdAt:'desc'}});assert(log);return{nativeRules:['eligible grant','GEN-26'],auditRecorded:true,administratorPolicy:'existing 4206 override preserved'};
 });
 result.unexpectedErrors=result.observations.filter(o=>!o.expected);if(result.unexpectedErrors.length)result.checks.push({name:'no_unexpected_browser_errors',status:'fail',error:JSON.stringify(result.unexpectedErrors),startedAt:result.startedAt,finishedAt:new Date().toISOString()});
 result.counts={pass:result.checks.filter(x=>x.status==='pass').length,fail:result.checks.filter(x=>x.status==='fail').length};result.status=result.counts.fail?'failed':'passed';if(result.counts.fail)process.exitCode=1;
}catch(e){result.status='failed';result.error=e.stack;process.exitCode=1;console.error(e.message);}finally{
 for(const context of contexts)await context.close();await restore();result.baselineRestored=baseline?true:false;await browser?.close();await c.db.$disconnect();result.finishedAt=new Date().toISOString();save();lease.release();console.log(JSON.stringify({receipt:file,status:result.status,counts:result.counts,timings:result.timings,failures:result.checks.filter(x=>x.status==='fail').map(x=>({name:x.name,error:x.error}))}));}})();
