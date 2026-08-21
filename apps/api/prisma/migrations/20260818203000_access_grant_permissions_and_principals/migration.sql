-- Additive normalization for Volume 2 access grants. Legacy permission_code remains
-- populated for API compatibility while the join table becomes the canonical set.
CREATE TABLE "access_grant_permissions" (
    "id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "permission_code" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "access_grant_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "access_grant_permissions_grant_id_permission_code_key"
ON "access_grant_permissions"("grant_id", "permission_code");
CREATE INDEX "access_grant_permissions_permission_code_idx"
ON "access_grant_permissions"("permission_code");

ALTER TABLE "access_grant_permissions"
ADD CONSTRAINT "access_grant_permissions_grant_id_fkey"
FOREIGN KEY ("grant_id") REFERENCES "access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "access_grant_permissions"
ADD CONSTRAINT "access_grant_permissions_permission_code_fkey"
FOREIGN KEY ("permission_code") REFERENCES "access_permission_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "access_grant_permissions" ("id", "grant_id", "permission_code", "source")
SELECT gen_random_uuid()::text, grant_row."id", grant_row."permission_code",
       CASE WHEN grant_row."profileId" IS NULL THEN 'custom' ELSE 'profile' END
FROM "access_grants" grant_row
JOIN "access_permission_catalog" catalog ON catalog."code" = grant_row."permission_code"
ON CONFLICT ("grant_id", "permission_code") DO NOTHING;

CREATE TABLE "access_principal_directory" (
    "id" TEXT NOT NULL,
    "principal_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "source" TEXT NOT NULL DEFAULT 'local_registry',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "access_principal_directory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "access_principal_directory_principal_type_external_id_key"
ON "access_principal_directory"("principal_type", "external_id");
CREATE INDEX "access_principal_directory_principal_type_is_active_idx"
ON "access_principal_directory"("principal_type", "is_active");

INSERT INTO "access_principal_directory"
    ("id", "principal_type", "external_id", "name_en", "name_ar", "source", "last_synced_at")
VALUES
    (gen_random_uuid()::text, 'group', 'GRP-DATA-CONSUMERS', 'Data Consumers', 'مستهلكو البيانات', 'seed_directory', CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'group', 'GRP-ANALYTICS', 'Analytics Community', 'مجتمع التحليلات', 'seed_directory', CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'group', 'GRP-PRIVACY-REVIEWERS', 'Privacy Reviewers', 'مراجعو الخصوصية', 'seed_directory', CURRENT_TIMESTAMP)
ON CONFLICT ("principal_type", "external_id") DO NOTHING;

-- Data Owners require create permission for the governed grant flow.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT role_row."id", permission_row."id"
FROM "roles" role_row
JOIN "permissions" permission_row
  ON permission_row."resource" = 'access_grants' AND permission_row."action" = 'create'
WHERE role_row."code" = 'data_owner'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
