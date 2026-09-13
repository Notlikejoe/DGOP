-- AlterTable
ALTER TABLE "ai_library_control_link_versions" ADD COLUMN     "categoryMappingVersionId" TEXT;

-- CreateTable
CREATE TABLE "ai_category_control_mapping_versions" (
    "id" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "categoryPin" JSONB NOT NULL,
    "controlPins" JSONB NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_category_control_mapping_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_category_control_mapping_reviews" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_category_control_mapping_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_source_native_drafts" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "sourceDigest" VARCHAR(64) NOT NULL,
    "projectionDigest" VARCHAR(64) NOT NULL,
    "targetUseCaseId" TEXT,
    "targetRiskId" TEXT,
    "requestKey" TEXT NOT NULL,
    "requestDigest" VARCHAR(64) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_source_native_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_migration_pilot_captures" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "bindings" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestDigest" VARCHAR(64) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_migration_pilot_captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_migration_pilot_reviews" (
    "id" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_migration_pilot_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_category_control_mapping_versions_categoryCode_round_key" ON "ai_category_control_mapping_versions"("categoryCode", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_category_control_mapping_reviews_versionId_key" ON "ai_category_control_mapping_reviews"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_source_native_drafts_targetUseCaseId_key" ON "ai_source_native_drafts"("targetUseCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_source_native_drafts_targetRiskId_key" ON "ai_source_native_drafts"("targetRiskId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_source_native_drafts_requestKey_key" ON "ai_source_native_drafts"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_source_native_drafts_snapshotId_rowKey_key" ON "ai_source_native_drafts"("snapshotId", "rowKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_migration_pilot_captures_requestKey_key" ON "ai_migration_pilot_captures"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_migration_pilot_captures_snapshotId_round_key" ON "ai_migration_pilot_captures"("snapshotId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_migration_pilot_reviews_captureId_key" ON "ai_migration_pilot_reviews"("captureId");

-- AddForeignKey
ALTER TABLE "ai_library_control_link_versions" ADD CONSTRAINT "ai_library_control_link_versions_categoryMappingVersionId_fkey" FOREIGN KEY ("categoryMappingVersionId") REFERENCES "ai_category_control_mapping_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_category_control_mapping_reviews" ADD CONSTRAINT "ai_category_control_mapping_reviews_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ai_category_control_mapping_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_source_native_drafts" ADD CONSTRAINT "ai_source_native_drafts_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ai_corrected_source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_source_native_drafts" ADD CONSTRAINT "ai_source_native_drafts_targetUseCaseId_fkey" FOREIGN KEY ("targetUseCaseId") REFERENCES "ai_use_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_source_native_drafts" ADD CONSTRAINT "ai_source_native_drafts_targetRiskId_fkey" FOREIGN KEY ("targetRiskId") REFERENCES "ai_risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_migration_pilot_captures" ADD CONSTRAINT "ai_migration_pilot_captures_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ai_corrected_source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_migration_pilot_reviews" ADD CONSTRAINT "ai_migration_pilot_reviews_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "ai_migration_pilot_captures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$ DECLARE ledger text; BEGIN
 FOREACH ledger IN ARRAY ARRAY['ai_category_control_mapping_versions','ai_category_control_mapping_reviews','ai_source_native_drafts','ai_migration_pilot_captures','ai_migration_pilot_reviews'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ai_source_corrections_append_only()',ledger||'_immutable',ledger);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK(length(trim(justification))>0 AND jsonb_typeof("evidenceIds")=''array'' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20)',ledger,ledger||'_evidence');
 END LOOP;
END; $$;
ALTER TABLE ai_category_control_mapping_versions ADD CONSTRAINT ai_category_control_shape CHECK(round>0 AND digest ~ '^[0-9a-f]{64}$' AND jsonb_typeof("controlPins")='array' AND jsonb_array_length("controlPins")<=10 AND "categoryPin"->>'code'="categoryCode");
ALTER TABLE ai_category_control_mapping_reviews ADD CONSTRAINT ai_category_control_outcome CHECK(outcome IN ('approve','return'));
ALTER TABLE ai_source_native_drafts ADD CONSTRAINT ai_source_native_shape CHECK(("targetUseCaseId" IS NULL)<>("targetRiskId" IS NULL) AND "sourceDigest" ~ '^[0-9a-f]{64}$' AND "projectionDigest" ~ '^[0-9a-f]{64}$' AND "requestDigest" ~ '^[0-9a-f]{64}$');
ALTER TABLE ai_migration_pilot_captures ADD CONSTRAINT ai_migration_pilot_shape CHECK(round>0 AND digest ~ '^[0-9a-f]{64}$' AND "requestDigest" ~ '^[0-9a-f]{64}$' AND jsonb_typeof(bindings)='array' AND jsonb_array_length(bindings)<=250 AND report->>'snapshotId'="snapshotId" AND report->>'productionReady'='false');
ALTER TABLE ai_migration_pilot_reviews ADD CONSTRAINT ai_migration_pilot_outcome CHECK(outcome IN ('approve','return'));
CREATE FUNCTION ai_category_pilot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposer text; head text; proposal jsonb; source jsonb;
BEGIN
 IF TG_TABLE_NAME='ai_category_control_mapping_versions' THEN
  IF NOT EXISTS(SELECT 1 FROM governed_reference_versions v JOIN governed_reference_values x ON x."versionId"=v.id WHERE v.id=NEW."categoryPin"->>'versionId' AND v."listCode"='R_RISKCAT' AND v.state='published' AND x.code=NEW."categoryCode") THEN RAISE EXCEPTION 'Published category required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."controlPins") p WHERE NOT EXISTS(SELECT 1 FROM ai_control_domain_versions v JOIN ai_control_domain_publications c ON c."versionId"=v.id WHERE v.id=p->>'versionId' AND v.digest=p->>'digest')) THEN RAISE EXCEPTION 'Published category control pins required'; END IF;
 ELSIF TG_TABLE_NAME='ai_category_control_mapping_reviews' THEN
  SELECT "proposedBy" INTO proposer FROM ai_category_control_mapping_versions WHERE id=NEW."versionId";
  SELECT id INTO head FROM ai_category_control_mapping_versions WHERE "categoryCode"=(SELECT "categoryCode" FROM ai_category_control_mapping_versions WHERE id=NEW."versionId") ORDER BY round DESC LIMIT 1;
  IF proposer=NEW."actorId" OR head IS DISTINCT FROM NEW."versionId" THEN RAISE EXCEPTION 'Independent latest category review required'; END IF;
 ELSIF TG_TABLE_NAME='ai_source_native_drafts' THEN
  SELECT r INTO source FROM ai_corrected_source_snapshots s,jsonb_array_elements(s.report->'rows') r WHERE s.id=NEW."snapshotId" AND r->>'key'=NEW."rowKey" AND r->>'sourceRef'=NEW."sourceRef" AND r->>'sample'='false';
  IF source IS NULL THEN RAISE EXCEPTION 'Original nonsample source row required'; END IF;
  IF NEW."targetUseCaseId" IS NOT NULL AND (source->>'kind'<>'usecase' OR NOT EXISTS(SELECT 1 FROM ai_use_cases u WHERE u.id=NEW."targetUseCaseId" AND u."useCaseRef" IS NULL AND u."workflowCaseId" IS NULL AND u."createdBy"=NEW."createdBy")) THEN RAISE EXCEPTION 'Native use-case source draft required'; END IF;
  IF NEW."targetRiskId" IS NOT NULL AND (source->>'kind'<>'risk' OR NOT EXISTS(SELECT 1 FROM ai_risks r JOIN ai_use_cases u ON u.id=r."useCaseId" WHERE r.id=NEW."targetRiskId" AND r."riskRef" IS NULL AND r."createdBy"=NEW."createdBy" AND u."useCaseRef"=source->>'parentRef')) THEN RAISE EXCEPTION 'Native risk source draft with preserved parent required'; END IF;
 ELSIF TG_TABLE_NAME='ai_migration_pilot_captures' THEN
  IF NOT EXISTS(SELECT 1 FROM ai_corrected_source_snapshots s JOIN ai_source_correction_reviews r ON r."versionId"=s."correctionVersionId" WHERE s.id=NEW."snapshotId" AND r.outcome='approve') THEN RAISE EXCEPTION 'Reviewed source required for pilot capture'; END IF;
 ELSE
  SELECT "createdBy",report INTO proposer,proposal FROM ai_migration_pilot_captures WHERE id=NEW."captureId";
  SELECT id INTO head FROM ai_migration_pilot_captures WHERE "snapshotId"=(SELECT "snapshotId" FROM ai_migration_pilot_captures WHERE id=NEW."captureId") ORDER BY round DESC LIMIT 1;
  IF proposer=NEW."actorId" OR head IS DISTINCT FROM NEW."captureId" THEN RAISE EXCEPTION 'Independent latest pilot review required'; END IF;
  IF NEW.outcome='approve' AND (proposal->>'pilotReady' IS DISTINCT FROM 'true' OR proposal->>'targetZeroDiff' IS DISTINCT FROM 'true' OR jsonb_array_length(proposal->'missingPilotRefs')<>0) THEN RAISE EXCEPTION 'Complete reconciled pilot required'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ai_category_mapping_insert BEFORE INSERT ON ai_category_control_mapping_versions FOR EACH ROW EXECUTE FUNCTION ai_category_pilot_guard();
CREATE TRIGGER ai_category_mapping_review_insert BEFORE INSERT ON ai_category_control_mapping_reviews FOR EACH ROW EXECUTE FUNCTION ai_category_pilot_guard();
CREATE TRIGGER ai_source_native_insert BEFORE INSERT ON ai_source_native_drafts FOR EACH ROW EXECUTE FUNCTION ai_category_pilot_guard();
CREATE TRIGGER ai_pilot_capture_insert BEFORE INSERT ON ai_migration_pilot_captures FOR EACH ROW EXECUTE FUNCTION ai_category_pilot_guard();
CREATE TRIGGER ai_pilot_review_insert BEFORE INSERT ON ai_migration_pilot_reviews FOR EACH ROW EXECUTE FUNCTION ai_category_pilot_guard();
CREATE FUNCTION ai_derived_library_controls_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."categoryMappingVersionId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_category_control_mapping_versions m JOIN ai_category_control_mapping_reviews r ON r."versionId"=m.id JOIN ai_risk_library_versions l ON l.id=NEW."libraryVersionId" WHERE m.id=NEW."categoryMappingVersionId" AND r.outcome='approve' AND m."controlPins"=NEW."controlPins" AND m."categoryPin"=l."referencePins"->'risk_category') THEN RAISE EXCEPTION 'Approved category-derived library pins required'; END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER ai_derived_library_controls_insert BEFORE INSERT ON ai_library_control_link_versions FOR EACH ROW EXECUTE FUNCTION ai_derived_library_controls_guard();
