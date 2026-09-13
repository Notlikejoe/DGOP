-- AlterTable
ALTER TABLE "ai_risks" ADD COLUMN     "initiationKey" TEXT,
ADD COLUMN     "libraryVersionId" TEXT;

-- CreateTable
CREATE TABLE "ai_dashboard_snapshots" (
    "id" TEXT NOT NULL,
    "organizationUnitId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "sourceMembers" JSONB NOT NULL,
    "projection" JSONB NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "scheduleVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_dashboard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_dashboard_schedule_versions" (
    "id" TEXT NOT NULL,
    "organizationUnitId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "dailyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_dashboard_schedule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_dashboard_schedule_runs" (
    "id" TEXT NOT NULL,
    "scheduleVersionId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "snapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_dashboard_schedule_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_risk_library_entries" (
    "id" TEXT NOT NULL,
    "libraryRef" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_risk_library_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_risk_library_versions" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "referencePins" JSONB NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_risk_library_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_risk_library_publications" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_risk_library_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_dashboard_snapshots_organizationUnitId_asOf_idx" ON "ai_dashboard_snapshots"("organizationUnitId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ai_dashboard_snapshots_organizationUnitId_frequency_periodK_key" ON "ai_dashboard_snapshots"("organizationUnitId", "frequency", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_dashboard_schedule_versions_organizationUnitId_round_key" ON "ai_dashboard_schedule_versions"("organizationUnitId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_dashboard_schedule_runs_scheduleVersionId_frequency_peri_key" ON "ai_dashboard_schedule_runs"("scheduleVersionId", "frequency", "periodKey", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_library_entries_libraryRef_key" ON "ai_risk_library_entries"("libraryRef");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_library_versions_entryId_round_key" ON "ai_risk_library_versions"("entryId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_library_publications_versionId_key" ON "ai_risk_library_publications"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risks_initiationKey_key" ON "ai_risks"("initiationKey");

-- AddForeignKey
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_libraryVersionId_fkey" FOREIGN KEY ("libraryVersionId") REFERENCES "ai_risk_library_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_dashboard_snapshots" ADD CONSTRAINT "ai_dashboard_snapshots_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_dashboard_snapshots" ADD CONSTRAINT "ai_dashboard_snapshots_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ai_dashboard_schedule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_dashboard_schedule_versions" ADD CONSTRAINT "ai_dashboard_schedule_versions_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_dashboard_schedule_runs" ADD CONSTRAINT "ai_dashboard_schedule_runs_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ai_dashboard_schedule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_dashboard_schedule_runs" ADD CONSTRAINT "ai_dashboard_schedule_runs_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ai_dashboard_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_library_versions" ADD CONSTRAINT "ai_risk_library_versions_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ai_risk_library_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_library_publications" ADD CONSTRAINT "ai_risk_library_publications_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ai_risk_library_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additive immutable governance ledgers; shared cases/assets remain owned by DGOP.
CREATE FUNCTION ai_reporting_library_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI reporting/library history is append-only'; END; $$;
CREATE TRIGGER "ai_dashboard_snapshots_immutable" BEFORE UPDATE OR DELETE ON "ai_dashboard_snapshots" FOR EACH ROW EXECUTE FUNCTION ai_reporting_library_append_only();
CREATE TRIGGER "ai_dashboard_schedule_versions_immutable" BEFORE UPDATE OR DELETE ON "ai_dashboard_schedule_versions" FOR EACH ROW EXECUTE FUNCTION ai_reporting_library_append_only();
CREATE TRIGGER "ai_dashboard_schedule_runs_immutable" BEFORE UPDATE OR DELETE ON "ai_dashboard_schedule_runs" FOR EACH ROW EXECUTE FUNCTION ai_reporting_library_append_only();
CREATE TRIGGER "ai_risk_library_entries_immutable" BEFORE UPDATE OR DELETE ON "ai_risk_library_entries" FOR EACH ROW EXECUTE FUNCTION ai_reporting_library_append_only();
CREATE TRIGGER "ai_risk_library_versions_immutable" BEFORE UPDATE OR DELETE ON "ai_risk_library_versions" FOR EACH ROW EXECUTE FUNCTION ai_reporting_library_append_only();
CREATE TRIGGER "ai_risk_library_publications_immutable" BEFORE UPDATE OR DELETE ON "ai_risk_library_publications" FOR EACH ROW EXECUTE FUNCTION ai_reporting_library_append_only();

ALTER TABLE ai_dashboard_snapshots ADD CONSTRAINT ai_dashboard_snapshot_valid CHECK (
 frequency IN ('manual','daily','monthly') AND digest ~ '^[0-9a-f]{64}$' AND jsonb_typeof(projection)='object' AND jsonb_typeof("sourceMembers")='object'
 AND (frequency='manual' OR frequency='daily' AND "periodKey" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR frequency='monthly' AND "periodKey" ~ '^[0-9]{4}-[0-9]{2}$'));
ALTER TABLE ai_dashboard_schedule_versions ADD CONSTRAINT ai_dashboard_schedule_valid CHECK(round>0 AND length(trim(justification))>0 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);
ALTER TABLE ai_dashboard_schedule_runs ADD CONSTRAINT ai_dashboard_run_valid CHECK(attempt BETWEEN 1 AND 3 AND frequency IN ('daily','monthly') AND
 (status='success' AND "snapshotId" IS NOT NULL AND "errorCode" IS NULL OR status='failed' AND "snapshotId" IS NULL AND "errorCode" IS NOT NULL));
ALTER TABLE ai_risk_library_entries ADD CONSTRAINT ai_library_ref_valid CHECK("libraryRef" ~ '^AIRL-[0-9]{3,}$');
ALTER TABLE ai_risk_library_versions ADD CONSTRAINT ai_library_version_valid CHECK(round>0 AND digest ~ '^[0-9a-f]{64}$' AND jsonb_typeof(content)='object' AND jsonb_typeof("referencePins")='object' AND length(trim(justification))>0 AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);
ALTER TABLE ai_risk_library_publications ADD CONSTRAINT ai_library_publication_valid CHECK(length(trim(justification))>0 AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);
CREATE FUNCTION ai_library_risk_provenance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW."libraryVersionId" IS DISTINCT FROM OLD."libraryVersionId" OR NEW."initiationKey" IS DISTINCT FROM OLD."initiationKey") THEN
  RAISE EXCEPTION 'AI library/creation provenance is immutable';
 END IF;
 IF TG_OP='INSERT' AND NEW."libraryVersionId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_risk_library_publications p WHERE p."versionId"=NEW."libraryVersionId") THEN
  RAISE EXCEPTION 'AI risk library source must be published';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ai_risk_library_source_guard BEFORE INSERT OR UPDATE ON ai_risks FOR EACH ROW EXECUTE FUNCTION ai_library_risk_provenance_guard();
CREATE FUNCTION ai_dashboard_schedule_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."scheduleVersionId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_dashboard_schedule_versions s WHERE s.id=NEW."scheduleVersionId" AND s."organizationUnitId"=NEW."organizationUnitId") THEN RAISE EXCEPTION 'Dashboard snapshot schedule must belong to this organization'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ai_dashboard_schedule_source BEFORE INSERT ON ai_dashboard_snapshots FOR EACH ROW EXECUTE FUNCTION ai_dashboard_schedule_source_guard();
