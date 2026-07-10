-- Sprint 15: Catalog Integration MVP.
-- Adds connector, import batch, reconciliation, external reference, and write-back evidence tables.

CREATE TYPE "IntegrationConnectorType" AS ENUM ('catalog', 'lineage', 'data_quality', 'dlp', 'pdp', 'ndi', 'risk', 'profiling', 'training');
CREATE TYPE "IntegrationDirection" AS ENUM ('inbound', 'outbound', 'bidirectional');
CREATE TYPE "IntegrationConnectorStatus" AS ENUM ('healthy', 'warning', 'failed', 'disabled');
CREATE TYPE "IntegrationSourceTrust" AS ENUM ('authoritative', 'trusted', 'observed', 'simulated');
CREATE TYPE "IntegrationAdapterType" AS ENUM ('catalog_csv', 'mock_rest');
CREATE TYPE "IntegrationJobType" AS ENUM ('catalog_sync', 'catalog_writeback', 'signal_ingest');
CREATE TYPE "IntegrationJobStatus" AS ENUM ('ready', 'running', 'completed', 'completed_with_errors', 'failed', 'disabled');
CREATE TYPE "IntegrationBatchStatus" AS ENUM ('running', 'completed', 'completed_with_errors', 'failed');
CREATE TYPE "IntegrationImportErrorSeverity" AS ENUM ('warning', 'error');
CREATE TYPE "IntegrationEntityType" AS ENUM ('data_asset', 'owner', 'steward', 'governance_status');
CREATE TYPE "IntegrationWritebackStatus" AS ENUM ('simulated', 'sent', 'failed');
CREATE TYPE "DataAssetCatalogSyncStatus" AS ENUM ('not_synced', 'synced', 'stale', 'error', 'writeback_simulated');

ALTER TABLE "data_assets"
  ADD COLUMN "externalCatalogId" TEXT,
  ADD COLUMN "catalogSource" TEXT,
  ADD COLUMN "catalogSyncStatus" "DataAssetCatalogSyncStatus" NOT NULL DEFAULT 'not_synced',
  ADD COLUMN "catalogTrustLevel" "IntegrationSourceTrust" NOT NULL DEFAULT 'observed',
  ADD COLUMN "catalogLastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "catalogWritebackStatus" "IntegrationWritebackStatus";

CREATE TABLE "integration_connectors" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "description" TEXT,
  "type" "IntegrationConnectorType" NOT NULL DEFAULT 'catalog',
  "direction" "IntegrationDirection" NOT NULL DEFAULT 'bidirectional',
  "status" "IntegrationConnectorStatus" NOT NULL DEFAULT 'warning',
  "sourceTrust" "IntegrationSourceTrust" NOT NULL DEFAULT 'authoritative',
  "configJson" JSONB,
  "fieldMappingJson" JSONB,
  "lastRunAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdBy" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_connectors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_jobs" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "connectorId" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "jobType" "IntegrationJobType" NOT NULL DEFAULT 'catalog_sync',
  "status" "IntegrationJobStatus" NOT NULL DEFAULT 'ready',
  "syncMode" TEXT NOT NULL DEFAULT 'manual',
  "scheduleCron" TEXT,
  "lastRunAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdBy" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_import_batches" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "connectorId" TEXT NOT NULL,
  "jobId" TEXT,
  "sourceName" TEXT,
  "adapterType" "IntegrationAdapterType" NOT NULL DEFAULT 'catalog_csv',
  "status" "IntegrationBatchStatus" NOT NULL DEFAULT 'running',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "triggeredBy" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "createdRows" INTEGER NOT NULL DEFAULT 0,
  "updatedRows" INTEGER NOT NULL DEFAULT 0,
  "unchangedRows" INTEGER NOT NULL DEFAULT 0,
  "errorRows" INTEGER NOT NULL DEFAULT 0,
  "warningRows" INTEGER NOT NULL DEFAULT 0,
  "reconciliationJson" JSONB,
  "mappingPreviewJson" JSONB,
  CONSTRAINT "integration_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_import_errors" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "externalId" TEXT,
  "field" TEXT,
  "message" TEXT NOT NULL,
  "severity" "IntegrationImportErrorSeverity" NOT NULL DEFAULT 'error',
  "rawRowJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_import_errors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_external_references" (
  "id" TEXT NOT NULL,
  "connectorId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "entityType" "IntegrationEntityType" NOT NULL DEFAULT 'data_asset',
  "entityId" TEXT,
  "assetId" TEXT,
  "sourceTrust" "IntegrationSourceTrust" NOT NULL DEFAULT 'authoritative',
  "syncStatus" "DataAssetCatalogSyncStatus" NOT NULL DEFAULT 'synced',
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_external_references_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_writeback_logs" (
  "id" TEXT NOT NULL,
  "connectorId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "batchId" TEXT,
  "status" "IntegrationWritebackStatus" NOT NULL DEFAULT 'simulated',
  "simulated" BOOLEAN NOT NULL DEFAULT true,
  "payloadJson" JSONB NOT NULL,
  "resultJson" JSONB,
  "message" TEXT,
  "actor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_writeback_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_connectors_code_key" ON "integration_connectors"("code");
CREATE INDEX "integration_connectors_type_idx" ON "integration_connectors"("type");
CREATE INDEX "integration_connectors_status_idx" ON "integration_connectors"("status");
CREATE INDEX "integration_connectors_isActive_idx" ON "integration_connectors"("isActive");

CREATE UNIQUE INDEX "integration_jobs_code_key" ON "integration_jobs"("code");
CREATE INDEX "integration_jobs_connectorId_idx" ON "integration_jobs"("connectorId");
CREATE INDEX "integration_jobs_jobType_idx" ON "integration_jobs"("jobType");
CREATE INDEX "integration_jobs_status_idx" ON "integration_jobs"("status");
CREATE INDEX "integration_jobs_isActive_idx" ON "integration_jobs"("isActive");

CREATE UNIQUE INDEX "integration_import_batches_code_key" ON "integration_import_batches"("code");
CREATE INDEX "integration_import_batches_connectorId_idx" ON "integration_import_batches"("connectorId");
CREATE INDEX "integration_import_batches_jobId_idx" ON "integration_import_batches"("jobId");
CREATE INDEX "integration_import_batches_status_idx" ON "integration_import_batches"("status");
CREATE INDEX "integration_import_batches_startedAt_idx" ON "integration_import_batches"("startedAt");

CREATE INDEX "integration_import_errors_batchId_idx" ON "integration_import_errors"("batchId");
CREATE INDEX "integration_import_errors_severity_idx" ON "integration_import_errors"("severity");

CREATE UNIQUE INDEX "integration_external_references_connectorId_externalId_entityType_key" ON "integration_external_references"("connectorId", "externalId", "entityType");
CREATE INDEX "integration_external_references_assetId_idx" ON "integration_external_references"("assetId");
CREATE INDEX "integration_external_references_entityType_idx" ON "integration_external_references"("entityType");
CREATE INDEX "integration_external_references_syncStatus_idx" ON "integration_external_references"("syncStatus");

CREATE INDEX "integration_writeback_logs_connectorId_idx" ON "integration_writeback_logs"("connectorId");
CREATE INDEX "integration_writeback_logs_assetId_idx" ON "integration_writeback_logs"("assetId");
CREATE INDEX "integration_writeback_logs_status_idx" ON "integration_writeback_logs"("status");
CREATE INDEX "integration_writeback_logs_createdAt_idx" ON "integration_writeback_logs"("createdAt");

CREATE INDEX "data_assets_externalCatalogId_idx" ON "data_assets"("externalCatalogId");
CREATE INDEX "data_assets_catalogSource_idx" ON "data_assets"("catalogSource");
CREATE INDEX "data_assets_catalogSyncStatus_idx" ON "data_assets"("catalogSyncStatus");

ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_import_batches" ADD CONSTRAINT "integration_import_batches_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_import_batches" ADD CONSTRAINT "integration_import_batches_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "integration_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_import_errors" ADD CONSTRAINT "integration_import_errors_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "integration_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_external_references" ADD CONSTRAINT "integration_external_references_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_external_references" ADD CONSTRAINT "integration_external_references_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_writeback_logs" ADD CONSTRAINT "integration_writeback_logs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_writeback_logs" ADD CONSTRAINT "integration_writeback_logs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_writeback_logs" ADD CONSTRAINT "integration_writeback_logs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "integration_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
