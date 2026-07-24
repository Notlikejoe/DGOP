ALTER TABLE "workflow_tasks"
  ADD COLUMN "formDataJson" JSONB,
  ADD COLUMN "formSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "formSubmittedBy" TEXT,
  ADD COLUMN "approvalGroupId" TEXT,
  ADD COLUMN "approvalMode" TEXT;

ALTER TABLE "workflow_templates"
  ADD COLUMN "modelSignature" TEXT,
  ADD COLUMN "signatureAlgorithm" TEXT,
  ADD COLUMN "securityJson" JSONB;

ALTER TABLE "workflow_template_versions"
  ADD COLUMN "modelSignature" TEXT,
  ADD COLUMN "signatureAlgorithm" TEXT,
  ADD COLUMN "encryptedSnapshotJson" JSONB,
  ADD COLUMN "securityJson" JSONB;

CREATE TABLE "workflow_runtime_tokens" (
  "id" TEXT NOT NULL,
  "instanceKey" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "templateStageId" TEXT,
  "taskId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'active',
  "tokenType" TEXT NOT NULL DEFAULT 'stage',
  "parallelGroup" TEXT,
  "dataJson" JSONB,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_runtime_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_runtime_tokens_instanceKey_key" ON "workflow_runtime_tokens"("instanceKey");
CREATE INDEX "workflow_runtime_tokens_caseId_idx" ON "workflow_runtime_tokens"("caseId");
CREATE INDEX "workflow_runtime_tokens_templateStageId_idx" ON "workflow_runtime_tokens"("templateStageId");
CREATE INDEX "workflow_runtime_tokens_taskId_idx" ON "workflow_runtime_tokens"("taskId");
CREATE INDEX "workflow_runtime_tokens_state_idx" ON "workflow_runtime_tokens"("state");
CREATE INDEX "workflow_runtime_tokens_parallelGroup_idx" ON "workflow_runtime_tokens"("parallelGroup");
CREATE INDEX "workflow_tasks_approvalGroupId_idx" ON "workflow_tasks"("approvalGroupId");

ALTER TABLE "workflow_runtime_tokens"
  ADD CONSTRAINT "workflow_runtime_tokens_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "workflow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_runtime_tokens"
  ADD CONSTRAINT "workflow_runtime_tokens_templateStageId_fkey" FOREIGN KEY ("templateStageId") REFERENCES "workflow_template_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workflow_runtime_tokens"
  ADD CONSTRAINT "workflow_runtime_tokens_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
