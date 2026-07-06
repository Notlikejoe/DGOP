-- Sprint 12: Training and awareness.
CREATE TYPE "TrainingAssignmentStatus" AS ENUM ('assigned', 'in_progress', 'completed', 'expired', 'waived');

CREATE TABLE "training_courses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'governance',
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "validityMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_courses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "training_requirements" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "dueDays" INTEGER NOT NULL DEFAULT 30,
    "validityMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_requirements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "training_assignments" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT,
    "status" "TrainingAssignmentStatus" NOT NULL DEFAULT 'assigned',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "score" INTEGER,
    "evidenceNote" TEXT,
    "assignedBy" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "training_courses_code_key" ON "training_courses"("code");
CREATE INDEX "training_courses_category_idx" ON "training_courses"("category");
CREATE INDEX "training_courses_isActive_idx" ON "training_courses"("isActive");
CREATE UNIQUE INDEX "training_requirements_courseId_roleId_key" ON "training_requirements"("courseId", "roleId");
CREATE INDEX "training_requirements_roleId_idx" ON "training_requirements"("roleId");
CREATE INDEX "training_assignments_userId_status_idx" ON "training_assignments"("userId", "status");
CREATE INDEX "training_assignments_courseId_status_idx" ON "training_assignments"("courseId", "status");
CREATE INDEX "training_assignments_dueDate_idx" ON "training_assignments"("dueDate");
CREATE INDEX "training_assignments_expiresAt_idx" ON "training_assignments"("expiresAt");

ALTER TABLE "training_requirements" ADD CONSTRAINT "training_requirements_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "training_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_requirements" ADD CONSTRAINT "training_requirements_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "training_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sprint 13: Data quality operations.
CREATE TYPE "DataQualityIssueStatus" AS ENUM ('open', 'triaged', 'in_progress', 'resolved', 'closed', 'cancelled');
CREATE TYPE "DataQualitySeverity" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "DataQualityDimension" AS ENUM ('completeness', 'accuracy', 'validity', 'consistency', 'timeliness', 'uniqueness');

CREATE TABLE "data_quality_issues" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "DataQualitySeverity" NOT NULL DEFAULT 'medium',
    "dimension" "DataQualityDimension" NOT NULL DEFAULT 'completeness',
    "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "assetId" TEXT,
    "responsiblePersonId" TEXT,
    "workflowCaseId" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "resolutionSummary" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_quality_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_quality_issue_evidence" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "actor" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_issue_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_quality_issues_code_key" ON "data_quality_issues"("code");
CREATE UNIQUE INDEX "data_quality_issues_workflowCaseId_key" ON "data_quality_issues"("workflowCaseId");
CREATE INDEX "data_quality_issues_assetId_idx" ON "data_quality_issues"("assetId");
CREATE INDEX "data_quality_issues_responsiblePersonId_idx" ON "data_quality_issues"("responsiblePersonId");
CREATE INDEX "data_quality_issues_status_idx" ON "data_quality_issues"("status");
CREATE INDEX "data_quality_issues_severity_idx" ON "data_quality_issues"("severity");
CREATE INDEX "data_quality_issues_dueDate_idx" ON "data_quality_issues"("dueDate");
CREATE INDEX "data_quality_issue_evidence_issueId_idx" ON "data_quality_issue_evidence"("issueId");

ALTER TABLE "data_quality_issues" ADD CONSTRAINT "data_quality_issues_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "data_quality_issues_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "data_quality_issues_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_issue_evidence" ADD CONSTRAINT "data_quality_issue_evidence_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "data_quality_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
