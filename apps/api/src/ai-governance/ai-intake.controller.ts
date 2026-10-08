import { AiReviewQueryDto } from './ai-review-query.dto';
import { RequireAnyPermissions } from '../auth/decorators';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AiRegisterQueryDto } from './ai-register-query.dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { CloseAiIntakeDto, CreateAiIntakeDraftDto, SubmitAiIntakeDto, TriageAiIntakeDto, UpdateAiIntakeDraftDto } from './ai-intake.dto';
import { AiIntakeService } from './ai-intake.service';

@Controller('ai/use-cases')
// Service methods additionally enforce purpose grants, scope, assignment and independent duties.
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.exec.ai')
export class AiIntakeController {
  constructor(private readonly service: AiIntakeService) {}

  @Post()
  @RequirePermissions('case.create.aiuc')
  create(@Body() dto: CreateAiIntakeDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.createDraft(user.id, dto.payload ?? {});
  }

  @Get()
  list(@CurrentUser() user: AuthUser,@Query() query:AiRegisterQueryDto) {
    return this.service.listVisible(user.id,query);
  }

  @Get('lookups')
  lookups(@CurrentUser() user: AuthUser) {
    return this.service.lookups(user.id);
  }

  @Get('triage')
  @RequireAnyPermissions('aiuc.classify.assess','case.view.aiuc.org','case.view.aiuc.all')
  triageQueue(@CurrentUser() user: AuthUser, @Query() query: AiReviewQueryDto) {
    return this.service.triageQueue(user.id, query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.getVisible(user.id, id);
  }
  @Get(':id/closure')
  closure(@Param('id',ParseUUIDPipe) id:string,@CurrentUser() user:AuthUser){return this.service.closureContext(user.id,id);}
  @Post(':id/closure')
  close(@Param('id',ParseUUIDPipe) id:string,@Body() dto:CloseAiIntakeDto,@CurrentUser() user:AuthUser){return this.service.closeRequest(user.id,id,dto.expectedVersion,dto.mode,dto.justification,dto.evidenceIds);}

  @Patch(':id/intake')
  @RequirePermissions('case.create.aiuc')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiIntakeDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateDraft(user.id, id, dto.expectedVersion, dto.changes);
  }

  @Post(':id/submit')
  @RequirePermissions('case.create.aiuc')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAiIntakeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.submit(user.id, id, dto.expectedVersion);
  }


  @Post(':id/resubmit')
  @RequirePermissions('case.create.aiuc')
  resubmit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAiIntakeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.resubmit(user.id, id, dto.expectedVersion);
  }

  @Post(':id/triage')
  @RequirePermissions('aiuc.classify.assess')
  triage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TriageAiIntakeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.triage(user.id, id, dto.expectedVersion, dto.decision, dto.justification);
  }
}
