-- Sprint 50/51: durable advanced-workflow execution and governed access operations.
-- Additive only. Existing cases, grants, and access reviews remain valid.

CREATE TABLE "workflow_execution_attempts" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "templateStageId" TEXT NOT NULL,
  "executionKind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "outcome" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "inputJson" JSONB,
  "resultJson" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_execution_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "workflow_execution_attempts_idempotencyKey_key" ON "workflow_execution_attempts"("idempotencyKey");
CREATE UNIQUE INDEX "workflow_execution_attempts_taskId_key" ON "workflow_execution_attempts"("taskId");
CREATE INDEX "workflow_execution_attempts_status_nextAttemptAt_idx" ON "workflow_execution_attempts"("status", "nextAttemptAt");
CREATE INDEX "workflow_execution_attempts_caseId_idx" ON "workflow_execution_attempts"("caseId");
CREATE INDEX "workflow_execution_attempts_templateStageId_idx" ON "workflow_execution_attempts"("templateStageId");
ALTER TABLE "workflow_execution_attempts" ADD CONSTRAINT "workflow_execution_attempts_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "workflow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_execution_attempts" ADD CONSTRAINT "workflow_execution_attempts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_execution_attempts" ADD CONSTRAINT "workflow_execution_attempts_templateStageId_fkey" FOREIGN KEY ("templateStageId") REFERENCES "workflow_template_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "access_review_items" ADD COLUMN "grantId" TEXT;
CREATE INDEX "access_review_items_grantId_idx" ON "access_review_items"("grantId");
CREATE UNIQUE INDEX "access_review_items_reviewId_grantId_key" ON "access_review_items"("reviewId", "grantId");
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "access_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "access_enforcement_attempts" (
  "id" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "connectorCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "requestJson" JSONB,
  "responseJson" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "access_enforcement_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "access_enforcement_attempts_idempotencyKey_key" ON "access_enforcement_attempts"("idempotencyKey");
CREATE INDEX "access_enforcement_attempts_grantId_idx" ON "access_enforcement_attempts"("grantId");
CREATE INDEX "access_enforcement_attempts_status_nextAttemptAt_idx" ON "access_enforcement_attempts"("status", "nextAttemptAt");
CREATE INDEX "access_enforcement_attempts_operation_idx" ON "access_enforcement_attempts"("operation");
ALTER TABLE "access_enforcement_attempts" ADD CONSTRAINT "access_enforcement_attempts_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
