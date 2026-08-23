-- Access grants, their version history, permission evidence, and enforcement
-- attempts are governance records. Prevent parent deletion from erasing them.
ALTER TABLE "access_grant_versions"
  DROP CONSTRAINT "access_grant_versions_grant_id_fkey";

ALTER TABLE "access_grant_versions"
  ADD CONSTRAINT "access_grant_versions_grant_id_fkey"
  FOREIGN KEY ("grant_id") REFERENCES "access_grants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "access_grant_permissions"
  DROP CONSTRAINT "access_grant_permissions_grant_id_fkey";

ALTER TABLE "access_grant_permissions"
  ADD CONSTRAINT "access_grant_permissions_grant_id_fkey"
  FOREIGN KEY ("grant_id") REFERENCES "access_grants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "access_enforcement_attempts"
  DROP CONSTRAINT "access_enforcement_attempts_grantId_fkey";

ALTER TABLE "access_enforcement_attempts"
  ADD CONSTRAINT "access_enforcement_attempts_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "access_grants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "access_grants"
  DROP CONSTRAINT "access_grants_assetId_fkey";

ALTER TABLE "access_grants"
  ADD CONSTRAINT "access_grants_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "data_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
