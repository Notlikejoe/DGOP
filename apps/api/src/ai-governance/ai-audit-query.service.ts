import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { ScopeService } from '../access/scope.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { jsonRecord } from './ai-risk-scoring';
import { reportCsvCell } from './ai-dashboard-reports.service';
import { AuditService } from '../audit/audit.service';
export interface AuditFilter {kind?:'airs'|'aiuc'|'all';detail?:'redacted'|'full';caseId?:string;assetId?:string;actorId?:string;from?:string;to?:string;page?:number;pageSize?:number}
@Injectable()
export class AiAuditQueryService {
 constructor(private readonly db:PrismaService,private readonly authorization:AiAuthorizationService,private readonly risks:AiRiskIntakeService,private readonly audit:AuditService){}
 async query(userId:string,filter:AuditFilter={}){
  const kind=filter.kind??'airs',detail=filter.detail??'redacted';
  if(!['airs','aiuc','all'].includes(kind)||!['redacted','full'].includes(detail))throw new BadRequestException('Use a supported AI audit kind and detail level');
  const page=filter.page??1,pageSize=filter.pageSize??20;
  const date=(value:string|undefined)=>{if(value===undefined)return undefined;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(new Date(value).getTime()))throw new BadRequestException('Use ISO UTC audit bounds');return new Date(value);};
  const from=date(filter.from),to=date(filter.to);
  if(!Number.isSafeInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100||(page-1)*pageSize>2147483647||from&&to&&from>to)throw new BadRequestException('Use ordered dates and bounded audit pagination');
  return this.db.$transaction(async tx=>{
   const where=await this.auditWhere(tx,userId,filter,kind,detail,from,to);
   const total=await tx.auditLog.count({where}),events=await tx.auditLog.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize,
    select:{id:true,action:true,entityType:true,entityId:true,createdAt:true,metadata:true,...(detail==='full'?{actor:true,previousHash:true,entryHash:true,chainVersion:true}:{})}});
   const allowed=['justification','actorRoleCode','authorityLevel','previousAuthorityLevel','decision','bandCode','severityCode','oldValue','newValue','scoreChanged','acceptanceChanged'];
   const rows=events.map(event=>{if(detail==='full')return event;const metadata=jsonRecord(event.metadata);return {...event,metadata:Object.fromEntries(allowed.filter(k=>['string','number','boolean'].includes(typeof metadata[k])||metadata[k]===null).map(k=>[k,metadata[k]]))};});
   return {rows,total,page,pageSize,readOnly:true,scope:'native_ai_audit',kind,detail,metadataRedacted:detail!=='full',chainCoverage:detail==='full'?'selected_native_entries':'redacted'};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});
 }
 private async auditWhere(tx:Prisma.TransactionClient,userId:string,filter:AuditFilter,kind:"airs"|"aiuc"|"all",detail:"redacted"|"full",from?:Date,to?:Date){
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
   const populations:Prisma.AuditLogWhereInput[]=[],caseIds:string[]=[];
   if(kind!=='aiuc'){
    const rows=await tx.aiRisk.findMany({where:{deletedAt:null,isSampleData:false,workflowCase:{is:{type:'AIRS'}},useCase:{is:{AND:[useCase,{asset:{is:asset}}]}},...(filter.caseId?{workflowCaseId:filter.caseId}:{})},select:{id:true,workflowCaseId:true}});
    caseIds.push(...rows.flatMap(r=>r.workflowCaseId?[r.workflowCaseId]:[]));
    populations.push({entityType:'ai_risk',entityId:{in:rows.map(r=>r.id)}});
   }
   if(kind!=='airs'){
    const rows=await tx.aiUseCase.findMany({where:{AND:[useCase,{workflowCase:{is:{type:'AIUC'}},...(filter.caseId?{workflowCaseId:filter.caseId}:{})}]},select:{id:true,workflowCaseId:true}});
    caseIds.push(...rows.flatMap(r=>r.workflowCaseId?[r.workflowCaseId]:[]));
    populations.push({entityType:'ai_use_case',entityId:{in:rows.map(r=>r.id)}});
    // Related AIRS records form the registered asset's operational audit trail.
    if(kind==='all'&&filter.assetId&&!filter.caseId){/* both native entity populations are included above */}
   }
   const notices=await tx.governanceNotification.findMany({where:{workflowCaseId:{in:caseIds},sourceType:{in:['ai_use_case','ai_risk_event','ai_risk_escalation','ai_risk_strategy','ai_risk_review','ai_risk_treatment','ai_risk_harmony']}},select:{id:true,deliveryAttempts:{select:{id:true}}}});
   populations.push({entityType:'governance_notification',entityId:{in:notices.map(n=>n.id)},action:{startsWith:'ai.notification.'}},{entityType:'governance_notification_delivery_attempt',entityId:{in:notices.flatMap(n=>n.deliveryAttempts.map(a=>a.id))},action:{startsWith:'ai.notification.'}});
   const where:Prisma.AuditLogWhereInput={OR:populations,...(filter.actorId?{actor:filter.actorId}:{}),...(from||to?{createdAt:{...(from?{gte:from}:{}),...(to?{lte:to}:{})}}:{})};
   return where;
 }
 async census(userId:string,filter:AuditFilter={}) {
  // Reuse public bounds validation, then resolve live access again in one census snapshot.
  await this.query(userId,{...filter,kind:filter.kind??'all',detail:'full',page:1,pageSize:1});
  return this.db.$transaction(async tx=>{
   const where=await this.auditWhere(tx,userId,filter,filter.kind??'all','full',filter.from?new Date(filter.from):undefined,filter.to?new Date(filter.to):undefined);
   const actions=new Map<string,{action:string;entityType:string;events:number;http:number;background:number;legacyOriginUnknown:number;withClientIp:number;withChangePair:number}>();
   let cursor:string|undefined,total=0;
   do {
    const rows=await tx.auditLog.findMany({where,orderBy:{id:'asc'},take:250,...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,action:true,entityType:true,metadata:true}});
    if(!rows.length)break;
    for(const r of rows){const m=jsonRecord(r.metadata),key=r.entityType+':'+r.action,a=actions.get(key)??{action:r.action,entityType:r.entityType,events:0,http:0,background:0,legacyOriginUnknown:0,withClientIp:0,withChangePair:0};a.events++;total++;
     if(m['actorOrigin']==='http')a.http++;else if(m['actorOrigin']==='background_or_internal')a.background++;else a.legacyOriginUnknown++;
     if(typeof m['clientIp']==='string'&&m['clientIp'].trim())a.withClientIp++;
     if(('oldValue' in m&&'newValue' in m)||('before' in m&&'after' in m))a.withChangePair++;
     actions.set(key,a);
    }
    cursor=rows[rows.length-1].id;if(rows.length<250)break;
   }while(cursor);
   return {asOf:new Date().toISOString(),scope:'selected_native_ai_population',readOnly:true,total,actions:[...actions.values()].sort((a,b)=>a.entityType.localeCompare(b.entityType)||a.action.localeCompare(b.action)),historicalMetadataReconstructed:false,globalChainVerified:false};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
 }
 async verifyGlobalChain(userId:string) {
  return this.db.$transaction(async tx=>{
  const actor=await this.authorization.authorize(userId,'case.view.aiuc.all',tx);
  await this.authorization.authorize(userId,'case.view.airs.all',tx);
  if(!actor.roles.includes('auditor'))throw new ForbiddenException('Global chain verification requires a live Auditor');
  const scope=await new ScopeService(tx as PrismaService).resolve(actor.roles);
  if(scope.orgUnits!=='all'||scope.domains!=='all'||scope.maxClassRank!==null)throw new ForbiddenException('Global chain verification requires unrestricted native audit scope');
  return {scope:'global_dgop_chain',...await this.audit.verifyChain(undefined,tx)};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60000});
 }
 async csv(userId:string,filter:AuditFilter){const result=await this.query(userId,filter);return '\ufeff'+[['auditId','action','entityType','entityId','createdAtUtc','details'],...result.rows.map(r=>[r.id,r.action,r.entityType,r.entityId,r.createdAt.toISOString(),JSON.stringify(filter.detail==='full'?r:r.metadata)])].map(row=>row.map(reportCsvCell).join(',')).join('\r\n')+'\r\n';}
}
