import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiRiskVersionDto, AssignAiRiskOwnerDto, SaveAiRiskIntakeDto } from './ai-risk-intake.dto';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { AiRiskAssessmentService } from './ai-risk-assessment.service';
import { CompleteRiskAssessmentDto, RestartRiskAssessmentDto, RiskDimensionScoreDto } from './ai-risk-assessment.dto';

@Controller('ai/risks')
export class AiRiskIntakeController {
  constructor(private readonly service: AiRiskIntakeService, private readonly assessments: AiRiskAssessmentService) {}
  // Authenticated reads enforce own/org/all alternatives with live grants and data scope.
  @Get() list(@CurrentUser() user: AuthUser) { return this.service.list(user.id); }
  @Get('lookups') lookups(@CurrentUser() user: AuthUser) { return this.service.lookups(user.id); }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(user.id, id); }
  @Get(':id/assessment') assessment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.assessments.context(user.id, id); }
  @Post(':id/assessment/start') @RequirePermissions('airs.risk.assess')
  startAssessment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AiRiskVersionDto, @Req() req: Request) {
    return this.assessments.start(user.id, id, dto.expectedVersion, req.ip ?? req.socket?.remoteAddress);
  }
  @Post(':id/assessment/tasks/:taskId') @RequirePermissions('airs.risk.assess')
  contribute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: RiskDimensionScoreDto, @Req() req: Request) { return this.assessments.contribute(user.id, id, taskId, dto, req.ip ?? req.socket?.remoteAddress); }
  @Post(':id/assessment/restart') @RequirePermissions('airs.risk.assess')
  restartAssessment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RestartRiskAssessmentDto, @Req() req: Request) {
    return this.assessments.start(user.id, id, dto.expectedVersion, req.ip ?? req.socket?.remoteAddress, true, dto.justification);
  }
  @Post(':id/assessment/complete') @RequirePermissions('airs.risk.assess')
  completeAssessment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteRiskAssessmentDto, @Req() req: Request) {
    return this.assessments.complete(user.id, id, dto, req.ip ?? req.socket?.remoteAddress);
  }
  @Post(':id/owner') @RequirePermissions('case.create.airs')
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignAiRiskOwnerDto, @Req() req: Request) {
    return this.service.assign(user.id, id, dto, req.ip ?? req.socket?.remoteAddress);
  }
  @Patch(':id/intake') @RequirePermissions('case.create.airs')
  save(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAiRiskIntakeDto, @Req() req: Request) {
    return this.service.save(user.id, id, dto.expectedVersion, dto.input, req.ip ?? req.socket?.remoteAddress);
  }
  @Post(':id/submit') @RequirePermissions('case.create.airs')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AiRiskVersionDto, @Req() req: Request) {
    return this.service.submit(user.id, id, dto.expectedVersion, req.ip ?? req.socket?.remoteAddress);
  }
}
