import { AiCapabilitiesController } from './ai-capabilities.controller';
import { AiEvidenceController } from './ai-evidence.controller';
import { AiEvidenceService } from './ai-evidence.service';
import { AiOperationalAlertsService } from './ai-operational-alerts.service';
import { AiAuditQueryService } from './ai-audit-query.service';
import { AiAuditQueryController } from './ai-audit-query.controller';
import { AiWorkflowProjectionService } from './ai-workflow-projection.service';
import { AiSeverityService } from './ai-severity.service';
import { AiSeverityController } from './ai-severity.controller';
import { AiRiskStrategyService } from './ai-risk-strategy.service';
import { AiLifecycleController } from './ai-lifecycle.controller';
import { AiLifecycleService } from './ai-lifecycle.service';
import { AiRiskStrategyController } from './ai-risk-strategy.controller';
import { AiHistoryService } from './ai-history.service';
import { AiHistoryController } from './ai-history.controller';
import { AiCategoryControlsService } from './ai-category-controls.service';
import { AiMigrationPilotService } from './ai-migration-pilot.service';
import { AiSourceNativeService } from './ai-source-native.service';
import { AiCycleAController } from './ai-cycle-a.controller';
import { AiLibrarySourceController, AiControlLinksController, AiAssetRiskController } from './ai-library-controls.controller';
import { AiLibrarySourceService } from './ai-library-source.service';
import { AiControlDomainsService } from './ai-control-domains.service';
import { AiLibraryControlLinksService } from './ai-library-control-links.service';
import { AiAssetRiskService } from './ai-asset-risk.service';
import { AiSourceCorrectionsService } from './ai-source-corrections.service';
import { AiSourceCorrectionsController } from './ai-source-corrections.controller';
import { AiMigrationPreviewService } from './ai-migration-preview.service';
import { AiMigrationPreviewController } from './ai-migration-preview.controller';
import { AiRiskLibraryService } from './ai-risk-library.service';
import { AiRiskLibraryController } from './ai-risk-library.controller';
import { AiRiskInitiationService } from './ai-risk-initiation.service';
import { AiDashboardReportsController } from './ai-dashboard-reports.controller';
import { AiDashboardReportsService } from './ai-dashboard-reports.service';
import { AiDashboardService } from './ai-dashboard.service';
import { AiDashboardController } from './ai-dashboard.controller';
import { AiReviewDisplayService } from './ai-review-display.service';
import { AiMonthlyReviewService } from './ai-monthly-review.service';
import { AiAnnualReviewService } from './ai-annual-review.service';
import { AiReviewReportService } from './ai-review-report.service';
import { AiReviewOperationsController } from './ai-review-operations.controller';
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
import { AiRiskResponseService } from './ai-risk-response.service';
import { AiTreatmentService } from './ai-treatment.service';
import { AiResidualAssessmentService } from './ai-residual-assessment.service';
import { AiResidualDecisionService } from './ai-residual-decision.service';
import { AiRiskReviewService } from './ai-risk-review.service';
import { AiRiskReviewController } from './ai-risk-review.controller';

@Module({
  imports: [AccessModule],
  controllers: [AiLifecycleController, AiEvidenceController, AiCapabilitiesController, AiAuditQueryController, AiSeverityController, AiRiskStrategyController, AiHistoryController, AiCycleAController, AiLibrarySourceController, AiControlLinksController, AiAssetRiskController, AiSourceCorrectionsController, AiMigrationPreviewController, AiRiskLibraryController, AiDashboardReportsController, AiDashboardController, AiReviewOperationsController, AiIntakeController, AiClassificationController, AiDecisionController, AiRegistrationController, AiRiskIntakeController, AiRiskReviewController],
  providers: [AiLifecycleService, AiEvidenceService, AiOperationalAlertsService, AiAuditQueryService, AiSeverityService, AiWorkflowProjectionService, AiRiskStrategyService, AiHistoryService, AiCategoryControlsService, AiMigrationPilotService, AiSourceNativeService, AiLibrarySourceService, AiControlDomainsService, AiLibraryControlLinksService, AiAssetRiskService, AiSourceCorrectionsService, AiMigrationPreviewService, AiRiskLibraryService, AiRiskInitiationService, AiDashboardReportsService, AiDashboardService, AiReviewDisplayService, AiMonthlyReviewService, AiAnnualReviewService, AiReviewReportService, AiIdentifiersService, AiAuthorizationService, AiWorkflowRoutingService, AiIntakeService, AiClassificationService, AiDecisionService, AiAssetFacade, AiRegistrationService, AiRiskIntakeService, AiRiskAssessmentService, AiRiskAdoptionService, AiRiskResponseService, AiTreatmentService, AiResidualAssessmentService, AiResidualDecisionService, AiRiskReviewService],
  exports: [AiOperationalAlertsService, AiWorkflowProjectionService, AiDashboardReportsService, AiIdentifiersService, AiAuthorizationService, AiWorkflowRoutingService, AiIntakeService, AiClassificationService, AiDecisionService, AiRiskReviewService],
})
export class AiGovernanceModule {}
