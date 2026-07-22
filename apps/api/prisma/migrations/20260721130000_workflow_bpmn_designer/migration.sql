ALTER TABLE "workflow_templates"
  ADD COLUMN "bpmnXml" TEXT,
  ADD COLUMN "designerJson" JSONB,
  ADD COLUMN "designerVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastPublishedAt" TIMESTAMP(3),
  ADD COLUMN "lastPublishedBy" TEXT;

CREATE TABLE "workflow_template_versions" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'designer',
  "changeSummary" TEXT,
  "bpmnXml" TEXT NOT NULL,
  "designerJson" JSONB,
  "validationJson" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_template_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_template_versions_templateId_version_key"
  ON "workflow_template_versions"("templateId", "version");

CREATE INDEX "workflow_template_versions_templateId_idx"
  ON "workflow_template_versions"("templateId");

ALTER TABLE "workflow_template_versions"
  ADD CONSTRAINT "workflow_template_versions_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
