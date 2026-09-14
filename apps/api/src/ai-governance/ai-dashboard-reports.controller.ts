import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { CaptureDashboardDto, ConfigureDashboardScheduleDto } from './ai-dashboard-reports.dto';
import { AiDashboardReportsService } from './ai-dashboard-reports.service';
@Controller('ai/dashboard-reports')
export class AiDashboardReportsController {
 constructor(private readonly reports:AiDashboardReportsService){}
 @Get('units') units(@CurrentUser() u:AuthUser){return this.reports.units(u.id);}
 @Get('units/:unitId/basis') basis(@CurrentUser() u:AuthUser,@Param('unitId',ParseUUIDPipe) unitId:string,@Query('frequency',new DefaultValuePipe('daily')) frequency:string){return this.reports.currentBasis(u.id,unitId,frequency);}
 @Post('snapshots') capture(@CurrentUser() u:AuthUser,@Body() dto:CaptureDashboardDto){return this.reports.capture(u.id,dto.organizationUnitId,dto.frequency);}
 @Get('units/:unitId/snapshots') list(@CurrentUser() u:AuthUser,@Param('unitId',ParseUUIDPipe) unitId:string,@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) size:number){return this.reports.list(u.id,unitId,page,size);}
 // Keep raw pagination untyped until ParseIntPipe: global implicit conversion would turn invalid strings into NaN and let DefaultValuePipe hide them.
 @Get('units/:unitId/trend') trend(@CurrentUser() u:AuthUser,@Param('unitId',ParseUUIDPipe) unitId:string,@Query('kpiId',new DefaultValuePipe('GEN-85')) kpi:string,@Query('frequency',new DefaultValuePipe('manual')) frequency:string,@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:unknown,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) size:unknown){return this.reports.trend(u.id,unitId,kpi,frequency,Number(page),Number(size));}
 @Get('units/:unitId/schedule') schedule(@CurrentUser() u:AuthUser,@Param('unitId',ParseUUIDPipe) unitId:string){return this.reports.schedule(u.id,unitId);}
 @Post('units/:unitId/schedule') configure(@CurrentUser() u:AuthUser,@Param('unitId',ParseUUIDPipe) unitId:string,@Body() dto:ConfigureDashboardScheduleDto){return this.reports.configure(u.id,unitId,dto);}
 @Get('compare') compare(@CurrentUser() u:AuthUser,@Query('leftId',ParseUUIDPipe) left:string,@Query('rightId',ParseUUIDPipe) right:string){return this.reports.compare(u.id,left,right);}
 @Get('snapshots/:id') get(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.reports.get(u.id,id);}
 @Get('snapshots/:id/export') async csv(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Res() res:Response){const csv=await this.reports.csv(u.id,id);res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="DGOP-AI-${id}.csv"`);res.send(csv);}
}
