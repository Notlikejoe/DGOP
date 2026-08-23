-- Harden workflow execution, evidence retention, and the global audit chain.
-- This migration preserves existing data and intentionally blocks deletion of
-- governance evidence through parent cascades.

ALTER TABLE "workflow_task_attachments"
  ADD COLUMN "storedName" TEXT;

CREATE UNIQUE INDEX "audit_logs_previousHash_key"
  ON "audit_logs"("previousHash");

ALTER TABLE "workflow_events"
  DROP CONSTRAINT "workflow_events_caseId_fkey";
ALTER TABLE "workflow_events"
  ADD CONSTRAINT "workflow_events_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "workflow_cases"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_task_attachments"
  DROP CONSTRAINT "workflow_task_attachments_caseId_fkey";
ALTER TABLE "workflow_task_attachments"
  ADD CONSTRAINT "workflow_task_attachments_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "workflow_cases"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_template_versions"
  DROP CONSTRAINT "workflow_template_versions_templateId_fkey";
ALTER TABLE "workflow_template_versions"
  ADD CONSTRAINT "workflow_template_versions_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ndi_evidence"
  DROP CONSTRAINT "ndi_evidence_specId_fkey";
ALTER TABLE "ndi_evidence"
  ADD CONSTRAINT "ndi_evidence_specId_fkey"
  FOREIGN KEY ("specId") REFERENCES "ndi_specifications"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_runtime_tokens"
  ADD CONSTRAINT "workflow_runtime_tokens_parentTokenId_fkey"
  FOREIGN KEY ("parentTokenId") REFERENCES "workflow_runtime_tokens"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "workflow_runtime_tokens_rootTokenId_fkey"
  FOREIGN KEY ("rootTokenId") REFERENCES "workflow_runtime_tokens"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workflow_runtime_tokens"
  ADD CONSTRAINT "workflow_runtime_tokens_state_check"
  CHECK ("state" IN ('active', 'waiting', 'queued', 'suspended', 'completed', 'failed', 'cancelled')) NOT VALID,
  ADD CONSTRAINT "workflow_runtime_tokens_token_type_check"
  CHECK ("tokenType" IN ('stage', 'approval', 'automation', 'sub_workflow', 'timer', 'notification', 'error')) NOT VALID;

ALTER TABLE "workflow_runtime_tokens"
  VALIDATE CONSTRAINT "workflow_runtime_tokens_state_check";
ALTER TABLE "workflow_runtime_tokens"
  VALIDATE CONSTRAINT "workflow_runtime_tokens_token_type_check";

ALTER TABLE "access_grants"
  ADD CONSTRAINT "access_grants_status_check"
  CHECK ("status" IN ('requested', 'scheduled', 'active', 'expired', 'rejected', 'revoked', 'pending_revocation', 'revocation_failed', 'suspended')) NOT VALID,
  ADD CONSTRAINT "access_grants_owner_decision_check"
  CHECK ("owner_decision" IN ('pending', 'approved', 'rejected')) NOT VALID,
  ADD CONSTRAINT "access_grants_enforcement_status_check"
  CHECK ("enforcement_status" IN ('pending', 'enforced', 'failed', 'not_enforced', 'revoked')) NOT VALID;

ALTER TABLE "access_grants" VALIDATE CONSTRAINT "access_grants_status_check";
ALTER TABLE "access_grants" VALIDATE CONSTRAINT "access_grants_owner_decision_check";
ALTER TABLE "access_grants" VALIDATE CONSTRAINT "access_grants_enforcement_status_check";
