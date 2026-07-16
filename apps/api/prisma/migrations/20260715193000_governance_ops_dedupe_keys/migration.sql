ALTER TABLE "governance_notifications" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "governance_escalations" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "governance_notifications_dedupeKey_key" ON "governance_notifications"("dedupeKey");
CREATE UNIQUE INDEX "governance_escalations_dedupeKey_key" ON "governance_escalations"("dedupeKey");
