-- Workflow template/routing engine.
-- Keeps existing workflow cases/tasks intact while adding reusable route maps.

CREATE TABLE "workflow_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "domainId" TEXT,
    "defaultSlaDays" INTEGER NOT NULL DEFAULT 5,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_template_stages" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'review',
    "taskType" TEXT NOT NULL DEFAULT 'review',
    "assigneeRoleCode" TEXT,
    "dueDays" INTEGER NOT NULL DEFAULT 2,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isStart" BOOLEAN NOT NULL DEFAULT false,
    "isDecision" BOOLEAN NOT NULL DEFAULT false,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workflow_template_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_template_transitions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fromStageId" TEXT NOT NULL,
    "toStageId" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "decision" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isHappyPath" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workflow_template_transitions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workflow_cases" ADD COLUMN "templateId" TEXT;

CREATE UNIQUE INDEX "workflow_templates_code_key" ON "workflow_templates"("code");
CREATE INDEX "workflow_templates_caseType_idx" ON "workflow_templates"("caseType");
CREATE INDEX "workflow_templates_domainId_idx" ON "workflow_templates"("domainId");
CREATE INDEX "workflow_templates_isActive_idx" ON "workflow_templates"("isActive");

CREATE UNIQUE INDEX "workflow_template_stages_templateId_code_key" ON "workflow_template_stages"("templateId", "code");
CREATE INDEX "workflow_template_stages_templateId_idx" ON "workflow_template_stages"("templateId");
CREATE INDEX "workflow_template_stages_sortOrder_idx" ON "workflow_template_stages"("sortOrder");

CREATE INDEX "workflow_template_transitions_templateId_idx" ON "workflow_template_transitions"("templateId");
CREATE INDEX "workflow_template_transitions_fromStageId_idx" ON "workflow_template_transitions"("fromStageId");
CREATE INDEX "workflow_template_transitions_toStageId_idx" ON "workflow_template_transitions"("toStageId");

CREATE INDEX "workflow_cases_templateId_idx" ON "workflow_cases"("templateId");

ALTER TABLE "workflow_templates"
  ADD CONSTRAINT "workflow_templates_domainId_fkey"
  FOREIGN KEY ("domainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workflow_template_stages"
  ADD CONSTRAINT "workflow_template_stages_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_template_transitions"
  ADD CONSTRAINT "workflow_template_transitions_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_template_transitions"
  ADD CONSTRAINT "workflow_template_transitions_fromStageId_fkey"
  FOREIGN KEY ("fromStageId") REFERENCES "workflow_template_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_template_transitions"
  ADD CONSTRAINT "workflow_template_transitions_toStageId_fkey"
  FOREIGN KEY ("toStageId") REFERENCES "workflow_template_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_cases"
  ADD CONSTRAINT "workflow_cases_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
