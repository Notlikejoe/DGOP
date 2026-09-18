// Installs the retained SDAIA workbook risk library into an isolated local DGOP preview.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
Object.assign(process.env,parseEnv(readFileSync(resolve(root,'.env'),'utf8')));
const connection=new URL(process.env.DATABASE_URL);
if(process.argv[2]!=='--local-demo'||connection.hostname!=='127.0.0.1'||connection.port!=='55436'||!/^\/dgop_ai_preview_\d+$/.test(connection.pathname)||process.env.NODE_ENV!=='development')throw Error('Explicit isolated local preview required; original database is prohibited');

const source=JSON.parse(readFileSync(resolve(root,'scripts/data/sdaia-ai-risk-library.json'),'utf8'));
if(source.schemaVersion!==1||source.rows?.length!==66||source.rows[0]?.libraryRef!=='AIRL-001'||source.rows.at(-1)?.libraryRef!=='AIRL-066')throw Error('The retained SDAIA risk-library dataset is incomplete');
if(new Set(source.rows.map(row=>row.libraryRef)).size!==source.rows.length)throw Error('The retained SDAIA risk-library identifiers are not unique');

const require=createRequire(resolve(root,'apps/api/package.json'));
const {NestFactory}=require('@nestjs/core'),{AppModule}=require(resolve(root,'apps/api/dist/app.module.js'));
const load=(name,klass)=>require(resolve(root,'apps/api/dist',name+'.js'))[klass];
const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
const db=app.get(load('prisma/prisma.service','PrismaService'));
const publications=app.get(load('master-data/ai-reference-publication.service','AiReferencePublicationService'));
const library=app.get(load('ai-governance/ai-risk-library.service','AiRiskLibraryService'));
const manifestPath=resolve(root,'storage/ai-preview/demo-manifest.json');
const manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
if(!manifest||manifest.demoOnly!==true||manifest.database!==connection.pathname.slice(1))throw Error('Run the local AI demonstration installer before importing its risk library');
for(const actor of ['officer','ethics','custodian'])if(!manifest.actors?.[actor])throw Error(`Local demonstration actor is missing: ${actor}`);
if(!manifest.evidenceId)throw Error('Local demonstration evidence is missing');

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
const equal=(left,right)=>JSON.stringify(stable(left))===JSON.stringify(stable(right));
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(stable(value))).digest('hex');
const reason=`Reviewed local import of ${source.source.workbook}, ${source.source.sheet} rows ${source.source.rows}; source language is Arabic and titleEn retains the source title because the workbook has no English title column`;
const evidenceIds=[manifest.evidenceId];
const sourceLocator=`retained-workbook:${source.source.workbook}#${source.source.sheet}!${source.source.rows}`;
const regulatory=new Set(['R_RISKCAT','R_ETHICS']);

async function ensureReference(listCode,requiredValues){
 const current=await db.governedReferenceVersion.findFirst({where:{listCode,state:'published'},include:{values:{orderBy:{sortOrder:'asc'}}}});
 if(!current)throw Error(`Published ${listCode} is required before importing the risk library`);
 const currentByCode=new Map(current.values.map(value=>[value.code,value]));
 const ready=requiredValues.every(value=>{const old=currentByCode.get(value.code);return old&&old.labelEn===value.labelEn&&old.labelAr===value.labelAr;});
 if(ready){manifest.references[listCode]=current.id;return current.id;}
 const merged=current.values.map(value=>({code:value.code,labelEn:value.labelEn,labelAr:value.labelAr,metadata:value.metadata??{}}));
 for(const value of requiredValues){const index=merged.findIndex(old=>old.code===value.code);if(index>=0)merged[index]=value;else merged.push(value);}
 const proposal=await publications.propose(manifest.actors.officer,listCode,{nameEn:`${listCode} — SDAIA risk library`,nameAr:`${listCode} — مكتبة مخاطر سدايا`,justification:reason,sourceSha256:source.source.sha256,sourceLocator,values:merged.map((value,sortOrder)=>({...value,sortOrder}))});
 if(regulatory.has(listCode))await publications.approve(manifest.actors.ethics,proposal.id,reason);
 const published=await publications.publish(manifest.actors.custodian,proposal.id,reason);
 manifest.references[listCode]=published.id;
 return published.id;
}

try{
 for(const [listCode,values] of Object.entries(source.references))await ensureReference(listCode,values);
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
 let created=0,updated=0,published=0,unchanged=0;
 for(const row of source.rows){
  const entry=await db.aiRiskLibraryEntry.findUnique({where:{libraryRef:row.libraryRef},include:{versions:{include:{publication:true},orderBy:{round:'desc'}}}});
  const latest=entry?.versions[0];
  if(latest?.publication&&equal(latest.content,row.content)){unchanged++;continue;}
  let versionId;
  if(latest&&!latest.publication&&equal(latest.content,row.content))versionId=latest.id;
  else if(!entry){
   const proposal=await db.$transaction(tx=>library.sourceProposal(tx,manifest.actors.officer,row.libraryRef,row.content,reason,evidenceIds));
   versionId=proposal.id;created++;
  }else{
   const proposal=await library.propose(manifest.actors.officer,{entryId:entry.id,expectedRound:latest?.round??0,content:row.content,justification:reason,evidenceIds});
   versionId=proposal.versionId;updated++;
  }
  await library.publish(manifest.actors.custodian,versionId,reason,evidenceIds);published++;
 }
 const installed=await db.aiRiskLibraryEntry.count({where:{libraryRef:{in:source.rows.map(row=>row.libraryRef)},versions:{some:{publication:{isNot:null}}}}});
 if(installed!==source.rows.length)throw Error(`Published risk-library count differs: expected ${source.rows.length}, found ${installed}`);
 console.log(JSON.stringify({sourceSha256:source.source.sha256,sourceRows:source.rows.length,installed,created,updated,published,unchanged,referenceDigest:digest(source.references)}));
}finally{await app.close();}
