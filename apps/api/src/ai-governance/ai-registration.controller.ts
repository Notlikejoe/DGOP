import { AiReviewQueryDto } from './ai-review-query.dto';
import { RequireAnyPermissions } from '../auth/decorators';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiRegistrationService } from './ai-registration.service';
import { ApproveAiRegistrationDto, ProposeAiRegistrationDto } from './ai-registration.dto';

@Controller('ai/use-cases/registration')
// Service methods additionally enforce purpose grants, scope, assignment and independent duties.
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.exec.ai')
export class AiRegistrationController {
  constructor(private readonly service: AiRegistrationService) {}

  // Both authenticated reads enforce live register-or-approve authorization in the service.
  @Get('queue')
  queue(@CurrentUser() user: AuthUser, @Query() query: AiReviewQueryDto) { return this.service.queue(user.id, query); }

  @Get('lookups')
  lookups(@CurrentUser() user: AuthUser) { return this.service.lookups(user.id); }

  @Post(':id/:taskId/propose')
  @RequirePermissions('aiuc.asset.register')
  propose(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: ProposeAiRegistrationDto, @Req() req: Request) {
    return this.service.propose(user.id, id, taskId, dto, req.ip ?? req.socket?.remoteAddress);
  }

  @Post(':id/:taskId/decide')
  @RequirePermissions('aiuc.asset.approve')
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: ApproveAiRegistrationDto, @Req() req: Request) {
    return this.service.decide(user.id, id, taskId, dto, req.ip ?? req.socket?.remoteAddress);
  }
}
