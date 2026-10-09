const fs=require('node:fs');
let code=fs.readFileSync(__dirname+'/check-manual-access-browser.cjs','utf8');
code=code.replace("require('./manual-access-common.cjs')","require('./access-sync-common.cjs')")
 .replace("purpose:'4206 focused manual profile browser verification'","purpose:'Access sync Batch 3 eight-profile browser verification'")
 .replace("const cp=JSON.parse(c.fs.readFileSync(c.state+'/checkpoint.json')),credentials=JSON.parse(c.fs.readFileSync(c.state+'/private/credentials.json'));","const cp=c.profileCheckpoint,credentials=c.credentials;")
 .replace("folder=c.state+'/browser-'+stamp","folder=c.state+'/evidence/'+stamp+'-profiles'")
 .replace("result={startedAt:","result={batch:3,group:'profiles',startedAt:")
 .replace("assert.deepEqual(result.binding,cp.after.binding)","assert.deepEqual(result.binding,c.checkpoint.candidateIdentity)")
 .replace("page.url().includes('/unauthorized')","new URL(page.url()).pathname==='/about'")
 .replace(" page.on('pageerror'", " page.on('console',m=>{if(m.type()==='error')result.observations.push({at:new Date().toISOString(),key:activeKey,route,kind:'consoleerror',message:m.text()});});\n page.on('pageerror'")
 .replace(" result.finishedAt=new Date().toISOString();result.counts=", " await check('all','No unexpected browser, console or HTTP errors',async()=>{const bad=result.observations.filter(o=>['pageerror','consoleerror','http'].includes(o.kind));assert.deepEqual(bad,[]);return{profiles:result.profiles.length};});\n result.finishedAt=new Date().toISOString();result.counts=")
 .replace("result.failure=e.message;result.finishedAt", "result.status='failed';result.failure=e.message;result.finishedAt");
fs.writeFileSync(__dirname+'/access-sync-profiles-browser.cjs',code);
console.log('Adapted existing profile browser runner for frozen isolated 4208 acceptance');
