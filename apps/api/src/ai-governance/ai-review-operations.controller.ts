import { RequireAnyPermissions } from '../auth/decorators';
import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiAnnualReviewService } from './ai-annual-review.service';
import { AiReviewReportService } from './ai-review-report.service';
import { CaptureMonthlyReviewDto, CompleteAnnualReviewDto, HandoverAnnualReviewDto, RegisterAnnualReviewDto } from './ai-review-operations.dto';
import { AiReviewDisplayService } from './ai-review-display.service';
import { AiMonthlyReviewService } from './ai-monthly-review.service';

@Controller('ai/review-operations')
// Service methods additionally enforce purpose grants, scope, assignment and independent duties.
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.exec.ai')
export class AiReviewOperationsController {
  constructor(private readonly annual:AiAnnualReviewService,private readonly reports:AiReviewReportService,private readonly display:AiReviewDisplayService,private readonly monthly:AiMonthlyReviewService){}
  @Get('cadence-config') cadence(@CurrentUser() u:AuthUser){return this.display.read(u.id);}
  @Get('report') report(@CurrentUser() u:AuthUser,@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) pageSize:number,@Query('filter',new DefaultValuePipe('next30')) filter:string){return this.reports.report(u.id,page,pageSize,filter);}
  @Get('reviews/:reviewId') detail(@CurrentUser() u:AuthUser,@Param('reviewId',ParseUUIDPipe) id:string){return this.reports.detail(u.id,id);}
  @Get('units') units(@CurrentUser() u:AuthUser){return this.annual.units(u.id);}
  @Get('annual/:unitId') context(@CurrentUser() u:AuthUser,@Param('unitId',ParseUUIDPipe) unitId:string){return this.annual.context(u.id,unitId);}
  @Post('annual') register(@CurrentUser() u:AuthUser,@Body() dto:RegisterAnnualReviewDto,@Req() req:Request){return this.annual.register(u.id,dto.organizationUnitId,req.ip);}
  @Post('annual/:reviewId/complete') complete(@CurrentUser() u:AuthUser,@Param('reviewId',ParseUUIDPipe) id:string,@Body() dto:CompleteAnnualReviewDto,@Req() req:Request){return this.annual.complete(u.id,id,dto,req.ip);}
  @Post('annual/:reviewId/handover') handover(@CurrentUser() u:AuthUser,@Param('reviewId',ParseUUIDPipe) id:string,@Body() dto:HandoverAnnualReviewDto,@Req() req:Request){return this.annual.handover(u.id,id,dto,req.ip);}
  @Post('monthly') capture(@CurrentUser() u:AuthUser,@Body() dto:CaptureMonthlyReviewDto,@Req() req:Request){return this.monthly.capture(u.id,dto.organizationUnitId,dto.periodMonth,req.ip);}
  @Get('monthly/:unitId') months(@CurrentUser() u:AuthUser,@Param('unitId',ParseUUIDPipe) id:string){return this.monthly.list(u.id,id);}
  @Get('monthly-snapshots/:snapshotId') snapshot(@CurrentUser() u:AuthUser,@Param('snapshotId',ParseUUIDPipe) id:string){return this.monthly.get(u.id,id);}
}
