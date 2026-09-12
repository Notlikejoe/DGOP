import { Module } from '@nestjs/common';
import { AiIdentifiersService } from './ai-identifiers.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiIntakeController } from './ai-intake.controller';
import { AiIntakeService } from './ai-intake.service';
import { AiClassificationController } from './ai-classification.controller';
import { AiClassificationService } from './ai-classification.service';
import { AiWorkflowRoutingService } from './ai-workflow-routing.service';

@Module({
  controllers: [AiIntakeController, AiClassificationController],
  providers: [AiIdentifiersService, AiAuthorizationService, AiWorkflowRoutingService, AiIntakeService, AiClassificationService],
  exports: [AiIdentifiersService, AiAuthorizationService, AiWorkflowRoutingService, AiIntakeService, AiClassificationService],
})
export class AiGovernanceModule {}
