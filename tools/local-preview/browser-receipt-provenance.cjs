const fs=require('node:fs'),path=require('node:path');
const {root}=require('./verification-binding.cjs');
const browserRoot=path.join(root,'storage/qa-native/dgop_ai_test_governance_1791135970271/browser-qa');
function browserReceipt(row,{browserRoot:ownedRoot=browserRoot}={}){
 const errors=[];let metadata,item,ui;
 try{
  metadata=JSON.parse(fs.readFileSync(path.join(ownedRoot,row.label+'.json'),'utf8'));
  if(typeof metadata.evaluatedAt!=='string'||metadata.evaluatedAt<row.startedAt||metadata.evaluatedAt>row.finishedAt)errors.push('Metadata outside the current execution interval');
  if(metadata.outcomes.length!==1)errors.push('Incomplete persona metadata');
  item=metadata.outcomes[0];if(item.persona!==row.detail?.persona)errors.push('Persona mismatch');if(item.functionalPassed!==true)errors.push('Metadata has no functional pass');
  if(!path.resolve(item.receipt).startsWith(path.resolve(ownedRoot)+path.sep))throw Error('Receipt outside owned browser evidence');
  ui=JSON.parse(fs.readFileSync(item.receipt,'utf8'));
  if(typeof ui.evaluatedAt!=='string'||ui.evaluatedAt<row.startedAt||ui.evaluatedAt>row.finishedAt)errors.push('UI receipt outside the current execution interval');
  if(ui.matrix!==true||ui.functionalPassed!==true||!(ui.checks>0)||ui.checks!==row.detail?.checks)errors.push('Incomplete functional matrix');
  for(const name of ['consoleErrors','failedResponses','functionalBadChecks'])if(!Array.isArray(ui[name])||ui[name].length)errors.push(name+' not empty');
  if(ui.navigationP95Ms!==row.detail?.navigationP95Ms||!(ui.navigationP95Ms<=3000))errors.push('Navigation receipt/budget mismatch');
  if(ui.browserVersion!==row.detail?.browserVersion)errors.push('Browser version mismatch');
  if(ui.licensedAcceptancePassed!==row.detail?.licensedAcceptancePassed)errors.push('License receipt mismatch');
 }catch(error){errors.push(error.message);}
 return {accepted:errors.length===0,errors,metadata,item,ui};
}
module.exports={browserReceipt};
if(require.main===module){
 const {binding}=require('./verification-binding.cjs'),folder=path.join(__dirname,'functional-verification-20261004'),current=binding();
 const rows=['browser-0','browser-1','browser-recheck','browser-recheck-ethics'].filter(group=>fs.existsSync(path.join(folder,group+'-results.json'))).flatMap(group=>JSON.parse(fs.readFileSync(path.join(folder,group+'-results.json'),'utf8')));
 const audit={evaluatedAt:new Date().toISOString(),binding:current,acceptanceReceipt:false,rows:rows.map(row=>{const proof=browserReceipt(row);return {label:row.label,persona:row.detail?.persona,accepted:proof.accepted,errors:proof.errors,startedAt:row.startedAt,finishedAt:row.finishedAt,metadataEvaluatedAt:proof.metadata?.evaluatedAt,uiEvaluatedAt:proof.ui?.evaluatedAt};})};
 fs.writeFileSync(path.join(folder,'browser-receipt-provenance-audit.json'),JSON.stringify(audit,null,2)+'\n');
 console.log(JSON.stringify({checked:audit.rows.length,rejected:audit.rows.filter(row=>!row.accepted)}));
}
