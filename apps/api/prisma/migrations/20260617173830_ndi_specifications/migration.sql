-- CreateEnum
CREATE TYPE "NdiSpecType" AS ENUM ('policy', 'standard', 'control', 'procedure', 'guideline');

-- CreateEnum
CREATE TYPE "NdiMaturityLevel" AS ENUM ('level_1', 'level_2', 'level_3', 'level_4', 'level_5');

-- CreateTable
CREATE TABLE "ndi_specifications" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "criterion" TEXT,
    "type" "NdiSpecType" NOT NULL DEFAULT 'standard',
    "maturityLevel" "NdiMaturityLevel" NOT NULL DEFAULT 'level_1',
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "descriptionAr" TEXT,
    "acceptanceCriteria" TEXT,
    "reference" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ndi_specifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ndi_specifications_code_key" ON "ndi_specifications"("code");

-- CreateIndex
CREATE INDEX "ndi_specifications_domainId_idx" ON "ndi_specifications"("domainId");

-- CreateIndex
CREATE INDEX "ndi_specifications_type_idx" ON "ndi_specifications"("type");

-- CreateIndex
CREATE INDEX "ndi_specifications_maturityLevel_idx" ON "ndi_specifications"("maturityLevel");

-- CreateIndex
CREATE INDEX "ndi_specifications_isActive_idx" ON "ndi_specifications"("isActive");

-- AddForeignKey
ALTER TABLE "ndi_specifications" ADD CONSTRAINT "ndi_specifications_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "ndi_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
