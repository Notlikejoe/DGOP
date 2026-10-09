const fs=require('node:fs');
let text=fs.readFileSync(__dirname+'/access-sync-profiles-browser.cjs','utf8');
text=text.replace("purpose:'Access sync Batch 3 eight-profile browser verification'","purpose:'Population acceptance eight-profile browser verification'")
.replace("folder=c.state+'/evidence/'+stamp+'-profiles'","folder=c.state+'/population/runs/'+stamp+'-profiles'")
.replace('assert.deepEqual(result.binding,c.checkpoint.candidateIdentity)','assert.deepEqual(result.binding,JSON.parse(c.fs.readFileSync(c.state+\'/population/manifest.json\')).populationIdentity)')
.replace('observations:result.observations}));','unexpected:result.observations.filter(o=>[\'pageerror\',\'consoleerror\',\'http\'].includes(o.kind))}));');
fs.writeFileSync(__dirname+'/population-profiles-browser.cjs',text);
