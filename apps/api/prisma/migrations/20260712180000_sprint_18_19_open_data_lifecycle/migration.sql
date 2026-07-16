-- Sprint 18/19: Open Data assessment, approval, publication, review, and usage lifecycle.

CREATE TYPE "OpenDataAssessmentStatus" AS ENUM ('draft', 'completed');

CREATE TYPE "OpenDataApprovalDecision" AS ENUM ('pending', 'approved', 'rejected', 'needs_changes');

CREATE TYPE "OpenDataPortalSyncStatus" AS ENUM ('pending', 'simulated', 'sent', 'failed');

CREATE TYPE "OpenDataReviewDecision" AS ENUM ('continue_publication', 'update_required', 'retire', 'reassess');

CREATE TABLE "open_data_assessments" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "OpenDataAssessmentStatus" NOT NULL DEFAULT 'draft',
    "publicClassification" BOOLEAN NOT NULL DEFAULT false,
    "restrictedInformation" BOOLEAN NOT NULL DEFAULT false,
    "aggregationApplied" BOOLEAN NOT NULL DEFAULT false,
    "anonymizationApplied" BOOLEAN NOT NULL DEFAULT false,
    "dqAcceptable" BOOLEAN NOT NULL DEFAULT false,
    "metadataComplete" BOOLEAN NOT NULL DEFAULT false,
    "privacyReviewComplete" BOOLEAN NOT NULL DEFAULT false,
    "legalReviewComplete" BOOLEAN NOT NULL DEFAULT false,
    "readinessScore" INTEGER NOT NULL DEFAULT 0,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "resultSignal" "OpenDataSignalStatus" NOT NULL DEFAULT 'needs_review',
    "blockersJson" JSONB,
    "reviewItemsJson" JSONB,
    "note" TEXT,
    "assessedBy" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_data_assessments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "open_data_approvals" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "decision" "OpenDataApprovalDecision" NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "workflowCaseId" TEXT,
    "workflowTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_data_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "open_data_publications" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "portalRecordId" TEXT,
    "portalUrl" TEXT,
    "format" "OpenDataPublicationFormat" NOT NULL,
    "syncStatus" "OpenDataPortalSyncStatus" NOT NULL DEFAULT 'simulated',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextReviewAt" TIMESTAMP(3),
    "publishedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_data_publications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "open_data_reviews" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "reviewDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "OpenDataReviewDecision" NOT NULL,
    "reviewer" TEXT NOT NULL,
    "note" TEXT,
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_data_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "open_data_usage_metrics" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "metricDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "uniqueUsers" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_data_usage_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "open_data_assessments_candidateId_idx" ON "open_data_assessments"("candidateId");
CREATE INDEX "open_data_assessments_status_idx" ON "open_data_assessments"("status");
CREATE INDEX "open_data_assessments_resultSignal_idx" ON "open_data_assessments"("resultSignal");
CREATE INDEX "open_data_assessments_createdAt_idx" ON "open_data_assessments"("createdAt");

CREATE UNIQUE INDEX "open_data_approvals_candidateId_step_key" ON "open_data_approvals"("candidateId", "step");
CREATE INDEX "open_data_approvals_candidateId_idx" ON "open_data_approvals"("candidateId");
CREATE INDEX "open_data_approvals_decision_idx" ON "open_data_approvals"("decision");
CREATE INDEX "open_data_approvals_workflowCaseId_idx" ON "open_data_approvals"("workflowCaseId");

CREATE UNIQUE INDEX "open_data_publications_portalRecordId_key" ON "open_data_publications"("portalRecordId");
CREATE INDEX "open_data_publications_candidateId_idx" ON "open_data_publications"("candidateId");
CREATE INDEX "open_data_publications_publishedAt_idx" ON "open_data_publications"("publishedAt");
CREATE INDEX "open_data_publications_nextReviewAt_idx" ON "open_data_publications"("nextReviewAt");
CREATE INDEX "open_data_publications_syncStatus_idx" ON "open_data_publications"("syncStatus");

CREATE INDEX "open_data_reviews_candidateId_idx" ON "open_data_reviews"("candidateId");
CREATE INDEX "open_data_reviews_reviewDate_idx" ON "open_data_reviews"("reviewDate");
CREATE INDEX "open_data_reviews_decision_idx" ON "open_data_reviews"("decision");
CREATE INDEX "open_data_reviews_nextReviewAt_idx" ON "open_data_reviews"("nextReviewAt");

CREATE INDEX "open_data_usage_metrics_candidateId_idx" ON "open_data_usage_metrics"("candidateId");
CREATE INDEX "open_data_usage_metrics_metricDate_idx" ON "open_data_usage_metrics"("metricDate");
CREATE INDEX "open_data_usage_metrics_source_idx" ON "open_data_usage_metrics"("source");

ALTER TABLE "open_data_assessments"
  ADD CONSTRAINT "open_data_assessments_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "open_data_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "open_data_approvals"
  ADD CONSTRAINT "open_data_approvals_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "open_data_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "open_data_approvals"
  ADD CONSTRAINT "open_data_approvals_workflowCaseId_fkey"
  FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "open_data_publications"
  ADD CONSTRAINT "open_data_publications_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "open_data_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "open_data_reviews"
  ADD CONSTRAINT "open_data_reviews_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "open_data_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "open_data_usage_metrics"
  ADD CONSTRAINT "open_data_usage_metrics_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "open_data_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
