ALTER TABLE "workflow_template_transitions"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "retiredAt" TIMESTAMP(3),
  ADD COLUMN "retiredBy" TEXT;

CREATE INDEX "workflow_template_transitions_isActive_idx"
  ON "workflow_template_transitions"("isActive");
