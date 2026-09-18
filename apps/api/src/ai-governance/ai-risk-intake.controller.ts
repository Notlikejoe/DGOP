import { AiRiskInitiationService } from './ai-risk-initiation.service';
import { CreateAiRiskDto } from './ai-risk-library.dto';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiRiskVersionDto, AssignAiRiskOwnerDto, SaveAiRiskIntakeDto } from './ai-risk-intake.dto';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { AiRiskAssessmentService } from './ai-risk-assessment.service';
import { CompleteResidualAssessmentDto, CompleteRiskAssessmentDto, RestartRiskAssessmentDto, RiskDimensionScoreDto } from './ai-risk-assessment.dto';
import { AiResidualAssessmentService } from './ai-residual-assessment.service';
import { AiResidualDecisionService } from './ai-residual-decision.service';
import { DecideResidualRiskDto } from './ai-residual-decision.dto';
import { AiRiskAdoptionService } from './ai-risk-adoption.service';
import { ReviewRiskAssessmentDto } from './ai-risk-adoption.dto';
import { AiRiskResponseService } from './ai-risk-response.service';
import { ProposeRiskResponseDto } from './ai-risk-response.dto';
import { AiTreatmentService } from './ai-treatment.service';
import { RecordTreatmentProgressDto, SaveTreatmentActionDto } from './ai-treatment.dto';

@Controller('ai/risks')
export class AiRiskIntakeController {
  constructor(private readonly service: AiRiskIntakeService, private readonly assessments: AiRiskAssessmentService, private readonly adoption: AiRiskAdoptionService,
    private readonly responses: AiRiskResponseService, private readonly treatment: AiTreatmentService, private readonly residual: AiResidualAssessmentService, private readonly residualDecisions: AiResidualDecisionService, private readonly initiation: AiRiskInitiationService) {}
  // Authenticated reads enforce own/org/all alternatives with live grants and data scope.
  @Get('initiation') initiationContext(@CurrentUser() u:AuthUser){return this.initiation.context(u.id);}
  @Post() create(@CurrentUser() u:AuthUser,@Body() dto:CreateAiRiskDto){return this.initiation.create(u.id,dto);}
  @Get() list(@CurrentUser() user: AuthUser) { return this.service.list(user.id); }
  @Get('lookups') lookups(@CurrentUser() user: AuthUser) { return this.service.lookups(user.id); }
  @Get(':id/residual') residualContext(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.residual.context(user.id,id); }
  @Get(':id/residual/review') residualReview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.residualDecisions.context(user.id,id); }
  @Post(':id/residual/decisions/:taskId')
  decideResidual(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: DecideResidualRiskDto, @Req() req: Request) { return this.residualDecisions.decide(user.id,id,taskId,dto,req.ip); }
  @Post(':id/residual/start') @RequirePermissions('airs.risk.assess')
  startResidual(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AiRiskVersionDto, @Req() req: Request) { return this.residual.start(user.id,id,dto.expectedVersion,req.ip); }
  @Post(':id/residual/restart') @RequirePermissions('airs.risk.assess')
  restartResidual(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RestartRiskAssessmentDto, @Req() req: Request) { return this.residual.start(user.id,id,dto.expectedVersion,req.ip,true,dto.justification); }
  @Post(':id/residual/tasks/:taskId') @RequirePermissions('airs.risk.assess')
  contributeResidual(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: RiskDimensionScoreDto, @Req() req: Request) { return this.residual.contribute(user.id,id,taskId,dto,req.ip); }
  @Post(':id/residual/complete') @RequirePermissions('airs.risk.assess')
  completeResidual(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteResidualAssessmentDto, @Req() req: Request) { return this.residual.complete(user.id,id,dto,req.ip); }
  @Get(':id/treatment') treatmentContext(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.treatment.context(user.id,id); }
  @Post(':id/actions') @RequirePermissions('airs.risk.assess')
  addAction(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveTreatmentActionDto, @Req() req: Request) { return this.treatment.save(user.id,id,dto,undefined,req.ip); }
  @Patch(':id/actions/:actionId') @RequirePermissions('airs.risk.assess')
  editAction(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('actionId', ParseUUIDPipe) actionId: string, @Body() dto: SaveTreatmentActionDto, @Req() req: Request) { return this.treatment.save(user.id,id,dto,actionId,req.ip); }
  @Post(':id/treatment/submit') @RequirePermissions('airs.risk.assess')
  submitPlan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AiRiskVersionDto, @Req() req: Request) { return this.treatment.submit(user.id,id,dto.expectedVersion,req.ip); }
  @Post(':id/actions/:actionId/progress') @RequirePermissions('airs.risk.assess')
  progress(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('actionId', ParseUUIDPipe) actionId: string, @Body() dto: RecordTreatmentProgressDto, @Req() req: Request) { return this.treatment.execute(user.id,id,actionId,dto,req.ip); }
  @Post(':id/treatment/tasks/:taskId')
  reviewPlan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: ReviewRiskAssessmentDto, @Req() req: Request) { return this.treatment.review(user.id,id,taskId,dto,req.ip); }
  @Get(':id/response') responseContext(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.responses.context(user.id, id); }
  @Post(':id/response/prepare') @RequirePermissions('airs.risk.assess')
  prepareResponse(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AiRiskVersionDto, @Req() req: Request) {
    return this.responses.prepare(user.id, id, dto.expectedVersion, req.ip ?? req.socket?.remoteAddress);
  }
  @Post(':id/response/propose') @RequirePermissions('airs.risk.assess')
  proposeResponse(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProposeRiskResponseDto, @Req() req: Request) {
    return this.responses.propose(user.id, id, dto, req.ip ?? req.socket?.remoteAddress);
  }
  @Post(':id/response/tasks/:taskId')
  decideResponse(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: ReviewRiskAssessmentDto, @Req() req: Request) { return this.responses.decide(user.id, id, taskId, dto, req.ip ?? req.socket?.remoteAddress); }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(user.id, id); }
  @Get(':id/assessment') assessment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.assessments.context(user.id, id); }
  @Get(':id/assessment/adoption') adoptionContext(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.adoption.context(user.id, id); }
  @Post(':id/assessment/adoption/prepare') @RequirePermissions('case.approve.airs')
  prepareAdoption(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AiRiskVersionDto, @Req() req: Request) {
    return this.adoption.prepare(user.id, id, dto.expectedVersion, req.ip ?? req.socket?.remoteAddress);
  }
  // Service resolves the stage-specific explicit grant and scoped visibility live.
  @Post(':id/assessment/reviews/:taskId')
  reviewAssessment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: ReviewRiskAssessmentDto, @Req() req: Request) { return this.adoption.review(user.id, id, taskId, dto, req.ip ?? req.socket?.remoteAddress); }
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
  @Delete(':id')
  @RequirePermissions('case.create.airs')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AiRiskVersionDto, @Req() req: Request) {
    return this.service.remove(user.id, id, dto.expectedVersion, req.ip ?? req.socket?.remoteAddress);
  }
  @Post(':id/submit') @RequirePermissions('case.create.airs')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AiRiskVersionDto, @Req() req: Request) {
    return this.service.submit(user.id, id, dto.expectedVersion, req.ip ?? req.socket?.remoteAddress);
  }
}
