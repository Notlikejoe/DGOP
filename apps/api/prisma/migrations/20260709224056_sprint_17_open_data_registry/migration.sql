-- CreateEnum
CREATE TYPE "OpenDataCandidateStatus" AS ENUM ('draft', 'assessment', 'under_review', 'approved', 'published', 'rejected', 'retired');

-- CreateEnum
CREATE TYPE "OpenDataPublicationFrequency" AS ENUM ('one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'on_demand');

-- CreateEnum
CREATE TYPE "OpenDataPublicationFormat" AS ENUM ('csv', 'json', 'xlsx', 'api', 'geojson', 'pdf', 'other');

-- CreateEnum
CREATE TYPE "OpenDataSignalStatus" AS ENUM ('ready', 'needs_review', 'blocked');

-- CreateEnum
CREATE TYPE "OpenDataPersonalDataAssessment" AS ENUM ('none', 'aggregated', 'personal_data', 'sensitive_personal_data', 'unknown');

-- CreateTable
CREATE TABLE "open_data_candidates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "description" TEXT,
    "publicationFrequency" "OpenDataPublicationFrequency" NOT NULL DEFAULT 'quarterly',
    "publicationFormat" "OpenDataPublicationFormat" NOT NULL DEFAULT 'csv',
    "portalUrl" TEXT,
    "status" "OpenDataCandidateStatus" NOT NULL DEFAULT 'draft',
    "ownerPersonId" TEXT,
    "stewardPersonId" TEXT,
    "odiaoReviewerPersonId" TEXT,
    "classificationId" TEXT,
    "dqScoreId" TEXT,
    "personalDataAssessment" "OpenDataPersonalDataAssessment" NOT NULL DEFAULT 'unknown',
    "classificationSignal" "OpenDataSignalStatus" NOT NULL DEFAULT 'needs_review',
    "dataQualitySignal" "OpenDataSignalStatus" NOT NULL DEFAULT 'needs_review',
    "personalDataSignal" "OpenDataSignalStatus" NOT NULL DEFAULT 'needs_review',
    "ownershipSignal" "OpenDataSignalStatus" NOT NULL DEFAULT 'needs_review',
    "publicationValueSignal" "OpenDataSignalStatus" NOT NULL DEFAULT 'needs_review',
    "publicationValueScore" INTEGER NOT NULL DEFAULT 50,
    "eligibilityScore" INTEGER NOT NULL DEFAULT 0,
    "eligibilityJson" JSONB,
    "decisionNote" TEXT,
    "publishedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_data_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "open_data_candidates_code_key" ON "open_data_candidates"("code");

-- CreateIndex
CREATE INDEX "open_data_candidates_assetId_idx" ON "open_data_candidates"("assetId");

-- CreateIndex
CREATE INDEX "open_data_candidates_status_idx" ON "open_data_candidates"("status");

-- CreateIndex
CREATE INDEX "open_data_candidates_ownerPersonId_idx" ON "open_data_candidates"("ownerPersonId");

-- CreateIndex
CREATE INDEX "open_data_candidates_stewardPersonId_idx" ON "open_data_candidates"("stewardPersonId");

-- CreateIndex
CREATE INDEX "open_data_candidates_odiaoReviewerPersonId_idx" ON "open_data_candidates"("odiaoReviewerPersonId");

-- CreateIndex
CREATE INDEX "open_data_candidates_classificationId_idx" ON "open_data_candidates"("classificationId");

-- CreateIndex
CREATE INDEX "open_data_candidates_dqScoreId_idx" ON "open_data_candidates"("dqScoreId");

-- CreateIndex
CREATE INDEX "open_data_candidates_nextReviewAt_idx" ON "open_data_candidates"("nextReviewAt");

-- CreateIndex
CREATE INDEX "open_data_candidates_eligibilityScore_idx" ON "open_data_candidates"("eligibilityScore");

-- CreateIndex
CREATE INDEX "role_data_access_maps_roleId_scopeKey_isActive_idx" ON "role_data_access_maps"("roleId", "scopeKey", "isActive");

-- AddForeignKey
ALTER TABLE "open_data_candidates" ADD CONSTRAINT "open_data_candidates_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_data_candidates" ADD CONSTRAINT "open_data_candidates_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_data_candidates" ADD CONSTRAINT "open_data_candidates_dqScoreId_fkey" FOREIGN KEY ("dqScoreId") REFERENCES "data_quality_scores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_data_candidates" ADD CONSTRAINT "open_data_candidates_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_data_candidates" ADD CONSTRAINT "open_data_candidates_stewardPersonId_fkey" FOREIGN KEY ("stewardPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_data_candidates" ADD CONSTRAINT "open_data_candidates_odiaoReviewerPersonId_fkey" FOREIGN KEY ("odiaoReviewerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "integration_external_references_connectorId_externalId_entityTy" RENAME TO "integration_external_references_connectorId_externalId_enti_key";
