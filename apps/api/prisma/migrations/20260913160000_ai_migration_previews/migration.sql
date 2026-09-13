-- CreateTable
CREATE TABLE "ai_migration_previews" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestDigest" VARCHAR(64) NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "environmentDigest" VARCHAR(64) NOT NULL,
    "report" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_migration_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_migration_dispositions" (
    "id" TEXT NOT NULL,
    "previewId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "actorId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_migration_dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_migration_preview_reviews" (
    "id" TEXT NOT NULL,
    "previewId" TEXT NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "actorId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_migration_preview_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_migration_previews_requestKey_key" ON "ai_migration_previews"("requestKey");

-- CreateIndex
CREATE INDEX "ai_migration_previews_createdAt_id_idx" ON "ai_migration_previews"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_migration_dispositions_previewId_rowKey_key" ON "ai_migration_dispositions"("previewId", "rowKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_migration_preview_reviews_previewId_key" ON "ai_migration_preview_reviews"("previewId");

-- AddForeignKey
ALTER TABLE "ai_migration_dispositions" ADD CONSTRAINT "ai_migration_dispositions_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "ai_migration_previews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_migration_preview_reviews" ADD CONSTRAINT "ai_migration_preview_reviews_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "ai_migration_previews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION ai_migration_preview_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI source preparation history is append-only'; END; $$;
CREATE TRIGGER ai_migration_preview_immutable BEFORE UPDATE OR DELETE ON ai_migration_previews FOR EACH ROW EXECUTE FUNCTION ai_migration_preview_append_only();
CREATE TRIGGER ai_migration_disposition_immutable BEFORE UPDATE OR DELETE ON ai_migration_dispositions FOR EACH ROW EXECUTE FUNCTION ai_migration_preview_append_only();
CREATE TRIGGER ai_migration_review_immutable BEFORE UPDATE OR DELETE ON ai_migration_preview_reviews FOR EACH ROW EXECUTE FUNCTION ai_migration_preview_append_only();
ALTER TABLE ai_migration_previews ADD CONSTRAINT ai_migration_preview_shape CHECK (
 digest ~ '^[0-9a-f]{64}$' AND "environmentDigest" ~ '^[0-9a-f]{64}$' AND "requestDigest" ~ '^[0-9a-f]{64}$'
 AND jsonb_typeof(report)='object' AND jsonb_typeof(report->'rows')='array'
 AND report->'reconciliation'->>'mode'='VALIDATE_ONLY' AND report->'reconciliation'->>'productionReady'='false'
 AND report @> '{"reconciliation":{"mode":"VALIDATE_ONLY","productionReady":false,"loadedCount":0}}'::jsonb AND length(trim(justification))>0
 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);
ALTER TABLE ai_migration_dispositions ADD CONSTRAINT ai_migration_disposition_shape CHECK(outcome IN ('defer','reject') AND length(trim(justification))>0 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);
ALTER TABLE ai_migration_preview_reviews ADD CONSTRAINT ai_migration_review_shape CHECK(outcome IN ('accept','reject') AND length(trim(justification))>0 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);
CREATE FUNCTION ai_migration_preview_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent ai_migration_previews%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM ai_migration_previews WHERE id=NEW."previewId" FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION 'Source preview parent is required'; END IF;
 IF EXISTS(SELECT 1 FROM ai_migration_preview_reviews WHERE "previewId"=NEW."previewId") THEN RAISE EXCEPTION 'Source preparation review is closed'; END IF;
 IF TG_TABLE_NAME='ai_migration_dispositions' THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent.report->'rows') r WHERE r->>'key'=NEW."rowKey" AND r->>'status'='quarantined') THEN RAISE EXCEPTION 'Disposition must belong to a quarantined source-preview row'; END IF;
 ELSE
  IF NEW."actorId"=parent."createdBy" THEN RAISE EXCEPTION 'Source preparation review must be independent'; END IF;
  IF NEW.outcome='accept' AND EXISTS(SELECT 1 FROM jsonb_array_elements(parent.report->'rows') r WHERE r->>'status'='quarantined' AND NOT EXISTS(SELECT 1 FROM ai_migration_dispositions d WHERE d."previewId"=parent.id AND d."rowKey"=r->>'key')) THEN RAISE EXCEPTION 'Quarantine dispositions are required before preparation acceptance'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ai_migration_disposition_parent BEFORE INSERT ON ai_migration_dispositions FOR EACH ROW EXECUTE FUNCTION ai_migration_preview_child_guard();
CREATE TRIGGER ai_migration_review_parent BEFORE INSERT ON ai_migration_preview_reviews FOR EACH ROW EXECUTE FUNCTION ai_migration_preview_child_guard();
