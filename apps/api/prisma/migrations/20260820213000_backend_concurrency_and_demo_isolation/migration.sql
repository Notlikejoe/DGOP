-- Keep human-readable business identifiers safe across concurrent API instances.
CREATE TABLE "business_sequences" (
  "key" TEXT NOT NULL,
  "value" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_sequences_pkey" PRIMARY KEY ("key")
);

INSERT INTO "business_sequences" ("key", "value")
SELECT
  'access_grant',
  COALESCE(MAX(substring("code" FROM 5)::BIGINT), 0)
FROM "access_grants"
WHERE "code" ~ '^AGR-[0-9]+$'
ON CONFLICT ("key") DO UPDATE
SET "value" = GREATEST("business_sequences"."value", EXCLUDED."value"),
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "business_sequences" ("key", "value")
SELECT
  'workflow_case',
  COALESCE(MAX(substring("code" FROM 5)::BIGINT), 0)
FROM "workflow_cases"
WHERE "code" ~ '^WFC-[0-9]+$'
ON CONFLICT ("key") DO UPDATE
SET "value" = GREATEST("business_sequences"."value", EXCLUDED."value"),
    "updatedAt" = CURRENT_TIMESTAMP;

-- An earlier feature migration populated active pilot authorizations. Retain
-- their history, but make them inert outside an explicit local seed process.
UPDATE "access_grants"
SET
  "status" = 'revoked',
  "enforcement_status" = 'revoked',
  "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP),
  "revokedBy" = 'system:migration',
  "revocationReason" = 'Pilot authorization deactivated during production-data isolation.',
  "updatedBy" = 'system:migration',
  "updatedAt" = CURRENT_TIMESTAMP,
  "version" = "version" + 1
WHERE "code" LIKE 'AGR-SAMPLE-%'
  AND "createdBy" = 'system:volume2'
  AND "justification" = 'Pilot sample authorization for the Volume 2 access matrix.'
  AND "status" <> 'revoked';

UPDATE "data_assets"
SET
  "isActive" = false,
  "deletedAt" = COALESCE("deletedAt", CURRENT_TIMESTAMP),
  "lifecycleStatus" = 'retired',
  "v6_lifecycle_state" = 'retired',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (
  'SAMPLE-DS-001',
  'SAMPLE-FL-001',
  'SAMPLE-DR-001',
  'SAMPLE-API-001',
  'SAMPLE-BI-001',
  'SAMPLE-AI-001'
)
  AND "description" = 'Volume 2 access-matrix sample asset.';
