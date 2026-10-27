'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{parseEnv}=require('node:util'),crypto=require('node:crypto'),{configure}=require('./configure-4212.cjs');
const env={PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'local_operator',PGPASSWORD:'test-only-operator-password'};
test('configuration refuses remote, indirect and ordinary database targets before file writes',()=>{
  assert.throws(()=>configure('missing','missing','dgop_ai_preview_20261027',{...env,PGHOST:'remote.example'}),/loopback/);
  assert.throws(()=>configure('missing','missing','dgop_ai_preview_20261027',{...env,PGHOSTADDR:'remote.example'}),/indirect/);
  for(const name of ['dgop_dev','dgop_restore_example','dgop_ai_preview_'])assert.throws(()=>configure('missing','missing',name,env),/new managed/);
});
test('fresh configuration rebinds the archived profile without overwriting or rotating business accounts',()=>{
  const state=fs.mkdtempSync(path.join(os.tmpdir(),'dgop-configure-')),source=path.join(state,'source'),files=path.join(state,'restored-files');
  const write=(root,name,data)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof data==='string'?data:JSON.stringify(data));};
  const keys={DGOP_SEARCH_QUERY_KEY:crypto.randomBytes(32).toString('hex'),DGOP_BPMN_SIGNING_SECRET:crypto.randomBytes(32).toString('hex')};
  try{
    write(source,'apps/api/prisma/schema.prisma','// source identity marker');
    write(files,'population/manifest.json',{fixtureVersion:'dgop-finance-hr-demo-v1',demoOnly:true,isComplianceProof:false,database:'original',root:'original',profile:'main-preview'});
    write(files,'population/sources/manifest.json',{fixtureVersion:'synthetic-sources-v5',sourceMode:'synthetic_demo',demoOnly:true});
    write(files,'profiles/installation.json',{profileVersion:1,demoOnly:true,database:'original',installationId:'original-profile'});
    write(files,'configuration/preserved-keys.json',keys);
    const result=configure(source,files,'dgop_ai_preview_202610270001',env),configured=parseEnv(fs.readFileSync(result.environmentFile,'utf8'));
    assert.equal(configured.DB_NAME,'dgop_ai_preview_202610270001');assert.equal(new URL(configured.DATABASE_URL).password,env.PGPASSWORD);
    assert.equal(configured.DGOP_BPMN_SIGNING_SECRET,keys.DGOP_BPMN_SIGNING_SECRET);assert.equal(configured.DGOP_SEARCH_QUERY_KEY,keys.DGOP_SEARCH_QUERY_KEY);
    assert.equal(configured.DGOP_NOTIFICATION_EXTERNAL_DELIVERY,'false');assert.equal(configured.DGOP_DEMO_ADAPTERS,'false');assert(!('SEED_ADMIN_PASSWORD' in configured));
    const manifest=JSON.parse(fs.readFileSync(path.join(state,'population/manifest.json'),'utf8'));assert.equal(manifest.demoOnly,true);assert.equal(manifest.isComplianceProof,false);assert.equal(manifest.root,source);
    const before=fs.readFileSync(result.environmentFile,'utf8');assert.throws(()=>configure(source,files,'dgop_ai_preview_202610270001',env),/never overwritten/);assert.equal(fs.readFileSync(result.environmentFile,'utf8'),before);
  }finally{fs.rmSync(state,{recursive:true,force:true});}
});
