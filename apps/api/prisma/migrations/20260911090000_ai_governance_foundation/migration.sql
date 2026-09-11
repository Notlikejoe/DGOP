-- CreateEnum
CREATE TYPE "GovernedReferenceState" AS ENUM ('draft', 'published', 'retired');

-- CreateEnum
CREATE TYPE "AiAssessmentKind" AS ENUM ('classification', 'inherent', 'residual');

-- CreateTable
CREATE TABLE "governed_reference_lists" (
    "code" VARCHAR(80) NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "ownerRoleCode" TEXT NOT NULL,
    "regulatory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governed_reference_lists_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "governed_reference_versions" (
    "id" TEXT NOT NULL,
    "listCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "GovernedReferenceState" NOT NULL DEFAULT 'draft',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "sourceSha256" VARCHAR(64),
    "sourceLocator" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governed_reference_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governed_reference_values" (
    "versionId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "governed_reference_values_pkey" PRIMARY KEY ("versionId","code")
);

-- CreateTable
CREATE TABLE "ai_use_cases" (
    "id" TEXT NOT NULL,
    "useCaseRef" TEXT,
    "workflowCaseId" TEXT,
    "assetId" TEXT,
    "requesterUserId" TEXT NOT NULL,
    "ownerPersonId" TEXT,
    "organizationUnitId" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "isSampleData" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_use_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_intake_revisions" (
    "id" TEXT NOT NULL,
    "useCaseId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_intake_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_risks" (
    "id" TEXT NOT NULL,
    "useCaseId" TEXT NOT NULL,
    "riskRef" TEXT,
    "workflowCaseId" TEXT,
    "ownerPersonId" TEXT,
    "title" VARCHAR(200),
    "cause" TEXT,
    "event" TEXT,
    "effect" TEXT,
    "isSampleData" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assessment_rounds" (
    "id" TEXT NOT NULL,
    "useCaseId" TEXT NOT NULL,
    "riskId" TEXT,
    "kind" "AiAssessmentKind" NOT NULL,
    "round" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "engineVersion" TEXT NOT NULL,
    "ruleReferenceVersionId" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assessment_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_treatment_actions" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "actionRef" TEXT NOT NULL,
    "workflowTaskId" TEXT,
    "assigneePersonId" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "targetDate" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_treatment_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_approval_obligations" (
    "id" TEXT NOT NULL,
    "useCaseId" TEXT NOT NULL,
    "riskId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_approval_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "governed_reference_versions_listCode_state_effectiveFrom_idx" ON "governed_reference_versions"("listCode", "state", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "governed_reference_versions_listCode_version_key" ON "governed_reference_versions"("listCode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_use_cases_useCaseRef_key" ON "ai_use_cases"("useCaseRef");

-- CreateIndex
CREATE UNIQUE INDEX "ai_use_cases_workflowCaseId_key" ON "ai_use_cases"("workflowCaseId");

-- CreateIndex
CREATE INDEX "ai_use_cases_ownerPersonId_deletedAt_idx" ON "ai_use_cases"("ownerPersonId", "deletedAt");

-- CreateIndex
CREATE INDEX "ai_use_cases_organizationUnitId_deletedAt_idx" ON "ai_use_cases"("organizationUnitId", "deletedAt");

-- CreateIndex
CREATE INDEX "ai_use_cases_assetId_idx" ON "ai_use_cases"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_intake_revisions_useCaseId_revision_key" ON "ai_intake_revisions"("useCaseId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risks_riskRef_key" ON "ai_risks"("riskRef");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risks_workflowCaseId_key" ON "ai_risks"("workflowCaseId");

-- CreateIndex
CREATE INDEX "ai_risks_useCaseId_deletedAt_idx" ON "ai_risks"("useCaseId", "deletedAt");

-- CreateIndex
CREATE INDEX "ai_risks_ownerPersonId_deletedAt_idx" ON "ai_risks"("ownerPersonId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risks_id_useCaseId_key" ON "ai_risks"("id", "useCaseId");

-- CreateIndex
CREATE INDEX "ai_assessment_rounds_useCaseId_kind_createdAt_idx" ON "ai_assessment_rounds"("useCaseId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_assessment_rounds_riskId_kind_round_key" ON "ai_assessment_rounds"("riskId", "kind", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_treatment_actions_actionRef_key" ON "ai_treatment_actions"("actionRef");

-- CreateIndex
CREATE UNIQUE INDEX "ai_treatment_actions_workflowTaskId_key" ON "ai_treatment_actions"("workflowTaskId");

-- CreateIndex
CREATE INDEX "ai_treatment_actions_riskId_deletedAt_idx" ON "ai_treatment_actions"("riskId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_approval_obligations_useCaseId_sourceKey_key" ON "ai_approval_obligations"("useCaseId", "sourceKey");

-- AddForeignKey
ALTER TABLE "governed_reference_versions" ADD CONSTRAINT "governed_reference_versions_listCode_fkey" FOREIGN KEY ("listCode") REFERENCES "governed_reference_lists"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governed_reference_values" ADD CONSTRAINT "governed_reference_values_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "governed_reference_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_intake_revisions" ADD CONSTRAINT "ai_intake_revisions_useCaseId_fkey" FOREIGN KEY ("useCaseId") REFERENCES "ai_use_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_useCaseId_fkey" FOREIGN KEY ("useCaseId") REFERENCES "ai_use_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessment_rounds" ADD CONSTRAINT "ai_assessment_rounds_useCaseId_fkey" FOREIGN KEY ("useCaseId") REFERENCES "ai_use_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessment_rounds" ADD CONSTRAINT "ai_assessment_rounds_riskId_useCaseId_fkey" FOREIGN KEY ("riskId", "useCaseId") REFERENCES "ai_risks"("id", "useCaseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessment_rounds" ADD CONSTRAINT "ai_assessment_rounds_ruleReferenceVersionId_fkey" FOREIGN KEY ("ruleReferenceVersionId") REFERENCES "governed_reference_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_treatment_actions" ADD CONSTRAINT "ai_treatment_actions_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "ai_risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_treatment_actions" ADD CONSTRAINT "ai_treatment_actions_workflowTaskId_fkey" FOREIGN KEY ("workflowTaskId") REFERENCES "workflow_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_treatment_actions" ADD CONSTRAINT "ai_treatment_actions_assigneePersonId_fkey" FOREIGN KEY ("assigneePersonId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_obligations" ADD CONSTRAINT "ai_approval_obligations_useCaseId_fkey" FOREIGN KEY ("useCaseId") REFERENCES "ai_use_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_obligations" ADD CONSTRAINT "ai_approval_obligations_riskId_useCaseId_fkey" FOREIGN KEY ("riskId", "useCaseId") REFERENCES "ai_risks"("id", "useCaseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additional invariants not expressible in Prisma's schema language.
ALTER TABLE "governed_reference_versions" ADD CONSTRAINT "governed_reference_version_valid"
CHECK (version > 0 AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
  AND ("sourceSha256" IS NULL OR "sourceSha256" ~ '^[0-9a-fA-F]{64}$')
  AND (state = 'draft' OR ("effectiveFrom" IS NOT NULL AND "approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL)));
CREATE UNIQUE INDEX "governed_reference_one_published" ON "governed_reference_versions" ("listCode") WHERE state = 'published';
ALTER TABLE "governed_reference_values" ADD CONSTRAINT "governed_reference_value_valid"
CHECK (code ~ '^[A-Z][A-Z0-9_]*$' AND length(trim("labelEn")) > 0 AND length(trim("labelAr")) > 0
  AND jsonb_typeof(metadata) = 'object');
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_case_valid"
CHECK (version > 0 AND length(trim(name)) > 0 AND ("useCaseRef" IS NULL OR "useCaseRef" ~ '^AI-[0-9]{3,}$'));
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risk_valid"
CHECK (version > 0 AND ("riskRef" IS NULL OR ("riskRef" ~ '^AIR-[0-9]{3,}$'
  AND title IS NOT NULL AND length(trim(title)) > 0
  AND cause IS NOT NULL AND length(trim(cause)) > 0
  AND event IS NOT NULL AND length(trim(event)) > 0
  AND effect IS NOT NULL AND length(trim(effect)) > 0)));
ALTER TABLE "ai_treatment_actions" ADD CONSTRAINT "ai_action_valid"
CHECK (version > 0 AND "actionRef" ~ '^ACT-[0-9]{3,}$' AND length(trim(title)) > 0);
ALTER TABLE "ai_approval_obligations" ADD CONSTRAINT "ai_obligation_valid"
CHECK (version > 0 AND length(trim("sourceKey")) > 0 AND length(trim(description)) > 0);
ALTER TABLE "ai_intake_revisions" ADD CONSTRAINT "ai_intake_revision_valid"
CHECK (revision > 0 AND "schemaVersion" = 1 AND jsonb_typeof(payload) = 'object');
ALTER TABLE "ai_assessment_rounds" ADD CONSTRAINT "ai_assessment_round_valid"
CHECK (round > 0 AND "schemaVersion" = 1 AND length(trim("engineVersion")) > 0
  AND jsonb_typeof(inputs) = 'object' AND jsonb_typeof(result) = 'object'
  AND ((kind = 'classification' AND "riskId" IS NULL) OR (kind IN ('inherent', 'residual') AND "riskId" IS NOT NULL)));
CREATE UNIQUE INDEX "ai_classification_round_unique" ON "ai_assessment_rounds" ("useCaseId", round) WHERE kind = 'classification';

CREATE FUNCTION dgop_ai_immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI revisions and calculation snapshots are append-only' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER ai_intake_append_only BEFORE UPDATE OR DELETE ON "ai_intake_revisions"
FOR EACH ROW EXECUTE FUNCTION dgop_ai_immutable_snapshot();
CREATE TRIGGER ai_assessment_append_only BEFORE UPDATE OR DELETE ON "ai_assessment_rounds"
FOR EACH ROW EXECUTE FUNCTION dgop_ai_immutable_snapshot();

CREATE FUNCTION dgop_reference_values_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text;
BEGIN
  -- Lock both source and destination on a move; a published value cannot be
  -- moved to a draft version to circumvent immutability.
  IF TG_OP <> 'INSERT' THEN
    PERFORM 1 FROM "governed_reference_versions" WHERE id = OLD."versionId" AND state = 'draft' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Published reference content is immutable' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    target_id := NEW."versionId";
    PERFORM 1 FROM "governed_reference_versions" WHERE id = target_id AND state = 'draft' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reference values require a draft version' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER governed_reference_value_guard BEFORE INSERT OR UPDATE OR DELETE ON "governed_reference_values"
FOR EACH ROW EXECUTE FUNCTION dgop_reference_values_draft_only();

CREATE FUNCTION dgop_reference_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN RAISE EXCEPTION 'Reference versions start as drafts' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'draft' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Reference history cannot be deleted' USING ERRCODE = '23514'; END IF;
    IF OLD.state <> 'published' OR NEW.state <> 'retired' OR NEW."effectiveTo" IS NULL
      OR (to_jsonb(NEW) - ARRAY['state','effectiveTo','updatedAt']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['state','effectiveTo','updatedAt']) THEN
      RAISE EXCEPTION 'Published reference versions may only be retired' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.state <> 'draft' THEN
    IF NEW.state <> 'published' OR NOT EXISTS (SELECT 1 FROM "governed_reference_values" WHERE "versionId" = OLD.id) THEN
      RAISE EXCEPTION 'Publish a populated draft before retiring it' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER governed_reference_version_guard BEFORE INSERT OR UPDATE OR DELETE ON "governed_reference_versions"
FOR EACH ROW EXECUTE FUNCTION dgop_reference_version_guard();

CREATE FUNCTION dgop_ai_reference_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "governed_reference_versions" WHERE id = NEW."ruleReferenceVersionId" AND state = 'published' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'New calculations require published reference parameters' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_assessment_reference_guard BEFORE INSERT ON "ai_assessment_rounds"
FOR EACH ROW EXECUTE FUNCTION dgop_ai_reference_pin_guard();

CREATE FUNCTION dgop_ai_record_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Archive AI governance records instead of deleting them' USING ERRCODE = '23514'; END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'AI record version must advance by one' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'ai_use_cases' THEN
    IF OLD."useCaseRef" IS NOT NULL AND OLD."useCaseRef" IS DISTINCT FROM NEW."useCaseRef" THEN
      RAISE EXCEPTION 'AI use-case identifiers are permanent' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'ai_risks' THEN
    IF OLD."useCaseId" <> NEW."useCaseId" OR (OLD."riskRef" IS NOT NULL AND OLD."riskRef" IS DISTINCT FROM NEW."riskRef") THEN
      RAISE EXCEPTION 'AI risk identity and parent are permanent' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'ai_treatment_actions' THEN
    IF OLD."riskId" <> NEW."riskId" OR OLD."actionRef" <> NEW."actionRef" THEN
      RAISE EXCEPTION 'AI action identity and parent are permanent' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'ai_approval_obligations' THEN
    IF OLD."useCaseId" <> NEW."useCaseId" OR OLD."sourceKey" <> NEW."sourceKey" THEN
      RAISE EXCEPTION 'AI obligation provenance is permanent' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_use_case_version_guard BEFORE UPDATE OR DELETE ON "ai_use_cases" FOR EACH ROW EXECUTE FUNCTION dgop_ai_record_version_guard();
CREATE TRIGGER ai_risk_version_guard BEFORE UPDATE OR DELETE ON "ai_risks" FOR EACH ROW EXECUTE FUNCTION dgop_ai_record_version_guard();
CREATE TRIGGER ai_action_version_guard BEFORE UPDATE OR DELETE ON "ai_treatment_actions" FOR EACH ROW EXECUTE FUNCTION dgop_ai_record_version_guard();
CREATE TRIGGER ai_obligation_version_guard BEFORE UPDATE OR DELETE ON "ai_approval_obligations" FOR EACH ROW EXECUTE FUNCTION dgop_ai_record_version_guard();
