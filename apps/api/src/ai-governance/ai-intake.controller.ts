import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { CloseAiIntakeDto, CreateAiIntakeDraftDto, SubmitAiIntakeDto, TriageAiIntakeDto, UpdateAiIntakeDraftDto } from './ai-intake.dto';
import { AiIntakeService } from './ai-intake.service';

@Controller('ai/use-cases')
export class AiIntakeController {
  constructor(private readonly service: AiIntakeService) {}

  @Post()
  @RequirePermissions('case.create.aiuc')
  create(@Body() dto: CreateAiIntakeDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.createDraft(user.id, dto.payload ?? {});
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.listVisible(user.id);
  }

  @Get('lookups')
  lookups(@CurrentUser() user: AuthUser) {
    return this.service.lookups(user.id);
  }

  @Get('triage')
  @RequirePermissions('aiuc.classify.assess')
  triageQueue(@CurrentUser() user: AuthUser) {
    return this.service.triageQueue(user.id);
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
