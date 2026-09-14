import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiAnnualReviewService } from './ai-annual-review.service';
import { AiDashboardService } from './ai-dashboard.service';
import { governanceDigest, governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
import { jsonRecord } from './ai-risk-scoring';
import { AI_KPI_CATALOG } from './ai-kpi.catalog';

export type ReportFrequency='manual'|'daily'|'monthly';
export function reportSlots(now=new Date()){
 const ksa=new Date(now.getTime()+10800000),daily=ksa.toISOString().slice(0,10);
 const monthly=new Date(Date.UTC(ksa.getUTCFullYear(),ksa.getUTCMonth()-1,1)).toISOString().slice(0,7);
 return {daily,monthly};
}
export function reportCsvCell(value:unknown){
 if(typeof value==='number'&&Number.isFinite(value))return String(value);
 let s=value===null||value===undefined?'':String(value);if(/^\s*[=+\-@]/u.test(s))s="'"+s;
 return '"'+s.replaceAll('"','""')+'"';
}
type Snapshot=Prisma.AiDashboardSnapshotGetPayload<{}>;
type Schedule=Prisma.AiDashboardScheduleVersionGetPayload<{}>;
type StoredProjection={cards:Array<Record<string,unknown>>;[key:string]:unknown};
const executiveCards=new Set(['GEN-85','GEN-86','GEN-87','GEN-90','GEN-91','GEN-92','GEN-95','GEN-98','GEN-99']);

@Injectable()
export class AiDashboardReportsService {
 constructor(private readonly prisma:PrismaService,private readonly dashboard:AiDashboardService,
  private readonly annual:AiAnnualReviewService,private readonly authorization:AiAuthorizationService,private readonly audit:AuditService){}
 private async access(tx:Prisma.TransactionClient,userId:string,unitId:string,write=false){
  const a=await this.annual.registerScope(tx,userId,unitId);
  // Register reports require full organization coverage, never a person's own-risk projection.
  await this.dashboard.snapshotMembers(tx,userId,unitId);
  if(write){const actor=await this.authorization.authorize(userId,'airs.cadence.manage',tx);
   if(!actor.roles.some(r=>['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER'].includes(r))||actor.roles.includes('auditor'))throw new ForbiddenException('Reporting schedules require an eligible governance operator');
  }
  return a;
 }
 async units(userId:string){return this.annual.units(userId);}
 private async visible(tx:Prisma.TransactionClient,userId:string,row:Snapshot){
  await this.access(tx,userId,row.organizationUnitId);
  const current=await this.dashboard.snapshotMembers(tx,userId,row.organizationUnitId);
  this.verifySnapshot(row,current);
  return current;
 }
 private verifySnapshot(row:Snapshot,current:Awaited<ReturnType<AiDashboardService['snapshotMembers']>>){
  const saved=jsonRecord(row.sourceMembers);
  for(const kind of ['risks','register','pipeline'] as const){
   const list=saved[kind],eligible=new Set(current[kind].map(m=>m.id));
   if(!Array.isArray(list)||list.some(m=>typeof jsonRecord(m)['id']!=='string'||!eligible.has(String(jsonRecord(m)['id']))))throw new ForbiddenException('Snapshot sources are outside current register visibility');
  }
  if(governanceDigest({sourceMembers:row.sourceMembers,projection:row.projection})!==row.digest)throw new ConflictException('Snapshot integrity check failed');
 }
 async trend(userId:string,unitId:string,kpiId='GEN-85',frequency='manual',page=1,pageSize=20){
  const definition=AI_KPI_CATALOG.find(k=>k.id===kpiId);
  if(!definition||!['manual','daily','monthly'].includes(frequency)||!Number.isSafeInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100||(page-1)*pageSize>2147483647)
   throw new BadRequestException('Use a supported KPI/frequency, positive page and page size 1–100');
  return governanceTransaction(this.prisma,async tx=>{
   await this.access(tx,userId,unitId);
   const live=await this.dashboard.projection(tx,userId,unitId);
   if(!live.cards.some(k=>k.id===kpiId))throw new ForbiddenException('This KPI is outside your live reporting authority');
   const members=await this.dashboard.snapshotMembers(tx,userId,unitId),where={organizationUnitId:unitId,frequency};
   // One older neighbor keeps each delta identical across page boundaries.
   const snapshots=await tx.aiDashboardSnapshot.findMany({where,orderBy:[{asOf:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize+1});
   const values=snapshots.map(row=>{
    this.verifySnapshot(row,members);
    const projection=jsonRecord(row.projection),cards=Array.isArray(projection['cards'])?projection['cards'].map(jsonRecord):[];
    const card=cards.filter(k=>k['id']===kpiId);
    if(projection['observationBasis']!=='current_scope_at_capture'||typeof projection['projectionVersion']!=='string'||card.length!==1||card[0]['unit']!==definition.unit||
      !(card[0]['value']===null||typeof card[0]['value']==='number'&&Number.isFinite(card[0]['value'])))throw new ConflictException('Saved KPI observation definition is incompatible');
    const sources=jsonRecord(row.sourceMembers);
    const cohort=governanceDigest(Object.fromEntries(['risks','register','pipeline'].map(kind=>[kind,(sources[kind] as unknown[]).map(m=>String(jsonRecord(m)['id'])).sort()])));
    return {row,card:card[0],version:projection['projectionVersion'],cohort};
   });
   const rows=values.slice(0,pageSize).map((v,index)=>{
    const older=values[index+1],value=v.card['value'] as number|null,previous=older?.card['value'];
    const comparable=!!older&&older.version===v.version&&older.row.asOf<v.row.asOf;
    return {snapshotId:v.row.id,asOf:v.row.asOf,periodKey:v.row.periodKey,value,unit:definition.unit,
     numerator:typeof v.card['numerator']==='number'?v.card['numerator']:null,denominator:typeof v.card['denominator']==='number'?v.card['denominator']:null,
     previousAsOf:older?.row.asOf??null,delta:comparable&&typeof value==='number'&&typeof previous==='number'?Math.round((value-previous)*100)/100:null,
     deltaUnit:definition.unit==='percent'?'percentage_points':definition.unit,cohortChanged:older?v.cohort!==older.cohort:null,comparisonAvailable:comparable&&typeof value==='number'&&typeof previous==='number'};
   });
   return {rows,total:await tx.aiDashboardSnapshot.count({where}),page,pageSize,frequency,kpi:{id:definition.id,labelEn:definition.labelEn,labelAr:definition.labelAr,unit:definition.unit},
    availableKpis:live.cards.map(k=>({id:k.id,labelEn:k.labelEn,labelAr:k.labelAr,unit:k.unit})),aggregateOnly:live.aggregateOnly,readOnly:true,
    observationBasis:'saved_capture',historicalReconstruction:false,missingObservationsInterpolated:false,timeZone:'Asia/Riyadh'};
  });
 }
 private async view(tx:Prisma.TransactionClient,userId:string,row:Snapshot){
  await this.visible(tx,userId,row);
  const actor=await this.authorization.authorizeAny(userId,['dashboard.view.aiuc','dashboard.view.airs','dashboard.view.exec.ai','case.view.airs.all'],tx);
  const live=await this.dashboard.projection(tx,userId,row.organizationUnitId),stored=row.projection as unknown as StoredProjection;
  const aggregateOnly=live.aggregateOnly;
  const projection=aggregateOnly?{...stored,cards:stored.cards.filter(k=>executiveCards.has(String(k['id']))),mode:'executive',aggregateOnly:true,governance:null,distribution:[],topRisks:[]}:stored;
  // Source identifiers, schedules and operator details never leave this boundary.
  return {id:row.id,organizationUnitId:row.organizationUnitId,frequency:row.frequency,periodKey:row.periodKey,asOf:row.asOf,digest:row.digest,projection,readOnly:true,aggregateOnly,mode:actor.roles.includes('auditor')?'audit':live.mode};
 }
 private async captureIn(tx:Prisma.TransactionClient,userId:string,unitId:string,frequency:ReportFrequency,now:Date,schedule?:Schedule){
  if(!['manual','daily','monthly'].includes(frequency))throw new BadRequestException('Use manual, daily or monthly reporting frequency');
  await this.access(tx,userId,unitId,true);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-dashboard-capture'),hashtext(${unitId}))`;
  const periodKey=frequency==='manual'?randomUUID():reportSlots(now)[frequency];
  const old=await tx.aiDashboardSnapshot.findUnique({where:{organizationUnitId_frequency_periodKey:{organizationUnitId:unitId,frequency,periodKey}}});
  if(old){await this.visible(tx,userId,old);return {row:old,created:false};}
  const live=await this.dashboard.projection(tx,userId,unitId);
  if(live.aggregateOnly||live.mode==='risk_owner'||!live.governance)throw new ForbiddenException('Only a full governance projection can be captured');
  const sourceMembers=await this.dashboard.snapshotMembers(tx,userId,unitId);
  // The capture is an observed current projection, not a reconstruction of a historical period.
  const projection=JSON.parse(JSON.stringify({...live,topRisks:[],projectionVersion:'ai-dashboard-v2',observationBasis:'current_scope_at_capture',periodMeaning:'cadence_slot',timeZone:'Asia/Riyadh'})) as Prisma.InputJsonObject;
  const digest=governanceDigest({sourceMembers,projection});
  const row=await tx.aiDashboardSnapshot.create({data:{organizationUnitId:unitId,frequency,periodKey,asOf:live.asOf,createdBy:userId,sourceMembers,projection,digest,scheduleVersionId:schedule?.id,createdAt:new Date()}});
  await this.audit.logRequired({actor:userId,action:'ai.dashboard.snapshot.capture',entityType:'ai_dashboard_snapshot',entityId:row.id,metadata:{organizationUnitId:unitId,frequency,periodKey,asOf:row.asOf,digest,scheduleVersionId:schedule?.id??null}},tx);
  return {row,created:true};
 }
 async capture(userId:string,unitId:string,frequency:ReportFrequency='manual'){
  return governanceTransaction(this.prisma,async tx=>{const {row,created}=await this.captureIn(tx,userId,unitId,frequency,new Date());return {id:row.id,created};});
 }
 async list(userId:string,unitId:string,page=1,pageSize=20){
  if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new BadRequestException('Use a positive page and page size 1–100');
  return governanceTransaction(this.prisma,async tx=>{
   await this.access(tx,userId,unitId);const where={organizationUnitId:unitId};
   const rows=await tx.aiDashboardSnapshot.findMany({where,orderBy:[{asOf:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize});
   const result:Array<{id:string;frequency:string;periodKey:string;asOf:Date}>=[];
   for(const row of rows){await this.visible(tx,userId,row);result.push({id:row.id,frequency:row.frequency,periodKey:row.periodKey,asOf:row.asOf});}
   return {rows:result,total:await tx.aiDashboardSnapshot.count({where}),page,pageSize,readOnly:true};
  });
 }
 async get(userId:string,id:string){return governanceTransaction(this.prisma,async tx=>{const row=await tx.aiDashboardSnapshot.findUnique({where:{id}});if(!row)throw new NotFoundException('Dashboard snapshot not found');return this.view(tx,userId,row);});}
 async compare(userId:string,leftId:string,rightId:string){return governanceTransaction(this.prisma,async tx=>{
  const left=await tx.aiDashboardSnapshot.findUnique({where:{id:leftId}}),right=await tx.aiDashboardSnapshot.findUnique({where:{id:rightId}});
  if(!left||!right)throw new NotFoundException('Dashboard snapshot not found');
  if(left.organizationUnitId!==right.organizationUnitId||left.frequency!==right.frequency)throw new BadRequestException('Compare observations from the same register and frequency');
  const a=await this.view(tx,userId,left),b=await this.view(tx,userId,right);
  if(a.projection['projectionVersion']!==b.projection['projectionVersion'])throw new ConflictException('Snapshot definitions differ');
  const rows=a.projection.cards.map(k=>{const next=b.projection.cards.find(n=>n['id']===k['id']),v=k['value'],n=next?.['value'];
   return {id:k['id'],labelEn:k['labelEn'],labelAr:k['labelAr'],unit:k['unit'],left:v??null,right:n??null,delta:typeof v==='number'&&typeof n==='number'&&k['unit']===next?.['unit']?Math.round((n-v)*100)/100:null,deltaUnit:k['unit']==='percent'?'percentage_points':k['unit']};});
  return {leftId,rightId,leftAsOf:left.asOf,rightAsOf:right.asOf,populationMayChange:true,readOnly:true,rows};
 });}
 async csv(userId:string,id:string){
  const view=await this.get(userId,id),rows=[['KPI','English label','Arabic label','Value','Unit','Numerator','Denominator','Observed at','Frequency','Cadence slot'] as unknown[],...view.projection.cards.map(k=>[k['id'],k['labelEn'],k['labelAr'],k['value'],k['unit'],k['numerator'],k['denominator'],view.asOf.toISOString(),view.frequency,view.periodKey])];
  return '\uFEFF'+rows.map(row=>row.map(reportCsvCell).join(',')).join('\r\n')+'\r\n';
 }
 async schedule(userId:string,unitId:string){return governanceTransaction(this.prisma,async tx=>{
  const a=await this.access(tx,userId,unitId);if(!a.actor.roles.some(r=>['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER','AI_COMPLIANCE_OFFICER','auditor'].includes(r)))throw new ForbiddenException('Governance schedule visibility required');
  const versions=await tx.aiDashboardScheduleVersion.findMany({where:{organizationUnitId:unitId},orderBy:{round:'desc'}}),latest=versions[0];
  const runs=latest?await tx.aiDashboardScheduleRun.findMany({where:{scheduleVersionId:{in:versions.map(v=>v.id)}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:30}):[];
  const canManage=a.actor.roles.some(r=>['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER'].includes(r))&&a.permissions.has('airs.cadence.manage')&&!a.actor.roles.includes('auditor');
  return {canManage,timeZone:'Asia/Riyadh',retryLimit:3,workerEnabled:process.env.GOVERNANCE_OPERATIONS_SCHEDULER!=='false'&&process.env.NODE_ENV!=='test',latest:latest?{id:latest.id,round:latest.round,dailyEnabled:latest.dailyEnabled,monthlyEnabled:latest.monthlyEnabled,operatorUserId:latest.operatorUserId}:null,
   history:versions.map(v=>({id:v.id,round:v.round,dailyEnabled:v.dailyEnabled,monthlyEnabled:v.monthlyEnabled,createdAt:v.createdAt,justification:v.justification})),runs:runs.map(({scheduleVersionId,...r})=>({...r,scheduleRound:versions.find(v=>v.id===scheduleVersionId)!.round}))};
 });}
 async configure(userId:string,unitId:string,dto:{expectedRound:number;dailyEnabled:boolean;monthlyEnabled:boolean;justification:string;evidenceIds:string[]}){
  const justification=governanceText(dto.justification);
  if(!Number.isInteger(dto.expectedRound)||dto.expectedRound<0||typeof dto.dailyEnabled!=='boolean'||typeof dto.monthlyEnabled!=='boolean')throw new BadRequestException('Use the current schedule round and boolean frequency flags');
  return governanceTransaction(this.prisma,async tx=>{
   await this.access(tx,userId,unitId,true);const evidenceIds=await governanceEvidence(tx,dto.evidenceIds);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-dashboard-schedule'),hashtext(${unitId}))`;
   const latest=await tx.aiDashboardScheduleVersion.findFirst({where:{organizationUnitId:unitId},orderBy:{round:'desc'}});
   if((latest?.round??0)!==dto.expectedRound)throw new ConflictException('Schedule changed; reload before configuring');
   const row=await tx.aiDashboardScheduleVersion.create({data:{organizationUnitId:unitId,round:dto.expectedRound+1,operatorUserId:userId,dailyEnabled:dto.dailyEnabled,monthlyEnabled:dto.monthlyEnabled,justification,evidenceIds,createdBy:userId,createdAt:new Date()}});
   await this.audit.logRequired({actor:userId,action:'ai.dashboard.schedule.configure',entityType:'ai_dashboard_schedule',entityId:row.id,metadata:{organizationUnitId:unitId,round:row.round,dailyEnabled:row.dailyEnabled,monthlyEnabled:row.monthlyEnabled,justification,evidenceIds}},tx);
   return {id:row.id,round:row.round};
  });
 }
 // Existing DGOP worker calls this. No independent timer, user-supplied clock or external dispatch.
 async processDue(now=new Date()){
  const versions=await this.prisma.$queryRaw<Schedule[]>`SELECT DISTINCT ON ("organizationUnitId") * FROM ai_dashboard_schedule_versions ORDER BY "organizationUnitId",round DESC`;
  let captured=0;
  for(const version of versions)for(const frequency of ['daily','monthly'] as const){
   if(!(frequency==='daily'?version.dailyEnabled:version.monthlyEnabled))continue;
   const periodKey=reportSlots(now)[frequency];
   try{captured+=await governanceTransaction(this.prisma,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-dashboard-schedule'),hashtext(${version.organizationUnitId}))`;
    const latest=await tx.aiDashboardScheduleVersion.findFirst({where:{organizationUnitId:version.organizationUnitId},orderBy:{round:'desc'}});
    if(latest?.id!==version.id)return 0;
    const run=await tx.aiDashboardScheduleRun.findFirst({where:{scheduleVersionId:version.id,frequency,periodKey},orderBy:{attempt:'desc'}});
    if(run?.status==='success'||(run?.attempt??0)>=3||run&&now.getTime()-run.createdAt.getTime()<300000)return 0;
    const {row,created}=await this.captureIn(tx,version.operatorUserId,version.organizationUnitId,frequency,now,version);
    await tx.aiDashboardScheduleRun.create({data:{scheduleVersionId:version.id,frequency,periodKey,attempt:(run?.attempt??0)+1,status:'success',snapshotId:row.id,createdAt:now}});
    await this.audit.logRequired({actor:version.operatorUserId,action:'ai.dashboard.schedule.success',entityType:'ai_dashboard_schedule',entityId:version.id,metadata:{frequency,periodKey,snapshotId:row.id}},tx);
    return created?1:0;
   });}catch(error){
    // Safe classifications only; credentials/query text never enter an operation history row.
    const errorCode=error instanceof ForbiddenException||error instanceof NotFoundException?'ACCESS_UNAVAILABLE':error instanceof ConflictException?'SOURCE_CHANGED':'CAPTURE_FAILED';
    await governanceTransaction(this.prisma,async tx=>{
     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-dashboard-schedule'),hashtext(${version.organizationUnitId}))`;
     const latest=await tx.aiDashboardScheduleVersion.findFirst({where:{organizationUnitId:version.organizationUnitId},orderBy:{round:'desc'}});if(latest?.id!==version.id)return;
     const run=await tx.aiDashboardScheduleRun.findFirst({where:{scheduleVersionId:version.id,frequency,periodKey},orderBy:{attempt:'desc'}});
     if(run?.status==='success'||(run?.attempt??0)>=3||run&&now.getTime()-run.createdAt.getTime()<300000)return;
     await tx.aiDashboardScheduleRun.create({data:{scheduleVersionId:version.id,frequency,periodKey,attempt:(run?.attempt??0)+1,status:'failed',errorCode,createdAt:now}});
     await this.audit.logRequired({actor:version.operatorUserId,action:'ai.dashboard.schedule.failed',entityType:'ai_dashboard_schedule',entityId:version.id,metadata:{frequency,periodKey,errorCode}},tx);
    });
   }
  }
  return {captured};
 }
}
