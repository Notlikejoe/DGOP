import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../access/scope.service';
import { AiReviewReportService, aggregateReviewMeasures } from './ai-review-report.service';
import { aiRoleMayHold, AiPermission, splitAiPermission } from './ai-permissions';
import { jsonRecord } from './ai-risk-scoring';
import { CoverageTask, dimensionCoverage, ethicsCoverage } from './ai-governance-coverage';
import { AI_KPI_CATALOG } from './ai-kpi.catalog';
import { AI_REPORTING_VERSION, ReportAssessment, reportingAssessments, indexBy } from './ai-reporting-projection';
import { reportProofs } from './ai-reporting-proof';
import { AiReviewQueryDto, aiReviewParams } from './ai-review-query.dto';
import { toPaged } from '../common/pagination';

export function percentage(n:number,d:number){return d?Math.round(n/d*10000)/100:null;}
export function average(values:number[]){return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*100)/100:null;}
const score=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=16?v:null;
export const AI_RISK_REPORT_SELECT={id:true,riskRef:true,title:true,version:true,ownerPersonId:true,useCase:{select:{lifecycleState:true,effectiveConfiguration:{select:{id:true,tierCode:true,payload:true,sourceRequestId:true,riskSnapshot:true,createdAt:true}}}},workflowCase:{select:{status:true}},
  reassessments:{orderBy:{inherentRound:'desc' as const},take:1,select:{inherentRound:true,additionalTriggers:{orderBy:{requiredInherentRound:'desc' as const},take:1,select:{requiredInherentRound:true}}}},
  responses:{orderBy:{round:'desc' as const},take:1,where:{strategyCode:{in:['MITIGATE','TRANSFER']},decisions:{some:{kind:'officer',decision:'approve'}}},select:{id:true,assessmentId:true,
    plans:{orderBy:{round:'desc' as const},take:1,select:{id:true,snapshot:true,decision:{select:{decision:true}}}}}},
  actions:{where:{deletedAt:null},select:{id:true,actionRef:true,title:true,responseId:true,planData:true,workflowTask:{select:{status:true,dueDate:true}},progress:{orderBy:{round:'desc' as const},take:1,select:{completionPct:true,completedAt:true}}}}
} satisfies Prisma.AiRiskSelect;
const select=AI_RISK_REPORT_SELECT;
type Assessment=ReportAssessment;
type Risk=Omit<Prisma.AiRiskGetPayload<{select:typeof select}>,'useCase'|'version'>&{assessments:Array<Omit<Assessment,'createdAt'>>};
/** Only current calculation provenance contributes; old residuals never pair with new inherent rounds. */
export function projectRisk(r:Risk,asOf:Date){
 const required=Math.max(r.reassessments[0]?.inherentRound??0,r.reassessments[0]?.additionalTriggers[0]?.requiredInherentRound??0);
 const inherent=r.assessments.find(a=>a.kind==='inherent'),current=inherent&&inherent.round>=required?inherent:null;
 const residual=r.assessments.find(a=>a.kind==='residual'),paired=residual&&current&&jsonRecord(residual.inputs)['inherentAssessmentId']===current.id?residual:null;
 const i=score(jsonRecord(current?.result)['score']),s=score(jsonRecord(paired?.result)['score']);
 const response=r.responses[0],candidate=response?.plans[0],plan=response?.assessmentId===current?.id&&candidate?.decision?.decision==='approve'&&jsonRecord(candidate.snapshot)['isSampleData']!==true?candidate:null;
 const actionIds=jsonRecord(plan?.snapshot)['actionIds'],actionSet=new Set(Array.isArray(actionIds)?actionIds:[]);
 const actions=plan&&Array.isArray(actionIds)?r.actions.filter(a=>a.responseId===response.id&&actionSet.has(a.id)&&a.workflowTask&&a.workflowTask.status!=='cancelled'&&jsonRecord(a.planData)['isSampleData']!==true).map(a=>{
  const p=a.progress[0],completed=!!p?.completedAt&&p.completionPct===100&&a.workflowTask?.status==='completed';
  return {id:a.id,actionRef:a.actionRef,title:a.title,dueAt:a.workflowTask!.dueDate,completionPct:p?.completionPct??0,completed,overdue:!completed&&!!a.workflowTask!.dueDate&&a.workflowTask!.dueDate<=asOf};
 }):[];
 return {id:r.id,riskRef:r.riskRef,title:r.title,status:r.workflowCase?.status??'draft',withoutOwner:!r.ownerPersonId,inherentScore:i,residualScore:s,
  inherentBand:current?jsonRecord(current.result)['bandCode']??null:null,residualBand:paired?jsonRecord(paired.result)['bandCode']??null:null,
  likelihood:paired?jsonRecord(paired.result)['likelihood']??null:null,impact:paired?jsonRecord(paired.result)['impactFinal']??null:null,
  reduction:i!==null&&s!==null?(i-s)/i*100:null,hasPlan:!!plan,treated:!!plan&&actions.length>0&&actions.every(a=>a.completed),
  completionPct:actions.length?average(actions.map(a=>a.completionPct)):0,actions};
}
export const DASHBOARD_FILTERS=['registered','sdaia_high','unclassified','identified','residual_high','open','without_owner','with_plan','treated','overdue_actions','plan_incomplete','assessment_gaps','ethics_gaps','mandatory_ethics_gaps'] as const;
@Injectable()
export class AiDashboardService {
 constructor(private readonly prisma:PrismaService,private readonly reports:AiReviewReportService,private readonly scope:ScopeService){}
 async access(tx:Prisma.TransactionClient,userId:string,historical=false){
  const a=await this.reports.access(tx,userId,historical),codes:AiPermission[]=['dashboard.view.aiuc','dashboard.view.exec.ai','case.view.aiuc.all','airs.cadence.manage'];
  const grants=await tx.rolePermission.findMany({where:{role:{is:{code:{in:a.actor.roles},isActive:true,deletedAt:null}},permission:{is:{OR:codes.map(splitAiPermission)}}},include:{role:{select:{code:true}},permission:true}});
  const permissions=new Set(grants.filter(g=>aiRoleMayHold(g.role.code,(g.permission.resource+'.'+g.permission.action) as AiPermission)).map(g=>g.permission.resource+'.'+g.permission.action));
  const canUseCases=a.mode!=='risk_owner'&&(a.actor.administratorOversight||permissions.has('dashboard.view.aiuc')||permissions.has('dashboard.view.exec.ai')||permissions.has('case.view.aiuc.all'));
  const scope=await this.scope.resolve(a.actor.roles),asset:Prisma.DataAssetWhereInput={isActive:true,deletedAt:null,
   ...(scope.orgUnits==='all'?{}:{orgUnitId:{in:scope.orgUnits}}),...(scope.domains==='all'?{}:{domainId:{in:scope.domains}}),...(scope.maxClassRank===null?{}:{classification:{is:{rank:{lte:scope.maxClassRank}}}})};
  const registerWhere:Prisma.AiUseCaseWhereInput={deletedAt:null,isSampleData:false,useCaseRef:{not:null},...(historical?{}:{lifecycleState:{not:'retired' as const}}),asset:{is:asset},...(scope.orgUnits==='all'?{}:{organizationUnitId:{in:scope.orgUnits}})};
  // An unlinked request has no governed asset domain/classification; fail closed on restricted scopes.
  const pipelineWhere:Prisma.AiUseCaseWhereInput={deletedAt:null,isSampleData:false,...(historical?{}:{lifecycleState:{not:'retired' as const}}),workflowCase:{is:{type:'AIUC'}},intakeRevisions:{some:{submittedAt:{not:null}}},
   ...(scope.orgUnits==='all'?{}:{organizationUnitId:{in:scope.orgUnits}}),OR:[{asset:{is:asset}},...(scope.domains==='all'&&scope.maxClassRank===null?[{assetId:null}]:[])]};
  return {...a,scope,permissions,canUseCases,canPipeline:canUseCases&&!a.aggregateOnly,registerWhere,pipelineWhere};
 }
 private async scopedAccess(tx:Prisma.TransactionClient,userId:string,unitId?:string,historical=false){
  const a=await this.access(tx,userId,historical);if(!unitId)return a;
  return {...a,where:{AND:[a.where,{useCase:{is:{organizationUnitId:unitId}}}]} satisfies Prisma.AiRiskWhereInput,registerWhere:{AND:[a.registerWhere,{organizationUnitId:unitId}]} satisfies Prisma.AiUseCaseWhereInput,pipelineWhere:{AND:[a.pipelineWhere,{organizationUnitId:unitId}]} satisfies Prisma.AiUseCaseWhereInput};
 }
 private async population(tx:Prisma.TransactionClient,userId:string,unitId?:string){
  const a=await this.scopedAccess(tx,userId,unitId),asOf=new Date(),rows=await tx.aiRisk.findMany({where:a.where,select});
  const latest=rows.length?await tx.$queryRaw<Assessment[]>`SELECT DISTINCT ON ("riskId",kind) id,"riskId",kind,round,result,"createdAt",jsonb_build_object('inherentAssessmentId',inputs->'inherentAssessmentId') AS inputs FROM ai_assessment_rounds WHERE "riskId" IN (${Prisma.join(rows.map(r=>r.id))}) AND kind::text IN ('inherent','residual') ORDER BY "riskId",kind,round DESC`:[];
  const byRisk=new Map<string,Assessment[]>();for(const v of latest){const list=byRisk.get(v.riskId)??[];list.push(v);byRisk.set(v.riskId,list);}
  const assessments=rows.flatMap(r=>reportingAssessments(r,byRisk.get(r.id)??[],r.useCase.effectiveConfiguration));
  const effectiveByRisk=indexBy(assessments,a=>a.riskId);
  const risks=rows.map(r=>projectRisk({...r,assessments:effectiveByRisk.get(r.id)??[]},asOf));
  const register=a.canUseCases?await tx.aiUseCase.findMany({where:a.registerWhere,select:{id:true,useCaseRef:true,name:true,lifecycleState:true,effectiveConfiguration:{select:{tierCode:true}},organizationUnitId:true,organizationUnit:{select:{nameEn:true,nameAr:true}},assessments:{where:{kind:'classification',riskId:null},orderBy:{round:'desc'},take:1,select:{result:true}}}}):[];
  const useCases=register.map(r=>({...r,assessments:undefined,effectiveConfiguration:undefined,approvedTier:r.effectiveConfiguration?.tierCode??jsonRecord(r.assessments[0]?.result)['approvedTierCode']??null}));
  const historical=await this.scopedAccess(tx,userId,unitId,true),retired=a.canUseCases?await tx.aiUseCase.count({where:{AND:[historical.registerWhere,{lifecycleState:'retired'}]}}):0;
  return {a,asOf,risks,useCases,retired,sourceRisks:rows,latest:assessments};
 }
 private async governance(tx:Prisma.TransactionClient,p:Awaited<ReturnType<AiDashboardService['population']>>){
  if(!p.a.canPipeline)return null;
  const ids=p.sourceRisks.map(r=>r.id);
  type Coordinator=CoverageTask&{riskId:string;templateId:string};
  const coordinators=ids.length?await tx.$queryRaw<Coordinator[]>`SELECT DISTINCT ON (r.id,s.code)
   t.id,t."caseId",s.code AS "stageCode",t.status,t."assigneeRoleCode",t."assigneeUserId",t."formSubmittedBy",t."completedAt",t."dueDate",t."createdAt",t."formDataJson",r.id AS "riskId",s."templateId"
   FROM ai_risks r JOIN workflow_cases c ON c.id=r."workflowCaseId"
   JOIN workflow_tasks t ON t."caseId"=c.id JOIN workflow_template_stages s ON s.id=t."templateStageId" AND s."templateId"=c."templateId"
   WHERE r.id IN (${Prisma.join(ids)}) AND s.code IN ('airs-inherent-assessment','airs-residual-assessment')
   AND t.status::text<>'cancelled' AND NOT coalesce(t."formDataJson",'{}'::jsonb)?'dimension'
   AND NOT coalesce(t."formDataJson",'{}'::jsonb)?'coordinatorTaskId'
   ORDER BY r.id,s.code,t."createdAt" DESC,t.id DESC`:[];
  const children=coordinators.length?await tx.workflowTask.findMany({where:{caseId:{in:[...new Set(coordinators.map(c=>c.caseId))]},status:{not:'cancelled'},templateStage:{is:{code:{in:['airs-inherent-assessment','airs-residual-assessment']}}}},select:{id:true,caseId:true,status:true,assigneeRoleCode:true,assigneeUserId:true,formSubmittedBy:true,completedAt:true,dueDate:true,createdAt:true,formDataJson:true,templateStage:{select:{code:true,templateId:true}}}}):[];
  const riskById=new Map(p.sourceRisks.map(r=>[r.id,r])),inherentByRisk=new Map(p.latest.filter(a=>a.kind==='inherent').map(a=>[a.riskId,a]));
  const childrenByCoordinator=indexBy(children,t=>String(jsonRecord(t.formDataJson)['coordinatorTaskId']));
  const assessments=coordinators.flatMap(c=>{
   const r=riskById.get(c.riskId)!,required=Math.max(r.reassessments[0]?.inherentRound??0,r.reassessments[0]?.additionalTriggers[0]?.requiredInherentRound??0),f=jsonRecord(c.formDataJson);
   const inherent=inherentByRisk.get(r.id);
   if(r.useCase.effectiveConfiguration?.sourceRequestId&&c.createdAt<r.useCase.effectiveConfiguration.createdAt)return [];
   if(c.stageCode==='airs-inherent-assessment'&&Number(f['assessmentRound']??0)<required)return [];
   if(c.stageCode==='airs-residual-assessment'&&(!inherent||inherent.round<required||f['inherentAssessmentId']!==inherent.id))return [];
   const covered=dimensionCoverage(c,(childrenByCoordinator.get(c.id)??[]).filter(t=>t.templateStage?.templateId===c.templateId).map(t=>({...t,stageCode:t.templateStage!.code})),p.asOf);
   return [{id:c.id,reference:r.riskRef,title:r.title,kind:c.stageCode==='airs-inherent-assessment'?'inherent':'residual',dueAt:c.dueDate,...covered}];
  });
  const due=assessments.filter(r=>r.dueAt&&r.dueAt<=p.asOf);
  const cases=await tx.aiUseCase.findMany({where:p.a.pipelineWhere,select:{id:true,useCaseRef:true,name:true,requesterUserId:true,effectiveConfiguration:{select:{tierCode:true,sourceRequestId:true,assessmentSnapshot:true}},owner:{select:{userId:true}},assessments:{where:{kind:'classification',riskId:null},orderBy:[{round:'desc'},{id:'desc'}],take:1,select:{id:true,result:true}},workflowCase:{select:{id:true,templateId:true,tasks:{where:{status:'completed',templateStage:{is:{code:'aiuc-ethics-review'}}},select:{id:true,caseId:true,status:true,assigneeRoleCode:true,assigneeUserId:true,formSubmittedBy:true,completedAt:true,dueDate:true,createdAt:true,formDataJson:true,templateStage:{select:{code:true,templateId:true}}}}}}}});
  const requestIds=cases.flatMap(c=>c.effectiveConfiguration?.sourceRequestId?[c.effectiveConfiguration.sourceRequestId]:[]),requests=await tx.aiLifecycleRequest.findMany({where:{id:{in:requestIds},status:'applied'},select:{id:true,proposerId:true,authorityTier:true,decisions:{where:{stage:'ethics',decision:'approve'},select:{taskId:true,actorId:true,actorRole:true,createdAt:true}}}}),requestById=new Map(requests.map(r=>[r.id,r]));
  const proofStates=await reportProofs(tx,cases.flatMap(c=>[{entityType:'ai_use_case',entityId:c.id},...(c.effectiveConfiguration?.sourceRequestId?[{entityType:'ai_lifecycle_request',entityId:c.effectiveConfiguration.sourceRequestId}]:[])]),p.asOf);
  const ethics=cases.flatMap(c=>{const d=c.assessments[0],config=c.effectiveConfiguration;if(!d&&!config)return [];
   if(config?.sourceRequestId){const request=requestById.get(config.sourceRequestId),high=config.tierCode==='HIGH',mandatory=high||request?.authorityTier==='HIGH'||config.tierCode==='UNACCEPTABLE';
    const eligible=(request?.decisions??[]).filter(t=>t.actorRole==='AI_ETHICS_COMMITTEE'&&t.actorId!==request?.proposerId&&t.actorId!==c.requesterUserId&&t.actorId!==c.owner?.userId&&t.createdAt<=p.asOf);
    return [{id:c.id,reference:c.useCaseRef??c.id,title:c.name,approvedTier:config.tierCode,high,mandatory,reviewed:eligible.some(t=>proofStates.get(t.taskId)==='verified'),demoReviewed:eligible.some(t=>proofStates.get(t.taskId)==='demo_verified')}];}
   if(!d)return [];
   const covered=ethicsCoverage(d.id,d.result,(c.workflowCase?.tasks??[]).filter(t=>proofStates.get(t.id)==='verified'&&t.caseId===c.workflowCase!.id&&t.templateStage?.templateId===c.workflowCase!.templateId).map(t=>({...t,stageCode:t.templateStage!.code})),p.asOf,c.requesterUserId,c.owner?.userId??null);
   return [{id:c.id,reference:c.useCaseRef??c.id,title:c.name,approvedTier:jsonRecord(d.result)['approvedTierCode']??null,...covered,demoReviewed:(c.workflowCase?.tasks??[]).some(t=>proofStates.get(t.id)==='demo_verified'&&jsonRecord(t.formDataJson)['classificationDecisionId']===d.id)}];
  });
  const high=ethics.filter(c=>c.high),mandatory=ethics.filter(c=>c.mandatory);
  return {assessments:due,ethics,measures:{assessmentDue:due.length,assessmentComplete:due.filter(r=>r.complete).length,assessmentMissingDeadline:assessments.filter(r=>!r.dueAt).length,high:high.length,highReviewed:high.filter(c=>c.reviewed).length,mandatory:mandatory.length,mandatoryReviewed:mandatory.filter(c=>c.reviewed).length,demoReviewed:ethics.filter(c=>c.demoReviewed).length,evidenceBasis:'operational_verified'}};
 }
 async summary(userId:string){return this.prisma.$transaction(tx=>this.projection(tx,userId),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:20000});}
 async projection(tx:Prisma.TransactionClient,userId:string,unitId?:string){
  const population=await this.population(tx,userId,unitId),{a,asOf,risks,useCases}=population,governance=await this.governance(tx,population),reviews=await aggregateReviewMeasures(tx,risks.map(r=>r.id),asOf);
  const high=useCases.filter(u=>u.approvedTier==='HIGH').length,unclassified=useCases.filter(u=>u.approvedTier===null||u.approvedTier==='').length,other=useCases.filter(u=>u.approvedTier!==null&&u.approvedTier!==''&&u.approvedTier!=='HIGH').length;
  const highInherent=risks.filter(r=>['HIGH','CRITICAL'].includes(String(r.inherentBand))),planned=risks.filter(r=>r.hasPlan),treated=planned.filter(r=>r.treated);
  const actions=risks.flatMap(r=>r.actions),inherent=risks.flatMap(r=>r.inherentScore===null?[]:[r.inherentScore]),residual=risks.flatMap(r=>r.residualScore===null?[]:[r.residualScore]),reduction=risks.flatMap(r=>r.reduction===null?[]:[r.reduction]);
  const matrix=Array.from({length:4},(_,p)=>Array.from({length:4},(_,i)=>risks.filter(r=>r.likelihood===p+1&&r.impact===i+1).length));
  const matrixCount=matrix.flat().reduce((n,v)=>n+v,0);
  const values:Record<string,{value:number|null;numerator?:number;denominator?:number}>={
   'GEN-86':{value:risks.length},'GEN-87':{value:risks.filter(r=>['HIGH','CRITICAL'].includes(String(r.residualBand))).length},'GEN-88':{value:risks.filter(r=>!['closed','cancelled'].includes(r.status)).length},'GEN-89':{value:risks.filter(r=>r.withoutOwner).length},
   'GEN-90':{value:average(inherent),denominator:inherent.length},'GEN-91':{value:average(residual),denominator:residual.length},'GEN-92':{value:average(reduction),denominator:reduction.length},
   'GEN-93':{value:percentage(treated.length,planned.length),numerator:treated.length,denominator:planned.length},'GEN-94':{value:actions.filter(a=>a.overdue).length},'GEN-95':{value:reviews.overdue},'GEN-96':{value:reviews.onTimePercent,numerator:reviews.closedOnTime,denominator:reviews.due},
   'GEN-97':{value:percentage(highInherent.filter(r=>r.actions.some(a=>a.completed)).length,highInherent.length),numerator:highInherent.filter(r=>r.actions.some(a=>a.completed)).length,denominator:highInherent.length}};
  if(a.canUseCases){Object.assign(values,{'GEN-85':{value:useCases.length},'GEN-98':{value:high},'GEN-99':{value:unclassified}});}
  if(a.canPipeline){
   const cases=await tx.aiUseCase.findMany({where:a.pipelineWhere,select:{workflowCase:{select:{id:true,status:true,tasks:{where:{status:'completed',templateStage:{is:{code:{in:['aiuc-triage','aiuc-decision']}}}},select:{id:true,dueDate:true,completedAt:true,formDataJson:true,templateStage:{select:{code:true}}}}}}}});
   const triage=cases.flatMap(c=>c.workflowCase?.tasks.filter(t=>t.templateStage?.code==='aiuc-triage')??[]),events=triage.length?await tx.workflowEvent.findMany({where:{taskId:{in:triage.map(t=>t.id)},action:'aiuc.triage.return'},select:{taskId:true}}):[];
   const closed=cases.filter(c=>['closed','rejected','cancelled','failed'].includes(c.workflowCase!.status)),accepted=closed.filter(c=>{const t=c.workflowCase!.tasks.filter(t=>t.templateStage?.code==='aiuc-decision').sort((l,r)=>(r.completedAt?.getTime()??0)-(l.completedAt?.getTime()??0))[0];return ['Approved','Approved with Conditions'].includes(String(jsonRecord(jsonRecord(t?.formDataJson)['adoptionDecision'])['resolutionCode']));});
   const onTime=triage.filter(t=>!!t.completedAt&&!!t.dueDate&&t.completedAt<=t.dueDate).length,returns=new Set(events.map(e=>e.taskId)).size;
   Object.assign(values,{'GEN-81':{value:cases.length},'GEN-82':{value:percentage(accepted.length,closed.length),numerator:accepted.length,denominator:closed.length},'GEN-83':{value:percentage(onTime,triage.length),numerator:onTime,denominator:triage.length},'GEN-84':{value:percentage(returns,triage.length),numerator:returns,denominator:triage.length}});
  }
  if(governance){const g=governance.measures;Object.assign(values,{'GEN-100':{value:percentage(g.assessmentComplete,g.assessmentDue),numerator:g.assessmentComplete,denominator:g.assessmentDue},'GEN-101':{value:percentage(g.highReviewed,g.high),numerator:g.highReviewed,denominator:g.high}});}
  const executive=new Set(['GEN-85','GEN-86','GEN-87','GEN-90','GEN-91','GEN-92','GEN-95','GEN-98','GEN-99']);
  const operational=new Set(['GEN-88','GEN-94','GEN-95','GEN-97']);
  const cards=AI_KPI_CATALOG.filter(k=>k.id in values&&(!a.aggregateOnly||executive.has(k.id))&&(a.mode!=='risk_owner'||operational.has(k.id))).map(k=>({...k,...values[k.id]}));
  const distribution=a.canUseCases&&!a.aggregateOnly?[...indexBy(useCases,u=>String(u.organizationUnitId)).values()].map(group=>{return {nameEn:group[0].organizationUnit?.nameEn??null,nameAr:group[0].organizationUnit?.nameAr??null,count:group.length};}):[];
  return {asOf,projectionVersion:AI_REPORTING_VERSION,lifecycle:{active:useCases.filter(u=>u.lifecycleState==='active').length,suspended:useCases.filter(u=>u.lifecycleState==='suspended').length,retired:population.retired,headlineBasis:'active_and_suspended',retiredBasis:'scoped_registered_history'},projection:'live_current_scope',mode:a.mode,aggregateOnly:a.aggregateOnly,cards,catalog:AI_KPI_CATALOG,
   reconciliation:a.canUseCases?{total:useCases.length,high,unclassified,otherClassified:other,sum:high+unclassified+other,balanced:high+unclassified+other===useCases.length}:null,
   governance:governance?.measures??null,
   matrix:a.mode==='risk_owner'?null:{cells:matrix,assessed:matrixCount,unassessed:risks.length-matrixCount},distribution,
   topRisks:a.aggregateOnly||a.mode==='risk_owner'?[]:risks.filter(r=>r.residualScore!==null).sort((l,r)=>r.residualScore!-l.residualScore!||l.id.localeCompare(r.id)).slice(0,10).map(({actions,...r})=>r)};
 }
 async reportingAccess(tx:Prisma.TransactionClient,userId:string,unitId:string,historical=false){const a=await this.scopedAccess(tx,userId,unitId,historical);if(a.mode==='risk_owner'||!a.canUseCases)throw new ForbiddenException('Register reporting authority required');return a;}
 async snapshotMembers(tx:Prisma.TransactionClient,userId:string,unitId:string,historical=false){
  const a=await this.scopedAccess(tx,userId,unitId,historical);if(a.mode==='risk_owner'||!a.canUseCases)throw new ForbiddenException('Register reporting authority required');
  const risks=await tx.aiRisk.findMany({where:a.where,select:{id:true,version:true},orderBy:{id:'asc'}}),register=await tx.aiUseCase.findMany({where:a.registerWhere,select:{id:true,version:true},orderBy:{id:'asc'}}),pipeline=await tx.aiUseCase.findMany({where:a.pipelineWhere,select:{id:true,version:true},orderBy:{id:'asc'}});
  return {risks,register,pipeline};
 }
 async drilldown(userId:string,filter:string,page=1,pageSize=25,search=''){
  const paging=aiReviewParams({page,pageSize,search} as AiReviewQueryDto);
  if(!(DASHBOARD_FILTERS as readonly string[]).includes(filter)||!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>200)throw new BadRequestException('Use a supported dashboard filter, positive page and page size 1–200');
  return this.prisma.$transaction(async tx=>{
   const population=await this.population(tx,userId),{a,asOf,risks,useCases}=population;if(a.aggregateOnly)throw new ForbiddenException('Executive dashboard is aggregate only');
   let rows:Array<Record<string,unknown>>;
   if(['assessment_gaps','ethics_gaps','mandatory_ethics_gaps'].includes(filter)){if(!a.canPipeline)throw new ForbiddenException('Governance dashboard authority required');const g=(await this.governance(tx,population))!;rows=filter==='assessment_gaps'?g.assessments.filter(r=>!r.complete):g.ethics.filter(c=>(filter==='ethics_gaps'?c.high:c.mandatory)&&!c.reviewed).map(({high,mandatory,reviewed,...r})=>r);}
   else if(['registered','sdaia_high','unclassified'].includes(filter)){if(!a.canUseCases)throw new ForbiddenException('Use-case dashboard authority required');rows=useCases.filter(u=>filter==='registered'||filter==='sdaia_high'&&u.approvedTier==='HIGH'||filter==='unclassified'&&(u.approvedTier===null||u.approvedTier==='')).map(u=>({id:u.id,reference:u.useCaseRef,title:u.name,lifecycleState:u.lifecycleState,approvedTier:u.approvedTier}));}
   else {const chosen=risks.filter(r=>filter==='identified'||filter==='overdue_actions'&&r.actions.some(a=>a.overdue)||filter==='residual_high'&&['HIGH','CRITICAL'].includes(String(r.residualBand))||filter==='open'&&!['closed','cancelled'].includes(r.status)||filter==='without_owner'&&r.withoutOwner||filter==='with_plan'&&r.hasPlan||filter==='treated'&&r.treated||filter==='plan_incomplete'&&['HIGH','CRITICAL'].includes(String(r.inherentBand))&&!r.actions.some(a=>a.completed));
    rows=filter==='overdue_actions'?chosen.flatMap(r=>r.actions.filter(a=>a.overdue).map(a=>({id:a.id,reference:a.actionRef,title:a.title,riskRef:r.riskRef,dueAt:a.dueAt,completionPct:a.completionPct}))):chosen.map(({actions,...r})=>({...r,reference:r.riskRef}));}
   const needle=search.trim().toLocaleLowerCase();if(needle)rows=rows.filter(r=>[r['reference'],r['title']].some(v=>String(v??'').toLocaleLowerCase().includes(needle)));
   rows.sort((l,r)=>String(l['reference']).localeCompare(String(r['reference']))||String(l['id']).localeCompare(String(r['id'])));
   return {asOf,filter,...toPaged(rows.slice(paging.skip,paging.skip+paging.take),rows.length,paging),readOnly:true};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:20000});
 }
}
