const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),net=require('node:net'),{parseEnv}=require('node:util'),{spawn,spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const {binding}=require('./verification-binding.cjs'),{acquireVerificationLease}=require('./verification-lease.cjs');
const state='C:/Users/Youss/Documents/Codex/work/dgop-access-sync',cp=JSON.parse(fs.readFileSync(state+'/checkpoint.json'));
const command=process.argv[2],stamp=new Date().toISOString().replaceAll(':','-'),dir=state+'/evidence/'+stamp+'-'+command;
const lease=acquireVerificationLease({purpose:'Access sync Batch 3 '+command});fs.mkdirSync(dir,{recursive:true});
const receipt={batch:3,group:command,startedAt:new Date().toISOString(),status:'running',checks:[]};
const check=(name,detail)=>{receipt.checks.push({name,at:new Date().toISOString(),passed:true,detail});console.log('PASS '+name);};
const free=port=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
const health=async port=>{try{const r=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(2000)});return r.ok?await r.json():null;}catch{return null;}};
(async()=>{let db;try{
 assert.equal(process.versions.node,'24.19.0');receipt.binding=binding(cp.root);assert.deepEqual(receipt.binding,cp.candidateIdentity);assert.deepEqual(binding(cp.original),cp.baseline);check('Frozen candidate and original source/locks/builds match saved identities');
 if(command==='recover-db'){
  const data=cp.original+'/storage/postgres-data',pidLines=fs.readFileSync(data+'/postmaster.pid','utf8').trim().split(/\r?\n/);
  assert.equal(path.resolve(pidLines[1]),path.resolve(data));assert.equal(pidLines[3],'55436');
  const ctl='C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe',status=spawnSync(ctl,['-D',data,'status'],{encoding:'utf8',windowsHide:true});
  if(status.status!==0){let alive=false;try{process.kill(Number(pidLines[0]),0);alive=true;}catch(e){if(e.code!=='ESRCH')throw e;}assert(!alive,'Recorded PostgreSQL PID still exists; inspect before recovery');await free(55436);
   const fd=fs.openSync(dir+'/postgres.log','a');let start;try{start=spawnSync(ctl,['-D',data,'-l',data+'/../postgres.log','-w','-t','20','start'],{stdio:['ignore',fd,fd],windowsHide:true,timeout:25000});}finally{fs.closeSync(fd);}assert.equal(start.status,0,'Known cluster recovery failed; inspect receipt log');}
  check('Known local PostgreSQL cluster recovered',{port:55436,dataDirectory:data});
 }else if(!['preflight','start'].includes(command))throw Error('Use recover-db, preflight or start');
 const req=createRequire(cp.root+'/apps/api/package.json'),config=JSON.parse(fs.readFileSync(state+'/private/database.json')),url=new URL(config.url);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55436');assert.equal(url.pathname,'/dgop_access_sync_qa_20261007');assert.equal(config.profile,'access-sync-test');url.searchParams.set('connect_timeout','3');
 const {PrismaClient}=req('@prisma/client');db=new PrismaClient({datasources:{db:{url:url.href}}});
 const rows=await db.$queryRaw`SELECT current_database() AS name, inet_server_port() AS port`;assert.equal(rows[0].name,cp.database.database);assert.equal(rows[0].port,55436);
 const credentials=JSON.parse(fs.readFileSync(cp.credentialRef));assert.equal(credentials.accounts.length,8);
 const users=await db.user.findMany({where:{email:{in:credentials.accounts.map(a=>a.email)}},include:{userRoles:{include:{role:true}}}});assert.equal(users.length,8);
 for(const u of users){assert(u.isActive);assert.equal(u.userRoles.some(r=>r.role.code==='system_admin'),u.email==='qa.admin@dgop.local');}
 const fixture=JSON.parse(fs.readFileSync('C:/Users/Youss/Documents/Codex/work/dgop-manual-access-20261007/checkpoint.json'));
 assert.equal(await db.dataAsset.count({where:{id:{in:[fixture.items['asset.finance'],fixture.items['asset.hr']]}}}),2);
 receipt.environment={profile:config.profile,database:{host:url.hostname,port:url.port,name:rows[0].name},accounts:users.map(u=>u.email),fixtureTag:fixture.tag,licenseConfigured:false,originalHealth:await health(4206)};check('Isolated database and eight baseline profiles verified');
 if(command==='start'){
  const launch=async(root,port,env,expectedDatabase,key)=>{
   const existing=await health(port);if(existing){assert.equal(existing.database.name,expectedDatabase);check(key+' already healthy',{port,database:expectedDatabase});return;}
   await free(port);const log=fs.openSync(state+'/'+key+'.runtime.log','a');
   const child=spawn(process.execPath,[root+'/apps/api/dist/main.js'],{cwd:root,env:{...process.env,...env,PORT:String(port),HOST:'127.0.0.1',PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH},stdio:['ignore',log,log],detached:true,windowsHide:true});child.unref();fs.closeSync(log);
   fs.writeFileSync(state+'/'+key+'.runtime.json',JSON.stringify({pid:child.pid,node:process.execPath,root,port,database:expectedDatabase,startedAt:new Date().toISOString()},null,2));
   let ready;for(let n=0;n<40;n++){await new Promise(r=>setTimeout(r,500));ready=await health(port);if(ready)break;}assert(ready,key+' did not become healthy');assert.equal(ready.database.name,expectedDatabase);check(key+' startup health',{port,database:expectedDatabase,pid:child.pid});
  };
  const previewEnv=parseEnv(fs.readFileSync(cp.configRef,'utf8'));assert.equal(new URL(previewEnv.DATABASE_URL).pathname,url.pathname);assert(!fs.existsSync(cp.root+'/.env'),'Unexpected source .env');
  await launch(cp.root,4208,{...previewEnv,DB_NAME:cp.database.database,UPLOAD_DIR:state+'/storage',STORAGE_DIR:state+'/storage',CORS_ORIGINS:'http://localhost:4208,http://127.0.0.1:4208'},cp.database.database,'preview');
  const originalEnv=parseEnv(fs.readFileSync(cp.original+'/.env','utf8'));assert.equal(new URL(originalEnv.DATABASE_URL).pathname,'/dgop_dev');await launch(cp.original,4206,originalEnv,'dgop_dev','original');
 }
 receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=e.stack;process.exitCode=1;console.error(e.message);}finally{await db?.$disconnect();receipt.finishedAt=new Date().toISOString();fs.writeFileSync(dir+'/receipt.json',JSON.stringify(receipt,null,2));lease.release();console.log('Receipt: '+dir+'/receipt.json');}})();
