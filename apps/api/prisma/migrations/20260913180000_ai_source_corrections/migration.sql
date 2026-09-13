-- CreateTable
CREATE TABLE "ai_source_correction_versions" (
    "id" TEXT NOT NULL,
    "previewId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestDigest" VARCHAR(64) NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "entries" JSONB NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_source_correction_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_source_correction_reviews" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "actorId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_source_correction_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_corrected_source_snapshots" (
    "id" TEXT NOT NULL,
    "correctionVersionId" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_corrected_source_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_control_domain_entries" (
    "id" TEXT NOT NULL,
    "controlCode" VARCHAR(40) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_control_domain_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_control_domain_versions" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "previewId" TEXT NOT NULL,
    "sourceRowKey" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "dimensionPins" JSONB NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_control_domain_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_control_domain_publications" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_control_domain_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_source_correction_versions_requestKey_key" ON "ai_source_correction_versions"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_source_correction_versions_previewId_round_key" ON "ai_source_correction_versions"("previewId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_source_correction_reviews_versionId_key" ON "ai_source_correction_reviews"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_corrected_source_snapshots_correctionVersionId_key" ON "ai_corrected_source_snapshots"("correctionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_control_domain_entries_controlCode_key" ON "ai_control_domain_entries"("controlCode");

-- CreateIndex
CREATE UNIQUE INDEX "ai_control_domain_versions_entryId_round_key" ON "ai_control_domain_versions"("entryId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_control_domain_publications_versionId_key" ON "ai_control_domain_publications"("versionId");

-- AddForeignKey
ALTER TABLE "ai_source_correction_versions" ADD CONSTRAINT "ai_source_correction_versions_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "ai_migration_previews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_source_correction_reviews" ADD CONSTRAINT "ai_source_correction_reviews_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ai_source_correction_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_corrected_source_snapshots" ADD CONSTRAINT "ai_corrected_source_snapshots_correctionVersionId_fkey" FOREIGN KEY ("correctionVersionId") REFERENCES "ai_source_correction_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_control_domain_versions" ADD CONSTRAINT "ai_control_domain_versions_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ai_control_domain_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_control_domain_versions" ADD CONSTRAINT "ai_control_domain_versions_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "ai_migration_previews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_control_domain_publications" ADD CONSTRAINT "ai_control_domain_publications_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ai_control_domain_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION ai_source_corrections_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI source correction/control history is append-only'; END; $$;
DO $$ DECLARE ledger text; BEGIN
 FOREACH ledger IN ARRAY ARRAY['ai_source_correction_versions','ai_source_correction_reviews','ai_corrected_source_snapshots','ai_control_domain_entries','ai_control_domain_versions','ai_control_domain_publications'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ai_source_corrections_append_only()',ledger||'_immutable',ledger);
 END LOOP;
 FOREACH ledger IN ARRAY ARRAY['ai_source_correction_versions','ai_source_correction_reviews','ai_corrected_source_snapshots','ai_control_domain_versions','ai_control_domain_publications'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK(length(trim(justification))>0 AND jsonb_typeof("evidenceIds")=''array'' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20)',ledger,ledger||'_evidence');
 END LOOP;
END; $$;
ALTER TABLE ai_source_correction_versions ADD CONSTRAINT ai_correction_version_shape CHECK(round>0 AND digest ~ '^[0-9a-f]{64}$' AND "requestDigest" ~ '^[0-9a-f]{64}$' AND jsonb_typeof(entries)='array' AND jsonb_array_length(entries) BETWEEN 1 AND 400);
ALTER TABLE ai_source_correction_reviews ADD CONSTRAINT ai_correction_review_shape CHECK(outcome IN ('approve','return'));
ALTER TABLE ai_corrected_source_snapshots ADD CONSTRAINT ai_corrected_snapshot_shape CHECK(digest ~ '^[0-9a-f]{64}$' AND report @> '{"version":"ai-corrected-source-preview-v1","reconciliation":{"mode":"VALIDATE_ONLY","productionReady":false,"loadedCount":0}}'::jsonb);
ALTER TABLE ai_control_domain_entries ADD CONSTRAINT ai_control_domain_code CHECK("controlCode" ~ '^[A-Z][A-Z0-9_]{2,39}$');
ALTER TABLE ai_control_domain_versions ADD CONSTRAINT ai_control_domain_version_shape CHECK(round>0 AND digest ~ '^[0-9a-f]{64}$' AND jsonb_typeof(content)='object' AND content @> '{"suggestionsOnly":true}'::jsonb AND jsonb_typeof("dimensionPins")='array' AND jsonb_array_length("dimensionPins") BETWEEN 1 AND 8);
CREATE FUNCTION ai_source_correction_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposer text; head_id text; source_key text; domain_entry text;
BEGIN
 IF TG_TABLE_NAME='ai_source_correction_versions' THEN
  IF NOT EXISTS(SELECT 1 FROM ai_migration_preview_reviews WHERE "previewId"=NEW."previewId" AND outcome='accept') THEN RAISE EXCEPTION 'Accepted source preparation required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.entries) b WHERE NOT EXISTS(SELECT 1 FROM ai_migration_previews p,jsonb_array_elements(p.report->'rows') r WHERE p.id=NEW."previewId" AND r->>'key'=b->>'rowKey')) THEN RAISE EXCEPTION 'Correction rows must belong to their source preview'; END IF;
 ELSIF TG_TABLE_NAME='ai_source_correction_reviews' THEN
  SELECT "proposedBy" INTO proposer FROM ai_source_correction_versions WHERE id=NEW."versionId";
  SELECT v.id INTO head_id FROM ai_source_correction_versions v WHERE v."previewId"=(SELECT "previewId" FROM ai_source_correction_versions WHERE id=NEW."versionId") ORDER BY round DESC LIMIT 1;
  IF proposer=NEW."actorId" OR head_id IS DISTINCT FROM NEW."versionId" THEN RAISE EXCEPTION 'Independent latest correction review required'; END IF;
 ELSIF TG_TABLE_NAME='ai_corrected_source_snapshots' THEN
  IF NOT EXISTS(SELECT 1 FROM ai_source_correction_reviews WHERE "versionId"=NEW."correctionVersionId" AND outcome='approve') THEN RAISE EXCEPTION 'Independently approved corrections required'; END IF;
 ELSIF TG_TABLE_NAME='ai_control_domain_versions' THEN
  IF NOT EXISTS(SELECT 1 FROM ai_migration_preview_reviews WHERE "previewId"=NEW."previewId" AND outcome='accept') THEN RAISE EXCEPTION 'Accepted source preparation required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_migration_previews p,jsonb_array_elements(p.report->'rows') r WHERE p.id=NEW."previewId" AND r->>'key'=NEW."sourceRowKey" AND r->>'kind'='control') THEN RAISE EXCEPTION 'Control domain must retain a source control row'; END IF;
  IF EXISTS(SELECT 1 FROM ai_control_domain_versions WHERE "entryId"=NEW."entryId" AND "sourceRowKey"<>NEW."sourceRowKey") THEN RAISE EXCEPTION 'Stable control identity cannot be rebound'; END IF;
 ELSE
  SELECT "proposedBy","sourceRowKey","entryId" INTO proposer,source_key,domain_entry FROM ai_control_domain_versions WHERE id=NEW."versionId";
  PERFORM pg_advisory_xact_lock(hashtext('ai-iso-source'),hashtext(source_key));
  SELECT id INTO head_id FROM ai_control_domain_versions WHERE "entryId"=domain_entry ORDER BY round DESC LIMIT 1;
  IF proposer=NEW."publishedBy" OR head_id IS DISTINCT FROM NEW."versionId" THEN RAISE EXCEPTION 'Independent latest control publication required'; END IF;
  IF EXISTS(SELECT 1 FROM ai_control_domain_versions v JOIN ai_control_domain_publications p ON p."versionId"=v.id WHERE v."sourceRowKey"=source_key AND v."entryId"<>domain_entry) THEN RAISE EXCEPTION 'Control source area already has a published identity'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ai_correction_version_write BEFORE INSERT ON ai_source_correction_versions FOR EACH ROW EXECUTE FUNCTION ai_source_correction_write_guard();
CREATE TRIGGER ai_correction_review_write BEFORE INSERT ON ai_source_correction_reviews FOR EACH ROW EXECUTE FUNCTION ai_source_correction_write_guard();
CREATE TRIGGER ai_corrected_snapshot_write BEFORE INSERT ON ai_corrected_source_snapshots FOR EACH ROW EXECUTE FUNCTION ai_source_correction_write_guard();
CREATE TRIGGER ai_control_version_write BEFORE INSERT ON ai_control_domain_versions FOR EACH ROW EXECUTE FUNCTION ai_source_correction_write_guard();
CREATE TRIGGER ai_control_publication_write BEFORE INSERT ON ai_control_domain_publications FOR EACH ROW EXECUTE FUNCTION ai_source_correction_write_guard();
