-- Prevent duplicate active role-to-data access mappings for the same role/scope.
-- Existing duplicates are deactivated deterministically before the unique index is added.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "roleId", "scopeKey"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM "role_data_access_maps"
  WHERE "isActive" = true
)
UPDATE "role_data_access_maps"
SET "isActive" = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "role_data_access_maps_active_role_scope_key"
ON "role_data_access_maps" ("roleId", "scopeKey")
WHERE "isActive" = true;
