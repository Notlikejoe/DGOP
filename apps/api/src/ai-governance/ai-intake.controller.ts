import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { CreateAiIntakeDraftDto, SubmitAiIntakeDto, UpdateAiIntakeDraftDto } from './ai-intake.dto';
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
  @RequirePermissions('case.view.aiuc.own')
  list(@CurrentUser() user: AuthUser) {
    return this.service.listOwn(user.id);
  }

  @Get(':id')
  @RequirePermissions('case.view.aiuc.own')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.getOwn(user.id, id);
  }

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
}
