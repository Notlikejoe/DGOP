-- Persist the responsible role queue on workflow tasks for auditable inbox routing.
ALTER TABLE "workflow_tasks"
ADD COLUMN "assigneeRoleCode" TEXT;

UPDATE "workflow_tasks" AS task
SET "assigneeRoleCode" = stage."assigneeRoleCode"
FROM "workflow_template_stages" AS stage
WHERE task."templateStageId" = stage.id
  AND task."assigneeRoleCode" IS NULL
  AND stage."assigneeRoleCode" IS NOT NULL;

CREATE INDEX "workflow_tasks_assignee_role_code_idx"
ON "workflow_tasks" ("assigneeRoleCode");

CREATE INDEX "workflow_tasks_assignee_role_status_due_idx"
ON "workflow_tasks" ("assigneeRoleCode", "status", "dueDate");
