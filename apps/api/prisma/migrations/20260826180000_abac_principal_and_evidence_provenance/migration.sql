-- Preserve the exact principal evaluated by ABAC, including identity groups.
ALTER TABLE "abac_decision_logs"
  ADD COLUMN "principalType" TEXT NOT NULL DEFAULT 'role',
  ADD COLUMN "principalId" TEXT;

UPDATE "abac_decision_logs" AS decision
SET "principalId" = COALESCE(role."code", 'legacy-unknown')
FROM "roles" AS role
WHERE decision."roleId" = role."id";

UPDATE "abac_decision_logs"
SET "principalId" = 'legacy-unknown'
WHERE "principalId" IS NULL;

ALTER TABLE "abac_decision_logs"
  ALTER COLUMN "principalId" SET NOT NULL;

CREATE INDEX "abac_decision_logs_principalType_principalId_idx"
  ON "abac_decision_logs"("principalType", "principalId");

-- Distinguish operational proof from seeded UAT evidence in every readiness rollup.
ALTER TABLE "ndi_evidence"
  ADD COLUMN "provenance" TEXT NOT NULL DEFAULT 'operational';

UPDATE "ndi_evidence"
SET "provenance" = 'seeded_uat'
WHERE "fileName" LIKE 'seed-%';

CREATE INDEX "ndi_evidence_provenance_status_idx"
  ON "ndi_evidence"("provenance", "status");
