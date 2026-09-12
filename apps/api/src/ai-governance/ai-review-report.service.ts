import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../access/scope.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { aiRoleMayHold, AiPermission, splitAiPermission } from './ai-permissions';
import { aiReviewStatus } from './ai-risk-review.service';

export interface ReviewMeasure {dueAt:Date;completion:{completedAt:Date}|null;cancellation?:unknown}
export function reviewMeasures(rows:ReviewMeasure[],asOf:Date) {
  const active=rows.filter(r=>!r.cancellation),due=active.filter(r=>r.dueAt<=asOf);
  const closedOnTime=due.filter(r=>r.completion&&r.completion.completedAt<=r.dueAt).length;
  return {total:rows.length,superseded:rows.length-active.length,completed:active.filter(r=>!!r.completion).length,
    overdue:due.filter(r=>!r.completion).length,due:due.length,closedOnTime,
    onTimePercent:due.length?Math.round(closedOnTime/due.length*10000)/100:null,
    dueSoon:active.filter(r=>!r.completion&&aiReviewStatus(false,r.dueAt,asOf)==='due_soon').length};
}
const reportPermissions:AiPermission[]=['dashboard.view.aiuc','dashboard.view.airs','dashboard.view.exec.ai','case.view.airs.all'];

@Injectable()
export class AiReviewReportService {
  constructor(private readonly prisma:PrismaService,private readonly authorization:AiAuthorizationService,
    private readonly scope:ScopeService,private readonly risks:AiRiskIntakeService){}

  async access(tx:Prisma.TransactionClient,userId:string) {
    const actor=await this.authorization.authorizeAny(userId,reportPermissions,tx);
    const grants=await tx.rolePermission.findMany({where:{role:{is:{code:{in:actor.roles},isActive:true,deletedAt:null}},
      permission:{is:{OR:reportPermissions.map(splitAiPermission)}}},include:{permission:true,role:{select:{code:true}}}});
    const permissions=new Set(grants.filter(g=>aiRoleMayHold(g.role.code,`${g.permission.resource}.${g.permission.action}` as AiPermission)).map(g=>`${g.permission.resource}.${g.permission.action}`));
    const governance=permissions.has('case.view.airs.all')&&!permissions.has('dashboard.view.exec.ai')||permissions.has('dashboard.view.aiuc')||permissions.has('dashboard.view.airs')&&actor.roles.some(r=>['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER','AI_COMPLIANCE_OFFICER'].includes(r));
    const aggregateOnly=!governance&&!actor.roles.includes('auditor')&&permissions.has('dashboard.view.exec.ai');
    const mode=aggregateOnly?'executive':actor.roles.includes('auditor')?'audit':governance?'governance':'risk_owner';
    let where:Prisma.AiRiskWhereInput;
    if(aggregateOnly){
      const scope=await this.scope.resolve(actor.roles);
      where={deletedAt:null,workflowCase:{is:{type:'AIRS'}},useCase:{is:{deletedAt:null,asset:{is:{isActive:true,deletedAt:null,
        ...(scope.orgUnits==='all'?{}:{orgUnitId:{in:scope.orgUnits}}),...(scope.domains==='all'?{}:{domainId:{in:scope.domains}}),
        ...(scope.maxClassRank===null?{}:{classification:{is:{rank:{lte:scope.maxClassRank}}}})}}}}};
    }else{
      where=(await this.risks.visibility(userId,tx)).where;
      if(mode==='risk_owner'){
        if(!actor.roles.includes('AI_RISK_OWNER')||!permissions.has('dashboard.view.airs'))throw new ForbiddenException('Risk review report requires actual Risk Owner dashboard authority');
        where={AND:[where,{owner:{is:{userId}}}]};
      }
    }
    where={AND:[where,{isSampleData:false,riskRef:{not:null},useCase:{is:{isSampleData:false}}}]};
    return {actor,where,aggregateOnly,mode};
  }
  async report(userId:string,page=1,pageSize=20) {
    if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new BadRequestException('Use a positive page and page size 1–100');
    return this.prisma.$transaction(async tx=>{
      const access=await this.access(tx,userId),asOf=new Date();
      // Measures use the complete scoped population, independent of UI pagination.
      const rows=await tx.aiRiskReview.findMany({where:{risk:{is:access.where}},select:{dueAt:true,completion:{select:{completedAt:true}},cancellation:{select:{id:true}}}});
      const next30=new Date(asOf.getTime()+30*86400000),calendarWhere:Prisma.AiRiskReviewWhereInput={risk:{is:access.where},completion:{is:null},cancellation:{is:null},dueAt:{gte:asOf,lte:next30}};
      const calendarTotal=access.aggregateOnly?0:await tx.aiRiskReview.count({where:calendarWhere});
      const calendar=access.aggregateOnly?[]:await tx.aiRiskReview.findMany({where:calendarWhere,orderBy:[{dueAt:'asc'},{id:'asc'}],skip:(page-1)*pageSize,take:pageSize,
        select:{id:true,riskId:true,dueAt:true,bandCode:true,risk:{select:{riskRef:true,title:true}}}});
      return {asOf,mode:access.mode,aggregateOnly:access.aggregateOnly,periodic:reviewMeasures(rows,asOf),calendar:calendar.map(r=>({...r,status:aiReviewStatus(false,r.dueAt,asOf)})),calendarTotal,page,pageSize};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});
  }
}
