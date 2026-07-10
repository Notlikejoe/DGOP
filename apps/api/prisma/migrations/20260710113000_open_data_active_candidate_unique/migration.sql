-- Enforce the Open Data registry invariant at database level:
-- one active, non-deleted candidate per governed data asset.
CREATE UNIQUE INDEX IF NOT EXISTS "open_data_candidates_active_asset_key"
  ON "open_data_candidates"("assetId")
  WHERE "deletedAt" IS NULL
    AND "status" NOT IN ('rejected', 'retired');
