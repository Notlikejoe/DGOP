const fs=require('node:fs'),path=require('node:path'),{root}=require('./verification-binding.cjs');
const {browserReceipt}=require('./browser-receipt-provenance.cjs');
const folder=path.join(__dirname,'functional-verification-20261004'),read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
// Progress is not acceptance evidence. Full integrity checks remain at runner
// boundaries and report validation; avoid hashing all source/build files per poll.
const current={source:{sha256:read(path.join(__dirname,'stability-delivery-20261004/candidate-manifest.json')).candidate.sourceSha256}};
const soak=read(root+'/storage/qa-native/dgop_ai_test_governance_1791135970271/soak-progress.json');
let browser=[];for(const group of ['browser-0','browser-1']){const file=folder+'/'+group+'-results.json';if(fs.existsSync(file))browser.push(...read(file).filter(row=>row.before.source.sha256===current.source.sha256));}
for(const name of fs.readdirSync(folder).filter(name=>/^browser-recheck(?:-[a-zA-Z]+)?-results\.json$/.test(name))){for(const recheck of read(folder+'/'+name).filter(row=>row.passed&&row.before.source.sha256===current.source.sha256)){const index=browser.findIndex(row=>row.detail?.persona===recheck.detail?.persona);if(index>=0)browser[index]=recheck;}}
const journeys=fs.readdirSync(root+'/storage/qa-repetitions').map(name=>read(root+'/storage/qa-repetitions/'+name+'/report.json')).filter(report=>report.updatedAt>='2026-10-04T18:57:00Z').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
console.log(JSON.stringify({progressOnly:true,liveSourceIntegrityVerified:false,frozenCandidateSourceSha256:current.source.sha256,soakMinutes:Number(soak.elapsedMinutes.toFixed(2)),healthSamples:soak.healthSamples,authenticatedReads:soak.authenticatedReadSamples,failures:soak.failures,recentFailures:soak.recentFailures,browserPersonasChecked:browser.length,browserFunctionallyPassed:browser.filter(row=>row.detail?.functionalPassed&&browserReceipt(row).accepted).length,navigationP95MaxMs:Math.max(0,...browser.map(row=>row.detail?.navigationP95Ms??0)),nativeRepetitionsCompleted:journeys?.completedRepetitions??0}));
