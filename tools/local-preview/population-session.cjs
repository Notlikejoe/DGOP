'use strict';
const c=require('./populate-dgop-common.cjs'),{binding}=require('./verification-binding.cjs');
const {acquireVerificationLease}=require('./verification-lease.cjs');
module.exports=async function session(batch,command='install'){
 const {fs,assert,folder,root,atomic,digest}=c,config=c.loadConfig();
 const lease=acquireVerificationLease({purpose:'4208 database examples Batch '+batch+' '+command});
 const directory=folder+'/runs/'+new Date().toISOString().replace(/[:.]/g,'-')+'-batch-'+batch+'-'+command;fs.mkdirSync(directory,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(folder+'/manifest.json')),identity=manifest.populationIdentity??manifest.sourceIdentity;
 assert.deepEqual(binding(root),identity);assert.deepEqual(binding(config.checkpoint.original),config.checkpoint.baseline);
 const {PrismaClient,Prisma}=config.req('@prisma/client'),db=new PrismaClient({datasources:{db:{url:config.url.href}}});
 const receipt={batch,command,status:'running',startedAt:new Date().toISOString(),binding:identity,environment:{database:manifest.database,profile:manifest.profile,fixtureVersion:manifest.fixtureVersion,realOutboundDelivery:false},checks:[],changes:[],errors:[]};
 const save=()=>atomic(folder+'/manifest.json',manifest),mark=(name,detail)=>{receipt.checks.push({name,detail,passed:true,at:new Date().toISOString()});console.log('PASS '+name);};
 const baselineCredentials=JSON.parse(fs.readFileSync(manifest.baselineCredentialRef)).accounts;
 const creds=[...JSON.parse(fs.readFileSync(manifest.credentialRef)).accounts,...baselineCredentials,...baselineCredentials.map(a=>({...a,key:'qa:'+a.key}))];
 const cookies=new Map();
 async function login(key){if(cookies.has(key))return cookies.get(key);const account=creds.find(a=>a.key===key);assert(account,'Missing actor '+key);const r=await fetch(manifest.base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:account.email,password:account.password}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,201,'Native login failed '+key);const cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');assert(cookie);cookies.set(key,cookie);return cookie;}
 async function api(route,body,actor='admin',method=body===undefined?'GET':'POST'){
  const isForm=body instanceof FormData;
  const r=await fetch(manifest.base+'/api'+route,{method,headers:{Cookie:await login(actor),Origin:manifest.base,'x-dgop-csrf':'same-origin',...(body===undefined||isForm?{}:{'content-type':'application/json'})},body:body===undefined?undefined:isForm?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const value=await r.json().catch(()=>null);if(!r.ok){const failure={route,method,actor,status:r.status,message:value?.message??value,at:new Date().toISOString()};receipt.errors.push(failure);throw Error(JSON.stringify(failure));}return value;
 }
 const row=async(key)=>{const item=manifest.items[key];assert(item,'Missing '+key);const value=await db[item.model].findUnique({where:{id:item.id}});assert(value&&!value.deletedAt,'Missing managed '+key);return value;};
 async function ensure(key,model,where,route,body,actor='admin',expected={}){
  const item=manifest.items[key];let value=item?await db[model].findUnique({where:{id:item.id}}):await db[model].findFirst({where});
  if(value){assert(!value.deletedAt,'Deleted fixture '+key);for(const [field,wanted]of Object.entries(expected))assert.deepEqual(value[field],wanted,'Conflicting/manual fixture '+key+'.'+field);}
  else{assert(!item,'Checkpoint row missing '+key);manifest.intents[key]={batch,model,where,bodyDigest:digest(body instanceof FormData?[...body.keys()]:body),at:new Date().toISOString()};save();value=await api(route,body,actor);const candidates=await db[model].findMany({where,take:2});assert.equal(candidates.length,1,'Native create not uniquely discoverable '+key);value=candidates[0];receipt.changes.push({key,operation:'native-create',model,id:value.id,actor,at:new Date().toISOString()});}
  assert(!item||value.id===item.id);manifest.items[key]??={id:value.id,model,expected,completedAt:new Date().toISOString()};save();return value;
 }
 async function transition(key,route,body,actor,method='PATCH',condition=()=>true){const current=await row(key);if(!condition(current))return current;const step=key+':'+route;manifest.intents[step]={batch,id:current.id,requestDigest:digest(body),at:new Date().toISOString()};save();await api(route,body,actor,method);receipt.changes.push({key,operation:'native-transition',actor,route,at:new Date().toISOString()});save();return row(key);}
 async function actor(key){const account=creds.find(a=>a.key===key);assert(account);return db.user.findUniqueOrThrow({where:{email:account.email},include:{person:true,userRoles:{include:{role:true}}}});}
 function id(key){assert(manifest.items[key],key);return manifest.items[key].id;}
 function ref(key){const v=manifest.references[key];assert(v,key);return typeof v==='string'?v:v.id;}
 async function native(fn){
  const previous={...process.env},cwd=process.cwd();let app;
  try{Object.assign(process.env,c.runtimeEnvironment(config.env,config.url,process.env),{DGOP_SYNTHETIC_POPULATION_MANIFEST:folder+'/manifest.json',AI_MIGRATION_SOURCE_DIR:folder+'/sources',AI_MIGRATION_SOURCE_MANIFEST:folder+'/sources/manifest.json'});process.chdir(root);
   const load=(file,name)=>config.req(root+'/apps/api/dist/'+file+'.js')[name];const {NestFactory}=config.req('@nestjs/core');app=await NestFactory.createApplicationContext(load('app.module','AppModule'),{logger:false});
   const prisma=app.get(load('prisma/prisma.service','PrismaService'));const current=await prisma.$queryRaw`SELECT current_database() AS name`;assert.equal(current[0].name,manifest.database);
   return await fn((file,name)=>app.get(load(file,name)),prisma);
  }finally{await app?.close();process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
 }
 async function groups(groups){manifest.groupChecks??={};for(const [name,fn]of groups){const key=batch+':'+name,fingerprint=digest({function:fn.toString(),binding:identity,fixture:manifest.fixtureVersion});const prior=manifest.groupChecks[key];if(prior?.fingerprint===fingerprint&&prior.status==='passed'){receipt.checks.push({name,passed:true,reusedFrom:prior.receipt,at:prior.at,detail:{unchangedInstallerGroup:true}});continue;}try{await fn();mark(name);manifest.groupChecks[key]={status:'passed',fingerprint,receipt:directory+'/receipt.json',at:new Date().toISOString()};save();}catch(e){receipt.errors.push({group:name,message:e.message,at:new Date().toISOString()});console.error('FAIL '+name+': '+e.message);manifest.groupChecks[key]={status:'failed',fingerprint,receipt:directory+'/receipt.json',at:new Date().toISOString()};save();}}}
 async function finish(){try{assert.deepEqual(binding(root),identity);assert.deepEqual(binding(config.checkpoint.original),config.checkpoint.baseline);
  receipt.status=receipt.errors.length?'incomplete':'passed';manifest.batchRuns??={};manifest.batchRuns[batch]={status:receipt.status,receipt:directory+'/receipt.json',at:new Date().toISOString()};
  if(receipt.status==='passed'&&command==='install'){manifest.completedBatches=[...new Set([...manifest.completedBatches,batch])].sort();}else if(command==='install'){manifest.completedBatches=manifest.completedBatches.filter(x=>x!==batch);}manifest.remainingBatches=[1,2,3,4,5].filter(x=>!manifest.completedBatches.includes(x));
  manifest.lastRun={command,batch,status:receipt.status,receipt:directory+'/receipt.json',at:new Date().toISOString()};save();
 }catch(e){receipt.status='failed';receipt.errors.push({message:e.message});}finally{receipt.finishedAt=new Date().toISOString();atomic(directory+'/receipt.json',receipt);await db.$disconnect();lease.release();console.log(JSON.stringify({status:receipt.status,batch,changes:receipt.changes.length,errors:receipt.errors.length,receipt:directory+'/receipt.json'}));if(receipt.status!=='passed')process.exitCode=1;}}
 const h=await api('/health',undefined);assert.equal(h.database.name,manifest.database);const actual=await db.$queryRaw`SELECT current_database() AS name`;assert.equal(actual[0].name,manifest.database);mark('Exact isolated runtime and database verified');
 return {...c,config,db,Prisma,receipt,directory,manifest,save,mark,api,row,ensure,transition,actor,id,ref,native,groups,finish};
};
