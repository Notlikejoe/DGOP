-- Sprint 48/49: Workflow Canvas pilot-readiness evidence
-- Additive only: persisted isolated designer test runs do not create production cases/tasks.
CREATE TABLE "workflow_designer_test_runs" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "runNumber" INTEGER NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'test',
  "status" TEXT NOT NULL DEFAULT 'ready',
  "bpmnXml" TEXT NOT NULL,
  "validationJson" JSONB NOT NULL,
  "inputJson" JSONB,
  "simulationJson" JSONB NOT NULL,
  "executedPathJson" JSONB NOT NULL,
  "resetAt" TIMESTAMP(3),
  "resetBy" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_designer_test_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_designer_test_runs_templateId_runNumber_key"
  ON "workflow_designer_test_runs"("templateId", "runNumber");

CREATE INDEX "workflow_designer_test_runs_templateId_idx"
  ON "workflow_designer_test_runs"("templateId");

CREATE INDEX "workflow_designer_test_runs_status_idx"
  ON "workflow_designer_test_runs"("status");

CREATE INDEX "workflow_designer_test_runs_createdBy_idx"
  ON "workflow_designer_test_runs"("createdBy");

CREATE INDEX "workflow_designer_test_runs_createdAt_idx"
  ON "workflow_designer_test_runs"("createdAt");

ALTER TABLE "workflow_designer_test_runs"
  ADD CONSTRAINT "workflow_designer_test_runs_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
