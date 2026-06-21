-- CreateEnum
CREATE TYPE "AssignmentTargetType" AS ENUM ('asset', 'domain', 'capability', 'subject', 'org_unit', 'system');

-- AlterTable
ALTER TABLE "people" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "stewardship_assignments" (
    "id" TEXT NOT NULL,
    "targetType" "AssignmentTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "roleTypeId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "justification" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stewardship_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_rules" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "scopeType" "AssignmentTargetType" NOT NULL,
    "refId" TEXT NOT NULL,
    "roleTypeId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stewardship_assignments_targetType_targetId_idx" ON "stewardship_assignments"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "stewardship_assignments_roleTypeId_idx" ON "stewardship_assignments"("roleTypeId");

-- CreateIndex
CREATE INDEX "stewardship_assignments_personId_idx" ON "stewardship_assignments"("personId");

-- CreateIndex
CREATE INDEX "assignment_rules_scopeType_refId_idx" ON "assignment_rules"("scopeType", "refId");

-- CreateIndex
CREATE INDEX "assignment_rules_roleTypeId_idx" ON "assignment_rules"("roleTypeId");

-- AddForeignKey
ALTER TABLE "stewardship_assignments" ADD CONSTRAINT "stewardship_assignments_roleTypeId_fkey" FOREIGN KEY ("roleTypeId") REFERENCES "role_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stewardship_assignments" ADD CONSTRAINT "stewardship_assignments_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_roleTypeId_fkey" FOREIGN KEY ("roleTypeId") REFERENCES "role_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
