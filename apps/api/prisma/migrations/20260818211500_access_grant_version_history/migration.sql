CREATE TABLE "access_grant_versions" (
    "id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot_json" JSONB NOT NULL,
    "change_reason" TEXT,
    "changed_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "access_grant_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "access_grant_versions_grant_id_version_key"
ON "access_grant_versions"("grant_id", "version");
CREATE INDEX "access_grant_versions_grant_id_created_at_idx"
ON "access_grant_versions"("grant_id", "created_at");

ALTER TABLE "access_grant_versions"
ADD CONSTRAINT "access_grant_versions_grant_id_fkey"
FOREIGN KEY ("grant_id") REFERENCES "access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "access_grant_versions" ("id", "grant_id", "version", "snapshot_json", "change_reason", "changed_by")
SELECT
  gen_random_uuid()::text,
  grant_row."id",
  grant_row."version",
  jsonb_build_object(
    'code', grant_row."code",
    'assetId', grant_row."assetId",
    'principalType', grant_row."principal_type",
    'principalId', grant_row."principal_id",
    'permissionCodes', COALESCE(
      (SELECT jsonb_agg(permission_row."permission_code" ORDER BY permission_row."permission_code")
       FROM "access_grant_permissions" permission_row WHERE permission_row."grant_id" = grant_row."id"),
      jsonb_build_array(grant_row."permission_code")
    ),
    'profileId', grant_row."profileId",
    'status', grant_row."status",
    'startsAt', grant_row."starts_at",
    'expiresAt', grant_row."expires_at",
    'justification', grant_row."justification",
    'ownerDecision', grant_row."owner_decision",
    'enforcementStatus', grant_row."enforcement_status"
  ),
  'Backfilled from the current governed grant state',
  COALESCE(grant_row."updatedBy", grant_row."createdBy")
FROM "access_grants" grant_row
ON CONFLICT ("grant_id", "version") DO NOTHING;
