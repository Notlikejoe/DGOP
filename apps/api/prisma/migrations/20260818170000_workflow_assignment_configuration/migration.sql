ALTER TABLE "workflow_template_stages"
ADD COLUMN "assignmentConfigJson" JSONB;

COMMENT ON COLUMN "workflow_template_stages"."assignmentConfigJson" IS
'Governed assignment configuration for direct-user, requester, manager, workflow-owner, workload, backup, and dynamic workflow assignment strategies.';
