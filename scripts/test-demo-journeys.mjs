// Fresh, native write journeys per repetition; never substitutes read-only assertion loops.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {atomicJson} from './demo-profile.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
assert.match(process.versions.node,/^24\.19\./);
const countIndex=process.argv.indexOf('--count'),required=countIndex<0?10:Number(process.argv[countIndex+1]);
assert.ok(Number.isInteger(required)&&required>=1&&required<=10,'Choose one to ten engineering repetitions; release requires ten');
const url=new URL(process.env.DGOP_AI_TEST_DATABASE_URL??'');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55438');assert.match(url.pathname,/^\/dgop_ai_test_[a-z0-9_]+$/);
const folder=join(root,'storage/qa-repetitions',randomUUID());mkdirSync(folder,{recursive:true});
mkdirSync(join(root,'storage/qa-native'),{recursive:true});
const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.DGOP_ENV_FILE;
const outcomes=[],report=()=>atomicJson(join(folder,'report.json'),{qaOnly:true,demoOnly:true,isLicensedDemoAcceptance:false,updatedAt:new Date().toISOString(),requiredRepetitions:10,requestedRepetitions:required,completedRepetitions:outcomes.length,tenNativeRepetitionsPassed:outcomes.length===10,outcomes});
report();
for(let repetition=1;repetition<=required;repetition++){
 const began=Date.now(),before=new Set(readdirSync(join(root,'storage/qa-native')));
 console.log('Starting fresh native governance journey repetition '+repetition+' of '+required);
 const result=spawnSync(process.execPath,[join(root,'scripts/test-demo-native.mjs')],{cwd:root,env,stdio:'inherit',windowsHide:true});
 if(result.error||result.status!==0){report();throw new Error('Native journey repetition failed; preserve its database, logs and atomic checkpoints.');}
 const created=readdirSync(join(root,'storage/qa-native')).filter(name=>!before.has(name));
 assert.equal(created.length,1,'Each repetition must own one separately created test database');
 const receipt=JSON.parse(readFileSync(join(root,'storage/qa-native',created[0],'engineering-verification.json'),'utf8'));
 assert.equal(receipt.nativeFixturesPassed,true);assert.equal(receipt.completedSetupReplayPreservedIdentities,true);
 outcomes.push({repetition,database:created[0],nativeWritesPassed:true,setupReplayPassed:true,durationMs:Date.now()-began});report();
}
console.log(outcomes.length+' fresh native governance repetitions passed. Licensed browser, soak and presentation approval remain separate gates.');
