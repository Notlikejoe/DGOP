import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiAnnualReviewService } from './ai-annual-review.service';
import { aggregateReviewMeasures } from './ai-review-report.service';

import { AiReviewQueryDto, aiReviewParams } from './ai-review-query.dto';
import { scopedHistoryPage, visibleSnapshots, snapshotMemberIds } from './ai-review-history';

export function monthlyReviewWindow(month:string,now=new Date()){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)||Number(month.slice(0,4))<2000)throw new BadRequestException('Use a valid closed reporting month YYYY-MM');
  const year=Number(month.slice(0,4)),m=Number(month.slice(5)),start=new Date(Date.UTC(year,m-1,1)-10800000),end=new Date(Date.UTC(year,m,1)-10800001);
  const shifted=new Date(now.getTime()+10800000),currentStart=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),1)-10800000;
  if(end.getTime()>=currentStart)throw new BadRequestException('Only a completed Saudi calendar month can be captured');
  return {start,end};
}
const options={isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000,maxWait:15000};
@Injectable()
export class AiMonthlyReviewService {
  constructor(private readonly prisma:PrismaService,private readonly annual:AiAnnualReviewService,private readonly audit:AuditService){}
  async capture(userId:string,unitId:string,periodMonth:string,clientIp?:string){
    const window=monthlyReviewWindow(periodMonth);
    return this.prisma.$transaction(async tx=>{
      const access=await this.annual.registerScope(tx,userId,unitId,true),capturedAt=new Date();
      if(await tx.aiMonthlyReviewReport.findUnique({where:{organizationUnitId_periodMonth:{organizationUnitId:unitId,periodMonth}}}))throw new ConflictException('This organization month already has an immutable snapshot');
      const members=await tx.aiRisk.findMany({where:access.where,select:{id:true,version:true},orderBy:{id:'asc'}}),measures=await aggregateReviewMeasures(tx,members.map(m=>m.id),capturedAt,window);
      const row=await tx.aiMonthlyReviewReport.create({data:{organizationUnitId:unitId,periodMonth,periodStart:window.start,periodEnd:window.end,capturedAt,createdBy:userId,members,measures,clientIp}});
      await this.audit.logRequired({actor:userId,action:'ai.review.report.monthly.capture',entityType:'ai_monthly_review_report',entityId:row.id,metadata:{organizationUnitId:unitId,periodMonth,capturedAt,sourceCount:members.length,clientIp:clientIp??null}},tx);
      return {id:row.id};
    },options);
  }
  private async visible(tx:Prisma.TransactionClient,userId:string,row:{organizationUnitId:string;members:Prisma.JsonValue}){
    const access=await this.annual.historyScope(tx,userId,row.organizationUnitId);
    if(!(await visibleSnapshots(tx,access.where,[row],r=>r.members)).length)throw new ForbiddenException('Monthly snapshot source is outside current register visibility');
    return snapshotMemberIds(row.members)!.length;
  }
  async list(userId:string,unitId:string,query:AiReviewQueryDto=new AiReviewQueryDto()){
    aiReviewParams(query);
    return this.prisma.$transaction(async tx=>{
      const access=await this.annual.historyScope(tx,userId,unitId),search=(query.search??'').trim();
      const where:Prisma.AiMonthlyReviewReportWhereInput={organizationUnitId:unitId,...(search?{periodMonth:{contains:search,mode:'insensitive'}}:{})};
      let sourceCount=0;
      const paged=await scopedHistoryPage(query,cursor=>tx.aiMonthlyReviewReport.findMany({where,select:{id:true,periodMonth:true,capturedAt:true,members:true},orderBy:[{periodMonth:'desc'},{id:'asc'}],take:200,...(cursor?{cursor:{id:cursor},skip:1}:{})}),rows=>visibleSnapshots(tx,access.where,rows,r=>r.members),r=>{sourceCount+=snapshotMemberIds(r.members)!.length;});
      const rows=await tx.aiMonthlyReviewReport.findMany({where:{id:{in:paged.ids}},select:{id:true,periodMonth:true,capturedAt:true,members:true},orderBy:[{periodMonth:'desc'},{id:'asc'}]});
      return {...paged.envelope,data:rows.map(r=>({id:r.id,periodMonth:r.periodMonth,capturedAt:r.capturedAt,sourceCount:snapshotMemberIds(r.members)!.length})),summary:{total:paged.envelope.total,sourceCount},readOnly:true};
    },options);
  }
  async get(userId:string,id:string){return this.prisma.$transaction(async tx=>{
    const row=await tx.aiMonthlyReviewReport.findUnique({where:{id}});if(!row)throw new NotFoundException('Monthly snapshot not found');
    const sourceCount=await this.visible(tx,userId,row);return {id:row.id,organizationUnitId:row.organizationUnitId,periodMonth:row.periodMonth,periodStart:row.periodStart,periodEnd:row.periodEnd,capturedAt:row.capturedAt,sourceCount,measures:row.measures,readOnly:true};
  },options);}
}
