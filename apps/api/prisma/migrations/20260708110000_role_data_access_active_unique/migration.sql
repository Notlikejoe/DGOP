DROP INDEX IF EXISTS "role_data_access_maps_roleId_scopeKey_isActive_key";

CREATE UNIQUE INDEX IF NOT EXISTS "role_data_access_maps_active_scope_key"
  ON "role_data_access_maps"("roleId", "scopeKey")
  WHERE "isActive" = true;
