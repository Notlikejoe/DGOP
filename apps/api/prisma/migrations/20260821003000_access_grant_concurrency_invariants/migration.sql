-- Protect the access matrix invariant across concurrent API instances:
-- one nonterminal grant per governed asset and principal.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "access_grants"
    WHERE "status" NOT IN ('revoked', 'rejected', 'expired')
    GROUP BY "assetId", "principal_type", "principal_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce active access-grant uniqueness: duplicate nonterminal asset/principal assignments exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "access_grants_active_principal_key"
  ON "access_grants" ("assetId", "principal_type", "principal_id")
  WHERE "status" NOT IN ('revoked', 'rejected', 'expired');
