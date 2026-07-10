-- Sprint 13 v4: Data Quality scorecards, profiling, RCA, SLA, and rule lifecycle.
CREATE TYPE "DataQualityPriority" AS ENUM ('P1', 'P2', 'P3', 'P4');
CREATE TYPE "DataQualityRuleStatus" AS ENUM ('draft', 'in_review', 'approved', 'deployed', 'retired');
CREATE TYPE "DataQualityRcaTemplate" AS ENUM ('five_whys', 'fishbone', 'process_map', 'lineage_analysis');
CREATE TYPE "DataQualityScoreLevel" AS ENUM ('enterprise', 'domain', 'asset', 'data_element', 'rule', 'issue');
CREATE TYPE "DataQualitySlaStage" AS ENUM ('triage', 'remediation', 'validation', 'closure');
CREATE TYPE "DataQualitySlaStatus" AS ENUM ('active', 'breached', 'completed', 'waived');

ALTER TABLE "data_quality_issues"
  ADD COLUMN "priority" "DataQualityPriority" NOT NULL DEFAULT 'P3',
  ADD COLUMN "triageDueAt" TIMESTAMP(3),
  ADD COLUMN "remediationDueAt" TIMESTAMP(3),
  ADD COLUMN "validationDueAt" TIMESTAMP(3),
  ADD COLUMN "escalatedAt" TIMESTAMP(3);

CREATE INDEX "data_quality_issues_priority_idx" ON "data_quality_issues"("priority");
CREATE INDEX "data_quality_issues_triageDueAt_idx" ON "data_quality_issues"("triageDueAt");
CREATE INDEX "data_quality_issues_remediationDueAt_idx" ON "data_quality_issues"("remediationDueAt");

CREATE TABLE "data_quality_rules" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "dimension" "DataQualityDimension" NOT NULL DEFAULT 'completeness',
    "status" "DataQualityRuleStatus" NOT NULL DEFAULT 'draft',
    "assetId" TEXT,
    "domainId" TEXT,
    "ownerPersonId" TEXT,
    "severity" "DataQualitySeverity" NOT NULL DEFAULT 'medium',
    "thresholdExpression" TEXT,
    "checkFrequency" TEXT NOT NULL DEFAULT 'weekly',
    "impactSummary" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deployedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_quality_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_quality_rule_versions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DataQualityRuleStatus" NOT NULL DEFAULT 'draft',
    "definitionJson" JSONB,
    "changeSummary" TEXT,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_rule_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_quality_scores" (
    "id" TEXT NOT NULL,
    "level" "DataQualityScoreLevel" NOT NULL,
    "refId" TEXT,
    "dimension" "DataQualityDimension",
    "score" INTEGER NOT NULL,
    "totalChecks" INTEGER NOT NULL DEFAULT 0,
    "failedChecks" INTEGER NOT NULL DEFAULT 0,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "assetId" TEXT,
    "domainId" TEXT,
    "ruleId" TEXT,
    "issueId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_scores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_quality_profiles" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "domainId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'profiling_import',
    "importedBy" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "columnCount" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" INTEGER NOT NULL DEFAULT 0,
    "recommendedRules" INTEGER NOT NULL DEFAULT 0,
    "anomalyCount" INTEGER NOT NULL DEFAULT 0,
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_quality_profile_columns" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "columnName" TEXT NOT NULL,
    "dataType" TEXT,
    "completenessPct" INTEGER NOT NULL DEFAULT 0,
    "uniquenessPct" INTEGER NOT NULL DEFAULT 0,
    "validityPct" INTEGER NOT NULL DEFAULT 0,
    "pattern" TEXT,
    "anomalyCount" INTEGER NOT NULL DEFAULT 0,
    "recommendation" TEXT,
    "dimension" "DataQualityDimension",

    CONSTRAINT "data_quality_profile_columns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_quality_rca_records" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "template" "DataQualityRcaTemplate" NOT NULL DEFAULT 'five_whys',
    "summary" TEXT,
    "why1" TEXT,
    "why2" TEXT,
    "why3" TEXT,
    "why4" TEXT,
    "why5" TEXT,
    "fishboneJson" JSONB,
    "processMap" TEXT,
    "lineageNotes" TEXT,
    "rootCause" TEXT,
    "remediationPlan" TEXT,
    "validationResult" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_quality_rca_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_quality_sla_breaches" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "stage" "DataQualitySlaStage" NOT NULL,
    "status" "DataQualitySlaStatus" NOT NULL DEFAULT 'active',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "breachedAt" TIMESTAMP(3),
    "escalatedTo" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_sla_breaches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_quality_rules_code_key" ON "data_quality_rules"("code");
CREATE INDEX "data_quality_rules_assetId_idx" ON "data_quality_rules"("assetId");
CREATE INDEX "data_quality_rules_domainId_idx" ON "data_quality_rules"("domainId");
CREATE INDEX "data_quality_rules_ownerPersonId_idx" ON "data_quality_rules"("ownerPersonId");
CREATE INDEX "data_quality_rules_status_idx" ON "data_quality_rules"("status");
CREATE INDEX "data_quality_rules_dimension_idx" ON "data_quality_rules"("dimension");
CREATE UNIQUE INDEX "data_quality_rule_versions_ruleId_version_key" ON "data_quality_rule_versions"("ruleId", "version");
CREATE INDEX "data_quality_rule_versions_status_idx" ON "data_quality_rule_versions"("status");
CREATE INDEX "data_quality_scores_level_refId_idx" ON "data_quality_scores"("level", "refId");
CREATE INDEX "data_quality_scores_assetId_idx" ON "data_quality_scores"("assetId");
CREATE INDEX "data_quality_scores_domainId_idx" ON "data_quality_scores"("domainId");
CREATE INDEX "data_quality_scores_ruleId_idx" ON "data_quality_scores"("ruleId");
CREATE INDEX "data_quality_scores_issueId_idx" ON "data_quality_scores"("issueId");
CREATE INDEX "data_quality_scores_dimension_idx" ON "data_quality_scores"("dimension");
CREATE INDEX "data_quality_scores_measuredAt_idx" ON "data_quality_scores"("measuredAt");
CREATE INDEX "data_quality_profiles_assetId_idx" ON "data_quality_profiles"("assetId");
CREATE INDEX "data_quality_profiles_domainId_idx" ON "data_quality_profiles"("domainId");
CREATE INDEX "data_quality_profiles_createdAt_idx" ON "data_quality_profiles"("createdAt");
CREATE INDEX "data_quality_profile_columns_profileId_idx" ON "data_quality_profile_columns"("profileId");
CREATE INDEX "data_quality_profile_columns_dimension_idx" ON "data_quality_profile_columns"("dimension");
CREATE INDEX "data_quality_rca_records_issueId_idx" ON "data_quality_rca_records"("issueId");
CREATE INDEX "data_quality_rca_records_template_idx" ON "data_quality_rca_records"("template");
CREATE INDEX "data_quality_sla_breaches_issueId_idx" ON "data_quality_sla_breaches"("issueId");
CREATE INDEX "data_quality_sla_breaches_stage_idx" ON "data_quality_sla_breaches"("stage");
CREATE INDEX "data_quality_sla_breaches_status_idx" ON "data_quality_sla_breaches"("status");
CREATE INDEX "data_quality_sla_breaches_dueAt_idx" ON "data_quality_sla_breaches"("dueAt");

ALTER TABLE "data_quality_rules" ADD CONSTRAINT "data_quality_rules_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_rules" ADD CONSTRAINT "data_quality_rules_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_rules" ADD CONSTRAINT "data_quality_rules_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_rule_versions" ADD CONSTRAINT "data_quality_rule_versions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "data_quality_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_quality_scores" ADD CONSTRAINT "data_quality_scores_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_scores" ADD CONSTRAINT "data_quality_scores_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_scores" ADD CONSTRAINT "data_quality_scores_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "data_quality_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_scores" ADD CONSTRAINT "data_quality_scores_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "data_quality_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_profiles" ADD CONSTRAINT "data_quality_profiles_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_profiles" ADD CONSTRAINT "data_quality_profiles_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_profile_columns" ADD CONSTRAINT "data_quality_profile_columns_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "data_quality_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_quality_rca_records" ADD CONSTRAINT "data_quality_rca_records_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "data_quality_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_quality_sla_breaches" ADD CONSTRAINT "data_quality_sla_breaches_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "data_quality_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sprint 14 v4: classification, DLP, masking, ABAC, and access review foundations.
CREATE TYPE "MaskingTechnique" AS ENUM ('static_masking', 'dynamic_masking', 'tokenization', 'anonymization', 'pseudonymization', 'redaction');
CREATE TYPE "AccessReviewStatus" AS ENUM ('draft', 'active', 'completed', 'cancelled');
CREATE TYPE "AccessReviewDecision" AS ENUM ('pending', 'certified', 'revoke', 'exception', 'escalated');
CREATE TYPE "AccessDecision" AS ENUM ('allow', 'deny', 'masked', 'review_required');
CREATE TYPE "ClassificationRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'implemented');
CREATE TYPE "SecuritySeverity" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "DlpIncidentStatus" AS ENUM ('new', 'triaged', 'under_review', 'contained', 'closed', 'false_positive');

CREATE TABLE "masking_policies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "technique" "MaskingTechnique" NOT NULL,
    "description" TEXT,
    "domainId" TEXT,
    "classificationId" TEXT,
    "appliesToPersonalData" BOOLEAN NOT NULL DEFAULT true,
    "fieldsJson" JSONB,
    "previewBefore" TEXT,
    "previewAfter" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "masking_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_data_access_maps" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "domainId" TEXT,
    "classificationId" TEXT,
    "maskingPolicyId" TEXT,
    "personalDataAllowed" BOOLEAN NOT NULL DEFAULT false,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
    "businessJustification" TEXT,
    "reviewCadenceDays" INTEGER NOT NULL DEFAULT 90,
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_data_access_maps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "access_reviews" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "AccessReviewStatus" NOT NULL DEFAULT 'draft',
    "ownerUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "access_review_items" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assetId" TEXT,
    "domainId" TEXT,
    "classificationId" TEXT,
    "decision" "AccessReviewDecision" NOT NULL DEFAULT 'pending',
    "reviewer" TEXT,
    "justification" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_review_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "abac_decision_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "roleId" TEXT,
    "assetId" TEXT,
    "domainId" TEXT,
    "classificationId" TEXT,
    "maskingPolicyId" TEXT,
    "requestedAction" TEXT NOT NULL,
    "decision" "AccessDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abac_decision_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dlp_incidents" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'medium',
    "status" "DlpIncidentStatus" NOT NULL DEFAULT 'new',
    "assetId" TEXT,
    "classificationId" TEXT,
    "detectionSource" TEXT NOT NULL DEFAULT 'manual',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedPersonId" TEXT,
    "workflowCaseId" TEXT,
    "containmentSummary" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dlp_incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "classification_change_requests" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fromClassificationId" TEXT,
    "toClassificationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ClassificationRequestStatus" NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "workflowCaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classification_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "masking_policies_code_key" ON "masking_policies"("code");
CREATE INDEX "masking_policies_domainId_idx" ON "masking_policies"("domainId");
CREATE INDEX "masking_policies_classificationId_idx" ON "masking_policies"("classificationId");
CREATE INDEX "masking_policies_technique_idx" ON "masking_policies"("technique");
CREATE INDEX "masking_policies_isActive_idx" ON "masking_policies"("isActive");
CREATE INDEX "role_data_access_maps_roleId_idx" ON "role_data_access_maps"("roleId");
CREATE INDEX "role_data_access_maps_domainId_idx" ON "role_data_access_maps"("domainId");
CREATE INDEX "role_data_access_maps_classificationId_idx" ON "role_data_access_maps"("classificationId");
CREATE INDEX "role_data_access_maps_maskingPolicyId_idx" ON "role_data_access_maps"("maskingPolicyId");
CREATE INDEX "role_data_access_maps_isActive_idx" ON "role_data_access_maps"("isActive");
CREATE UNIQUE INDEX "access_reviews_code_key" ON "access_reviews"("code");
CREATE INDEX "access_reviews_status_idx" ON "access_reviews"("status");
CREATE INDEX "access_reviews_ownerUserId_idx" ON "access_reviews"("ownerUserId");
CREATE INDEX "access_reviews_dueDate_idx" ON "access_reviews"("dueDate");
CREATE INDEX "access_review_items_reviewId_idx" ON "access_review_items"("reviewId");
CREATE INDEX "access_review_items_userId_idx" ON "access_review_items"("userId");
CREATE INDEX "access_review_items_roleId_idx" ON "access_review_items"("roleId");
CREATE INDEX "access_review_items_decision_idx" ON "access_review_items"("decision");
CREATE INDEX "access_review_items_domainId_idx" ON "access_review_items"("domainId");
CREATE INDEX "abac_decision_logs_actorUserId_idx" ON "abac_decision_logs"("actorUserId");
CREATE INDEX "abac_decision_logs_roleId_idx" ON "abac_decision_logs"("roleId");
CREATE INDEX "abac_decision_logs_assetId_idx" ON "abac_decision_logs"("assetId");
CREATE INDEX "abac_decision_logs_decision_idx" ON "abac_decision_logs"("decision");
CREATE INDEX "abac_decision_logs_createdAt_idx" ON "abac_decision_logs"("createdAt");
CREATE UNIQUE INDEX "dlp_incidents_code_key" ON "dlp_incidents"("code");
CREATE UNIQUE INDEX "dlp_incidents_workflowCaseId_key" ON "dlp_incidents"("workflowCaseId");
CREATE INDEX "dlp_incidents_assetId_idx" ON "dlp_incidents"("assetId");
CREATE INDEX "dlp_incidents_classificationId_idx" ON "dlp_incidents"("classificationId");
CREATE INDEX "dlp_incidents_assignedPersonId_idx" ON "dlp_incidents"("assignedPersonId");
CREATE INDEX "dlp_incidents_severity_idx" ON "dlp_incidents"("severity");
CREATE INDEX "dlp_incidents_status_idx" ON "dlp_incidents"("status");
CREATE INDEX "dlp_incidents_detectedAt_idx" ON "dlp_incidents"("detectedAt");
CREATE UNIQUE INDEX "classification_change_requests_workflowCaseId_key" ON "classification_change_requests"("workflowCaseId");
CREATE INDEX "classification_change_requests_assetId_idx" ON "classification_change_requests"("assetId");
CREATE INDEX "classification_change_requests_status_idx" ON "classification_change_requests"("status");
CREATE INDEX "classification_change_requests_toClassificationId_idx" ON "classification_change_requests"("toClassificationId");

ALTER TABLE "masking_policies" ADD CONSTRAINT "masking_policies_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "masking_policies" ADD CONSTRAINT "masking_policies_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "role_data_access_maps" ADD CONSTRAINT "role_data_access_maps_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_data_access_maps" ADD CONSTRAINT "role_data_access_maps_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "role_data_access_maps" ADD CONSTRAINT "role_data_access_maps_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "role_data_access_maps" ADD CONSTRAINT "role_data_access_maps_maskingPolicyId_fkey" FOREIGN KEY ("maskingPolicyId") REFERENCES "masking_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "access_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "abac_decision_logs" ADD CONSTRAINT "abac_decision_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "abac_decision_logs" ADD CONSTRAINT "abac_decision_logs_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "abac_decision_logs" ADD CONSTRAINT "abac_decision_logs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "abac_decision_logs" ADD CONSTRAINT "abac_decision_logs_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "abac_decision_logs" ADD CONSTRAINT "abac_decision_logs_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "abac_decision_logs" ADD CONSTRAINT "abac_decision_logs_maskingPolicyId_fkey" FOREIGN KEY ("maskingPolicyId") REFERENCES "masking_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dlp_incidents" ADD CONSTRAINT "dlp_incidents_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dlp_incidents" ADD CONSTRAINT "dlp_incidents_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dlp_incidents" ADD CONSTRAINT "dlp_incidents_assignedPersonId_fkey" FOREIGN KEY ("assignedPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dlp_incidents" ADD CONSTRAINT "dlp_incidents_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "classification_change_requests" ADD CONSTRAINT "classification_change_requests_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_change_requests" ADD CONSTRAINT "classification_change_requests_fromClassificationId_fkey" FOREIGN KEY ("fromClassificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "classification_change_requests" ADD CONSTRAINT "classification_change_requests_toClassificationId_fkey" FOREIGN KEY ("toClassificationId") REFERENCES "classifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_change_requests" ADD CONSTRAINT "classification_change_requests_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
