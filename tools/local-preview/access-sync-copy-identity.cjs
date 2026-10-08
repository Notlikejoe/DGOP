const fs=require('node:fs'),path=require('node:path'),{hash,binding}=require('./verification-binding.cjs');
const file='C:/Users/Youss/Documents/Codex/work/dgop-access-sync/checkpoint.json',cp=JSON.parse(fs.readFileSync(file));
fs.copyFileSync(cp.original+'/.env.example',cp.root+'/.env.example');
let files=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','dist','.git','.angular','storage','tmp','coverage','.codex','.agents'].includes(e.name)||(/^\.env(?:\.|$)/.test(e.name)&&e.name!=='.env.example')||/primeui-license\.local\.ts$|tsconfig\.tsbuildinfo$/.test(e.name))continue;
 const a=path.join(dir,e.name),r=path.relative(cp.original,a);
 if(e.isDirectory())walk(a);else {if(hash(fs.readFileSync(a))!==hash(fs.readFileSync(path.join(cp.root,r))))throw Error('Changed file '+r);files++;}
}}
walk(cp.original);
cp.sourceCopyVerifiedAt=new Date().toISOString();cp.copyExclusions=['.codex runtime logs','.agents','environment secrets','license secret','runtime storage','build outputs'];cp.verifiedCopiedFiles=files;cp.copiedSource=binding(cp.root).source;
fs.writeFileSync(file,JSON.stringify(cp,null,2));console.log(JSON.stringify({verifiedFiles:files,source:cp.copiedSource}));
