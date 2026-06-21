-- CreateEnum
CREATE TYPE "NdiEvidenceStatus" AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'expired', 'revoked');

-- AlterTable
ALTER TABLE "ndi_specifications" ADD COLUMN     "ownerPersonId" TEXT;

-- CreateTable
CREATE TABLE "ndi_evidence" (
    "id" TEXT NOT NULL,
    "specId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "status" "NdiEvidenceStatus" NOT NULL DEFAULT 'draft',
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "expiryDate" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ndi_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ndi_evidence_specId_idx" ON "ndi_evidence"("specId");

-- CreateIndex
CREATE INDEX "ndi_evidence_status_idx" ON "ndi_evidence"("status");

-- CreateIndex
CREATE INDEX "ndi_evidence_expiryDate_idx" ON "ndi_evidence"("expiryDate");

-- CreateIndex
CREATE INDEX "ndi_specifications_ownerPersonId_idx" ON "ndi_specifications"("ownerPersonId");

-- AddForeignKey
ALTER TABLE "ndi_specifications" ADD CONSTRAINT "ndi_specifications_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ndi_evidence" ADD CONSTRAINT "ndi_evidence_specId_fkey" FOREIGN KEY ("specId") REFERENCES "ndi_specifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
