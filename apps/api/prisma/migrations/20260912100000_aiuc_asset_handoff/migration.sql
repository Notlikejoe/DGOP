ALTER TABLE "ai_risks" ADD COLUMN "aiucHandoffSourceId" TEXT;
ALTER TABLE "ai_risks" ADD COLUMN "handoffPayload" JSONB;
CREATE UNIQUE INDEX "ai_risks_aiucHandoffSourceId_key" ON "ai_risks"("aiucHandoffSourceId");
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_handoff_source_check"
  CHECK ("aiucHandoffSourceId" IS NULL OR ("aiucHandoffSourceId" = "useCaseId" AND "handoffPayload" IS NOT NULL));
ALTER TABLE "ai_approval_obligations" ADD COLUMN "assetId" TEXT;
ALTER TABLE "ai_approval_obligations" ADD CONSTRAINT "ai_approval_obligations_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION dgop_ai_handoff_identity_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."aiucHandoffSourceId" IS NOT NULL AND (
    NEW."aiucHandoffSourceId" IS DISTINCT FROM OLD."aiucHandoffSourceId" OR
    NEW."handoffPayload" IS DISTINCT FROM OLD."handoffPayload" OR
    NEW."useCaseId" IS DISTINCT FROM OLD."useCaseId" OR
    NEW."workflowCaseId" IS DISTINCT FROM OLD."workflowCaseId"
  ) THEN RAISE EXCEPTION 'AIUC handoff identity and source payload are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dgop_ai_handoff_identity_guard BEFORE UPDATE ON "ai_risks"
FOR EACH ROW EXECUTE FUNCTION dgop_ai_handoff_identity_guard();

CREATE FUNCTION dgop_ai_asset_identity_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."assetId" IS NOT NULL AND NEW."assetId" IS DISTINCT FROM OLD."assetId" THEN
    RAISE EXCEPTION 'AI use-case asset identity is permanent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dgop_ai_asset_identity_guard BEFORE UPDATE ON "ai_use_cases"
FOR EACH ROW EXECUTE FUNCTION dgop_ai_asset_identity_guard();

CREATE FUNCTION dgop_ai_asset_metadata_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ai_use_cases" u WHERE u."assetId" = OLD.id AND u."useCaseRef" IS NOT NULL
    AND (NEW.asset_type <> 'ai_data_product' OR NEW.type_metadata_json->>'aiUseCaseRef' IS DISTINCT FROM u."useCaseRef")) THEN
    RAISE EXCEPTION 'Linked AI asset type and use-case reference are permanent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dgop_ai_asset_metadata_guard BEFORE UPDATE ON "data_assets"
FOR EACH ROW EXECUTE FUNCTION dgop_ai_asset_metadata_guard();

CREATE FUNCTION dgop_ai_obligation_asset_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."assetId" IS NOT NULL AND (NEW."riskId" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "ai_use_cases" u WHERE u.id = NEW."useCaseId" AND u."assetId" = NEW."assetId"
  )) THEN RAISE EXCEPTION 'AI obligations must link to the use-case asset and an AIRS risk'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER dgop_ai_obligation_asset_guard AFTER INSERT OR UPDATE ON "ai_approval_obligations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dgop_ai_obligation_asset_guard();
