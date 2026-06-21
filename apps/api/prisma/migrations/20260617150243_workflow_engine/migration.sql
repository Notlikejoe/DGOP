-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('draft', 'pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('draft', 'submitted', 'under_review', 'awaiting_information', 'decision_made', 'approved', 'rejected', 'implemented', 'closed');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskDecision" AS ENUM ('approved', 'rejected');

-- AlterTable
ALTER TABLE "stewardship_assignments" ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'approved',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- CreateTable
CREATE TABLE "workflow_cases" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'general',
    "status" "CaseStatus" NOT NULL DEFAULT 'draft',
    "assetId" TEXT,
    "assignmentId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_tasks" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'review',
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "assigneeUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "decision" "TaskDecision",
    "decisionComment" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_events" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "taskId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_cases_code_key" ON "workflow_cases"("code");

-- CreateIndex
CREATE INDEX "workflow_cases_status_idx" ON "workflow_cases"("status");

-- CreateIndex
CREATE INDEX "workflow_cases_type_idx" ON "workflow_cases"("type");

-- CreateIndex
CREATE INDEX "workflow_cases_assetId_idx" ON "workflow_cases"("assetId");

-- CreateIndex
CREATE INDEX "workflow_tasks_caseId_idx" ON "workflow_tasks"("caseId");

-- CreateIndex
CREATE INDEX "workflow_tasks_assigneeUserId_idx" ON "workflow_tasks"("assigneeUserId");

-- CreateIndex
CREATE INDEX "workflow_tasks_status_idx" ON "workflow_tasks"("status");

-- CreateIndex
CREATE INDEX "workflow_events_caseId_idx" ON "workflow_events"("caseId");

-- AddForeignKey
ALTER TABLE "workflow_cases" ADD CONSTRAINT "workflow_cases_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_cases" ADD CONSTRAINT "workflow_cases_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "stewardship_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "workflow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "workflow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
