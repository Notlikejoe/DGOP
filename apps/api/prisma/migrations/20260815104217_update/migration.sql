-- DropIndex
DROP INDEX "workflow_template_stages_assignmentStrategy_idx";

-- DropIndex
DROP INDEX "workflow_template_stages_nodeType_idx";

-- DropIndex
DROP INDEX "workflow_template_transitions_connector_type_idx";

-- DropIndex
DROP INDEX "workflow_template_transitions_default_path_idx";

-- AlterTable
ALTER TABLE "access_grants" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "access_permission_catalog" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "access_permission_profiles" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "data_asset_subtypes" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "data_asset_types" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workflow_variable_definitions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "data_sharing_requests_workflowCaseId_idx" ON "data_sharing_requests"("workflowCaseId");

-- CreateIndex
CREATE INDEX "data_sharing_reviews_requestId_idx" ON "data_sharing_reviews"("requestId");

-- CreateIndex
CREATE INDEX "foi_appeals_workflowCaseId_idx" ON "foi_appeals"("workflowCaseId");

-- CreateIndex
CREATE INDEX "foi_requests_workflowCaseId_idx" ON "foi_requests"("workflowCaseId");

-- CreateIndex
CREATE INDEX "privacy_breaches_workflowCaseId_idx" ON "privacy_breaches"("workflowCaseId");

-- CreateIndex
CREATE INDEX "privacy_dpias_workflowCaseId_idx" ON "privacy_dpias"("workflowCaseId");

-- CreateIndex
CREATE INDEX "privacy_dsr_requests_workflowCaseId_idx" ON "privacy_dsr_requests"("workflowCaseId");

-- CreateIndex
CREATE INDEX "privacy_gates_dpiaId_idx" ON "privacy_gates"("dpiaId");

-- RenameIndex
ALTER INDEX "governance_maturity_assessment_dimensions_assessmentId_dimensio" RENAME TO "governance_maturity_assessment_dimensions_assessmentId_dime_key";

-- RenameIndex
ALTER INDEX "workflow_delegations_delegatorUserId_delegateUserId_roleCode_as" RENAME TO "workflow_delegations_delegatorUserId_delegateUserId_roleCod_key";

-- RenameIndex
ALTER INDEX "workflow_tasks_assignee_role_code_idx" RENAME TO "workflow_tasks_assigneeRoleCode_idx";

-- RenameIndex
ALTER INDEX "workflow_tasks_assignee_role_status_due_idx" RENAME TO "workflow_tasks_assigneeRoleCode_status_dueDate_idx";
