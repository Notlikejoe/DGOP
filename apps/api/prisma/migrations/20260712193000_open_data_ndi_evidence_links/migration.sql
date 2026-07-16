ALTER TABLE "open_data_assessments"
ADD COLUMN "evidenceId" TEXT;

ALTER TABLE "open_data_publications"
ADD COLUMN "evidenceId" TEXT;

CREATE INDEX "open_data_assessments_evidenceId_idx"
ON "open_data_assessments"("evidenceId");

CREATE INDEX "open_data_publications_evidenceId_idx"
ON "open_data_publications"("evidenceId");

ALTER TABLE "open_data_assessments"
ADD CONSTRAINT "open_data_assessments_evidenceId_fkey"
FOREIGN KEY ("evidenceId") REFERENCES "ndi_evidence"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "open_data_publications"
ADD CONSTRAINT "open_data_publications_evidenceId_fkey"
FOREIGN KEY ("evidenceId") REFERENCES "ndi_evidence"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
