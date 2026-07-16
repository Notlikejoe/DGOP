ALTER TABLE "workflow_tasks" ADD COLUMN "templateStageId" TEXT;

CREATE INDEX "workflow_tasks_templateStageId_idx" ON "workflow_tasks"("templateStageId");

ALTER TABLE "workflow_tasks"
  ADD CONSTRAINT "workflow_tasks_templateStageId_fkey"
  FOREIGN KEY ("templateStageId") REFERENCES "workflow_template_stages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
