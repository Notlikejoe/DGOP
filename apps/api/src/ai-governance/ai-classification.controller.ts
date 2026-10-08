import { AiReviewQueryDto } from './ai-review-query.dto';
import { RequireAnyPermissions } from '../auth/decorators';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiClassificationService } from './ai-classification.service';
import {
  CreateAiClassificationDto,
  OverrideAiClassificationDto,
  ReviewAiClassificationGateDto,
  ReturnAiClassificationDto,
  UnacceptableAiClassificationDto,
  VerifyAiClassificationDto,
} from './ai-classification.dto';

@Controller('ai/use-cases/classification')
// Service methods additionally enforce purpose grants, scope, assignment and independent duties.
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.exec.ai')
export class AiClassificationController {
  constructor(private readonly service: AiClassificationService) {}

  @Get('configuration')
  @RequireAnyPermissions('aiuc.classify.assess','case.view.aiuc.org','case.view.aiuc.all')
  configuration(@CurrentUser() user: AuthUser) {
    return this.service.configuration(user.id);
  }

  @Get('queue')
  @RequireAnyPermissions('aiuc.classify.assess','case.view.aiuc.org','case.view.aiuc.all')
  queue(@CurrentUser() user: AuthUser, @Query() query: AiReviewQueryDto) {
    return this.service.queue(user.id, query);
  }

  @Get('verification/queue')
  @RequireAnyPermissions('aiuc.classify.assess','case.view.aiuc.org','case.view.aiuc.all')
  verificationQueue(@CurrentUser() user: AuthUser, @Query() query: AiReviewQueryDto) {
    return this.service.verificationQueue(user.id, query);
  }

  @Get('reviews/queue')
  @RequirePermissions('case.view.aiuc.org')
  reviewQueue(@CurrentUser() user: AuthUser, @Query() query: AiReviewQueryDto) {
    return this.service.reviewQueue(user.id, query);
  }

  @Post(':id/assess')
  @RequirePermissions('aiuc.classify.assess')
  assess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAiClassificationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.assess(user.id, id, dto.expectedVersion, dto.input);
  }

  @Post(':id/verify')
  @RequirePermissions('aiuc.classify.assess')
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyAiClassificationDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.verify(user.id, id, dto.expectedVersion, dto.justification, req.ip ?? req.socket?.remoteAddress, dto.evidenceIds);
  }

  @Post(':id/return')
  @RequirePermissions('aiuc.classify.assess')
  returnForReassessment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnAiClassificationDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.returnForReassessment(user.id, id, dto.expectedVersion, dto.justification, req.ip ?? req.socket?.remoteAddress);
  }

  @Post(':id/override')
  @RequirePermissions('aiuc.classify.override')
  override(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OverrideAiClassificationDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.override(user.id, id, dto.expectedVersion, dto.approvedTierCode, dto.justification,
      dto.evidenceIds, dto.authorityReference, req.ip ?? req.socket?.remoteAddress);
  }

  @Post(':id/unacceptable')
  @RequirePermissions('aiuc.tier.unacceptable')
  unacceptable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnacceptableAiClassificationDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.unacceptable(user.id, id, dto.expectedVersion, dto.justification,
      dto.evidenceIds, dto.authorityReference, req.ip ?? req.socket?.remoteAddress);
  }

  @Get(':id/reversal')
  reversalContext(@Param('id',ParseUUIDPipe) id:string,@CurrentUser() user:AuthUser){return this.service.reversalContext(user.id,id);}
  @Post(':id/reversal')
  @RequirePermissions('aiuc.classify.reverse')
  reverse(@Param('id',ParseUUIDPipe) id:string,@Body() dto:UnacceptableAiClassificationDto,@CurrentUser() user:AuthUser,@Req() req:Request){return this.service.reverseOverride(user.id,id,dto.expectedVersion,dto.justification,dto.evidenceIds,dto.authorityReference,req.ip??req.socket.remoteAddress);}


  @Post(':id/reviews/:taskId')
  @RequirePermissions('case.view.aiuc.org')
  reviewGate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: ReviewAiClassificationGateDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.reviewGate(user.id, id, taskId, dto.expectedVersion, dto.decision,
      dto.justification, dto.evidenceIds, req.ip ?? req.socket?.remoteAddress);
  }
}
