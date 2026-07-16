CREATE TYPE "NdiAuditPackStatus" AS ENUM ('queued', 'generated', 'failed');
CREATE TYPE "MdmMatchStatus" AS ENUM ('candidate', 'under_review', 'merged', 'rejected', 'superseded');
CREATE TYPE "MdmResolutionStep" AS ENUM ('identify', 'compare', 'survivorship', 'approval', 'publish');
CREATE TYPE "ReferenceDataVersionStatus" AS ENUM ('draft', 'under_review', 'approved', 'active', 'rejected', 'retired');
CREATE TYPE "MetadataCertificationStatus" AS ENUM ('draft', 'submitted', 'certified', 'needs_remediation', 'expired');
CREATE TYPE "ArchitectureReviewDecision" AS ENUM ('pending', 'approved', 'approved_with_conditions', 'rejected', 'needs_changes');

CREATE TABLE "ndi_audit_packs" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL DEFAULT 'full',
  "domainId" TEXT,
  "status" "NdiAuditPackStatus" NOT NULL DEFAULT 'queued',
  "readinessScore" INTEGER NOT NULL DEFAULT 0,
  "specCount" INTEGER NOT NULL DEFAULT 0,
  "approvedEvidenceCount" INTEGER NOT NULL DEFAULT 0,
  "gapCount" INTEGER NOT NULL DEFAULT 0,
  "blockerCount" INTEGER NOT NULL DEFAULT 0,
  "manifestJson" JSONB NOT NULL,
  "summaryJson" JSONB NOT NULL,
  "fileSha256" TEXT,
  "generatedAt" TIMESTAMP(3),
  "requestedBy" TEXT NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ndi_audit_packs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mdm_match_candidates" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sourceAssetId" TEXT NOT NULL,
  "candidateAssetId" TEXT NOT NULL,
  "matchScore" INTEGER NOT NULL DEFAULT 0,
  "status" "MdmMatchStatus" NOT NULL DEFAULT 'candidate',
  "resolutionStep" "MdmResolutionStep" NOT NULL DEFAULT 'identify',
  "sourceTrustRank" INTEGER NOT NULL DEFAULT 50,
  "survivorshipRulesJson" JSONB,
  "proposedGoldenRecordJson" JSONB,
  "resolutionNote" TEXT,
  "evidenceId" TEXT,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mdm_match_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reference_data_versions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" "ReferenceDataVersionStatus" NOT NULL DEFAULT 'draft',
  "domainId" TEXT,
  "assetId" TEXT,
  "changeSummary" TEXT,
  "sourceTrustRank" INTEGER NOT NULL DEFAULT 50,
  "valuesCount" INTEGER NOT NULL DEFAULT 0,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "evidenceId" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reference_data_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metadata_certifications" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "status" "MetadataCertificationStatus" NOT NULL DEFAULT 'draft',
  "qualityScore" INTEGER NOT NULL DEFAULT 0,
  "completenessScore" INTEGER NOT NULL DEFAULT 0,
  "ownerConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "glossaryAligned" BOOLEAN NOT NULL DEFAULT false,
  "lineageReviewed" BOOLEAN NOT NULL DEFAULT false,
  "certificationNote" TEXT,
  "certifiedBy" TEXT,
  "certifiedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "workflowCaseId" TEXT,
  "evidenceId" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "metadata_certifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "architecture_reviews" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "reviewType" TEXT NOT NULL DEFAULT 'data_model',
  "title" TEXT NOT NULL,
  "decision" "ArchitectureReviewDecision" NOT NULL DEFAULT 'pending',
  "architectureDecision" TEXT,
  "lineageImpact" TEXT,
  "riskLevel" TEXT NOT NULL DEFAULT 'medium',
  "conditionsJson" JSONB,
  "evidenceId" TEXT,
  "workflowCaseId" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "architecture_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ndi_audit_packs_code_key" ON "ndi_audit_packs"("code");
CREATE INDEX "ndi_audit_packs_domainId_idx" ON "ndi_audit_packs"("domainId");
CREATE INDEX "ndi_audit_packs_status_idx" ON "ndi_audit_packs"("status");
CREATE INDEX "ndi_audit_packs_generatedAt_idx" ON "ndi_audit_packs"("generatedAt");

CREATE UNIQUE INDEX "mdm_match_candidates_code_key" ON "mdm_match_candidates"("code");
CREATE UNIQUE INDEX "mdm_match_candidates_sourceAssetId_candidateAssetId_key" ON "mdm_match_candidates"("sourceAssetId", "candidateAssetId");
CREATE INDEX "mdm_match_candidates_sourceAssetId_idx" ON "mdm_match_candidates"("sourceAssetId");
CREATE INDEX "mdm_match_candidates_candidateAssetId_idx" ON "mdm_match_candidates"("candidateAssetId");
CREATE INDEX "mdm_match_candidates_status_idx" ON "mdm_match_candidates"("status");
CREATE INDEX "mdm_match_candidates_resolutionStep_idx" ON "mdm_match_candidates"("resolutionStep");
CREATE INDEX "mdm_match_candidates_evidenceId_idx" ON "mdm_match_candidates"("evidenceId");

CREATE UNIQUE INDEX "reference_data_versions_code_version_key" ON "reference_data_versions"("code", "version");
CREATE INDEX "reference_data_versions_domainId_idx" ON "reference_data_versions"("domainId");
CREATE INDEX "reference_data_versions_assetId_idx" ON "reference_data_versions"("assetId");
CREATE INDEX "reference_data_versions_status_idx" ON "reference_data_versions"("status");
CREATE INDEX "reference_data_versions_evidenceId_idx" ON "reference_data_versions"("evidenceId");

CREATE UNIQUE INDEX "metadata_certifications_code_key" ON "metadata_certifications"("code");
CREATE UNIQUE INDEX "metadata_certifications_workflowCaseId_key" ON "metadata_certifications"("workflowCaseId");
CREATE INDEX "metadata_certifications_assetId_idx" ON "metadata_certifications"("assetId");
CREATE INDEX "metadata_certifications_status_idx" ON "metadata_certifications"("status");
CREATE INDEX "metadata_certifications_workflowCaseId_idx" ON "metadata_certifications"("workflowCaseId");
CREATE INDEX "metadata_certifications_evidenceId_idx" ON "metadata_certifications"("evidenceId");
CREATE INDEX "metadata_certifications_expiresAt_idx" ON "metadata_certifications"("expiresAt");

CREATE UNIQUE INDEX "architecture_reviews_code_key" ON "architecture_reviews"("code");
CREATE UNIQUE INDEX "architecture_reviews_workflowCaseId_key" ON "architecture_reviews"("workflowCaseId");
CREATE INDEX "architecture_reviews_assetId_idx" ON "architecture_reviews"("assetId");
CREATE INDEX "architecture_reviews_decision_idx" ON "architecture_reviews"("decision");
CREATE INDEX "architecture_reviews_workflowCaseId_idx" ON "architecture_reviews"("workflowCaseId");
CREATE INDEX "architecture_reviews_evidenceId_idx" ON "architecture_reviews"("evidenceId");

ALTER TABLE "ndi_audit_packs" ADD CONSTRAINT "ndi_audit_packs_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "ndi_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mdm_match_candidates" ADD CONSTRAINT "mdm_match_candidates_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mdm_match_candidates" ADD CONSTRAINT "mdm_match_candidates_candidateAssetId_fkey" FOREIGN KEY ("candidateAssetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mdm_match_candidates" ADD CONSTRAINT "mdm_match_candidates_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ndi_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reference_data_versions" ADD CONSTRAINT "reference_data_versions_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reference_data_versions" ADD CONSTRAINT "reference_data_versions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reference_data_versions" ADD CONSTRAINT "reference_data_versions_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ndi_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "metadata_certifications" ADD CONSTRAINT "metadata_certifications_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metadata_certifications" ADD CONSTRAINT "metadata_certifications_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "metadata_certifications" ADD CONSTRAINT "metadata_certifications_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ndi_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "architecture_reviews" ADD CONSTRAINT "architecture_reviews_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "architecture_reviews" ADD CONSTRAINT "architecture_reviews_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "architecture_reviews" ADD CONSTRAINT "architecture_reviews_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ndi_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
