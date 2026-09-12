import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiDashboardService } from './ai-dashboard.service';
@Controller('ai/dashboard')
export class AiDashboardController {
 constructor(private readonly dashboard:AiDashboardService){}
 @Get() summary(@CurrentUser() u:AuthUser){return this.dashboard.summary(u.id);}
 @Get('drilldown') drilldown(@CurrentUser() u:AuthUser,@Query('filter') filter:string,@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) size:number){return this.dashboard.drilldown(u.id,filter,page,size);}
}
