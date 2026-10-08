import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isOperationalEvidence, operationalEvidenceExclusion, operationalEvidenceWhere } from '../src/evidence/evidence-status';
import { EvidenceService } from '../src/evidence/evidence.service';
import { ScoringService } from '../src/scoring/scoring.service';

async function main() {
 const now=new Date('2026-10-03T12:00:00Z'), valid={status:'approved',expiryDate:null,provenance:'operational'};
 assert.equal(isOperationalEvidence(valid,now),true);
 assert.equal(operationalEvidenceExclusion({...valid,expiryDate:now},now),'expired');
 assert.equal(operationalEvidenceExclusion({...valid,deletedAt:now},now),'deleted');
 assert.equal(operationalEvidenceExclusion({...valid,status:'submitted'},now),'not_approved');
 for(const provenance of ['seeded_uat','unknown',undefined])assert.equal(operationalEvidenceExclusion({...valid,provenance},now),'synthetic_or_unknown_provenance');
 assert.deepEqual(operationalEvidenceWhere(now).OR,[{expiryDate:null},{expiryDate:{gt:now}}]);
 const saved={...process.env};
 const directory=mkdtempSync(join(tmpdir(),'dgop-score-profile-')),databaseUrl='postgresql://fixture@127.0.0.1:55438/dgop_ai_test_scoring';
 try {
  const domain={id:'d1',code:'data_quality',nameEn:'Quality',nameAr:'الجودة',shortCode:'DQ'};
  const spec={id:'s1',code:'SYNTHETIC',nameEn:'Synthetic',nameAr:'اصطناعي',type:'control',maturityLevel:'level_2',ownerPersonId:'p1',domainId:'d1',domain,owner:{fullNameEn:'Fixture',fullNameAr:'مثال'}};
  const queries:unknown[]=[];
  const db:any={ndiSpecification:{findMany:async()=>[spec]},ndiDomain:{findMany:async()=>[domain]},ndiEvidence:{
   count:async()=>1,
   findMany:async(args:any)=>{queries.push(args.where);return args.where.provenance==='seeded_uat'?[{specId:'s1',status:'approved',expiryDate:null,provenance:'seeded_uat',submittedAt:now,reviewedAt:now}]:[];},
  }};
  process.env.EVIDENCE_STORAGE_DIR=directory;
  const scoring=new ScoringService(db,new EvidenceService(db,{log:async()=>undefined} as never));
  const actor={id:'u1',email:'fixture@example.test',roles:['dmo_admin']};
  delete process.env.DGOP_DEMO;
  await assert.rejects(()=>scoring.scenarioReadiness(actor),/unavailable/);
  writeFileSync(join(directory,'installation.json'),JSON.stringify({profileVersion:1,demoOnly:true,database:'dgop_ai_test_scoring',installationId:'scoring-fixture-1',installationRoot:directory,bindHost:'127.0.0.1'}));
  Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:databaseUrl,DGOP_AI_TEST_DATABASE_URL:databaseUrl,DGOP_DEMO:'true',DGOP_DEMO_ROOT:directory,DGOP_DEMO_PROFILE_FILE:join(directory,'installation.json'),DGOP_DEMO_INSTALLATION_ID:'scoring-fixture-1',DGOP_DEMO_FIXTURE_VERSION:'fixture-v1'});
  const result=await scoring.scenarioReadiness(actor);
  assert.equal(result.demoOnly,true);assert.equal(result.isComplianceClaim,false);assert.equal(result.fixtureVersion,'fixture-v1');
  assert.equal(result.operational.overall.score,0);assert.equal(result.scenario.overall.score,100);
  assert.equal(result.operational.overall.satisfiedCount,0);assert.equal(result.scenario.overall.satisfiedCount,1);
  assert.equal(result.syntheticEvidenceCount,1);assert.equal(result.scenario.scoringBasis,'demonstration_scenario');
  assert.equal(queries.length,2);
  assert.equal((await scoring.readiness(actor)).overall.score,0,'Scenario evaluation must not promote evidence or change operational scoring');
 } finally {
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
 }
 console.log('Evidence eligibility passed: provenance, deletion, approval, expiry boundary, guarded separate scenario score and unchanged operational readiness.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
