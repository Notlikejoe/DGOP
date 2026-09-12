import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiAnnualReviewService } from './ai-annual-review.service';
import { AiReviewReportService } from './ai-review-report.service';
import { CompleteAnnualReviewDto, RegisterAnnualReviewDto } from './ai-review-operations.dto';

@Controller('ai/review-operations')
export class AiReviewOperationsController {
  constructor(private readonly annual:AiAnnualReviewService,private readonly reports:AiReviewReportService){}
  @Get('report') report(@CurrentUser() u:AuthUser,@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) pageSize:number){return this.reports.report(u.id,page,pageSize);}
  @Get('units') units(@CurrentUser() u:AuthUser){return this.annual.units(u.id);}
  @Get('annual/:unitId') context(@CurrentUser() u:AuthUser,@Param('unitId',ParseUUIDPipe) unitId:string){return this.annual.context(u.id,unitId);}
  @Post('annual') register(@CurrentUser() u:AuthUser,@Body() dto:RegisterAnnualReviewDto,@Req() req:Request){return this.annual.register(u.id,dto.organizationUnitId,req.ip);}
  @Post('annual/:reviewId/complete') complete(@CurrentUser() u:AuthUser,@Param('reviewId',ParseUUIDPipe) id:string,@Body() dto:CompleteAnnualReviewDto,@Req() req:Request){return this.annual.complete(u.id,id,dto,req.ip);}
}
