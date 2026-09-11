import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiClassificationService } from './ai-classification.service';
import { CreateAiClassificationDto } from './ai-classification.dto';

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

  @Post(':id/assess')
  @RequirePermissions('aiuc.classify.assess')
  assess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAiClassificationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.assess(user.id, id, dto.expectedVersion, dto.input);
  }
}
