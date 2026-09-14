import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { CompleteAiRiskReviewDto } from './ai-risk-review.dto';
import { AiSeverityService, SeverityInput } from './ai-severity.service';
class SeverityDto extends CompleteAiRiskReviewDto {
 @IsIn(['propose','approve','return','reverse']) action!:SeverityInput['action'];
 @IsOptional() @IsIn(['P1','P2','P3','P4']) severityCode?:string;
}
@Controller('ai/risks/:id/severity')
export class AiSeverityController {
 constructor(private readonly severity:AiSeverityService){}
 @Get() context(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.severity.context(u.id,id);}
 @Post() act(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SeverityDto,@Req() req:Request){return this.severity.act(u.id,id,dto,req.ip);}
}
