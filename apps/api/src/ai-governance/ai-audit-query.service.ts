import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { ScopeService } from '../access/scope.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { jsonRecord } from './ai-risk-scoring';
import { reportCsvCell } from './ai-dashboard-reports.service';
export interface AuditFilter {kind?:'airs'|'aiuc'|'all';detail?:'redacted'|'full';caseId?:string;assetId?:string;actorId?:string;from?:string;to?:string;page?:number;pageSize?:number}
@Injectable()
export class AiAuditQueryService {
 constructor(private readonly db:PrismaService,private readonly authorization:AiAuthorizationService,private readonly risks:AiRiskIntakeService){}
 async query(userId:string,filter:AuditFilter={}){
  const kind=filter.kind??'airs',detail=filter.detail??'redacted';
  if(!['airs','aiuc','all'].includes(kind)||!['redacted','full'].includes(detail))throw new BadRequestException('Use a supported AI audit kind and detail level');
  const page=filter.page??1,pageSize=filter.pageSize??20;
  const date=(value:string|undefined)=>{if(value===undefined)return undefined;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(new Date(value).getTime()))throw new BadRequestException('Use ISO UTC audit bounds');return new Date(value);};
  const from=date(filter.from),to=date(filter.to);
  if(!Number.isSafeInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100||(page-1)*pageSize>2147483647||from&&to&&from>to)throw new BadRequestException('Use ordered dates and bounded audit pagination');
  return this.db.$transaction(async tx=>{
   const actor=await this.authorization.authorizeAny(userId,kind==='aiuc'?['case.view.aiuc.org','case.view.aiuc.all']:['case.view.airs.org','case.view.airs.all'],tx);
   if(kind==='all')await this.authorization.authorizeAny(userId,['case.view.aiuc.org','case.view.aiuc.all'],tx);
   if(detail==='full'){
    if(!actor.roles.includes('auditor'))throw new ForbiddenException('Full native AI audit metadata requires a live Auditor');
    await this.authorization.authorize(userId,kind==='aiuc'?'case.view.aiuc.all':'case.view.airs.all',tx);
    if(kind==='all')await this.authorization.authorize(userId,'case.view.aiuc.all',tx);
   }
   // Resolve the installed DGOP scope against the same snapshot as native event population.
   const scope=await new ScopeService(tx as PrismaService).resolve(actor.roles);
   const asset:Prisma.DataAssetWhereInput={deletedAt:null,...(scope.orgUnits==='all'?{}:{orgUnitId:{in:scope.orgUnits}}),...(scope.domains==='all'?{}:{domainId:{in:scope.domains}}),...(scope.maxClassRank===null?{}:{classification:{is:{rank:{lte:scope.maxClassRank}}}})};
   const useCase:Prisma.AiUseCaseWhereInput={deletedAt:null,isSampleData:false,...(scope.orgUnits==='all'?{}:{organizationUnitId:{in:scope.orgUnits}}),OR:[{asset:{is:asset}},...(scope.domains==='all'&&scope.maxClassRank===null?[{assetId:null}]:[])],...(filter.assetId?{assetId:filter.assetId}:{})};
   const populations:Prisma.AuditLogWhereInput[]=[];
   if(kind!=='aiuc'){
    const rows=await tx.aiRisk.findMany({where:{deletedAt:null,isSampleData:false,workflowCase:{is:{type:'AIRS'}},useCase:{is:{AND:[useCase,{asset:{is:asset}}]}},...(filter.caseId?{workflowCaseId:filter.caseId}:{})},select:{id:true}});
    populations.push({entityType:'ai_risk',entityId:{in:rows.map(r=>r.id)}});
   }
   if(kind!=='airs'){
    const rows=await tx.aiUseCase.findMany({where:{AND:[useCase,{workflowCase:{is:{type:'AIUC'}},...(filter.caseId?{workflowCaseId:filter.caseId}:{})}]},select:{id:true}});
    populations.push({entityType:'ai_use_case',entityId:{in:rows.map(r=>r.id)}});
    // Related AIRS records form the registered asset's operational audit trail.
    if(kind==='all'&&filter.assetId&&!filter.caseId){/* both native entity populations are included above */}
   }
   const where:Prisma.AuditLogWhereInput={OR:populations,...(filter.actorId?{actor:filter.actorId}:{}),...(from||to?{createdAt:{...(from?{gte:from}:{}),...(to?{lte:to}:{})}}:{})};
   const total=await tx.auditLog.count({where}),events=await tx.auditLog.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize,
    select:{id:true,action:true,entityType:true,entityId:true,createdAt:true,metadata:true,...(detail==='full'?{actor:true,previousHash:true,entryHash:true,chainVersion:true}:{})}});
   const allowed=['justification','actorRoleCode','authorityLevel','previousAuthorityLevel','decision','bandCode','severityCode','oldValue','newValue','scoreChanged','acceptanceChanged'];
   const rows=events.map(event=>{if(detail==='full')return event;const metadata=jsonRecord(event.metadata);return {...event,metadata:Object.fromEntries(allowed.filter(k=>['string','number','boolean'].includes(typeof metadata[k])||metadata[k]===null).map(k=>[k,metadata[k]]))};});
   return {rows,total,page,pageSize,readOnly:true,scope:'native_ai_audit',kind,detail,metadataRedacted:detail!=='full',chainCoverage:detail==='full'?'selected_native_entries':'redacted'};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});
 }
 async csv(userId:string,filter:AuditFilter){const result=await this.query(userId,filter);return '\ufeff'+[['auditId','action','entityType','entityId','createdAtUtc','details'],...result.rows.map(r=>[r.id,r.action,r.entityType,r.entityId,r.createdAt.toISOString(),JSON.stringify(filter.detail==='full'?r:r.metadata)])].map(row=>row.map(reportCsvCell).join(',')).join('\r\n')+'\r\n';}
}
