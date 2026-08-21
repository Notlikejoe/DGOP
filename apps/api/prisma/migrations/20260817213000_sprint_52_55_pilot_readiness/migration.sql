-- Sprint 52-55: durable production-pilot approvals and deployment-rehearsal evidence.
-- Additive migration: no existing tables, columns, enums, or records are removed or rewritten.

CREATE TYPE "PilotSignOffDecision" AS ENUM ('approved', 'approved_with_exception', 'declined');
CREATE TYPE "PilotReleaseRehearsalStatus" AS ENUM ('planned', 'passed', 'failed');

CREATE TABLE "pilot_sign_offs" (
  "id" TEXT NOT NULL,
  "releaseCode" TEXT NOT NULL DEFAULT 'v6-production-pilot',
  "gateCode" TEXT NOT NULL,
  "decision" "PilotSignOffDecision" NOT NULL,
  "exceptionSummary" TEXT,
  "evidenceLinksJson" JSONB,
  "recordedBy" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pilot_sign_offs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_sign_offs_releaseCode_gateCode_recordedAt_idx"
  ON "pilot_sign_offs"("releaseCode", "gateCode", "recordedAt");
CREATE INDEX "pilot_sign_offs_decision_idx" ON "pilot_sign_offs"("decision");

CREATE TABLE "pilot_release_rehearsals" (
  "id" TEXT NOT NULL,
  "releaseCode" TEXT NOT NULL DEFAULT 'v6-production-pilot',
  "environment" TEXT NOT NULL,
  "status" "PilotReleaseRehearsalStatus" NOT NULL DEFAULT 'planned',
  "deployedAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "rollbackTested" BOOLEAN NOT NULL DEFAULT false,
  "rollbackCompletedAt" TIMESTAMP(3),
  "summary" TEXT NOT NULL,
  "evidenceLinksJson" JSONB,
  "recordedBy" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pilot_release_rehearsals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_release_rehearsals_releaseCode_recordedAt_idx"
  ON "pilot_release_rehearsals"("releaseCode", "recordedAt");
CREATE INDEX "pilot_release_rehearsals_status_idx" ON "pilot_release_rehearsals"("status");
