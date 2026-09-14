// Local recovery rehearsal only. Creates a fresh restore database; never drops or overwrites one.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(join(root,'apps/api/package.json'));
if(process.argv[2]!=='--isolated-preview')throw new Error('Use --isolated-preview for the guarded recovery rehearsal');
const environment=require('dotenv').parse(readFileSync(join(root,'.env'))),url=new URL(environment.DATABASE_URL??'');
if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!=='55436'||!/^\/dgop_ai_preview_\d+$/.test(url.pathname))throw new Error('Only the isolated local AI preview database is eligible');
const start=Date.now(),stamp=String(start),target='dgop_ai_restore_'+stamp,folder=join(root,'storage/ai-release',stamp);
mkdirSync(folder,{recursive:true});const dump=join(folder,'ai-preview.dump');
if(existsSync(dump))throw new Error('Preserve existing backups');
const pg=process.env.DGOP_TEST_PG_BIN??'C:/Program Files/PostgreSQL/16/bin',env={...process.env,PGPASSWORD:decodeURIComponent(url.password)};
const connection=['-h',url.hostname,'-p',url.port,'-U',decodeURIComponent(url.username)];
function run(name,args){const result=spawnSync(join(pg,name+'.exe'),args,{cwd:root,env,encoding:'utf8',windowsHide:true});if(result.status!==0){let message=String(result.stderr??result.error??name+' failed');for(const secret of [url.password,decodeURIComponent(url.password)].filter(Boolean))message=message.replaceAll(secret,'[REDACTED]');throw new Error(message);}}
const {PrismaClient}=require('@prisma/client'),source=new PrismaClient({datasources:{db:{url:url.href}}});
const restoreUrl=new URL(url);restoreUrl.pathname='/'+target;const restored=new PrismaClient({datasources:{db:{url:restoreUrl.href}}});
async function fingerprint(db){
 const tables=await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"),result={};
 for(const {tablename} of tables){if(!/^[a-z0-9_]+$/.test(tablename))throw new Error('Unexpected table identifier');
  const rows=await db.$queryRawUnsafe('SELECT to_jsonb(t) AS row FROM "'+tablename+'" t');
  const canonical=rows.map(r=>JSON.stringify(r.row)).sort();result[tablename]={rows:rows.length,sha256:createHash('sha256').update(JSON.stringify(canonical)).digest('hex')};
 }
 return result;
}
try{
 const before=await fingerprint(source);
 run('pg_dump',[...connection,'-d',url.pathname.slice(1),'-Fc','--file',dump]);
 run('createdb',[...connection,target]);
 run('pg_restore',[...connection,'-d',target,'--no-owner','--no-privileges','--exit-on-error',dump]);
 const recovered=await fingerprint(restored),after=await fingerprint(source);
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Source changed during rehearsal; keep backup and restore database, repeat after pausing only preview writers');
 if(JSON.stringify(before)!==JSON.stringify(recovered))throw new Error('Restored table fingerprints differ');
 const proof={checkedAt:new Date().toISOString(),source:url.pathname.slice(1),restoredDatabase:target,backupPath:dump,tables:Object.keys(before).length,
  allTableRowsAndFingerprintsMatch:true,sourceUnchanged:true,elapsedSeconds:Math.round((Date.now()-start)/1000),originalDatabaseUntouched:true,
  certification:false,rtoEvidence:'Observed recovery time for this local demonstration only',rpoEvidence:'Snapshot recovery verified; continuous WAL/PITR and production RPO are not certified'};
 writeFileSync(join(folder,'restore-verification.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{await Promise.all([source.$disconnect(),restored.$disconnect()]);}
