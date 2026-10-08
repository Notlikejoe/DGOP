import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../access/scope.service';
import { AiAuthorizationService, effectiveAiPermissions } from './ai-authorization.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { aiRoleMayHold, AiPermission, splitAiPermission } from './ai-permissions';
import { aiReviewStatus } from './ai-risk-review.service';
import { aiReviewParams } from './ai-review-query.dto';
import { toPaged } from '../common/pagination';

export interface ReviewMeasure {dueAt:Date;completion:{completedAt:Date}|null;cancellation?:unknown;retirement?:unknown}
export function reviewMeasures(rows:ReviewMeasure[],asOf:Date) {
  const active=rows.filter(r=>!r.cancellation&&!r.retirement),due=active.filter(r=>r.dueAt<=asOf);
  const closedOnTime=due.filter(r=>r.completion&&r.completion.completedAt<=asOf&&r.completion.completedAt<=r.dueAt).length;
  return {total:rows.length,superseded:rows.filter(r=>!!r.cancellation).length,retired:rows.filter(r=>!!r.retirement).length,completed:active.filter(r=>!!r.completion&&r.completion.completedAt<=asOf).length,
    overdue:due.filter(r=>!r.completion||r.completion.completedAt>asOf).length,due:due.length,closedOnTime,
    onTimePercent:due.length?Math.round(closedOnTime/due.length*10000)/100:null,
    dueSoon:active.filter(r=>(!r.completion||r.completion.completedAt>asOf)&&aiReviewStatus(false,r.dueAt,asOf)==='due_soon').length};
}
const reportPermissions:AiPermission[]=['dashboard.view.aiuc','dashboard.view.airs','dashboard.view.exec.ai','case.view.airs.all'];
export const REVIEW_FILTERS=['next30','all','overdue','due_soon','scheduled','completed','superseded'] as const;
export async function aggregateReviewMeasures(tx:Prisma.TransactionClient,riskIds:string[],asOf:Date,window?:{start:Date;end:Date}) {
  if(!riskIds.length)return reviewMeasures([],asOf);
  const [m]=await tx.$queryRaw<Array<Omit<ReturnType<typeof reviewMeasures>,'onTimePercent'>>>`
    SELECT count(*)::int AS total,
      count(*) FILTER(WHERE x."reviewId" IS NOT NULL)::int AS superseded,
      count(*) FILTER(WHERE z."reviewId" IS NOT NULL)::int AS retired,
      count(*) FILTER(WHERE x."reviewId" IS NULL AND z."reviewId" IS NULL AND c."completedAt"<=${asOf})::int AS completed,
      count(*) FILTER(WHERE x."reviewId" IS NULL AND z."reviewId" IS NULL AND r."dueAt"<=${asOf} AND (c."reviewId" IS NULL OR c."completedAt">${asOf}))::int AS overdue,
      count(*) FILTER(WHERE x."reviewId" IS NULL AND z."reviewId" IS NULL AND r."dueAt"<=${asOf})::int AS due,
      count(*) FILTER(WHERE x."reviewId" IS NULL AND z."reviewId" IS NULL AND r."dueAt"<=${asOf} AND c."completedAt"<=r."dueAt" AND c."completedAt"<=${asOf})::int AS "closedOnTime",
      count(*) FILTER(WHERE x."reviewId" IS NULL AND z."reviewId" IS NULL AND r."dueAt">${asOf} AND r."dueAt"<=${new Date(asOf.getTime()+7*86400000)} AND (c."reviewId" IS NULL OR c."completedAt">${asOf}))::int AS "dueSoon"
    FROM ai_risk_reviews r LEFT JOIN ai_risk_review_completions c ON c."reviewId"=r.id LEFT JOIN ai_risk_review_cancellations x ON x."reviewId"=r.id LEFT JOIN ai_lifecycle_review_retirements z ON z."reviewId"=r.id
    WHERE r."riskId" IN (${Prisma.join(riskIds)}) ${window?Prisma.sql`AND r."dueAt">=${window.start} AND r."dueAt"<=${window.end}`:Prisma.empty}`;
  return {...m,onTimePercent:m.due?Math.round(m.closedOnTime/m.due*10000)/100:null};
}

@Injectable()
export class AiReviewReportService {
  constructor(private readonly prisma:PrismaService,private readonly authorization:AiAuthorizationService,
    private readonly scope:ScopeService,private readonly risks:AiRiskIntakeService){}

  async access(tx:Prisma.TransactionClient,userId:string,historical=false) {
    const actor=await this.authorization.authorizeAny(userId,reportPermissions,tx);
    const grants=await tx.rolePermission.findMany({where:{role:{is:{code:{in:actor.roles},isActive:true,deletedAt:null}},
      permission:{is:{OR:reportPermissions.map(splitAiPermission)}}},include:{permission:true,role:{select:{code:true}}}});
    const permissions=effectiveAiPermissions(actor.roles,grants);
    const governance=actor.administratorOversight||permissions.has('case.view.airs.all')&&!permissions.has('dashboard.view.exec.ai')||permissions.has('dashboard.view.aiuc')||permissions.has('dashboard.view.airs')&&actor.roles.some(r=>['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER','AI_COMPLIANCE_OFFICER'].includes(r));
    const aggregateOnly=!governance&&!actor.roles.includes('auditor')&&permissions.has('dashboard.view.exec.ai');
    const mode=aggregateOnly?'executive':actor.roles.includes('auditor')?'audit':governance?'governance':'risk_owner';
    let where:Prisma.AiRiskWhereInput;
    if(aggregateOnly){
      const scope=await this.scope.resolve(actor.roles);
      where={deletedAt:null,workflowCase:{is:{type:'AIRS'}},useCase:{is:{deletedAt:null,...(historical?{}:{lifecycleState:{not:'retired' as const}}),asset:{is:{isActive:true,deletedAt:null,
        ...(scope.orgUnits==='all'?{}:{orgUnitId:{in:scope.orgUnits}}),...(scope.domains==='all'?{}:{domainId:{in:scope.domains}}),
        ...(scope.maxClassRank===null?{}:{classification:{is:{rank:{lte:scope.maxClassRank}}}})}}}}};
    }else{
      where=(await this.risks.visibility(userId,tx,historical)).where;
      if(mode==='risk_owner'){
        if(!actor.roles.includes('AI_RISK_OWNER')||!permissions.has('dashboard.view.airs'))throw new ForbiddenException('Risk review report requires actual Risk Owner dashboard authority');
        where={AND:[where,{owner:{is:{userId}}}]};
      }
    }
    where={AND:[where,{isSampleData:false,riskRef:{not:null},useCase:{is:{isSampleData:false}}}]};
    return {actor,where,aggregateOnly,mode};
  }
  async report(userId:string,page=1,pageSize=25,filter='next30',search='') {
    const paging=aiReviewParams({page,pageSize,search});
    if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>200)throw new BadRequestException('Use a positive page and page size 1–200');
    if(!(REVIEW_FILTERS as readonly string[]).includes(filter))throw new BadRequestException('Unknown review filter');
    return this.prisma.$transaction(async tx=>{
      const access=await this.access(tx,userId),asOf=new Date();
      // Measures use the complete scoped population, independent of UI pagination.
      const members=await tx.aiRisk.findMany({where:access.where,select:{id:true}}),periodic=await aggregateReviewMeasures(tx,members.map(m=>m.id),asOf);
      const open:Prisma.AiRiskReviewWhereInput={completion:{is:null},cancellation:{is:null},retirement:{is:null}};
      const statusWhere:Record<string,Prisma.AiRiskReviewWhereInput>={all:{},next30:{...open,dueAt:{gte:asOf,lte:new Date(asOf.getTime()+30*86400000)}},overdue:{...open,dueAt:{lte:asOf}},due_soon:{...open,dueAt:{gt:asOf,lte:new Date(asOf.getTime()+7*86400000)}},scheduled:{...open,dueAt:{gt:new Date(asOf.getTime()+7*86400000)}},completed:{completion:{isNot:null},cancellation:{is:null}},superseded:{cancellation:{isNot:null}}};
      const calendarWhere:Prisma.AiRiskReviewWhereInput={risk:{is:access.where},retirement:{is:null},...statusWhere[filter],...(search.trim()?{OR:[{risk:{is:{title:{contains:search.trim(),mode:'insensitive'}}}},{risk:{is:{riskRef:{contains:search.trim(),mode:'insensitive'}}}}]}:{})};
      const calendarTotal=access.aggregateOnly?0:await tx.aiRiskReview.count({where:calendarWhere});
      const calendar=access.aggregateOnly?[]:await tx.aiRiskReview.findMany({where:calendarWhere,orderBy:[{dueAt:'asc'},{id:'asc'}],skip:(page-1)*pageSize,take:pageSize,
        select:{id:true,riskId:true,dueAt:true,bandCode:true,completion:{select:{completedAt:true}},cancellation:{select:{id:true}},risk:{select:{riskRef:true,title:true}}}});
      return {asOf,mode:access.mode,aggregateOnly:access.aggregateOnly,periodic,filter,calendar:calendar.map(r=>({...r,completion:undefined,cancellation:undefined,status:r.cancellation?'superseded':aiReviewStatus(!!r.completion,r.dueAt,asOf)})),calendarTotal,...toPaged(calendar.map(r=>({...r,completion:undefined,cancellation:undefined,status:r.cancellation?'superseded':aiReviewStatus(!!r.completion,r.dueAt,asOf)})),calendarTotal,paging)};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});
  }
  async detail(userId:string,reviewId:string){return this.prisma.$transaction(async tx=>{
    const a=await this.access(tx,userId,true);if(a.aggregateOnly)throw new ForbiddenException('Executive report authority provides aggregate measures only');
    const review=await tx.aiRiskReview.findFirst({where:{id:reviewId,risk:{is:a.where}},select:{id:true,round:true,riskId:true,dueAt:true,anchorAt:true,bandCode:true,intervalDays:true,referenceVersionId:true,cadenceReferenceVersionId:true,cadenceCode:true,displayCadenceLabelEn:true,displayCadenceLabelAr:true,
      risk:{select:{riskRef:true,title:true}},retirement:{select:{createdAt:true,requestId:true}},completion:{select:{completedAt:true,justification:true,evidenceIds:true}},cancellation:{select:{createdAt:true,reassessment:{select:{triggerCode:true,justification:true}}}},signals:{orderBy:{threshold:'asc'},select:{threshold:true,createdAt:true}}}});
    if(!review)throw new NotFoundException('Scoped review not found');return {...review,readOnly:true,status:review.retirement?'retired':review.cancellation?'superseded':aiReviewStatus(!!review.completion,review.dueAt)};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});}
}
