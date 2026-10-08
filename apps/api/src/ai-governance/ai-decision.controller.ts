import { AiReviewQueryDto } from './ai-review-query.dto';
import { RequireAnyPermissions } from '../auth/decorators';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiDecisionService } from './ai-decision.service';
import { RecordAiucDecisionDto } from './ai-decision.dto';

@Controller('ai/use-cases/decisions')
// Service methods additionally enforce purpose grants, scope, assignment and independent duties.
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.exec.ai')
export class AiDecisionController {
  constructor(private readonly service: AiDecisionService) {}

  @Get('queue')
  @RequireAnyPermissions('case.approve.aiuc','case.view.aiuc.org','case.view.aiuc.all')
  queue(@CurrentUser() user: AuthUser, @Query() query: AiReviewQueryDto) { return this.service.queue(user.id, query); }

  @Post(':id/:taskId')
  @RequirePermissions('case.approve.aiuc')
  record(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: RecordAiucDecisionDto,
    @Req() req: Request,
  ) {
    return this.service.record(user.id, id, taskId, dto, req.ip ?? req.socket?.remoteAddress);
  }
}
