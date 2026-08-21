-- Sprint 46-47: workflow variables/forms/connectors, token lineage, and access authorization spine.
-- Additive migration only: no drops, no destructive backfills.

ALTER TABLE "workflow_template_transitions"
  ADD COLUMN IF NOT EXISTS "connector_type" TEXT NOT NULL DEFAULT 'sequence',
  ADD COLUMN IF NOT EXISTS "is_default_path" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "timeout_after_seconds" INTEGER;

CREATE INDEX IF NOT EXISTS "workflow_template_transitions_connector_type_idx"
  ON "workflow_template_transitions"("connector_type");
CREATE INDEX IF NOT EXISTS "workflow_template_transitions_default_path_idx"
  ON "workflow_template_transitions"("fromStageId", "is_default_path");

ALTER TABLE "workflow_runtime_tokens"
  ADD COLUMN IF NOT EXISTS "parentTokenId" TEXT,
  ADD COLUMN IF NOT EXISTS "rootTokenId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchKey" TEXT,
  ADD COLUMN IF NOT EXISTS "branchIndex" INTEGER,
  ADD COLUMN IF NOT EXISTS "joinKey" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceTransitionId" TEXT;

CREATE INDEX IF NOT EXISTS "workflow_runtime_tokens_parentTokenId_idx"
  ON "workflow_runtime_tokens"("parentTokenId");
CREATE INDEX IF NOT EXISTS "workflow_runtime_tokens_rootTokenId_idx"
  ON "workflow_runtime_tokens"("rootTokenId");
CREATE INDEX IF NOT EXISTS "workflow_runtime_tokens_branchKey_idx"
  ON "workflow_runtime_tokens"("branchKey");
CREATE INDEX IF NOT EXISTS "workflow_runtime_tokens_joinKey_idx"
  ON "workflow_runtime_tokens"("joinKey");
CREATE INDEX IF NOT EXISTS "workflow_runtime_tokens_sourceTransitionId_idx"
  ON "workflow_runtime_tokens"("sourceTransitionId");

CREATE TABLE IF NOT EXISTS "workflow_variable_definitions" (
  "id" TEXT NOT NULL,
  "registryKey" TEXT NOT NULL,
  "templateId" TEXT,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT,
  "description" TEXT,
  "variableType" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'case',
  "source" TEXT NOT NULL DEFAULT 'system',
  "defaultValueJson" JSONB,
  "allowedValuesJson" JSONB,
  "isRequired" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_variable_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_variable_definitions_registryKey_key"
  ON "workflow_variable_definitions"("registryKey");
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_variable_definitions_templateId_code_key"
  ON "workflow_variable_definitions"("templateId", "code");
CREATE INDEX IF NOT EXISTS "workflow_variable_definitions_templateId_idx"
  ON "workflow_variable_definitions"("templateId");
CREATE INDEX IF NOT EXISTS "workflow_variable_definitions_code_idx"
  ON "workflow_variable_definitions"("code");
CREATE INDEX IF NOT EXISTS "workflow_variable_definitions_variableType_idx"
  ON "workflow_variable_definitions"("variableType");
CREATE INDEX IF NOT EXISTS "workflow_variable_definitions_scope_idx"
  ON "workflow_variable_definitions"("scope");
CREATE INDEX IF NOT EXISTS "workflow_variable_definitions_isActive_idx"
  ON "workflow_variable_definitions"("isActive");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_variable_definitions_templateId_fkey'
  ) THEN
    ALTER TABLE "workflow_variable_definitions"
      ADD CONSTRAINT "workflow_variable_definitions_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "access_permission_catalog" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "asset_type" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT,
  "description" TEXT,
  "risk_level" TEXT NOT NULL DEFAULT 'standard',
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "access_permission_catalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "access_permission_catalog_code_key"
  ON "access_permission_catalog"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "access_permission_catalog_asset_type_action_version_key"
  ON "access_permission_catalog"("asset_type", "action", "version");
CREATE INDEX IF NOT EXISTS "access_permission_catalog_asset_type_idx"
  ON "access_permission_catalog"("asset_type");
CREATE INDEX IF NOT EXISTS "access_permission_catalog_action_idx"
  ON "access_permission_catalog"("action");
CREATE INDEX IF NOT EXISTS "access_permission_catalog_isActive_idx"
  ON "access_permission_catalog"("isActive");

CREATE TABLE IF NOT EXISTS "access_permission_profiles" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "asset_type" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT,
  "description" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "permission_codes_json" JSONB NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "access_permission_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "access_permission_profiles_code_key"
  ON "access_permission_profiles"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "access_permission_profiles_asset_type_code_version_key"
  ON "access_permission_profiles"("asset_type", "code", "version");
CREATE INDEX IF NOT EXISTS "access_permission_profiles_asset_type_idx"
  ON "access_permission_profiles"("asset_type");
CREATE INDEX IF NOT EXISTS "access_permission_profiles_isActive_idx"
  ON "access_permission_profiles"("isActive");

CREATE TABLE IF NOT EXISTS "access_grants" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "principal_type" TEXT NOT NULL DEFAULT 'user',
  "principal_id" TEXT NOT NULL,
  "permission_code" TEXT NOT NULL,
  "profileId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "justification" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "owner_decision" TEXT NOT NULL DEFAULT 'pending',
  "owner_decision_by" TEXT,
  "owner_decision_at" TIMESTAMP(3),
  "enforcement_status" TEXT NOT NULL DEFAULT 'not_enforced',
  "workflowCaseId" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "access_grants_code_key" ON "access_grants"("code");
CREATE INDEX IF NOT EXISTS "access_grants_assetId_idx" ON "access_grants"("assetId");
CREATE INDEX IF NOT EXISTS "access_grants_principal_type_principal_id_idx" ON "access_grants"("principal_type", "principal_id");
CREATE INDEX IF NOT EXISTS "access_grants_permission_code_idx" ON "access_grants"("permission_code");
CREATE INDEX IF NOT EXISTS "access_grants_profileId_idx" ON "access_grants"("profileId");
CREATE INDEX IF NOT EXISTS "access_grants_status_idx" ON "access_grants"("status");
CREATE INDEX IF NOT EXISTS "access_grants_owner_decision_idx" ON "access_grants"("owner_decision");
CREATE INDEX IF NOT EXISTS "access_grants_enforcement_status_idx" ON "access_grants"("enforcement_status");
CREATE INDEX IF NOT EXISTS "access_grants_workflowCaseId_idx" ON "access_grants"("workflowCaseId");
CREATE INDEX IF NOT EXISTS "access_grants_expires_at_idx" ON "access_grants"("expires_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'access_grants_assetId_fkey'
  ) THEN
    ALTER TABLE "access_grants"
      ADD CONSTRAINT "access_grants_assetId_fkey"
      FOREIGN KEY ("assetId") REFERENCES "data_assets"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'access_grants_profileId_fkey'
  ) THEN
    ALTER TABLE "access_grants"
      ADD CONSTRAINT "access_grants_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "access_permission_profiles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'access_grants_workflowCaseId_fkey'
  ) THEN
    ALTER TABLE "access_grants"
      ADD CONSTRAINT "access_grants_workflowCaseId_fkey"
      FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "workflow_variable_definitions" (
  "id", "registryKey", "templateId", "code", "nameEn", "description", "variableType", "scope", "source", "allowedValuesJson", "isRequired"
)
VALUES
  ('wvar-case-id', 'global:case.id', NULL, 'case.id', 'Workflow case id', 'Stable workflow case identifier.', 'text', 'case', 'system', NULL, true),
  ('wvar-case-status', 'global:case.status', NULL, 'case.status', 'Workflow case status', 'Current case lifecycle status.', 'text', 'case', 'system', '["draft","submitted","under_review","awaiting_information","decision_made","approved","rejected","implemented","closed"]'::jsonb, true),
  ('wvar-case-type', 'global:case.type', NULL, 'case.type', 'Workflow case type', 'Route and business case type.', 'text', 'case', 'system', NULL, true),
  ('wvar-asset-id', 'global:asset.id', NULL, 'asset.id', 'Linked asset id', 'Asset linked to the workflow case.', 'text', 'asset', 'system', NULL, false),
  ('wvar-asset-type', 'global:asset.type', NULL, 'asset.type', 'Asset type', 'v6 governed asset type.', 'text', 'asset', 'system', '["dataset","file","document_record","api_data_feed","bi_report_dashboard","ai_data_product"]'::jsonb, false),
  ('wvar-task-decision', 'global:task.decision', NULL, 'task.decision', 'Task decision', 'Decision submitted by the current task actor.', 'text', 'task', 'runtime', '["approved","rejected","return_for_clarification"]'::jsonb, false),
  ('wvar-stage-code', 'global:stage.code', NULL, 'stage.code', 'Stage code', 'Active workflow stage code.', 'text', 'task', 'system', NULL, true),
  ('wvar-stage-kind', 'global:stage.kind', NULL, 'stage.kind', 'Stage kind', 'Active workflow stage kind.', 'text', 'task', 'system', NULL, false),
  ('wvar-actor-user', 'global:actor.user', NULL, 'actor.user', 'Actor user', 'User acting on the task or route.', 'user', 'actor', 'runtime', NULL, false),
  ('wvar-actor-roles', 'global:actor.roles', NULL, 'actor.roles', 'Actor roles', 'Role codes for the current actor.', 'list', 'actor', 'runtime', NULL, false),
  ('wvar-form-required-complete', 'global:task.formRequiredComplete', NULL, 'task.formRequiredComplete', 'Required form complete', 'True when required form fields are present and valid.', 'boolean', 'task', 'runtime', NULL, false),
  ('wvar-sla-due-date', 'global:task.slaDueDate', NULL, 'task.slaDueDate', 'Task SLA due date', 'Due date used by timer and SLA-aware routing.', 'date', 'task', 'system', NULL, false)
ON CONFLICT ("registryKey") DO UPDATE SET
  "nameEn" = EXCLUDED."nameEn",
  "description" = EXCLUDED."description",
  "variableType" = EXCLUDED."variableType",
  "scope" = EXCLUDED."scope",
  "source" = EXCLUDED."source",
  "allowedValuesJson" = EXCLUDED."allowedValuesJson",
  "isRequired" = EXCLUDED."isRequired",
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "access_permission_catalog" ("id", "code", "asset_type", "action", "nameEn", "description", "risk_level", "version", "createdBy")
VALUES
  ('apc-dataset-read', 'dataset.read', 'dataset', 'read', 'Read dataset', 'View governed dataset records and metadata.', 'standard', 1, 'system'),
  ('apc-dataset-export', 'dataset.export', 'dataset', 'export', 'Export dataset', 'Export dataset extracts under approved purpose.', 'elevated', 1, 'system'),
  ('apc-dataset-update-metadata', 'dataset.update_metadata', 'dataset', 'update_metadata', 'Update dataset metadata', 'Maintain business metadata and stewardship fields.', 'standard', 1, 'system'),
  ('apc-file-read', 'file.read', 'file', 'read', 'Read file metadata', 'View governed file metadata.', 'standard', 1, 'system'),
  ('apc-file-download', 'file.download', 'file', 'download', 'Download file', 'Download governed file content.', 'elevated', 1, 'system'),
  ('apc-file-transfer', 'file.transfer', 'file', 'transfer', 'Transfer file', 'Transfer files to an approved destination.', 'high', 1, 'system'),
  ('apc-document-read', 'document_record.read', 'document_record', 'read', 'Read document record', 'View controlled document or record.', 'standard', 1, 'system'),
  ('apc-document-certify', 'document_record.certify', 'document_record', 'certify', 'Certify document record', 'Certify record completeness and disposition evidence.', 'elevated', 1, 'system'),
  ('apc-document-dispose', 'document_record.dispose', 'document_record', 'dispose', 'Dispose record', 'Execute approved retention/disposition action.', 'high', 1, 'system'),
  ('apc-api-consume', 'api_data_feed.consume', 'api_data_feed', 'consume', 'Consume API or feed', 'Use an API endpoint or data feed.', 'standard', 1, 'system'),
  ('apc-api-subscribe', 'api_data_feed.subscribe', 'api_data_feed', 'subscribe', 'Subscribe consumer', 'Register a consuming application or user.', 'elevated', 1, 'system'),
  ('apc-api-manage-consumer', 'api_data_feed.manage_consumer', 'api_data_feed', 'manage_consumer', 'Manage API consumer', 'Manage keys, subscriptions, and consumer lifecycle.', 'high', 1, 'system'),
  ('apc-bi-view', 'bi_report_dashboard.view', 'bi_report_dashboard', 'view', 'View report or dashboard', 'View governed report/dashboard output.', 'standard', 1, 'system'),
  ('apc-bi-export', 'bi_report_dashboard.export', 'bi_report_dashboard', 'export', 'Export report data', 'Export report/dashboard data.', 'elevated', 1, 'system'),
  ('apc-bi-certify', 'bi_report_dashboard.certify', 'bi_report_dashboard', 'certify', 'Certify report', 'Certify metrics, definitions, and audience.', 'elevated', 1, 'system'),
  ('apc-ai-invoke', 'ai_data_product.invoke', 'ai_data_product', 'invoke', 'Invoke AI data product', 'Run or consume an approved AI data product.', 'elevated', 1, 'system'),
  ('apc-ai-training-data', 'ai_data_product.use_training_data', 'ai_data_product', 'use_training_data', 'Use training data', 'Use data for AI model training or tuning.', 'high', 1, 'system'),
  ('apc-ai-model-card', 'ai_data_product.inspect_model_card', 'ai_data_product', 'inspect_model_card', 'Inspect model card', 'View model card and risk documentation.', 'standard', 1, 'system')
ON CONFLICT ("code") DO UPDATE SET
  "asset_type" = EXCLUDED."asset_type",
  "action" = EXCLUDED."action",
  "nameEn" = EXCLUDED."nameEn",
  "description" = EXCLUDED."description",
  "risk_level" = EXCLUDED."risk_level",
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "access_permission_profiles" ("id", "code", "asset_type", "nameEn", "description", "version", "permission_codes_json", "createdBy")
VALUES
  ('app-dataset-viewer-v1', 'dataset.viewer', 'dataset', 'Dataset viewer', 'Read-only dataset access.', 1, '["dataset.read"]'::jsonb, 'system'),
  ('app-dataset-steward-v1', 'dataset.steward', 'dataset', 'Dataset steward', 'Dataset read/export and metadata stewardship.', 1, '["dataset.read","dataset.export","dataset.update_metadata"]'::jsonb, 'system'),
  ('app-file-reader-v1', 'file.reader', 'file', 'File reader', 'Read and download governed files.', 1, '["file.read","file.download"]'::jsonb, 'system'),
  ('app-file-transfer-v1', 'file.transfer_operator', 'file', 'File transfer operator', 'Read, download, and transfer governed files.', 1, '["file.read","file.download","file.transfer"]'::jsonb, 'system'),
  ('app-document-viewer-v1', 'document_record.viewer', 'document_record', 'Document record viewer', 'Read controlled document records.', 1, '["document_record.read"]'::jsonb, 'system'),
  ('app-document-manager-v1', 'document_record.manager', 'document_record', 'Document record manager', 'Read, certify, and dispose document records.', 1, '["document_record.read","document_record.certify","document_record.dispose"]'::jsonb, 'system'),
  ('app-api-consumer-v1', 'api_data_feed.consumer', 'api_data_feed', 'API/feed consumer', 'Consume an API or data feed.', 1, '["api_data_feed.consume"]'::jsonb, 'system'),
  ('app-api-manager-v1', 'api_data_feed.manager', 'api_data_feed', 'API/feed manager', 'Consume, subscribe, and manage API/feed consumers.', 1, '["api_data_feed.consume","api_data_feed.subscribe","api_data_feed.manage_consumer"]'::jsonb, 'system'),
  ('app-bi-viewer-v1', 'bi_report_dashboard.viewer', 'bi_report_dashboard', 'BI viewer', 'View governed BI reports and dashboards.', 1, '["bi_report_dashboard.view"]'::jsonb, 'system'),
  ('app-bi-certifier-v1', 'bi_report_dashboard.certifier', 'bi_report_dashboard', 'BI certifier', 'View, export, and certify BI content.', 1, '["bi_report_dashboard.view","bi_report_dashboard.export","bi_report_dashboard.certify"]'::jsonb, 'system'),
  ('app-ai-user-v1', 'ai_data_product.user', 'ai_data_product', 'AI data product user', 'Invoke and inspect approved AI data products.', 1, '["ai_data_product.invoke","ai_data_product.inspect_model_card"]'::jsonb, 'system'),
  ('app-ai-trainer-v1', 'ai_data_product.trainer', 'ai_data_product', 'AI training data user', 'Invoke AI products and use approved training data.', 1, '["ai_data_product.invoke","ai_data_product.use_training_data","ai_data_product.inspect_model_card"]'::jsonb, 'system')
ON CONFLICT ("code") DO UPDATE SET
  "asset_type" = EXCLUDED."asset_type",
  "nameEn" = EXCLUDED."nameEn",
  "description" = EXCLUDED."description",
  "version" = EXCLUDED."version",
  "permission_codes_json" = EXCLUDED."permission_codes_json",
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "permissions" ("id", "resource", "action", "descriptionEn")
VALUES
  ('perm-access-grants-view', 'access_grants', 'view', 'View access grants, permission catalog, and profiles.'),
  ('perm-access-grants-create', 'access_grants', 'create', 'Request or create governed access grants.'),
  ('perm-access-grants-edit', 'access_grants', 'edit', 'Approve, reject, revoke, or enforce governed access grants.')
ON CONFLICT ("resource", "action") DO UPDATE SET
  "descriptionEn" = EXCLUDED."descriptionEn";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN ('system_admin', 'dmo_admin', 'data_owner', 'security_reviewer', 'auditor')
  AND p."resource" = 'access_grants'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
