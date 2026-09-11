import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiClassificationService } from './ai-classification.service';
import {
  CreateAiClassificationDto,
  OverrideAiClassificationDto,
  ReturnAiClassificationDto,
  UnacceptableAiClassificationDto,
  VerifyAiClassificationDto,
} from './ai-classification.dto';

@Controller('ai/use-cases/classification')
export class AiClassificationController {
  constructor(private readonly service: AiClassificationService) {}

  @Get('configuration')
  @RequirePermissions('aiuc.classify.assess')
  configuration(@CurrentUser() user: AuthUser) {
    return this.service.configuration(user.id);
  }

  @Get('queue')
  @RequirePermissions('aiuc.classify.assess')
  queue(@CurrentUser() user: AuthUser) {
    return this.service.queue(user.id);
  }

  @Get('verification/queue')
  @RequirePermissions('aiuc.classify.assess')
  verificationQueue(@CurrentUser() user: AuthUser) {
    return this.service.verificationQueue(user.id);
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
    return this.service.verify(user.id, id, dto.expectedVersion, dto.justification, req.ip ?? req.socket?.remoteAddress);
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
}
