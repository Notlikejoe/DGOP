import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiSourceCorrectionsService } from './ai-source-corrections.service';
import { AiMigrationPreviewService } from './ai-migration-preview.service';
import { AiRiskLibraryService, LIBRARY_LISTS, LIBRARY_TEXT } from './ai-risk-library.service';
import { governanceDigest, governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
import { jsonRecord } from './ai-risk-scoring';
import { PreviewRow } from './ai-migration-preview';
import { reportCsvCell } from './ai-dashboard-reports.service';
export function projectSourceLibrary(row:PreviewRow){
 if(row.kind!=='library'||row.status!=='prepared'||row.sample||row.issues.length||!/^AIRL-\d{3,}$/.test(row.sourceRef))throw new ConflictException('Select prepared nonsample library rows without unresolved issues');
 const content:Record<string,unknown>={};for(const key of LIBRARY_TEXT)content[key]=row.prepared[key];for(const key of Object.keys(LIBRARY_LISTS)){const pin=jsonRecord(row.prepared[key]);if(pin['code'])content[key]=pin['code'];}
 return content;
}
@Injectable()
export class AiLibrarySourceService {
 constructor(private readonly prisma:PrismaService,private readonly corrections:AiSourceCorrectionsService,private readonly previews:AiMigrationPreviewService,private readonly library:AiRiskLibraryService,private readonly audit:AuditService){}
 async propose(userId:string,snapshotId:string,dto:{requestKey:string;rowKeys:string[];expectedDigest:string;justification:string;evidenceIds:string[]}){
  const justification=governanceText(dto.justification);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.requestKey))throw new BadRequestException('Stable source import request UUID required');if(!Array.isArray(dto.rowKeys)||!dto.rowKeys.length||dto.rowKeys.length>66||new Set(dto.rowKeys).size!==dto.rowKeys.length)throw new BadRequestException('Select one to 66 unique source library rows');
  return governanceTransaction(this.prisma,async tx=>{
   const {snapshot}=await this.corrections.approvedSnapshot(tx,userId,snapshotId),evidenceIds=await governanceEvidence(tx,dto.evidenceIds);if(snapshot.digest!==dto.expectedDigest)throw new ConflictException('Corrected source snapshot changed');
   const rowKeys=[...dto.rowKeys].sort(),requestDigest=governanceDigest({userId,snapshotId,rowKeys,justification,evidenceIds,expectedDigest:dto.expectedDigest}),old=await tx.aiLibrarySourceImport.findUnique({where:{requestKey:dto.requestKey},include:{items:true}});
   if(old){if(old.requestDigest!==requestDigest)throw new ConflictException('Source import request key belongs to another proposal');return {...old,created:false};}
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-source-library'),hashtext(${snapshotId}))`;
   const rows=jsonRecord(snapshot.report)['rows'] as PreviewRow[],selected=rowKeys.map(key=>{const row=rows.find(r=>r.key===key);if(!row)throw new BadRequestException('Source library row not found');return {row,content:projectSourceLibrary(row)};});
   if(await tx.aiLibrarySourceItem.count({where:{snapshotId,rowKey:{in:rowKeys}}}))throw new ConflictException('Selected source row already has an immutable target proposal');
   const batch=await tx.aiLibrarySourceImport.create({data:{snapshotId,requestKey:dto.requestKey,requestDigest,rowKeys,createdBy:userId,justification,evidenceIds}});
   for(const {row,content} of selected){const v=await this.library.sourceProposal(tx,userId,row.sourceRef,content,justification,evidenceIds);await tx.aiLibrarySourceItem.create({data:{batchId:batch.id,snapshotId,rowKey:row.key,libraryVersionId:v.id,sourceRef:row.sourceRef,sourceDigest:governanceDigest(row.raw),projectionDigest:governanceDigest(content)}});}
   await this.audit.logRequired({actor:userId,action:'ai.library.source.propose',entityType:'ai_library_source_import',entityId:batch.id,metadata:{snapshotId,rowCount:selected.length,digest:snapshot.digest,justification,evidenceIds,autoPublished:false}},tx);
   return {...batch,items:await tx.aiLibrarySourceItem.findMany({where:{batchId:batch.id}}),created:true};
  });
 }
 private async access(userId:string,snapshotId:string){const s=await this.corrections.snapshot(userId,snapshotId);return this.previews.mappingBase(this.prisma,userId,s.correctionVersion.previewId);}
 async list(userId:string,snapshotId:string,page=1,size=20){if(!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1||size>100)throw new BadRequestException('Use supported source archive pagination');await this.access(userId,snapshotId);const where={snapshotId};return {rows:await this.prisma.aiLibrarySourceImport.findMany({where,include:{items:{include:{version:{include:{publication:true,entry:true}}}}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*size,take:size}),total:await this.prisma.aiLibrarySourceImport.count({where}),page,pageSize:size};}
 async reconcile(userId:string,id:string){
  const batch=await this.prisma.aiLibrarySourceImport.findUnique({where:{id},include:{items:{include:{version:{include:{entry:true,publication:true}}}},snapshot:true}});if(!batch)throw new NotFoundException('Source library import not found');await this.access(userId,batch.snapshotId);
  if(governanceDigest(batch.snapshot.report)!==batch.snapshot.digest)throw new ConflictException('Source snapshot integrity differs');const rows=jsonRecord(batch.snapshot.report)['rows'] as PreviewRow[];
  const members=batch.items.map(i=>{const row=rows.find(r=>r.key===i.rowKey)!,content=projectSourceLibrary(row),v=i.version;return {rowKey:i.rowKey,sourceRef:i.sourceRef,targetRef:v.entry.libraryRef,versionId:v.id,published:!!v.publication,sourceUnchanged:governanceDigest(row.raw)===i.sourceDigest,projectionUnchanged:governanceDigest(content)===i.projectionDigest,contentEqual:governanceDigest(content)===governanceDigest(v.content),identifierEqual:row.sourceRef===i.sourceRef&&i.sourceRef===v.entry.libraryRef,targetIntegrity:governanceDigest({content:v.content,referencePins:v.referencePins})===v.digest};});
  const balanced=members.length===(batch.rowKeys as string[]).length,selectedLibraryZeroDiff=balanced&&members.every(m=>m.sourceUnchanged&&m.projectionUnchanged&&m.contentEqual&&m.identifierEqual&&m.targetIntegrity);
  return {batchId:id,snapshotId:batch.snapshotId,createdAt:batch.createdAt,requestedCount:(batch.rowKeys as string[]).length,targetProposalCount:members.length,publishedCount:members.filter(m=>m.published).length,sourceLibraryCount:rows.filter(r=>r.kind==='library').length,selectedLibraryZeroDiff,members,scope:'selected_library_proposals_only',overallZeroDiff:null,pilotSignedOff:false,productionReady:false};
 }
 async export(userId:string,id:string,format:string){const r=await this.reconcile(userId,id);if(format==='json')return JSON.stringify(r,null,2);if(format!=='csv')throw new BadRequestException('Use JSON or CSV source reconciliation exports');return '\uFEFF'+[['rowKey','sourceRef','targetRef','versionId','published','sourceUnchanged','projectionUnchanged','contentEqual','identifierEqual','targetIntegrity','scope'],...r.members.map(m=>[m.rowKey,m.sourceRef,m.targetRef,m.versionId,m.published,m.sourceUnchanged,m.projectionUnchanged,m.contentEqual,m.identifierEqual,m.targetIntegrity,r.scope])].map(x=>x.map(reportCsvCell).join(',')).join('\r\n');}
}
