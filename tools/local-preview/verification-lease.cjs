const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');

function acquireVerificationLease({purpose,folder=__dirname}){
 const file=path.join(folder,'verification-execution.lock');
 const owner={id:randomUUID(),pid:process.pid,purpose,startedAt:new Date().toISOString()};
 let fd;
 try{fd=fs.openSync(file,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  let held;try{held=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  throw Error('Verification is already reserved'+(held?' by PID '+held.pid+' ('+held.purpose+')':'')+'. Finish that job before another build/check. Inspect the owned process before clearing a stale lease: '+file);
 }
 try{fs.writeFileSync(fd,JSON.stringify(owner)+'\n');}finally{fs.closeSync(fd);}
 let released=false;
 const release=()=>{
  if(released)return;
  try{const current=JSON.parse(fs.readFileSync(file,'utf8'));if(current.id===owner.id&&current.pid===owner.pid)fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')return;}
  released=true;
 };
 process.once('exit',release);
 return {owner,release};
}
module.exports={acquireVerificationLease};
