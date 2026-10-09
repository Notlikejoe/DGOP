const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const state='C:/Users/Youss/Documents/Codex/work/dgop-access-sync',root=state+'/source',base='http://localhost:4208';
const checkpoint=JSON.parse(fs.readFileSync(state+'/checkpoint.json')),profileCheckpoint=JSON.parse(fs.readFileSync('C:/Users/Youss/Documents/Codex/work/dgop-manual-access-20261007/checkpoint.json'));
const req=createRequire(root+'/apps/api/package.json'),config=JSON.parse(fs.readFileSync(state+'/private/database.json')),url=new URL(config.url);
if(url.hostname!=='127.0.0.1'||url.port!=='55436'||url.pathname!=='/dgop_access_sync_qa_20261007'||config.profile!=='access-sync-test')throw Error('Isolated access acceptance database guard failed');
const {PrismaClient}=req('@prisma/client'),db=new PrismaClient({datasources:{db:{url:url.href}}});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
const credentials=JSON.parse(fs.readFileSync(checkpoint.credentialRef));
async function login(email,password){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',Origin:base,'x-dgop-csrf':'same-origin'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(12000)});const cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');return{status:r.status,cookie};}
async function api(cookie,method,route,body){const r=await fetch(base+'/api'+route,{method,headers:{cookie,Origin:base,'x-dgop-csrf':'same-origin',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});let data;try{data=await r.json();}catch{data=null;}return{status:r.status,data};}
module.exports={fs,path,crypto,req,root,state,base,url,db,hash,atomic,login,api,checkpoint,profileCheckpoint,credentials};
