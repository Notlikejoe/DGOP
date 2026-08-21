ALTER TABLE "workflow_cases"
ADD COLUMN "templateVersion" INTEGER;

UPDATE "workflow_cases" AS workflow_case
SET "templateVersion" = COALESCE(template."designerVersion", 1)
FROM "workflow_templates" AS template
WHERE workflow_case."templateId" = template."id";

UPDATE "workflow_cases"
SET "templateVersion" = 1
WHERE "templateVersion" IS NULL;

ALTER TABLE "workflow_cases"
ALTER COLUMN "templateVersion" SET DEFAULT 1,
ALTER COLUMN "templateVersion" SET NOT NULL;

CREATE INDEX "workflow_cases_templateId_templateVersion_idx"
ON "workflow_cases"("templateId", "templateVersion");
