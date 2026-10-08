import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSyntheticPopulationProfile } from '../src/common/synthetic-population-profile';
const previous={...process.env}, cwd=process.cwd(), base=mkdtempSync(join(tmpdir(),'dgop-population-'));
try {
 const root=join(base,'source'), folder=join(base,'population'); mkdirSync(root);mkdirSync(folder);
 process.chdir(root); const file=join(folder,'manifest.json');
 process.env.DGOP_SYNTHETIC_POPULATION_MANIFEST=file;process.env.NODE_ENV='development';process.env.DGOP_PROFILE='access-sync-test';
 process.env.DATABASE_URL='postgresql://example:example@127.0.0.1:55436/dgop_access_sync_qa_20261007';process.env.DB_NAME='dgop_access_sync_qa_20261007';
 const manifest={fixtureVersion:'dgop-finance-hr-demo-v1',demoOnly:true,isComplianceProof:false,database:process.env.DB_NAME,profile:'access-sync-test',root};
 writeFileSync(file,JSON.stringify(manifest));assert.equal(isSyntheticPopulationProfile(),true);
 for(const [key,value] of Object.entries({NODE_ENV:'production',DGOP_PROFILE:'default',DB_NAME:'dgop_dev',DATABASE_URL:'postgresql://example:example@localhost:55436/dgop_dev'})){
  const saved=process.env[key];process.env[key]=value;assert.equal(isSyntheticPopulationProfile(),false,key);process.env[key]=saved;
 }
 writeFileSync(file,JSON.stringify({...manifest,isComplianceProof:true}));assert.equal(isSyntheticPopulationProfile(),false);
 delete process.env.DGOP_SYNTHETIC_POPULATION_MANIFEST;assert.equal(isSyntheticPopulationProfile(),false);
 console.log('PASS exact synthetic population guard, mismatched database/profile and operational fallback');
} finally {process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);rmSync(base,{recursive:true,force:true});}
