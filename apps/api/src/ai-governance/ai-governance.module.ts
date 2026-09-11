import { Module } from '@nestjs/common';
import { AiIdentifiersService } from './ai-identifiers.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiIntakeController } from './ai-intake.controller';
import { AiIntakeService } from './ai-intake.service';

@Module({
  controllers: [AiIntakeController],
  providers: [AiIdentifiersService, AiAuthorizationService, AiIntakeService],
  exports: [AiIdentifiersService, AiAuthorizationService, AiIntakeService],
})
export class AiGovernanceModule {}
