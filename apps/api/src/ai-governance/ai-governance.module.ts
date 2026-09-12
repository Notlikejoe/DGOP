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
import { AccessModule } from '../access/access.module';
import { AiAssetFacade } from './ai-asset.facade';
import { AiRegistrationController } from './ai-registration.controller';
import { AiRegistrationService } from './ai-registration.service';
import { AiRiskIntakeController } from './ai-risk-intake.controller';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { AiRiskAssessmentService } from './ai-risk-assessment.service';
import { AiRiskAdoptionService } from './ai-risk-adoption.service';

@Module({
  imports: [AccessModule],
  controllers: [AiIntakeController, AiClassificationController, AiDecisionController, AiRegistrationController, AiRiskIntakeController],
  providers: [AiIdentifiersService, AiAuthorizationService, AiWorkflowRoutingService, AiIntakeService, AiClassificationService, AiDecisionService, AiAssetFacade, AiRegistrationService, AiRiskIntakeService, AiRiskAssessmentService, AiRiskAdoptionService],
  exports: [AiIdentifiersService, AiAuthorizationService, AiWorkflowRoutingService, AiIntakeService, AiClassificationService, AiDecisionService],
})
export class AiGovernanceModule {}
