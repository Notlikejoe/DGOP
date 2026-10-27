'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {inside}=require('./codec.cjs');

/** Rebind a newly restored snapshot to a dedicated local source checkout. Never seeds or resets a database. */
function configure(source,files,database,env=process.env){
  assert(/^(?:127\.0\.0\.1|localhost)$/.test(env.PGHOST??''),'Use a loopback PGHOST');
  assert(!env.PGHOSTADDR&&!env.PGSERVICE&&!env.PGSERVICEFILE,'Unset indirect PostgreSQL connection overrides');
  assert(/^dgop_ai_preview_\d{8,30}$/.test(database),'Choose a new managed dgop_ai_preview_<digits> database');
  assert(env.PGUSER&&env.PGPASSWORD,'Set the local PostgreSQL credentials privately');
  const port=Number(env.PGPORT??5432);assert(Number.isInteger(port)&&port>0&&port<65536,'Invalid PostgreSQL port');
  source=fs.realpathSync(source);files=fs.realpathSync(files);
  assert(fs.existsSync(path.join(source,'apps/api/prisma/schema.prisma')),'Source checkout is missing');
  const state=path.dirname(source),population=path.join(state,'population'),profiles=path.join(state,'profiles'),privateDir=path.join(state,'private');
  for(const destination of [population,profiles,privateDir])assert(!fs.existsSync(destination),'Use a fresh state directory; existing configuration is never overwritten');
  const read=name=>JSON.parse(fs.readFileSync(inside(files,name),'utf8'));
  const manifest=read('population/manifest.json'),profile=read('profiles/installation.json'),keys=read('configuration/preserved-keys.json');
  assert(manifest.fixtureVersion==='dgop-finance-hr-demo-v1'&&manifest.demoOnly===true&&manifest.isComplianceProof===false,'Unsupported synthetic profile');
  assert(profile.profileVersion===1&&profile.demoOnly===true,'Unsupported managed profile');
  for(const k of ['DGOP_SEARCH_QUERY_KEY','DGOP_BPMN_SIGNING_SECRET'])assert(typeof keys[k]==='string'&&keys[k].length>=32,'Missing preserved application key');
  const originalSources=inside(files,'population/sources');assert(fs.existsSync(path.join(originalSources,'manifest.json')),'Source workbooks are missing');
  const toCopy=[];
  function inspect(dir,prefix=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){assert(!entry.isSymbolicLink(),'Unexpected source symlink');const name=prefix+entry.name,file=path.join(dir,entry.name);if(entry.isDirectory())inspect(file,name+'/');else {assert(entry.isFile(),'Unexpected source file');toCopy.push({file,name});}}}
  inspect(originalSources);
  const url=new URL('postgresql://127.0.0.1');url.hostname=env.PGHOST;url.port=String(port);url.username=env.PGUSER;url.password=env.PGPASSWORD;url.pathname='/'+database;
  const installationId=crypto.randomUUID(),profileFile=path.join(profiles,'installation.json'),envFile=path.join(privateDir,'runtime.env');
  const configuration={NODE_ENV:'development',HOST:'127.0.0.1',DGOP_BIND_HOST:'127.0.0.1',PORT:'3012',PUBLIC_ORIGIN:'http://localhost:4212',CORS_ORIGINS:'http://localhost:4212',DATABASE_URL:url.href,DB_NAME:database,JWT_SECRET:crypto.randomBytes(48).toString('base64url'),JWT_EXPIRES_IN:'8h',DGOP_SEARCH_QUERY_KEY:keys.DGOP_SEARCH_QUERY_KEY,DGOP_BPMN_SIGNING_SECRET:keys.DGOP_BPMN_SIGNING_SECRET,DGOP_ENV_FILE:envFile,DGOP_DEMO:'true',DGOP_PROFILE:'main-preview',DGOP_DEMO_ROOT:state,DGOP_DEMO_PROFILE_FILE:profileFile,DGOP_DEMO_INSTALLATION_ID:installationId,DGOP_SYNTHETIC_POPULATION_MANIFEST:path.join(population,'manifest.json'),AI_MIGRATION_SOURCE_DIR:path.join(population,'sources'),AI_MIGRATION_SOURCE_MANIFEST:path.join(population,'sources/manifest.json'),STORAGE_DIR:files,EVIDENCE_STORAGE_DIR:path.join(files,'evidence'),WORKFLOW_ATTACHMENT_STORAGE_DIR:path.join(files,'attachments'),DGOP_AUDIT_FAIL_CLOSED:'true',DGOP_NOTIFICATION_EXTERNAL_DELIVERY:'false',GOVERNANCE_OPERATIONS_SCHEDULER:'false',WORKFLOW_EXECUTION_SCHEDULER:'false',DGOP_DEMO_ADAPTERS:'false',DGOP_DEMO_ADAPTER_SCHEDULER:'false',DGOP_WORKFLOW_STARTUP_MAINTENANCE:'false',DGOP_INTEGRATION_STARTUP_MAINTENANCE:'false',DGOP_SAMPLE_LABELS:'business'};
  fs.mkdirSync(population);fs.mkdirSync(profiles);fs.mkdirSync(privateDir,{mode:0o700});
  for(const {file,name}of toCopy){const destination=inside(path.join(population,'sources'),name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination,fs.constants.COPYFILE_EXCL);}
  fs.writeFileSync(path.join(population,'manifest.json'),JSON.stringify({...manifest,database,root:source,profile:'main-preview',base:'http://localhost:4212'},null,2)+'\n',{flag:'wx',mode:0o600});
  fs.writeFileSync(profileFile,JSON.stringify({...profile,database,installationRoot:state,installationId,bindHost:'127.0.0.1'},null,2)+'\n',{flag:'wx',mode:0o600});
  fs.writeFileSync(envFile,Object.entries(configuration).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{flag:'wx',mode:0o600});
  return{environmentFile:envFile,source,database,syntheticProfilePreserved:true,externalDelivery:'disabled'};
}
module.exports={configure};
if(require.main===module){try{const[source,files,database]=process.argv.slice(2);assert(source&&files&&database,'Usage: node configure-4212.cjs SOURCE_CHECKOUT RESTORED_FILES dgop_ai_preview_DIGITS');console.log(JSON.stringify(configure(source,files,database)));}catch(error){console.error(error.message);process.exitCode=1;}}
