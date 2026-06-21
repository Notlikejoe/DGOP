-- CreateTable
CREATE TABLE "data_assets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'draft',
    "ownerStatus" TEXT NOT NULL DEFAULT 'unassigned',
    "ownerName" TEXT,
    "domainId" TEXT,
    "orgUnitId" TEXT,
    "systemId" TEXT,
    "capabilityId" TEXT,
    "classificationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_subjects" (
    "assetId" TEXT NOT NULL,
    "dataSubjectId" TEXT NOT NULL,

    CONSTRAINT "asset_subjects_pkey" PRIMARY KEY ("assetId","dataSubjectId")
);

-- CreateTable
CREATE TABLE "asset_relationships" (
    "id" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "targetAssetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_assets_code_key" ON "data_assets"("code");

-- CreateIndex
CREATE INDEX "data_assets_domainId_idx" ON "data_assets"("domainId");

-- CreateIndex
CREATE INDEX "data_assets_orgUnitId_idx" ON "data_assets"("orgUnitId");

-- CreateIndex
CREATE INDEX "data_assets_systemId_idx" ON "data_assets"("systemId");

-- CreateIndex
CREATE INDEX "data_assets_capabilityId_idx" ON "data_assets"("capabilityId");

-- CreateIndex
CREATE INDEX "data_assets_classificationId_idx" ON "data_assets"("classificationId");

-- CreateIndex
CREATE INDEX "data_assets_lifecycleStatus_idx" ON "data_assets"("lifecycleStatus");

-- CreateIndex
CREATE INDEX "data_assets_ownerStatus_idx" ON "data_assets"("ownerStatus");

-- CreateIndex
CREATE INDEX "asset_subjects_dataSubjectId_idx" ON "asset_subjects"("dataSubjectId");

-- CreateIndex
CREATE INDEX "asset_relationships_targetAssetId_idx" ON "asset_relationships"("targetAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_relationships_sourceAssetId_targetAssetId_type_key" ON "asset_relationships"("sourceAssetId", "targetAssetId", "type");

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "business_capabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_subjects" ADD CONSTRAINT "asset_subjects_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_subjects" ADD CONSTRAINT "asset_subjects_dataSubjectId_fkey" FOREIGN KEY ("dataSubjectId") REFERENCES "data_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_relationships" ADD CONSTRAINT "asset_relationships_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_relationships" ADD CONSTRAINT "asset_relationships_targetAssetId_fkey" FOREIGN KEY ("targetAssetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
