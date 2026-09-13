-- AlterTable
ALTER TABLE "ai_risks" ADD COLUMN     "controlPins" JSONB,
ADD COLUMN     "suggestedControlPins" JSONB;

-- CreateTable
CREATE TABLE "ai_library_source_imports" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestDigest" VARCHAR(64) NOT NULL,
    "rowKeys" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_library_source_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_library_source_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "libraryVersionId" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "sourceDigest" VARCHAR(64) NOT NULL,
    "projectionDigest" VARCHAR(64) NOT NULL,

    CONSTRAINT "ai_library_source_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_library_control_link_versions" (
    "id" TEXT NOT NULL,
    "libraryVersionId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "controlPins" JSONB NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_library_control_link_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_library_control_link_reviews" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_library_control_link_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_library_source_imports_requestKey_key" ON "ai_library_source_imports"("requestKey");

-- CreateIndex
CREATE INDEX "ai_library_source_imports_snapshotId_createdAt_idx" ON "ai_library_source_imports"("snapshotId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_library_source_items_libraryVersionId_key" ON "ai_library_source_items"("libraryVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_library_source_items_snapshotId_rowKey_key" ON "ai_library_source_items"("snapshotId", "rowKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_library_control_link_versions_libraryVersionId_round_key" ON "ai_library_control_link_versions"("libraryVersionId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_library_control_link_reviews_versionId_key" ON "ai_library_control_link_reviews"("versionId");

-- AddForeignKey
ALTER TABLE "ai_library_source_imports" ADD CONSTRAINT "ai_library_source_imports_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ai_corrected_source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_library_source_items" ADD CONSTRAINT "ai_library_source_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ai_library_source_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_library_source_items" ADD CONSTRAINT "ai_library_source_items_libraryVersionId_fkey" FOREIGN KEY ("libraryVersionId") REFERENCES "ai_risk_library_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_library_control_link_versions" ADD CONSTRAINT "ai_library_control_link_versions_libraryVersionId_fkey" FOREIGN KEY ("libraryVersionId") REFERENCES "ai_risk_library_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_library_control_link_reviews" ADD CONSTRAINT "ai_library_control_link_reviews_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ai_library_control_link_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Source preparation and tag provenance are additive, governed, and append-only.
DO $$ DECLARE ledger text; BEGIN
 FOREACH ledger IN ARRAY ARRAY['ai_library_source_imports','ai_library_source_items','ai_library_control_link_versions','ai_library_control_link_reviews'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ai_source_corrections_append_only()',ledger||'_immutable',ledger);
 END LOOP;
 FOREACH ledger IN ARRAY ARRAY['ai_library_source_imports','ai_library_control_link_versions','ai_library_control_link_reviews'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK(length(trim(justification))>0 AND jsonb_typeof("evidenceIds")=''array'' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20)',ledger,ledger||'_evidence');
 END LOOP;
END; $$;
ALTER TABLE ai_library_source_imports ADD CONSTRAINT ai_library_source_import_shape CHECK("requestDigest" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("rowKeys")='array' AND jsonb_array_length("rowKeys") BETWEEN 1 AND 66);
ALTER TABLE ai_library_source_items ADD CONSTRAINT ai_library_source_item_shape CHECK("sourceRef" ~ '^AIRL-[0-9]{3,}$' AND "sourceDigest" ~ '^[0-9a-f]{64}$' AND "projectionDigest" ~ '^[0-9a-f]{64}$');
ALTER TABLE ai_library_control_link_versions ADD CONSTRAINT ai_library_control_link_shape CHECK(round>0 AND digest ~ '^[0-9a-f]{64}$' AND jsonb_typeof("controlPins")='array' AND jsonb_array_length("controlPins")<=10);
ALTER TABLE ai_library_control_link_reviews ADD CONSTRAINT ai_library_control_link_review_shape CHECK(outcome IN ('approve','return'));
ALTER TABLE ai_risks ADD CONSTRAINT ai_risk_control_pins_shape CHECK("controlPins" IS NULL OR(jsonb_typeof("controlPins")='array' AND jsonb_array_length("controlPins")<=10));
CREATE FUNCTION ai_library_source_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposer text; head_id text;
BEGIN
 IF TG_TABLE_NAME='ai_library_source_items' THEN
  IF NOT EXISTS(SELECT 1 FROM ai_library_source_imports b JOIN ai_corrected_source_snapshots s ON s.id=b."snapshotId",jsonb_array_elements(s.report->'rows') r WHERE b.id=NEW."batchId" AND b."snapshotId"=NEW."snapshotId" AND b."rowKeys" ? NEW."rowKey" AND r->>'key'=NEW."rowKey" AND r->>'kind'='library' AND r->>'status'='prepared' AND r->>'sample'='false' AND r->>'sourceRef'=NEW."sourceRef") THEN RAISE EXCEPTION 'Source library item must retain a prepared source row'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_risk_library_versions v JOIN ai_risk_library_entries e ON e.id=v."entryId" WHERE v.id=NEW."libraryVersionId" AND e."libraryRef"=NEW."sourceRef") THEN RAISE EXCEPTION 'Source library target identifier must match'; END IF;
 ELSIF TG_TABLE_NAME='ai_library_control_link_versions' THEN
  IF NOT EXISTS(SELECT 1 FROM ai_risk_library_publications WHERE "versionId"=NEW."libraryVersionId") THEN RAISE EXCEPTION 'Published library source required for tags'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."controlPins") p WHERE NOT EXISTS(SELECT 1 FROM ai_control_domain_versions v JOIN ai_control_domain_publications c ON c."versionId"=v.id WHERE v.id=p->>'versionId' AND v.digest=p->>'digest')) THEN RAISE EXCEPTION 'Published control source required'; END IF;
 ELSE
  SELECT "proposedBy" INTO proposer FROM ai_library_control_link_versions WHERE id=NEW."versionId";
  SELECT id INTO head_id FROM ai_library_control_link_versions WHERE "libraryVersionId"=(SELECT "libraryVersionId" FROM ai_library_control_link_versions WHERE id=NEW."versionId") ORDER BY round DESC LIMIT 1;
  IF proposer=NEW."actorId" OR head_id IS DISTINCT FROM NEW."versionId" THEN RAISE EXCEPTION 'Independent latest library control review required'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ai_library_source_item_write BEFORE INSERT ON ai_library_source_items FOR EACH ROW EXECUTE FUNCTION ai_library_source_link_guard();
CREATE TRIGGER ai_library_control_link_write BEFORE INSERT ON ai_library_control_link_versions FOR EACH ROW EXECUTE FUNCTION ai_library_source_link_guard();
CREATE TRIGGER ai_library_control_link_review_write BEFORE INSERT ON ai_library_control_link_reviews FOR EACH ROW EXECUTE FUNCTION ai_library_source_link_guard();
CREATE FUNCTION ai_risk_control_provenance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."suggestedControlPins" IS DISTINCT FROM OLD."suggestedControlPins" THEN RAISE EXCEPTION 'AI library control suggestions are immutable provenance'; END IF;
 IF TG_OP='UPDATE' AND OLD."riskRef" IS NOT NULL AND NEW."controlPins" IS DISTINCT FROM OLD."controlPins" THEN RAISE EXCEPTION 'Submitted risk control tags are immutable'; END IF;
 IF NEW."suggestedControlPins" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_library_control_link_versions v JOIN ai_library_control_link_reviews r ON r."versionId"=v.id WHERE v.id=NEW."suggestedControlPins"->>'mappingVersionId' AND v."libraryVersionId"=NEW."libraryVersionId" AND v.digest=NEW."suggestedControlPins"->>'digest' AND v."controlPins"=NEW."suggestedControlPins"->'controlPins' AND r.outcome='approve') THEN RAISE EXCEPTION 'Approved library control suggestion provenance required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ai_risk_control_provenance BEFORE INSERT OR UPDATE ON ai_risks FOR EACH ROW EXECUTE FUNCTION ai_risk_control_provenance_guard();
