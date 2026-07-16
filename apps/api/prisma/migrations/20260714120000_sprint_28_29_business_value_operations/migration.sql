CREATE TYPE "BusinessGlossaryStatus" AS ENUM ('draft', 'under_review', 'approved', 'needs_revision', 'retired', 'expired');
CREATE TYPE "BusinessLineageStatus" AS ENUM ('mapped', 'under_review', 'verified', 'needs_update');
CREATE TYPE "BusinessImpactLevel" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "DataValueStatus" AS ENUM ('planned', 'measuring', 'realized', 'at_risk', 'retired');
CREATE TYPE "LifecycleDecisionStatus" AS ENUM ('proposed', 'approved', 'implemented', 'rejected');
CREATE TYPE "RetentionDecision" AS ENUM ('retain', 'archive', 'dispose', 'review');
CREATE TYPE "GovernanceNotificationSeverity" AS ENUM ('info', 'success', 'warning', 'critical');
CREATE TYPE "GovernanceNotificationStatus" AS ENUM ('unread', 'read', 'archived');
CREATE TYPE "GovernanceEscalationLevel" AS ENUM ('domain_council', 'data_stewardship_council', 'data_governance_board', 'executive_steering_committee');
CREATE TYPE "GovernanceEscalationStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'cancelled');
CREATE TYPE "ComplianceCalendarType" AS ENUM ('processing_activity_review', 'cross_border_transfer_monitoring', 'annual_dpia_review', 'monthly_dq_scorecard_review');
CREATE TYPE "ComplianceCalendarStatus" AS ENUM ('active', 'paused', 'completed', 'archived');

CREATE TABLE "business_glossary_terms" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "termEn" TEXT NOT NULL,
  "termAr" TEXT,
  "definition" TEXT NOT NULL,
  "status" "BusinessGlossaryStatus" NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "reviewDueAt" TIMESTAMP(3),
  "assetId" TEXT,
  "domainId" TEXT,
  "workflowCaseId" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_glossary_terms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_glossary_term_versions" (
  "id" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "definition" TEXT NOT NULL,
  "status" "BusinessGlossaryStatus" NOT NULL,
  "changedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_glossary_term_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_lineage_maps" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "processName" TEXT NOT NULL,
  "businessProcess" TEXT,
  "technicalBridge" TEXT,
  "status" "BusinessLineageStatus" NOT NULL DEFAULT 'mapped',
  "impactLevel" "BusinessImpactLevel" NOT NULL DEFAULT 'medium',
  "impactScore" INTEGER NOT NULL DEFAULT 50,
  "sourceAssetId" TEXT,
  "targetAssetId" TEXT,
  "domainId" TEXT,
  "workflowCaseId" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_lineage_maps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_asset_valuations" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "domainId" TEXT,
  "useCase" TEXT NOT NULL,
  "valueDriver" TEXT,
  "annualValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "roiPercent" INTEGER NOT NULL DEFAULT 0,
  "adoptionScore" INTEGER NOT NULL DEFAULT 0,
  "surveyScore" INTEGER NOT NULL DEFAULT 0,
  "status" "DataValueStatus" NOT NULL DEFAULT 'measuring',
  "ownerName" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_asset_valuations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_user_surveys" (
  "id" TEXT NOT NULL,
  "valuationId" TEXT,
  "assetId" TEXT,
  "respondent" TEXT,
  "score" INTEGER NOT NULL DEFAULT 0,
  "feedback" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_user_surveys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_lifecycle_decisions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "currentStatus" TEXT NOT NULL,
  "proposedStatus" TEXT NOT NULL,
  "retentionDecision" "RetentionDecision" NOT NULL DEFAULT 'review',
  "retentionBasis" TEXT,
  "disposalDueAt" TIMESTAMP(3),
  "status" "LifecycleDecisionStatus" NOT NULL DEFAULT 'proposed',
  "workflowCaseId" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_lifecycle_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_impact_assessments" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "assetId" TEXT,
  "domainId" TEXT,
  "processName" TEXT NOT NULL,
  "impactLevel" "BusinessImpactLevel" NOT NULL DEFAULT 'medium',
  "impactScore" INTEGER NOT NULL DEFAULT 50,
  "rtoHours" INTEGER,
  "revenueImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "citizenImpact" TEXT,
  "operationalImpact" TEXT,
  "status" "DataValueStatus" NOT NULL DEFAULT 'measuring',
  "workflowCaseId" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_impact_assessments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_value_kpis" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "valueType" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "targetValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "actualValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit" TEXT,
  "useCase" TEXT,
  "ownerName" TEXT,
  "status" "DataValueStatus" NOT NULL DEFAULT 'measuring',
  "assetId" TEXT,
  "domainId" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_value_kpis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_notifications" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "severity" "GovernanceNotificationSeverity" NOT NULL DEFAULT 'info',
  "status" "GovernanceNotificationStatus" NOT NULL DEFAULT 'unread',
  "sourceType" TEXT,
  "sourceId" TEXT,
  "targetRoleCode" TEXT,
  "assigneeUserId" TEXT,
  "workflowCaseId" TEXT,
  "workflowTaskId" TEXT,
  "emailTo" TEXT,
  "emailSentAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_escalations" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "level" "GovernanceEscalationLevel" NOT NULL,
  "status" "GovernanceEscalationStatus" NOT NULL DEFAULT 'open',
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "penaltyPoints" INTEGER NOT NULL DEFAULT 0,
  "ownerRoleCode" TEXT,
  "dueAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "workflowCaseId" TEXT,
  "workflowTaskId" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_escalations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_calendar_templates" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" "ComplianceCalendarType" NOT NULL,
  "cadence" TEXT NOT NULL,
  "ownerRoleCode" TEXT,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "defaultSlaBusinessDays" INTEGER NOT NULL DEFAULT 5,
  "status" "ComplianceCalendarStatus" NOT NULL DEFAULT 'active',
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "compliance_calendar_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_calendar_occurrences" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "ComplianceCalendarStatus" NOT NULL DEFAULT 'active',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "workflowCaseId" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "compliance_calendar_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ksa_holidays" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT,
  "isRecurring" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ksa_holidays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_glossary_terms_code_key" ON "business_glossary_terms"("code");
CREATE UNIQUE INDEX "business_glossary_terms_workflowCaseId_key" ON "business_glossary_terms"("workflowCaseId");
CREATE INDEX "business_glossary_terms_assetId_idx" ON "business_glossary_terms"("assetId");
CREATE INDEX "business_glossary_terms_domainId_idx" ON "business_glossary_terms"("domainId");
CREATE INDEX "business_glossary_terms_status_idx" ON "business_glossary_terms"("status");
CREATE INDEX "business_glossary_terms_reviewDueAt_idx" ON "business_glossary_terms"("reviewDueAt");
CREATE UNIQUE INDEX "business_glossary_term_versions_termId_version_key" ON "business_glossary_term_versions"("termId", "version");
CREATE INDEX "business_glossary_term_versions_termId_idx" ON "business_glossary_term_versions"("termId");

CREATE UNIQUE INDEX "business_lineage_maps_code_key" ON "business_lineage_maps"("code");
CREATE UNIQUE INDEX "business_lineage_maps_workflowCaseId_key" ON "business_lineage_maps"("workflowCaseId");
CREATE INDEX "business_lineage_maps_sourceAssetId_idx" ON "business_lineage_maps"("sourceAssetId");
CREATE INDEX "business_lineage_maps_targetAssetId_idx" ON "business_lineage_maps"("targetAssetId");
CREATE INDEX "business_lineage_maps_domainId_idx" ON "business_lineage_maps"("domainId");
CREATE INDEX "business_lineage_maps_status_idx" ON "business_lineage_maps"("status");

CREATE UNIQUE INDEX "data_asset_valuations_code_key" ON "data_asset_valuations"("code");
CREATE INDEX "data_asset_valuations_assetId_idx" ON "data_asset_valuations"("assetId");
CREATE INDEX "data_asset_valuations_domainId_idx" ON "data_asset_valuations"("domainId");
CREATE INDEX "data_asset_valuations_status_idx" ON "data_asset_valuations"("status");
CREATE INDEX "data_user_surveys_valuationId_idx" ON "data_user_surveys"("valuationId");
CREATE INDEX "data_user_surveys_assetId_idx" ON "data_user_surveys"("assetId");

CREATE UNIQUE INDEX "asset_lifecycle_decisions_code_key" ON "asset_lifecycle_decisions"("code");
CREATE UNIQUE INDEX "asset_lifecycle_decisions_workflowCaseId_key" ON "asset_lifecycle_decisions"("workflowCaseId");
CREATE INDEX "asset_lifecycle_decisions_assetId_idx" ON "asset_lifecycle_decisions"("assetId");
CREATE INDEX "asset_lifecycle_decisions_status_idx" ON "asset_lifecycle_decisions"("status");
CREATE INDEX "asset_lifecycle_decisions_disposalDueAt_idx" ON "asset_lifecycle_decisions"("disposalDueAt");

CREATE UNIQUE INDEX "business_impact_assessments_code_key" ON "business_impact_assessments"("code");
CREATE UNIQUE INDEX "business_impact_assessments_workflowCaseId_key" ON "business_impact_assessments"("workflowCaseId");
CREATE INDEX "business_impact_assessments_assetId_idx" ON "business_impact_assessments"("assetId");
CREATE INDEX "business_impact_assessments_domainId_idx" ON "business_impact_assessments"("domainId");
CREATE INDEX "business_impact_assessments_impactLevel_idx" ON "business_impact_assessments"("impactLevel");
CREATE INDEX "business_impact_assessments_status_idx" ON "business_impact_assessments"("status");

CREATE UNIQUE INDEX "data_value_kpis_code_key" ON "data_value_kpis"("code");
CREATE INDEX "data_value_kpis_assetId_idx" ON "data_value_kpis"("assetId");
CREATE INDEX "data_value_kpis_domainId_idx" ON "data_value_kpis"("domainId");
CREATE INDEX "data_value_kpis_status_idx" ON "data_value_kpis"("status");

CREATE INDEX "governance_notifications_status_idx" ON "governance_notifications"("status");
CREATE INDEX "governance_notifications_severity_idx" ON "governance_notifications"("severity");
CREATE INDEX "governance_notifications_targetRoleCode_idx" ON "governance_notifications"("targetRoleCode");
CREATE INDEX "governance_notifications_assigneeUserId_idx" ON "governance_notifications"("assigneeUserId");
CREATE INDEX "governance_notifications_workflowCaseId_idx" ON "governance_notifications"("workflowCaseId");
CREATE INDEX "governance_notifications_workflowTaskId_idx" ON "governance_notifications"("workflowTaskId");

CREATE UNIQUE INDEX "governance_escalations_code_key" ON "governance_escalations"("code");
CREATE INDEX "governance_escalations_level_idx" ON "governance_escalations"("level");
CREATE INDEX "governance_escalations_status_idx" ON "governance_escalations"("status");
CREATE INDEX "governance_escalations_sourceType_sourceId_idx" ON "governance_escalations"("sourceType", "sourceId");
CREATE INDEX "governance_escalations_workflowCaseId_idx" ON "governance_escalations"("workflowCaseId");
CREATE INDEX "governance_escalations_workflowTaskId_idx" ON "governance_escalations"("workflowTaskId");

CREATE UNIQUE INDEX "compliance_calendar_templates_code_key" ON "compliance_calendar_templates"("code");
CREATE INDEX "compliance_calendar_templates_type_idx" ON "compliance_calendar_templates"("type");
CREATE INDEX "compliance_calendar_templates_status_idx" ON "compliance_calendar_templates"("status");
CREATE INDEX "compliance_calendar_templates_nextRunAt_idx" ON "compliance_calendar_templates"("nextRunAt");
CREATE UNIQUE INDEX "compliance_calendar_occurrences_code_key" ON "compliance_calendar_occurrences"("code");
CREATE INDEX "compliance_calendar_occurrences_templateId_idx" ON "compliance_calendar_occurrences"("templateId");
CREATE INDEX "compliance_calendar_occurrences_status_idx" ON "compliance_calendar_occurrences"("status");
CREATE INDEX "compliance_calendar_occurrences_dueAt_idx" ON "compliance_calendar_occurrences"("dueAt");
CREATE INDEX "compliance_calendar_occurrences_workflowCaseId_idx" ON "compliance_calendar_occurrences"("workflowCaseId");
CREATE UNIQUE INDEX "ksa_holidays_date_key" ON "ksa_holidays"("date");
CREATE INDEX "ksa_holidays_isRecurring_idx" ON "ksa_holidays"("isRecurring");

ALTER TABLE "business_glossary_terms" ADD CONSTRAINT "business_glossary_terms_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_glossary_terms" ADD CONSTRAINT "business_glossary_terms_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_glossary_terms" ADD CONSTRAINT "business_glossary_terms_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_glossary_term_versions" ADD CONSTRAINT "business_glossary_term_versions_termId_fkey" FOREIGN KEY ("termId") REFERENCES "business_glossary_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "business_lineage_maps" ADD CONSTRAINT "business_lineage_maps_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_lineage_maps" ADD CONSTRAINT "business_lineage_maps_targetAssetId_fkey" FOREIGN KEY ("targetAssetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_lineage_maps" ADD CONSTRAINT "business_lineage_maps_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_lineage_maps" ADD CONSTRAINT "business_lineage_maps_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "data_asset_valuations" ADD CONSTRAINT "data_asset_valuations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_asset_valuations" ADD CONSTRAINT "data_asset_valuations_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_user_surveys" ADD CONSTRAINT "data_user_surveys_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "data_asset_valuations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_user_surveys" ADD CONSTRAINT "data_user_surveys_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_lifecycle_decisions" ADD CONSTRAINT "asset_lifecycle_decisions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_lifecycle_decisions" ADD CONSTRAINT "asset_lifecycle_decisions_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_impact_assessments" ADD CONSTRAINT "business_impact_assessments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_impact_assessments" ADD CONSTRAINT "business_impact_assessments_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_impact_assessments" ADD CONSTRAINT "business_impact_assessments_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_value_kpis" ADD CONSTRAINT "data_value_kpis_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_value_kpis" ADD CONSTRAINT "data_value_kpis_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "governance_notifications" ADD CONSTRAINT "governance_notifications_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "governance_notifications" ADD CONSTRAINT "governance_notifications_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "governance_notifications" ADD CONSTRAINT "governance_notifications_workflowTaskId_fkey" FOREIGN KEY ("workflowTaskId") REFERENCES "workflow_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "governance_escalations" ADD CONSTRAINT "governance_escalations_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "governance_escalations" ADD CONSTRAINT "governance_escalations_workflowTaskId_fkey" FOREIGN KEY ("workflowTaskId") REFERENCES "workflow_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compliance_calendar_occurrences" ADD CONSTRAINT "compliance_calendar_occurrences_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "compliance_calendar_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_calendar_occurrences" ADD CONSTRAINT "compliance_calendar_occurrences_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
