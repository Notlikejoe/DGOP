-- Sprint 44-45: v6.0 workflow and asset-type foundation.

ALTER TABLE "data_assets"
  ADD COLUMN IF NOT EXISTS "asset_type" TEXT NOT NULL DEFAULT 'dataset',
  ADD COLUMN IF NOT EXISTS "asset_subtype" TEXT,
  ADD COLUMN IF NOT EXISTS "v6_lifecycle_state" TEXT NOT NULL DEFAULT 'registered',
  ADD COLUMN IF NOT EXISTS "lifecycle_phase" TEXT NOT NULL DEFAULT 'discover',
  ADD COLUMN IF NOT EXISTS "type_metadata_json" JSONB;

CREATE TABLE IF NOT EXISTS "data_asset_types" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "description" TEXT,
  "lifecycleStatesJson" JSONB,
  "evidenceExpectationsJson" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_asset_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "data_asset_subtypes" (
  "id" TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_asset_subtypes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "data_asset_types_code_key" ON "data_asset_types"("code");
CREATE INDEX IF NOT EXISTS "data_asset_types_isActive_idx" ON "data_asset_types"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "data_asset_subtypes_typeId_code_key" ON "data_asset_subtypes"("typeId", "code");
CREATE INDEX IF NOT EXISTS "data_asset_subtypes_typeId_idx" ON "data_asset_subtypes"("typeId");
CREATE INDEX IF NOT EXISTS "data_asset_subtypes_code_idx" ON "data_asset_subtypes"("code");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'data_asset_subtypes_typeId_fkey'
  ) THEN
    ALTER TABLE "data_asset_subtypes"
      ADD CONSTRAINT "data_asset_subtypes_typeId_fkey"
      FOREIGN KEY ("typeId") REFERENCES "data_asset_types"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "data_assets_asset_type_idx" ON "data_assets"("asset_type");
CREATE INDEX IF NOT EXISTS "data_assets_asset_subtype_idx" ON "data_assets"("asset_subtype");
CREATE INDEX IF NOT EXISTS "data_assets_v6_lifecycle_state_idx" ON "data_assets"("v6_lifecycle_state");
CREATE INDEX IF NOT EXISTS "data_assets_lifecycle_phase_idx" ON "data_assets"("lifecycle_phase");

INSERT INTO "data_asset_types" ("id", "code", "nameEn", "nameAr", "description", "lifecycleStatesJson", "evidenceExpectationsJson")
VALUES
  ('dat-dataset', 'dataset', 'Dataset', 'Dataset', 'Structured governed dataset.', '["registered","designed","built","validated","published","operational","deprecated","retired"]'::jsonb, '["classification","owner","quality_rules","retention"]'::jsonb),
  ('dat-file', 'file', 'File', 'File', 'Governed file object or managed file collection.', '["registered","designed","built","validated","published","operational","deprecated","retired"]'::jsonb, '["classification","owner","storage_location","retention"]'::jsonb),
  ('dat-document-record', 'document_record', 'Document or Record', 'Document or Record', 'Governed document, official record, or document set.', '["registered","designed","built","validated","published","operational","deprecated","retired"]'::jsonb, '["record_owner","retention","classification","disposition"]'::jsonb),
  ('dat-api-feed', 'api_data_feed', 'API or Data Feed', 'API or Data Feed', 'Governed API endpoint, stream, or recurring data feed.', '["registered","designed","built","validated","published","operational","deprecated","retired"]'::jsonb, '["contract","owner","consumer_registry","sla"]'::jsonb),
  ('dat-bi-report', 'bi_report_dashboard', 'BI Report or Dashboard', 'BI Report or Dashboard', 'Governed BI report, dashboard, or analytical product.', '["registered","designed","built","validated","published","operational","deprecated","retired"]'::jsonb, '["metric_definitions","owner","certification","refresh_sla"]'::jsonb),
  ('dat-ai-product', 'ai_data_product', 'AI Data Product', 'AI Data Product', 'Governed model, feature set, AI dataset, or AI-assisted product.', '["registered","designed","built","validated","published","operational","deprecated","retired"]'::jsonb, '["model_card","risk_assessment","training_data_lineage","human_oversight"]'::jsonb)
ON CONFLICT ("code") DO UPDATE SET
  "nameEn" = EXCLUDED."nameEn",
  "nameAr" = EXCLUDED."nameAr",
  "description" = EXCLUDED."description",
  "lifecycleStatesJson" = EXCLUDED."lifecycleStatesJson",
  "evidenceExpectationsJson" = EXCLUDED."evidenceExpectationsJson",
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "data_asset_subtypes" ("id", "typeId", "code", "nameEn", "nameAr", "description")
VALUES
  ('dst-dataset-master', 'dat-dataset', 'master_dataset', 'Master Dataset', 'Master Dataset', 'Authoritative master dataset.'),
  ('dst-dataset-transactional', 'dat-dataset', 'transactional_dataset', 'Transactional Dataset', 'Transactional Dataset', 'Operational transactional dataset.'),
  ('dst-dataset-reference', 'dat-dataset', 'reference_dataset', 'Reference Dataset', 'Reference Dataset', 'Reference or lookup dataset.'),
  ('dst-dataset-analytical', 'dat-dataset', 'analytical_dataset', 'Analytical Dataset', 'Analytical Dataset', 'Curated analytical dataset.'),
  ('dst-file-flat', 'dat-file', 'flat_file', 'Flat File', 'Flat File', 'CSV, TSV, or delimited file.'),
  ('dst-file-extract', 'dat-file', 'extract', 'Extract', 'Extract', 'Scheduled or ad hoc data extract.'),
  ('dst-file-spreadsheet', 'dat-file', 'spreadsheet', 'Spreadsheet', 'Spreadsheet', 'Spreadsheet file under governance.'),
  ('dst-file-media', 'dat-file', 'media_file', 'Media File', 'Media File', 'Image, video, audio, or other media file.'),
  ('dst-record-policy', 'dat-document-record', 'policy_record', 'Policy Record', 'Policy Record', 'Policy, procedure, or controlled record.'),
  ('dst-record-case', 'dat-document-record', 'case_record', 'Case Record', 'Case Record', 'Case file or official case record.'),
  ('dst-record-contract', 'dat-document-record', 'contract_record', 'Contract Record', 'Contract Record', 'Contract or agreement record.'),
  ('dst-record-retention', 'dat-document-record', 'retention_record', 'Retention Record', 'Retention Record', 'Retention or disposition record.'),
  ('dst-api-rest', 'dat-api-feed', 'rest_api', 'REST API', 'REST API', 'REST or HTTP API endpoint.'),
  ('dst-api-stream', 'dat-api-feed', 'event_stream', 'Event Stream', 'Event Stream', 'Streaming or event-based feed.'),
  ('dst-api-batch', 'dat-api-feed', 'batch_feed', 'Batch Feed', 'Batch Feed', 'Scheduled batch data feed.'),
  ('dst-api-integration', 'dat-api-feed', 'integration_feed', 'Integration Feed', 'Integration Feed', 'System integration feed.'),
  ('dst-bi-dashboard', 'dat-bi-report', 'dashboard', 'Dashboard', 'Dashboard', 'Interactive dashboard.'),
  ('dst-bi-certified-report', 'dat-bi-report', 'certified_report', 'Certified Report', 'Certified Report', 'Certified operational or regulatory report.'),
  ('dst-bi-self-service-report', 'dat-bi-report', 'self_service_report', 'Self-Service Report', 'Self-Service Report', 'Self-service analytics report.'),
  ('dst-bi-regulatory-report', 'dat-bi-report', 'regulatory_report', 'Regulatory Report', 'Regulatory Report', 'Regulatory or statutory report.'),
  ('dst-ai-model', 'dat-ai-product', 'model', 'AI Model', 'AI Model', 'Predictive or generative AI model.'),
  ('dst-ai-feature-set', 'dat-ai-product', 'feature_set', 'Feature Set', 'Feature Set', 'Managed features for AI or analytics.'),
  ('dst-ai-training-dataset', 'dat-ai-product', 'training_dataset', 'Training Dataset', 'Training Dataset', 'Dataset used to train or tune AI models.'),
  ('dst-ai-prompt-library', 'dat-ai-product', 'prompt_library', 'Prompt Library', 'Prompt Library', 'Managed prompt or instruction library.')
ON CONFLICT ("typeId", "code") DO UPDATE SET
  "nameEn" = EXCLUDED."nameEn",
  "nameAr" = EXCLUDED."nameAr",
  "description" = EXCLUDED."description",
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;
