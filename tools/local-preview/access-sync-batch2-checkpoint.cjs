const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {binding,hash}=require('./verification-binding.cjs');
const {acquireVerificationLease}=require('./verification-lease.cjs');
const state='C:/Users/Youss/Documents/Codex/work/dgop-access-sync';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const file=state+'/checkpoint.json',cp=read(file),prior=read(state+'/checkpoint-batch-1.json');
assert.equal(cp.status,'batch-2-in-progress');
const lease=acquireVerificationLease({purpose:'Access sync Batch 2 receipt validation and checkpoint'});
try{
 const current=binding(cp.root),preserved=binding(cp.original),preflight=read(state+'/batch-2-preflight.json');
 assert.deepEqual(preserved,cp.baseline,'Original source, locks or builds changed');
 assert.equal(current.apiLockSha256,cp.baseline.apiLockSha256);
 assert.equal(current.webLockSha256,cp.baseline.webLockSha256);
 assert.equal(current.node,'24.19.0');
 const git=spawnSync('git',['-C',cp.original,'branch','--show-current'],{encoding:'utf8',windowsHide:true});
 assert.equal(git.status,0);assert.equal(git.stdout.trim(),'main');
 const receipts=fs.readdirSync(state+'/evidence').map(folder=>state+'/evidence/'+folder+'/receipt.json').filter(f=>fs.existsSync(f)).map(file=>({file,...read(file)}));
 const latest=group=>{
  const result=receipts.filter(r=>r.batch===2&&r.group===group).sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
  assert(result,'Missing receipt: '+group);assert.equal(result.status,'passed','Latest run failed: '+group);
  assert.deepEqual(result.binding.source,current.source,'Source changed since '+group);
  assert.equal(result.binding.apiLockSha256,current.apiLockSha256);assert.equal(result.binding.webLockSha256,current.webLockSha256);
  assert.equal(result.binding.node,current.node);assert.equal(path.resolve(result.node),path.resolve(process.execPath));
  assert(Date.parse(result.startedAt)>=Date.parse(preflight.at));
  assert(Date.parse(result.finishedAt)>=Date.parse(result.startedAt));assert(Date.parse(result.finishedAt)<=Date.now());
  assert(result.checks.length>0);
  for(const c of result.checks){
   assert.equal(c.exitCode,0);assert(!c.error);
   assert(Date.parse(c.startedAt)>=Date.parse(result.startedAt));
   assert(Date.parse(c.finishedAt)>=Date.parse(c.startedAt));assert(Date.parse(c.finishedAt)<=Date.parse(result.finishedAt));
   assert(path.resolve(c.cwd).startsWith(path.resolve(cp.root)+path.sep)||path.resolve(c.cwd)===path.resolve(cp.root));
  }
  return result;
 };
 const ui=latest('ui'),auth=latest('auth'),apiBuild=latest('apiBuild'),webBuild=latest('webBuild');
 assert.equal(ui.checks.length,1);assert.equal(auth.checks.length,2);assert.equal(apiBuild.checks.length,1);assert.equal(webBuild.checks.length,1);
 const log=(r,name)=>fs.readFileSync(path.dirname(r.file)+'/'+name+'.log','utf8');
 assert(/Test Files\s+6 passed \(6\)/.test(log(ui,'live-access-ui')));
 assert(/Tests\s+36 passed \(36\)/.test(log(ui,'live-access-ui')));
 assert(/12\/12 passed/.test(log(auth,'auth.service')));
 assert(/PASS access snapshot/.test(log(auth,'access-snapshot')));
 const buildTime=(name,r)=>{const mtime=fs.statSync(name).mtimeMs;assert(mtime>=Date.parse(r.startedAt)&&mtime<=Date.parse(r.finishedAt));return mtime;};
 const apiMtime=buildTime(cp.root+'/apps/api/dist/main.js',apiBuild);
 const webMtime=buildTime(cp.root+'/apps/web/dist/web/browser/index.html',webBuild);
 const changedFiles=[];
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(['node_modules','dist','.git','.angular','storage','tmp','coverage','.codex','.agents'].includes(e.name))continue;
  assert(!e.isSymbolicLink(),'Unexpected source link');
  const absolute=path.join(dir,e.name),relative=path.relative(cp.root,absolute).replaceAll('\\','/');
  if(e.isDirectory())walk(absolute);else if(!/(?:^|\/)\.env(?:\.|$)|primeui-license\.local\.ts$|tsconfig\.tsbuildinfo$/.test(relative)){
   const original=path.join(cp.original,relative),sha256=hash(fs.readFileSync(absolute));
   if(!fs.existsSync(original)||hash(fs.readFileSync(original))!==sha256)changedFiles.push({path:relative,sha256});
  }
 }}walk(cp.root);changedFiles.sort((a,b)=>a.path.localeCompare(b.path));
 const priorChanges=new Map(prior.changedFiles.map(f=>[f.path,f.sha256]));
 const batch2ChangedFiles=changedFiles.filter(f=>priorChanges.get(f.path)!==f.sha256);
 const warningPath='apps/web/src/app/pages/governance/access-management/access-management.scss';
 assert.equal(hash(fs.readFileSync(cp.root+'/'+warningPath)),hash(fs.readFileSync(cp.original+'/'+warningPath)));
 const failedBatch2=receipts.filter(r=>r.batch===2&&r.status==='failed').map(r=>({file:r.file,group:r.group,status:r.status}));
 const finishedAt=new Date().toISOString();
 const next='Batch 3 only: recover the verified local runtime/database without changing original files or shared grants; preflight the isolated access-sync-test database, eight existing persona credentials, ports and license; run timed eight-account acceptance, scope/role/disabled-user and API enforcement checks, multiple tabs/account switching/delayed-response/recovery checks, EN/AR/RTL/themes/mobile/keyboard checks and polling counts; restore isolated baselines, then present preview at 4208. No reseed, upgrade, full release matrix or soak.';
 const ledger={batch:2,status:'batch-2-focused-checks-passed-runtime-acceptance-pending',finishedAt,binding:current,
  priorBatchEvidence:state+'/evidence-ledger-batch-1.json',sourceFrozenBy:ui.startedAt,
  environment:{profile:cp.profile,database:cp.database,node:process.execPath,originalPort:4206,previewPort:4208,previewStarted:false,licenseConfigured:preflight.licenseConfigured,configurationRef:cp.configRef,credentialRef:cp.credentialRef,runtimePreflightRef:state+'/batch-2-preflight.json',runtimeBlockers:preflight.blockers,databaseWritesThisBatch:false},
  changedFiles,batch2ChangedFiles,
  checks:[{group:'focused UI',receipt:ui.file,testFiles:6,tests:36},{group:'auth and capability projection',receipt:auth.file,authTests:12,capabilityAssertions:'eligible AI grants, native panel/report policy, deterministic revisions, transport failures'},{group:'API production build',receipt:apiBuild.file,outputMtime:new Date(apiMtime).toISOString(),outputBinding:current.apiBuild},{group:'web production build',receipt:webBuild.file,outputMtime:new Date(webMtime).toISOString(),outputBinding:current.webBuild}],
  receiptValidation:{latestRunRequired:true,sourceLocksAndNodeMatch:true,nestedTimestampsValid:true,checkExitCodesZero:true,buildOutputsFresh:true},
  coverage:['5-second visible polling, one in flight, timeout, exact 10-second staleness and recovery','superseded login and GET cancellation, stale write results ignored, no automatic write replay','permission-aware navigation, hubs, tool counts, quick links, navigation search and route access','real Angular routed page recreation and Finance-to-HR response cancellation; discarded draft notice','revoked page removal and About redirect; opaque connection cover, inert background and keyboard focus','Ownership optional user/reference request gating and usable authorized lists on lookup failure','AI officer registration mismatch, native specialist panel eligibility, optional lookup failure and explicit queue failure'],
  preserved:{originalBinding:preserved,originalBranch:'main',originalRuntimeHealthAtPreflight:preflight.originalHealth,originalRuntimeConfirmedUp:false,sealedCandidateUntouched:true,priorRepairUntouched:true,credentialsAndSharedGrantsUnchanged:true,locksUnchanged:true},
  failedReceipts:failedBatch2,
  failureDispositions:[{issue:'Ownership made an unavailable user-directory request.',resolution:'Focused reproduction failed as expected; directory and dependent forms now gated, latest focused UI suite passes.'},{issue:'Review template accessed a private rowsFor method.',resolution:'Made the template method protected; production web build and focused suite pass.'},{issue:'Shell test environment lacked matchMedia.',resolution:'Added a browser API fixture to the test; routed boundary tests pass without an application workaround.'}],
  remainingWarnings:[{kind:'unchanged stylesheet budget warning',path:warningPath,sizeKB:43.44,warningBudgetKB:42,errorBudgetKB:45},{kind:'PrimeUI license',configured:false,presentationAcceptancePending:true}],
  pending:['Batch 3 database-backed and timed browser acceptance across eight real profiles','Measured ten-second timing and request counts in actual browser tabs','EN/AR/RTL, themes, mobile and keyboard browser acceptance','4208 preview startup after local service recovery and acceptance'],next};
 const checkpoint={...cp,batch:2,status:'batch-2-complete',completedAt:finishedAt,candidateIdentity:current,changedFiles,batch2ChangedFiles,
  completedSteps:[...new Set([...prior.completedSteps,'reactive-tool-and-page-visibility','generation-bound-page-recreation','request-cancellation-and-write-blocking','ten-second-connection-cover','optional-reference-and-AI-panel-gating','batch-2-focused-UI-API-checks-and-both-builds'])],
  pending:ledger.pending,sourceFrozenAt:ui.startedAt,evidenceRef:state+'/evidence-ledger.json',priorCheckpointRef:state+'/checkpoint-batch-1.json',runtimeBlockers:preflight.blockers,nextAction:next};
 const report='C:/Users/Youss/Documents/Codex/2026-10-02/github-plugin-github-openai-curated-remote/outputs/DGOP-access-sync-batch-2-2026-10-07.md';
 const link=(label,target)=>'['+label+']('+target+')';
 const reportText=`# DGOP automatic access updates — Batch 2 checkpoint\n\nBatch 2 implementation and focused checks are complete in the isolated repair copy. Eight-account browser acceptance and the 4208 preview are pending Batch 3. No release-readiness claim is made.\n\n## Delivered behavior\n\n- Navigation, tool cards/counts, quick links, search entries, route access and affected actions read the current access snapshot. AI tools use native server capability eligibility. Administrator oversight and existing independent business-decision checks are preserved.\n- An access revision clears page state and recreates the authorized page. Revoked pages disappear and return to About; a visible bilingual notice explains discarded edits. Old scoped GETs are cancelled and late responses cannot restore removed records or actions.\n- Superseded login requests are cancelled. Writes require verified current access; old write results are ignored and writes are never automatically replayed. Successful user/role saves refresh access; failed saves do not.\n- After ten seconds without access verification, an opaque connection cover hides protected content and blocks writes. The background is inert, focus stays on the cover, and recovery restores the same page when access is unchanged. Invalid sessions return to sign-in.\n- Ownership avoids unauthorized user-directory/reference calls. Authorized lists remain usable when optional lookups fail; dependent forms explain why they are disabled.\n- AI review requests only eligible panels. Officers no longer request the registrar queue without native eligibility. Optional reference failures remain separate from permitted queue failures, which produce an error instead of a false empty queue.\n- English/Arabic messages and logical layout styles are included. Actual RTL, theme, mobile and keyboard presentation acceptance remains in Batch 3.\n\n## Fresh verification\n\n| Check | Result | Evidence |\n|---|---|---|\n| Six focused frontend files | 36/36 passed | ${link('UI receipt',ui.file)} |\n| Authentication and capability projection | 12/12 auth tests plus capability assertions passed | ${link('API receipt',auth.file)} |\n| API production build | Passed | ${link('API build',apiBuild.file)} |\n| Web production build and templates | Passed; initial bundle 611.30 kB | ${link('Web build',webBuild.file)} |\n\nThe tests exercise actual Angular route recreation with stale reads and drafts, polling/timeouts, cancellation, access removal, write blocking, focus containment, optional references and AI panel eligibility. Mocked component/session fixtures are functional evidence; they do not replace timed browser or database-backed acceptance.\n\nReceipt sources, both locks, pinned Node, nested timestamps, exit codes and newly written build outputs were validated against the frozen candidate. Earlier failed receipts remain on disk and in the ledger. No passing result was inherited over a newer failure. The existing Access Management stylesheet produces a 43.44 kB warning against its 42 kB warning budget (45 kB error budget); that stylesheet is unchanged.\n\n## Preservation and blockers\n\n- Original branch remains main. Original source, both lockfiles and both build hashes exactly match the baseline. Original users, passwords and shared grants were not changed. No installation, migration, reseed or dependency upgrade occurred in this batch.\n- At Batch 2 preflight, localhost:4206 and the local database at 127.0.0.1:55436 were unavailable. Original runtime health is not claimed. No guessed database cluster was started or unrelated process stopped.\n- Database-backed Batch 1 receipts are retained as historical evidence; they are not relabeled as acceptance of changed Batch 2 code.\n- PrimeUI license is still unconfigured; licensed presentation acceptance remains separate. Security review remains deferred.\n- The sealed candidate and previous AI repair were not edited. Preview 4208 has not started.\n\n## Frozen identity\n\n- Source SHA256: ${current.source.sha256} (${current.source.files} files).\n- API lock SHA256: ${current.apiLockSha256}\n- Web lock SHA256: ${current.webLockSha256}\n- API build SHA256: ${current.apiBuild.sha256}\n- Web build SHA256: ${current.webBuild.sha256}\n- Node: ${current.node}\n- Profile: ${cp.profile}; database: 127.0.0.1:55436/${cp.database.database}.\n- ${link('Checkpoint',file)}; ${link('Evidence ledger',state+'/evidence-ledger.json')}. The ledger lists ${batch2ChangedFiles.length} files changed in Batch 2 and ${changedFiles.length} cumulative application/test files. Credential and configuration references are stored there; no passwords are copied into evidence.\n\n## Next action\n\n${next}\n`;
 // All gate validation completes before any delivery state is replaced.
 const atomic=(target,value)=>{const temp=target+'.tmp-'+process.pid;fs.writeFileSync(temp,value);fs.renameSync(temp,target);};
 atomic(state+'/evidence-ledger.json',JSON.stringify(ledger,null,2)+'\n');
 atomic(file,JSON.stringify(checkpoint,null,2)+'\n');
 atomic(report,reportText);
 console.log(JSON.stringify({status:checkpoint.status,source:current.source.sha256,apiBuild:current.apiBuild.sha256,webBuild:current.webBuild.sha256,batch2ChangedFiles:batch2ChangedFiles.length,changedFiles:changedFiles.length,report,checkpoint:file,pending:ledger.pending}));
}finally{lease.release();}
