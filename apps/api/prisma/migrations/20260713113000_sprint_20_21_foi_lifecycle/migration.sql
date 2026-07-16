CREATE TYPE "FoiRequesterType" AS ENUM ('individual', 'business', 'government', 'media', 'nonprofit', 'other');
CREATE TYPE "FoiRequestChannel" AS ENUM ('web', 'email', 'crm', 'call_center', 'manual');
CREATE TYPE "FoiRequestCategory" AS ENUM ('data_request', 'record_request', 'policy_request', 'statistics', 'other');
CREATE TYPE "FoiRequestStatus" AS ENUM ('registered', 'under_review', 'awaiting_clarification', 'decision_due', 'approved', 'partially_approved', 'rejected', 'extended', 'disclosed', 'appealed', 'closed', 'cancelled');
CREATE TYPE "FoiReviewType" AS ENUM ('classification', 'privacy', 'legal', 'owner', 'disclosure');
CREATE TYPE "FoiReviewStatus" AS ENUM ('pending', 'completed', 'blocked');
CREATE TYPE "FoiDecisionOutcome" AS ENUM ('approved', 'partially_approved', 'rejected', 'extended');
CREATE TYPE "FoiDisclosureMethod" AS ENUM ('secure_link', 'email', 'pickup', 'portal', 'other');
CREATE TYPE "FoiAppealStatus" AS ENUM ('submitted', 'under_review', 'upheld', 'overturned', 'closed', 'withdrawn');

CREATE TABLE "foi_response_templates" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "outcome" "FoiDecisionOutcome" NOT NULL,
  "bodyEn" TEXT NOT NULL,
  "bodyAr" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "foi_response_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "foi_requests" (
  "id" TEXT NOT NULL,
  "requestNumber" TEXT NOT NULL,
  "requesterName" TEXT NOT NULL,
  "requesterEmail" TEXT,
  "requesterPhone" TEXT,
  "requesterType" "FoiRequesterType" NOT NULL DEFAULT 'individual',
  "channel" "FoiRequestChannel" NOT NULL DEFAULT 'manual',
  "category" "FoiRequestCategory" NOT NULL DEFAULT 'record_request',
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "FoiRequestStatus" NOT NULL DEFAULT 'registered',
  "identityValidated" BOOLEAN NOT NULL DEFAULT false,
  "contactValidated" BOOLEAN NOT NULL DEFAULT false,
  "assignedOfficerPersonId" TEXT,
  "assetId" TEXT,
  "dataDomainId" TEXT,
  "classificationId" TEXT,
  "responseTemplateId" TEXT,
  "decisionOutcome" "FoiDecisionOutcome",
  "decisionSummary" TEXT,
  "extendedDueAt" TIMESTAMP(3),
  "workflowCaseId" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "foi_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "foi_reviews" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "reviewType" "FoiReviewType" NOT NULL,
  "status" "FoiReviewStatus" NOT NULL DEFAULT 'pending',
  "reviewerPersonId" TEXT,
  "note" TEXT,
  "evidenceSummary" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "foi_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "foi_exemption_evidence" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "basisCode" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "classificationId" TEXT,
  "recordedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "foi_exemption_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "foi_decisions" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "outcome" "FoiDecisionOutcome" NOT NULL,
  "summary" TEXT NOT NULL,
  "justification" TEXT NOT NULL,
  "responseTemplateId" TEXT,
  "decidedBy" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "extendedDueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "foi_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "foi_disclosures" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "decisionId" TEXT,
  "method" "FoiDisclosureMethod" NOT NULL DEFAULT 'secure_link',
  "recipient" TEXT NOT NULL,
  "recordUrl" TEXT,
  "summary" TEXT,
  "disclosedBy" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "foi_disclosures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "foi_appeals" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "appealNumber" TEXT NOT NULL,
  "status" "FoiAppealStatus" NOT NULL DEFAULT 'submitted',
  "reason" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "assignedOfficerPersonId" TEXT,
  "decision" TEXT,
  "closedAt" TIMESTAMP(3),
  "workflowCaseId" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "foi_appeals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "foi_response_templates_code_key" ON "foi_response_templates"("code");
CREATE INDEX "foi_response_templates_outcome_idx" ON "foi_response_templates"("outcome");
CREATE INDEX "foi_response_templates_isActive_idx" ON "foi_response_templates"("isActive");

CREATE UNIQUE INDEX "foi_requests_requestNumber_key" ON "foi_requests"("requestNumber");
CREATE UNIQUE INDEX "foi_requests_workflowCaseId_key" ON "foi_requests"("workflowCaseId");
CREATE INDEX "foi_requests_status_idx" ON "foi_requests"("status");
CREATE INDEX "foi_requests_channel_idx" ON "foi_requests"("channel");
CREATE INDEX "foi_requests_category_idx" ON "foi_requests"("category");
CREATE INDEX "foi_requests_dueAt_idx" ON "foi_requests"("dueAt");
CREATE INDEX "foi_requests_assetId_idx" ON "foi_requests"("assetId");
CREATE INDEX "foi_requests_dataDomainId_idx" ON "foi_requests"("dataDomainId");
CREATE INDEX "foi_requests_classificationId_idx" ON "foi_requests"("classificationId");
CREATE INDEX "foi_requests_assignedOfficerPersonId_idx" ON "foi_requests"("assignedOfficerPersonId");

CREATE UNIQUE INDEX "foi_reviews_requestId_reviewType_key" ON "foi_reviews"("requestId", "reviewType");
CREATE INDEX "foi_reviews_requestId_idx" ON "foi_reviews"("requestId");
CREATE INDEX "foi_reviews_reviewType_idx" ON "foi_reviews"("reviewType");
CREATE INDEX "foi_reviews_status_idx" ON "foi_reviews"("status");
CREATE INDEX "foi_reviews_reviewerPersonId_idx" ON "foi_reviews"("reviewerPersonId");

CREATE INDEX "foi_exemption_evidence_requestId_idx" ON "foi_exemption_evidence"("requestId");
CREATE INDEX "foi_exemption_evidence_basisCode_idx" ON "foi_exemption_evidence"("basisCode");
CREATE INDEX "foi_exemption_evidence_classificationId_idx" ON "foi_exemption_evidence"("classificationId");

CREATE INDEX "foi_decisions_requestId_idx" ON "foi_decisions"("requestId");
CREATE INDEX "foi_decisions_outcome_idx" ON "foi_decisions"("outcome");
CREATE INDEX "foi_decisions_responseTemplateId_idx" ON "foi_decisions"("responseTemplateId");

CREATE INDEX "foi_disclosures_requestId_idx" ON "foi_disclosures"("requestId");
CREATE INDEX "foi_disclosures_decisionId_idx" ON "foi_disclosures"("decisionId");
CREATE INDEX "foi_disclosures_releasedAt_idx" ON "foi_disclosures"("releasedAt");

CREATE UNIQUE INDEX "foi_appeals_appealNumber_key" ON "foi_appeals"("appealNumber");
CREATE UNIQUE INDEX "foi_appeals_workflowCaseId_key" ON "foi_appeals"("workflowCaseId");
CREATE INDEX "foi_appeals_requestId_idx" ON "foi_appeals"("requestId");
CREATE INDEX "foi_appeals_status_idx" ON "foi_appeals"("status");
CREATE INDEX "foi_appeals_dueAt_idx" ON "foi_appeals"("dueAt");
CREATE INDEX "foi_appeals_assignedOfficerPersonId_idx" ON "foi_appeals"("assignedOfficerPersonId");

ALTER TABLE "foi_requests" ADD CONSTRAINT "foi_requests_assignedOfficerPersonId_fkey" FOREIGN KEY ("assignedOfficerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "foi_requests" ADD CONSTRAINT "foi_requests_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "foi_requests" ADD CONSTRAINT "foi_requests_dataDomainId_fkey" FOREIGN KEY ("dataDomainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "foi_requests" ADD CONSTRAINT "foi_requests_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "foi_requests" ADD CONSTRAINT "foi_requests_responseTemplateId_fkey" FOREIGN KEY ("responseTemplateId") REFERENCES "foi_response_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "foi_requests" ADD CONSTRAINT "foi_requests_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "foi_reviews" ADD CONSTRAINT "foi_reviews_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "foi_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "foi_reviews" ADD CONSTRAINT "foi_reviews_reviewerPersonId_fkey" FOREIGN KEY ("reviewerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "foi_exemption_evidence" ADD CONSTRAINT "foi_exemption_evidence_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "foi_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "foi_exemption_evidence" ADD CONSTRAINT "foi_exemption_evidence_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "foi_decisions" ADD CONSTRAINT "foi_decisions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "foi_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "foi_decisions" ADD CONSTRAINT "foi_decisions_responseTemplateId_fkey" FOREIGN KEY ("responseTemplateId") REFERENCES "foi_response_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "foi_disclosures" ADD CONSTRAINT "foi_disclosures_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "foi_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "foi_disclosures" ADD CONSTRAINT "foi_disclosures_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "foi_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "foi_appeals" ADD CONSTRAINT "foi_appeals_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "foi_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "foi_appeals" ADD CONSTRAINT "foi_appeals_assignedOfficerPersonId_fkey" FOREIGN KEY ("assignedOfficerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "foi_appeals" ADD CONSTRAINT "foi_appeals_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
