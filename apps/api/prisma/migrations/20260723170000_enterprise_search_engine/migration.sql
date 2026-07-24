ALTER TABLE "search_index_records"
  ADD COLUMN "normalizedKeywords" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'database',
  ADD COLUMN "externalSystem" TEXT,
  ADD COLUMN "indexedPayloadJson" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastCdcEventId" TEXT;

CREATE INDEX "search_index_records_source_idx" ON "search_index_records"("source");
CREATE INDEX "search_index_records_isDeleted_idx" ON "search_index_records"("isDeleted");
CREATE INDEX "search_index_records_lastIndexedAt_idx" ON "search_index_records"("lastIndexedAt");

ALTER TABLE "saved_searches"
  ADD COLUMN "queryHash" TEXT,
  ADD COLUMN "queryCiphertextJson" JSONB,
  ADD COLUMN "queryProtected" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "search_analytics_events"
  ADD COLUMN "queryHash" TEXT,
  ADD COLUMN "queryCiphertextJson" JSONB,
  ADD COLUMN "queryProtected" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "search_index_change_events" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "payloadJson" JSONB,
  "visibilityJson" JSONB,
  "resultMessage" TEXT,
  "errorMessage" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "search_index_change_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "search_index_change_events_entityType_entityId_idx" ON "search_index_change_events"("entityType", "entityId");
CREATE INDEX "search_index_change_events_status_queuedAt_idx" ON "search_index_change_events"("status", "queuedAt");
