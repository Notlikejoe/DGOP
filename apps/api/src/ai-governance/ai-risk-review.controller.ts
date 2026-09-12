import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiRiskVersionDto } from './ai-risk-intake.dto';
import { CompleteAiRiskReviewDto, ReassessAiRiskDto } from './ai-risk-review.dto';
import { AiRiskReviewService } from './ai-risk-review.service';

@Controller('ai/risks/:id/reviews')
export class AiRiskReviewController {
  constructor(private readonly reviews:AiRiskReviewService){}
  @Get() context(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.reviews.context(user.id,id);}
  @Post('reassess')
  reassess(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReassessAiRiskDto,@Req() req:Request){return this.reviews.reassess(user.id,id,dto,req.ip);}
  @Post('triggers')
  trigger(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReassessAiRiskDto,@Req() req:Request){return this.reviews.addTrigger(user.id,id,dto,req.ip);}
  @Post('register') @RequirePermissions('airs.cadence.manage')
  register(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:AiRiskVersionDto,@Req() req:Request){return this.reviews.register(user.id,id,dto.expectedVersion,req.ip);}
  @Post('recalculate') @RequirePermissions('airs.cadence.manage')
  recalculate(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:AiRiskVersionDto){return this.reviews.recalculate(user.id,id,dto.expectedVersion);}
  @Post(':reviewId/complete') @RequirePermissions('airs.risk.assess')
  complete(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('reviewId',ParseUUIDPipe) reviewId:string,@Body() dto:CompleteAiRiskReviewDto,@Req() req:Request){return this.reviews.complete(user.id,id,reviewId,dto,req.ip);}
}
