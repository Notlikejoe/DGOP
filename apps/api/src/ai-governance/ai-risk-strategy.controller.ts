import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { CompleteAiRiskReviewDto } from './ai-risk-review.dto';
import { AiRiskStrategyService, StrategyAction } from './ai-risk-strategy.service';
class StrategyDto extends CompleteAiRiskReviewDto {
  @IsIn(['propose','approve','return','close','open-escalation','advance','return-for-response']) action!:StrategyAction;
  @IsOptional() @IsIn(['scope_change','stop_use_case']) avoidanceAction?:'scope_change'|'stop_use_case';
  @IsOptional() @IsString() @MaxLength(5000) scopeChange?:string;
}
@Controller('ai/risks/:id/strategy')
export class AiRiskStrategyController {
  constructor(private readonly strategy:AiRiskStrategyService){}
  @Get() context(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.strategy.context(user.id,id);}
  @Post() act(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:StrategyDto,@Req() req:Request){return this.strategy.act(user.id,id,dto,req.ip);}
}
