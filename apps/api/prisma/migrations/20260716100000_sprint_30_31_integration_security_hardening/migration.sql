ALTER TYPE "IntegrationConnectorType" ADD VALUE IF NOT EXISTS 'open_data';
ALTER TYPE "IntegrationConnectorType" ADD VALUE IF NOT EXISTS 'foi';
ALTER TYPE "IntegrationConnectorType" ADD VALUE IF NOT EXISTS 'lms';
ALTER TYPE "IntegrationConnectorType" ADD VALUE IF NOT EXISTS 'siem';
ALTER TYPE "IntegrationConnectorType" ADD VALUE IF NOT EXISTS 'iam_sso';
ALTER TYPE "IntegrationConnectorType" ADD VALUE IF NOT EXISTS 'masking';
ALTER TYPE "IntegrationConnectorType" ADD VALUE IF NOT EXISTS 'abac';

ALTER TYPE "IntegrationAdapterType" ADD VALUE IF NOT EXISTS 'webhook_json';
ALTER TYPE "IntegrationAdapterType" ADD VALUE IF NOT EXISTS 'mock_data_quality';
ALTER TYPE "IntegrationAdapterType" ADD VALUE IF NOT EXISTS 'mock_dlp';
ALTER TYPE "IntegrationAdapterType" ADD VALUE IF NOT EXISTS 'mock_open_data';
ALTER TYPE "IntegrationAdapterType" ADD VALUE IF NOT EXISTS 'mock_foi';
ALTER TYPE "IntegrationAdapterType" ADD VALUE IF NOT EXISTS 'mock_lms';
ALTER TYPE "IntegrationAdapterType" ADD VALUE IF NOT EXISTS 'mock_siem';
ALTER TYPE "IntegrationAdapterType" ADD VALUE IF NOT EXISTS 'mock_iam_sso';

CREATE TYPE "IntegrationEventStatus" AS ENUM (
  'queued',
  'processing',
  'succeeded',
  'failed',
  'retry_scheduled',
  'dead_letter'
);

CREATE TYPE "IntegrationReconciliationStatus" AS ENUM (
  'healthy',
  'review',
  'failed'
);

ALTER TABLE "audit_logs"
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "entryHash" TEXT,
  ADD COLUMN "chainVersion" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "audit_logs_entryHash_idx" ON "audit_logs"("entryHash");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

CREATE TABLE "integration_events" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "connectorId" TEXT,
  "adapterType" "IntegrationAdapterType" NOT NULL DEFAULT 'catalog_csv',
  "eventType" TEXT NOT NULL,
  "sourceName" TEXT,
  "externalEventId" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "status" "IntegrationEventStatus" NOT NULL DEFAULT 'queued',
  "severity" "IntegrationImportErrorSeverity" NOT NULL DEFAULT 'warning',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextRetryAt" TIMESTAMP(3),
  "lastError" TEXT,
  "payloadJson" JSONB NOT NULL,
  "normalizedJson" JSONB,
  "resultJson" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "deadLetteredAt" TIMESTAMP(3),
  "actor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_reconciliation_reports" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "connectorId" TEXT,
  "batchId" TEXT,
  "eventId" TEXT,
  "status" "IntegrationReconciliationStatus" NOT NULL DEFAULT 'healthy',
  "totalRecords" INTEGER NOT NULL DEFAULT 0,
  "matchedRecords" INTEGER NOT NULL DEFAULT 0,
  "createdRecords" INTEGER NOT NULL DEFAULT 0,
  "updatedRecords" INTEGER NOT NULL DEFAULT 0,
  "failedRecords" INTEGER NOT NULL DEFAULT 0,
  "orphanedRecords" INTEGER NOT NULL DEFAULT 0,
  "missingRecords" INTEGER NOT NULL DEFAULT 0,
  "summaryJson" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_reconciliation_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_events_code_key" ON "integration_events"("code");
CREATE UNIQUE INDEX "integration_events_dedupeKey_key" ON "integration_events"("dedupeKey");
CREATE INDEX "integration_events_connectorId_idx" ON "integration_events"("connectorId");
CREATE INDEX "integration_events_status_idx" ON "integration_events"("status");
CREATE INDEX "integration_events_nextRetryAt_idx" ON "integration_events"("nextRetryAt");
CREATE INDEX "integration_events_eventType_idx" ON "integration_events"("eventType");
CREATE INDEX "integration_events_receivedAt_idx" ON "integration_events"("receivedAt");

CREATE UNIQUE INDEX "integration_reconciliation_reports_code_key" ON "integration_reconciliation_reports"("code");
CREATE INDEX "integration_reconciliation_reports_connectorId_idx" ON "integration_reconciliation_reports"("connectorId");
CREATE INDEX "integration_reconciliation_reports_batchId_idx" ON "integration_reconciliation_reports"("batchId");
CREATE INDEX "integration_reconciliation_reports_eventId_idx" ON "integration_reconciliation_reports"("eventId");
CREATE INDEX "integration_reconciliation_reports_status_idx" ON "integration_reconciliation_reports"("status");
CREATE INDEX "integration_reconciliation_reports_createdAt_idx" ON "integration_reconciliation_reports"("createdAt");

ALTER TABLE "integration_events"
  ADD CONSTRAINT "integration_events_connectorId_fkey"
  FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "integration_reconciliation_reports"
  ADD CONSTRAINT "integration_reconciliation_reports_connectorId_fkey"
  FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "integration_reconciliation_reports"
  ADD CONSTRAINT "integration_reconciliation_reports_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "integration_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "integration_reconciliation_reports"
  ADD CONSTRAINT "integration_reconciliation_reports_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "integration_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
