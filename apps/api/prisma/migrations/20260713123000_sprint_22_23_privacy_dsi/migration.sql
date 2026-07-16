CREATE TYPE "PrivacyLegalBasisCategory" AS ENUM ('consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interest');
CREATE TYPE "PrivacyWorkStatus" AS ENUM ('draft', 'submitted', 'under_review', 'action_required', 'approved', 'rejected', 'closed');
CREATE TYPE "PrivacyGatePhase" AS ENUM ('requirements', 'design', 'development', 'testing', 'deployment');
CREATE TYPE "PrivacyGateStatus" AS ENUM ('pending', 'approved', 'blocked', 'not_required');
CREATE TYPE "DpiaRiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "DsrRequestType" AS ENUM ('access', 'correction', 'deletion', 'restriction', 'portability', 'objection');
CREATE TYPE "DsrRequestStatus" AS ENUM ('received', 'identity_validation', 'in_progress', 'awaiting_data_owner', 'fulfilled', 'rejected', 'closed');
CREATE TYPE "BreachSeverity" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "BreachStatus" AS ENUM ('detected', 'triage', 'contained', 'notified', 'closed', 'false_positive');
CREATE TYPE "ConsentStatus" AS ENUM ('active', 'withdrawn', 'expired');
CREATE TYPE "RetentionTrigger" AS ENUM ('creation', 'last_use', 'contract_end', 'manual');
CREATE TYPE "DataSharingRequestStatus" AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'agreement_active', 'retired');
CREATE TYPE "DataSharingReviewStep" AS ENUM ('owner', 'privacy', 'security', 'technical');
CREATE TYPE "DataSharingReviewDecision" AS ENUM ('pending', 'approved', 'rejected', 'needs_changes');
CREATE TYPE "DataSharingAgreementStatus" AS ENUM ('draft', 'active', 'renewal_due', 'expired', 'retired');
CREATE TYPE "DataSharingUsageStatus" AS ENUM ('normal', 'watch', 'escalated');

CREATE TABLE "privacy_legal_bases" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "category" "PrivacyLegalBasisCategory" NOT NULL,
  "description" TEXT,
  "authority" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "privacy_legal_bases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_ropa_records" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "processName" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "assetId" TEXT,
  "domainId" TEXT,
  "legalBasisId" TEXT,
  "ownerPersonId" TEXT,
  "dataSubjects" TEXT,
  "recipients" TEXT,
  "retentionSummary" TEXT,
  "status" "PrivacyWorkStatus" NOT NULL DEFAULT 'draft',
  "reviewDueAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "privacy_ropa_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_dpias" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assetId" TEXT,
  "domainId" TEXT,
  "legalBasisId" TEXT,
  "classificationId" TEXT,
  "status" "PrivacyWorkStatus" NOT NULL DEFAULT 'draft',
  "riskLevel" "DpiaRiskLevel" NOT NULL DEFAULT 'medium',
  "inherentRiskScore" INTEGER NOT NULL DEFAULT 50,
  "residualRiskScore" INTEGER NOT NULL DEFAULT 50,
  "crossBorderTransfer" BOOLEAN NOT NULL DEFAULT false,
  "reviewerPersonId" TEXT,
  "workflowCaseId" TEXT,
  "decisionSummary" TEXT,
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "privacy_dpias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_gates" (
  "id" TEXT NOT NULL,
  "dpiaId" TEXT NOT NULL,
  "phase" "PrivacyGatePhase" NOT NULL,
  "status" "PrivacyGateStatus" NOT NULL DEFAULT 'pending',
  "reviewerPersonId" TEXT,
  "note" TEXT,
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "privacy_gates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_dsr_requests" (
  "id" TEXT NOT NULL,
  "requestNumber" TEXT NOT NULL,
  "requesterName" TEXT NOT NULL,
  "requesterEmail" TEXT,
  "requestType" "DsrRequestType" NOT NULL,
  "status" "DsrRequestStatus" NOT NULL DEFAULT 'received',
  "description" TEXT NOT NULL,
  "identityValidated" BOOLEAN NOT NULL DEFAULT false,
  "assetId" TEXT,
  "domainId" TEXT,
  "assignedPersonId" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "fulfilledAt" TIMESTAMP(3),
  "workflowCaseId" TEXT,
  "decisionSummary" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "privacy_dsr_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_breaches" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assetId" TEXT,
  "domainId" TEXT,
  "severity" "BreachSeverity" NOT NULL DEFAULT 'medium',
  "status" "BreachStatus" NOT NULL DEFAULT 'detected',
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "containedAt" TIMESTAMP(3),
  "notificationDueAt" TIMESTAMP(3) NOT NULL,
  "notifiedAt" TIMESTAMP(3),
  "assignedPersonId" TEXT,
  "workflowCaseId" TEXT,
  "regulatorNotified" BOOLEAN NOT NULL DEFAULT false,
  "subjectNotified" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "privacy_breaches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_consent_records" (
  "id" TEXT NOT NULL,
  "assetId" TEXT,
  "subjectRef" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "legalBasisId" TEXT,
  "status" "ConsentStatus" NOT NULL DEFAULT 'active',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3),
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "privacy_consent_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_retention_rules" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "assetId" TEXT,
  "domainId" TEXT,
  "trigger" "RetentionTrigger" NOT NULL DEFAULT 'creation',
  "durationDays" INTEGER NOT NULL,
  "action" TEXT NOT NULL DEFAULT 'review',
  "ownerPersonId" TEXT,
  "nextReviewAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "privacy_retention_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_sharing_requests" (
  "id" TEXT NOT NULL,
  "requestNumber" TEXT NOT NULL,
  "requesterOrg" TEXT NOT NULL,
  "recipientOrg" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "legalBasisId" TEXT,
  "assetId" TEXT,
  "domainId" TEXT,
  "classificationId" TEXT,
  "maskingPolicyId" TEXT,
  "roleDataAccessMapId" TEXT,
  "consentRequired" BOOLEAN NOT NULL DEFAULT false,
  "crossBorderTransfer" BOOLEAN NOT NULL DEFAULT false,
  "status" "DataSharingRequestStatus" NOT NULL DEFAULT 'draft',
  "riskScore" INTEGER NOT NULL DEFAULT 50,
  "requiredControlsJson" JSONB,
  "workflowCaseId" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_sharing_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_sharing_reviews" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "step" "DataSharingReviewStep" NOT NULL,
  "decision" "DataSharingReviewDecision" NOT NULL DEFAULT 'pending',
  "reviewerPersonId" TEXT,
  "note" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_sharing_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_sharing_agreements" (
  "id" TEXT NOT NULL,
  "agreementNumber" TEXT NOT NULL,
  "requestId" TEXT,
  "assetId" TEXT,
  "domainId" TEXT,
  "recipientOrg" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" "DataSharingAgreementStatus" NOT NULL DEFAULT 'draft',
  "ownerPersonId" TEXT,
  "agreementUrl" TEXT,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "renewalDueAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_sharing_agreements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_sharing_usage_metrics" (
  "id" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "metricDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordsShared" INTEGER NOT NULL DEFAULT 0,
  "apiCalls" INTEGER NOT NULL DEFAULT 0,
  "incidents" INTEGER NOT NULL DEFAULT 0,
  "status" "DataSharingUsageStatus" NOT NULL DEFAULT 'normal',
  "note" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_sharing_usage_metrics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "privacy_legal_bases_code_key" ON "privacy_legal_bases"("code");
CREATE INDEX "privacy_legal_bases_category_idx" ON "privacy_legal_bases"("category");
CREATE INDEX "privacy_legal_bases_isActive_idx" ON "privacy_legal_bases"("isActive");
CREATE UNIQUE INDEX "privacy_ropa_records_code_key" ON "privacy_ropa_records"("code");
CREATE INDEX "privacy_ropa_records_assetId_idx" ON "privacy_ropa_records"("assetId");
CREATE INDEX "privacy_ropa_records_domainId_idx" ON "privacy_ropa_records"("domainId");
CREATE INDEX "privacy_ropa_records_legalBasisId_idx" ON "privacy_ropa_records"("legalBasisId");
CREATE INDEX "privacy_ropa_records_ownerPersonId_idx" ON "privacy_ropa_records"("ownerPersonId");
CREATE INDEX "privacy_ropa_records_status_idx" ON "privacy_ropa_records"("status");
CREATE INDEX "privacy_ropa_records_reviewDueAt_idx" ON "privacy_ropa_records"("reviewDueAt");
CREATE UNIQUE INDEX "privacy_dpias_code_key" ON "privacy_dpias"("code");
CREATE UNIQUE INDEX "privacy_dpias_workflowCaseId_key" ON "privacy_dpias"("workflowCaseId");
CREATE INDEX "privacy_dpias_assetId_idx" ON "privacy_dpias"("assetId");
CREATE INDEX "privacy_dpias_domainId_idx" ON "privacy_dpias"("domainId");
CREATE INDEX "privacy_dpias_legalBasisId_idx" ON "privacy_dpias"("legalBasisId");
CREATE INDEX "privacy_dpias_classificationId_idx" ON "privacy_dpias"("classificationId");
CREATE INDEX "privacy_dpias_status_idx" ON "privacy_dpias"("status");
CREATE INDEX "privacy_dpias_riskLevel_idx" ON "privacy_dpias"("riskLevel");
CREATE INDEX "privacy_dpias_reviewerPersonId_idx" ON "privacy_dpias"("reviewerPersonId");
CREATE INDEX "privacy_dpias_dueAt_idx" ON "privacy_dpias"("dueAt");
CREATE UNIQUE INDEX "privacy_gates_dpiaId_phase_key" ON "privacy_gates"("dpiaId", "phase");
CREATE INDEX "privacy_gates_phase_idx" ON "privacy_gates"("phase");
CREATE INDEX "privacy_gates_status_idx" ON "privacy_gates"("status");
CREATE INDEX "privacy_gates_reviewerPersonId_idx" ON "privacy_gates"("reviewerPersonId");
CREATE INDEX "privacy_gates_dueAt_idx" ON "privacy_gates"("dueAt");
CREATE UNIQUE INDEX "privacy_dsr_requests_requestNumber_key" ON "privacy_dsr_requests"("requestNumber");
CREATE UNIQUE INDEX "privacy_dsr_requests_workflowCaseId_key" ON "privacy_dsr_requests"("workflowCaseId");
CREATE INDEX "privacy_dsr_requests_status_idx" ON "privacy_dsr_requests"("status");
CREATE INDEX "privacy_dsr_requests_requestType_idx" ON "privacy_dsr_requests"("requestType");
CREATE INDEX "privacy_dsr_requests_assetId_idx" ON "privacy_dsr_requests"("assetId");
CREATE INDEX "privacy_dsr_requests_domainId_idx" ON "privacy_dsr_requests"("domainId");
CREATE INDEX "privacy_dsr_requests_assignedPersonId_idx" ON "privacy_dsr_requests"("assignedPersonId");
CREATE INDEX "privacy_dsr_requests_dueAt_idx" ON "privacy_dsr_requests"("dueAt");
CREATE UNIQUE INDEX "privacy_breaches_code_key" ON "privacy_breaches"("code");
CREATE UNIQUE INDEX "privacy_breaches_workflowCaseId_key" ON "privacy_breaches"("workflowCaseId");
CREATE INDEX "privacy_breaches_severity_idx" ON "privacy_breaches"("severity");
CREATE INDEX "privacy_breaches_status_idx" ON "privacy_breaches"("status");
CREATE INDEX "privacy_breaches_assetId_idx" ON "privacy_breaches"("assetId");
CREATE INDEX "privacy_breaches_domainId_idx" ON "privacy_breaches"("domainId");
CREATE INDEX "privacy_breaches_assignedPersonId_idx" ON "privacy_breaches"("assignedPersonId");
CREATE INDEX "privacy_breaches_notificationDueAt_idx" ON "privacy_breaches"("notificationDueAt");
CREATE INDEX "privacy_consent_records_assetId_idx" ON "privacy_consent_records"("assetId");
CREATE INDEX "privacy_consent_records_legalBasisId_idx" ON "privacy_consent_records"("legalBasisId");
CREATE INDEX "privacy_consent_records_status_idx" ON "privacy_consent_records"("status");
CREATE INDEX "privacy_consent_records_expiresAt_idx" ON "privacy_consent_records"("expiresAt");
CREATE UNIQUE INDEX "privacy_retention_rules_code_key" ON "privacy_retention_rules"("code");
CREATE INDEX "privacy_retention_rules_assetId_idx" ON "privacy_retention_rules"("assetId");
CREATE INDEX "privacy_retention_rules_domainId_idx" ON "privacy_retention_rules"("domainId");
CREATE INDEX "privacy_retention_rules_ownerPersonId_idx" ON "privacy_retention_rules"("ownerPersonId");
CREATE INDEX "privacy_retention_rules_nextReviewAt_idx" ON "privacy_retention_rules"("nextReviewAt");
CREATE INDEX "privacy_retention_rules_isActive_idx" ON "privacy_retention_rules"("isActive");
CREATE UNIQUE INDEX "data_sharing_requests_requestNumber_key" ON "data_sharing_requests"("requestNumber");
CREATE UNIQUE INDEX "data_sharing_requests_workflowCaseId_key" ON "data_sharing_requests"("workflowCaseId");
CREATE INDEX "data_sharing_requests_status_idx" ON "data_sharing_requests"("status");
CREATE INDEX "data_sharing_requests_assetId_idx" ON "data_sharing_requests"("assetId");
CREATE INDEX "data_sharing_requests_domainId_idx" ON "data_sharing_requests"("domainId");
CREATE INDEX "data_sharing_requests_classificationId_idx" ON "data_sharing_requests"("classificationId");
CREATE INDEX "data_sharing_requests_legalBasisId_idx" ON "data_sharing_requests"("legalBasisId");
CREATE INDEX "data_sharing_requests_maskingPolicyId_idx" ON "data_sharing_requests"("maskingPolicyId");
CREATE INDEX "data_sharing_requests_roleDataAccessMapId_idx" ON "data_sharing_requests"("roleDataAccessMapId");
CREATE INDEX "data_sharing_requests_riskScore_idx" ON "data_sharing_requests"("riskScore");
CREATE UNIQUE INDEX "data_sharing_reviews_requestId_step_key" ON "data_sharing_reviews"("requestId", "step");
CREATE INDEX "data_sharing_reviews_step_idx" ON "data_sharing_reviews"("step");
CREATE INDEX "data_sharing_reviews_decision_idx" ON "data_sharing_reviews"("decision");
CREATE INDEX "data_sharing_reviews_reviewerPersonId_idx" ON "data_sharing_reviews"("reviewerPersonId");
CREATE UNIQUE INDEX "data_sharing_agreements_agreementNumber_key" ON "data_sharing_agreements"("agreementNumber");
CREATE INDEX "data_sharing_agreements_requestId_idx" ON "data_sharing_agreements"("requestId");
CREATE INDEX "data_sharing_agreements_assetId_idx" ON "data_sharing_agreements"("assetId");
CREATE INDEX "data_sharing_agreements_domainId_idx" ON "data_sharing_agreements"("domainId");
CREATE INDEX "data_sharing_agreements_status_idx" ON "data_sharing_agreements"("status");
CREATE INDEX "data_sharing_agreements_ownerPersonId_idx" ON "data_sharing_agreements"("ownerPersonId");
CREATE INDEX "data_sharing_agreements_renewalDueAt_idx" ON "data_sharing_agreements"("renewalDueAt");
CREATE INDEX "data_sharing_usage_metrics_agreementId_idx" ON "data_sharing_usage_metrics"("agreementId");
CREATE INDEX "data_sharing_usage_metrics_metricDate_idx" ON "data_sharing_usage_metrics"("metricDate");
CREATE INDEX "data_sharing_usage_metrics_status_idx" ON "data_sharing_usage_metrics"("status");

ALTER TABLE "privacy_ropa_records" ADD CONSTRAINT "privacy_ropa_records_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_ropa_records" ADD CONSTRAINT "privacy_ropa_records_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_ropa_records" ADD CONSTRAINT "privacy_ropa_records_legalBasisId_fkey" FOREIGN KEY ("legalBasisId") REFERENCES "privacy_legal_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_ropa_records" ADD CONSTRAINT "privacy_ropa_records_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dpias" ADD CONSTRAINT "privacy_dpias_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dpias" ADD CONSTRAINT "privacy_dpias_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dpias" ADD CONSTRAINT "privacy_dpias_legalBasisId_fkey" FOREIGN KEY ("legalBasisId") REFERENCES "privacy_legal_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dpias" ADD CONSTRAINT "privacy_dpias_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dpias" ADD CONSTRAINT "privacy_dpias_reviewerPersonId_fkey" FOREIGN KEY ("reviewerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dpias" ADD CONSTRAINT "privacy_dpias_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_gates" ADD CONSTRAINT "privacy_gates_dpiaId_fkey" FOREIGN KEY ("dpiaId") REFERENCES "privacy_dpias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "privacy_gates" ADD CONSTRAINT "privacy_gates_reviewerPersonId_fkey" FOREIGN KEY ("reviewerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dsr_requests" ADD CONSTRAINT "privacy_dsr_requests_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dsr_requests" ADD CONSTRAINT "privacy_dsr_requests_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dsr_requests" ADD CONSTRAINT "privacy_dsr_requests_assignedPersonId_fkey" FOREIGN KEY ("assignedPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_dsr_requests" ADD CONSTRAINT "privacy_dsr_requests_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_breaches" ADD CONSTRAINT "privacy_breaches_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_breaches" ADD CONSTRAINT "privacy_breaches_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_breaches" ADD CONSTRAINT "privacy_breaches_assignedPersonId_fkey" FOREIGN KEY ("assignedPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_breaches" ADD CONSTRAINT "privacy_breaches_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_consent_records" ADD CONSTRAINT "privacy_consent_records_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_consent_records" ADD CONSTRAINT "privacy_consent_records_legalBasisId_fkey" FOREIGN KEY ("legalBasisId") REFERENCES "privacy_legal_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_retention_rules" ADD CONSTRAINT "privacy_retention_rules_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_retention_rules" ADD CONSTRAINT "privacy_retention_rules_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_retention_rules" ADD CONSTRAINT "privacy_retention_rules_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_requests" ADD CONSTRAINT "data_sharing_requests_legalBasisId_fkey" FOREIGN KEY ("legalBasisId") REFERENCES "privacy_legal_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_requests" ADD CONSTRAINT "data_sharing_requests_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_requests" ADD CONSTRAINT "data_sharing_requests_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_requests" ADD CONSTRAINT "data_sharing_requests_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_requests" ADD CONSTRAINT "data_sharing_requests_maskingPolicyId_fkey" FOREIGN KEY ("maskingPolicyId") REFERENCES "masking_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_requests" ADD CONSTRAINT "data_sharing_requests_roleDataAccessMapId_fkey" FOREIGN KEY ("roleDataAccessMapId") REFERENCES "role_data_access_maps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_requests" ADD CONSTRAINT "data_sharing_requests_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_reviews" ADD CONSTRAINT "data_sharing_reviews_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "data_sharing_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_sharing_reviews" ADD CONSTRAINT "data_sharing_reviews_reviewerPersonId_fkey" FOREIGN KEY ("reviewerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_agreements" ADD CONSTRAINT "data_sharing_agreements_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "data_sharing_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_agreements" ADD CONSTRAINT "data_sharing_agreements_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_agreements" ADD CONSTRAINT "data_sharing_agreements_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_agreements" ADD CONSTRAINT "data_sharing_agreements_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_sharing_usage_metrics" ADD CONSTRAINT "data_sharing_usage_metrics_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "data_sharing_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
