-- Sprint 13/14 hardening: stable active access-map uniqueness.
ALTER TABLE "role_data_access_maps" ADD COLUMN "scopeKey" TEXT;

UPDATE "role_data_access_maps"
SET "scopeKey" = 'domain:' || COALESCE("domainId", 'all') || '|class:' || COALESCE("classificationId", 'all');

ALTER TABLE "role_data_access_maps"
  ALTER COLUMN "scopeKey" SET NOT NULL,
  ALTER COLUMN "scopeKey" SET DEFAULT 'domain:all|class:all';

CREATE INDEX "role_data_access_maps_scopeKey_idx" ON "role_data_access_maps"("scopeKey");
CREATE UNIQUE INDEX "role_data_access_maps_roleId_scopeKey_isActive_key"
  ON "role_data_access_maps"("roleId", "scopeKey", "isActive");
