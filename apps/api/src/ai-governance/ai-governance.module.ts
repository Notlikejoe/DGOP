import { Module } from '@nestjs/common';
import { AiIdentifiersService } from './ai-identifiers.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiIntakeController } from './ai-intake.controller';
import { AiIntakeService } from './ai-intake.service';
import { AiClassificationController } from './ai-classification.controller';
import { AiClassificationService } from './ai-classification.service';
import { AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { AiDecisionController } from './ai-decision.controller';
import { AiDecisionService } from './ai-decision.service';

@Module({
  controllers: [AiIntakeController, AiClassificationController, AiDecisionController],
  providers: [AiIdentifiersService, AiAuthorizationService, AiWorkflowRoutingService, AiIntakeService, AiClassificationService, AiDecisionService],
  exports: [AiIdentifiersService, AiAuthorizationService, AiWorkflowRoutingService, AiIntakeService, AiClassificationService, AiDecisionService],
})
export class AiGovernanceModule {}
