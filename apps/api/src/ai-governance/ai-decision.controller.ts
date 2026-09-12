import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiDecisionService } from './ai-decision.service';
import { RecordAiucDecisionDto } from './ai-decision.dto';

@Controller('ai/use-cases/decisions')
export class AiDecisionController {
  constructor(private readonly service: AiDecisionService) {}

  @Get('queue')
  @RequirePermissions('case.approve.aiuc')
  queue(@CurrentUser() user: AuthUser) { return this.service.queue(user.id); }

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
