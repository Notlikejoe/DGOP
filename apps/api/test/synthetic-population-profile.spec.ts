import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSyntheticPopulationProfile } from '../src/common/synthetic-population-profile';
import { migrationSources, AI_RECONCILED_POPULATION_SOURCES as AI_POPULATION_MIGRATION_SOURCES } from '../src/ai-governance/ai-migration-sources';
import { parseMigrationWorkbook, AI_MIGRATION_SOURCES } from '../src/ai-governance/ai-migration-workbook';
const previous={...process.env}, cwd=process.cwd(), base=mkdtempSync(join(tmpdir(),'dgop-population-'));
try {
 const root=join(base,'source'), folder=join(base,'population'); mkdirSync(root);mkdirSync(folder);
 process.chdir(root); const file=join(folder,'manifest.json');
 process.env.DGOP_SYNTHETIC_POPULATION_MANIFEST=file;process.env.NODE_ENV='development';process.env.DGOP_PROFILE='access-sync-test';
 process.env.DATABASE_URL='postgresql://example:example@127.0.0.1:55436/dgop_access_sync_qa_20261007';process.env.DB_NAME='dgop_access_sync_qa_20261007';
 const manifest={fixtureVersion:'dgop-finance-hr-demo-v1',demoOnly:true,isComplianceProof:false,database:process.env.DB_NAME,profile:'access-sync-test',root};
 writeFileSync(file,JSON.stringify(manifest));assert.equal(isSyntheticPopulationProfile(),true);
 const sources=join(folder,'sources');mkdirSync(sources);process.env.AI_MIGRATION_SOURCE_DIR=sources;process.env.AI_MIGRATION_SOURCE_MANIFEST=join(sources,'manifest.json');
 const sourceManifest={manifestVersion:1,fixtureVersion:'synthetic-sources-v5',demoOnly:true,sourceMode:'synthetic_demo',productionReady:false,sources:AI_POPULATION_MIGRATION_SOURCES};
 writeFileSync(process.env.AI_MIGRATION_SOURCE_MANIFEST,JSON.stringify(sourceManifest));assert.deepEqual(migrationSources().sources,AI_POPULATION_MIGRATION_SOURCES);
 const book=parseMigrationWorkbook(readFileSync(join(__dirname,'../../../scripts/data/demo-sources-v5/demo-risk-v5.xlsx')),'risk',AI_POPULATION_MIGRATION_SOURCES[0].sha256);
 assert(book.sheets.some(s=>Object.values(s.cells).some(c=>c.value==='AI-900001')));
 assert(book.sheets.every(s=>Object.values(s.cells).every(c=>c.value!=='كارثي')));
 assert(book.sheets.some(s=>Object.entries(s.cells).some(([a,c])=>/^AC\d+$/.test(a)&&c.value===false)));
 writeFileSync(process.env.AI_MIGRATION_SOURCE_MANIFEST,JSON.stringify({...sourceManifest,sources:sourceManifest.sources.map(s=>({...s,sha256:'0'.repeat(64)}))}));assert.throws(()=>migrationSources(),/immutable fixture/);
 delete process.env.AI_MIGRATION_SOURCE_MANIFEST;assert.deepEqual(migrationSources().sources,[...AI_MIGRATION_SOURCES]);
 for(const [key,value] of Object.entries({NODE_ENV:'production',DGOP_PROFILE:'default',DB_NAME:'dgop_dev',DATABASE_URL:'postgresql://example:example@localhost:55436/dgop_dev'})){
  const saved=process.env[key];process.env[key]=value;assert.equal(isSyntheticPopulationProfile(),false,key);process.env[key]=saved;
 }
 writeFileSync(file,JSON.stringify({...manifest,isComplianceProof:true}));assert.equal(isSyntheticPopulationProfile(),false);
 process.env.DGOP_PROFILE='main-preview';process.env.DB_NAME='dgop_ai_preview_20261021';
 process.env.DATABASE_URL='postgresql://example:example@127.0.0.1:55436/'+process.env.DB_NAME;
 process.env.DGOP_DEMO='true';process.env.DGOP_DEMO_ROOT=base;process.env.DGOP_DEMO_INSTALLATION_ID='fixture-main-preview';
 process.env.DGOP_DEMO_PROFILE_FILE=join(base,'demo-profile.json');
 const profile={profileVersion:1,demoOnly:true,database:process.env.DB_NAME,installationId:process.env.DGOP_DEMO_INSTALLATION_ID,installationRoot:base,bindHost:'127.0.0.1'};
 const nextManifest={...manifest,database:process.env.DB_NAME,profile:'main-preview'};
 writeFileSync(process.env.DGOP_DEMO_PROFILE_FILE,JSON.stringify(profile));writeFileSync(file,JSON.stringify(nextManifest));
 assert.equal(isSyntheticPopulationProfile(),true,'Managed main preview retains synthetic fixtures');
 process.env.DGOP_DEMO='false';assert.equal(isSyntheticPopulationProfile(),false);process.env.DGOP_DEMO='true';
 process.env.NODE_ENV='production';assert.equal(isSyntheticPopulationProfile(),false);process.env.NODE_ENV='development';
 writeFileSync(file,JSON.stringify({...nextManifest,root:base}));assert.equal(isSyntheticPopulationProfile(),false);
 writeFileSync(file,JSON.stringify(nextManifest));writeFileSync(process.env.DGOP_DEMO_PROFILE_FILE,JSON.stringify({...profile,database:'dgop_dev'}));assert.equal(isSyntheticPopulationProfile(),false);
 delete process.env.DGOP_SYNTHETIC_POPULATION_MANIFEST;assert.equal(isSyntheticPopulationProfile(),false);
 process.env.NODE_ENV='test';process.env.DATABASE_URL='postgresql://example:example@127.0.0.1:55438/dgop_ai_test_source_guard';process.env.DGOP_AI_TEST_DATABASE_URL=process.env.DATABASE_URL;
 writeFileSync(process.env.DGOP_DEMO_PROFILE_FILE,JSON.stringify({...profile,database:'dgop_ai_test_source_guard'}));
 writeFileSync(join(sources,'manifest.json'),JSON.stringify(sourceManifest));process.env.AI_MIGRATION_SOURCE_MANIFEST=join(sources,'manifest.json');
 assert.equal(migrationSources().sourceMode,'synthetic_demo','Managed engineering fallback must remain usable without the development population profile');
 for(const [key,value]of Object.entries({NODE_ENV:'production',DGOP_DEMO:'false',DGOP_AI_TEST_DATABASE_URL:'postgresql://example:example@127.0.0.1:55438/dgop_ai_test_other',DATABASE_URL:'postgresql://example:example@127.0.0.1:55436/dgop_ai_test_source_guard'})){
  const saved=process.env[key];process.env[key]=value;assert.throws(()=>migrationSources(),/trusted isolated/,key);process.env[key]=saved;
 }
 console.log('PASS exact synthetic population and managed engineering guards, mismatched database/profile and operational fallback');
} finally {process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);rmSync(base,{recursive:true,force:true});}
