-- Guard the enterprise ownership rule at the database layer for open-ended assignments:
-- one active approved primary per target and responsibility. Date-window overlap
-- remains enforced in the service because PostgreSQL partial unique indexes cannot
-- compare dynamic date ranges without a heavier exclusion constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "stewardship_assignments_one_open_approved_primary_idx"
ON "stewardship_assignments"("targetType", "targetId", "roleTypeId")
WHERE "isPrimary" = true
  AND "isActive" = true
  AND "approvalStatus" = 'approved'
  AND "deletedAt" IS NULL
  AND "expiryDate" IS NULL;
