ALTER TABLE "workflow_template_stages"
  ADD COLUMN "nodeType" TEXT NOT NULL DEFAULT 'user_task',
  ADD COLUMN "assignmentStrategy" TEXT NOT NULL DEFAULT 'role',
  ADD COLUMN "formSchemaJson" JSONB,
  ADD COLUMN "slaConfigJson" JSONB,
  ADD COLUMN "notificationRulesJson" JSONB,
  ADD COLUMN "evidenceRequirementsJson" JSONB,
  ADD COLUMN "automationConfigJson" JSONB,
  ADD COLUMN "gatewayConfigJson" JSONB,
  ADD COLUMN "parallelGroup" TEXT;

ALTER TABLE "workflow_template_transitions"
  ADD COLUMN "conditionExpression" TEXT,
  ADD COLUMN "conditionJson" JSONB;

CREATE INDEX "workflow_template_stages_nodeType_idx"
  ON "workflow_template_stages"("nodeType");

CREATE INDEX "workflow_template_stages_assignmentStrategy_idx"
  ON "workflow_template_stages"("assignmentStrategy");
