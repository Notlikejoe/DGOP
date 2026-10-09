const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const root='C:/Users/Youss/OneDrive/Documents/DGOP',state='C:/Users/Youss/Documents/Codex/work/dgop-manual-access-20261007',base='http://localhost:4206';
const req=createRequire(path.join(root,'apps/api/package.json')),env=req('dotenv').parse(fs.readFileSync(path.join(root,'.env'))),url=new URL(env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='55436')throw Error('Expected original local DGOP database on 55436');
const {PrismaClient}=req('@prisma/client'),db=new PrismaClient({datasources:{db:{url:url.href}}});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
function privateStorage(){fs.mkdirSync(path.join(state,'private'),{recursive:true});fs.writeFileSync(path.join(state,'private/.gitignore'),'*\n');}
async function login(email,password){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',Origin:base,'x-dgop-csrf':'same-origin'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(12000)});const cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');return{status:r.status,cookie};}
async function api(cookie,method,route,body){const r=await fetch(base+'/api'+route,{method,headers:{cookie,Origin:base,'x-dgop-csrf':'same-origin',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});let data;try{data=await r.json();}catch{data=null;}return{status:r.status,data};}
module.exports={fs,path,crypto,req,root,state,base,env,url,db,hash,atomic,privateStorage,login,api};
