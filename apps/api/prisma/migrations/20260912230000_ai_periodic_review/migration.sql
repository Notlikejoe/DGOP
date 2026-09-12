-- AlterEnum
ALTER TYPE "ComplianceCalendarType" ADD VALUE 'ai_risk_review';

-- CreateTable
CREATE TABLE "ai_risk_reviews" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "acceptanceDecisionId" TEXT NOT NULL,
    "referenceVersionId" TEXT NOT NULL,
    "calendarTemplateId" TEXT NOT NULL,
    "calendarOccurrenceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "bandCode" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "cadenceLabelEn" TEXT NOT NULL,
    "cadenceLabelAr" TEXT NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assignedOwnerId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_risk_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_risk_review_completions" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "clientIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_risk_review_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_risk_review_signals" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "notificationIds" JSONB NOT NULL,
    "escalationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_risk_review_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_reviews_calendarOccurrenceId_key" ON "ai_risk_reviews"("calendarOccurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_reviews_taskId_key" ON "ai_risk_reviews"("taskId");

-- CreateIndex
CREATE INDEX "ai_risk_reviews_dueAt_idx" ON "ai_risk_reviews"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_reviews_riskId_round_key" ON "ai_risk_reviews"("riskId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_review_completions_reviewId_key" ON "ai_risk_review_completions"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_review_signals_reviewId_threshold_key" ON "ai_risk_review_signals"("reviewId", "threshold");

-- AddForeignKey
ALTER TABLE "ai_risk_reviews" ADD CONSTRAINT "ai_risk_reviews_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "ai_risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_reviews" ADD CONSTRAINT "ai_risk_reviews_acceptanceDecisionId_fkey" FOREIGN KEY ("acceptanceDecisionId") REFERENCES "ai_risk_assessment_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_reviews" ADD CONSTRAINT "ai_risk_reviews_referenceVersionId_fkey" FOREIGN KEY ("referenceVersionId") REFERENCES "governed_reference_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_reviews" ADD CONSTRAINT "ai_risk_reviews_calendarTemplateId_fkey" FOREIGN KEY ("calendarTemplateId") REFERENCES "compliance_calendar_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_reviews" ADD CONSTRAINT "ai_risk_reviews_calendarOccurrenceId_fkey" FOREIGN KEY ("calendarOccurrenceId") REFERENCES "compliance_calendar_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_reviews" ADD CONSTRAINT "ai_risk_reviews_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_review_completions" ADD CONSTRAINT "ai_risk_review_completions_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ai_risk_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_review_signals" ADD CONSTRAINT "ai_risk_review_signals_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ai_risk_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Combined Phase 3H/3I: immutable basis/completion/signal ledgers.
ALTER TABLE ai_risk_reviews ADD CONSTRAINT ai_review_shape CHECK
 (round>0 AND "intervalDays" BETWEEN 1 AND 3660 AND "bandCode" IN ('LOW','MEDIUM','HIGH','CRITICAL') AND "dueAt">="anchorAt");
ALTER TABLE ai_risk_review_completions ADD CONSTRAINT ai_review_completion_shape CHECK
 (length(btrim(justification)) BETWEEN 1 AND 5000 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20 AND "completedAt"<=CURRENT_TIMESTAMP);
ALTER TABLE ai_risk_review_signals ADD CONSTRAINT ai_review_signal_shape CHECK
 (threshold IN (50,80,95,100) AND jsonb_typeof("notificationIds")='array' AND jsonb_array_length("notificationIds")>0 AND (threshold=100)=("escalationId" IS NOT NULL));

CREATE FUNCTION ai_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI review ledgers are append-only'; END $$;
CREATE TRIGGER ai_review_immutable BEFORE UPDATE OR DELETE ON ai_risk_reviews FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
CREATE TRIGGER ai_review_completion_immutable BEFORE UPDATE OR DELETE ON ai_risk_review_completions FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
CREATE TRIGGER ai_review_signal_immutable BEFORE UPDATE OR DELETE ON ai_risk_review_signals FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();

CREATE FUNCTION ai_review_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_anchor timestamp; immediate boolean;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM ai_risks r JOIN ai_risk_assessment_decisions d ON d.id=NEW."acceptanceDecisionId"
 JOIN ai_assessment_rounds a ON a.id=d."assessmentId" JOIN workflow_tasks t ON t.id=NEW."taskId"
 JOIN workflow_template_stages s ON s.id=t."templateStageId" JOIN workflow_templates wt ON wt.id=s."templateId"
 JOIN compliance_calendar_occurrences o ON o.id=NEW."calendarOccurrenceId"
 JOIN compliance_calendar_templates ct ON ct.id=NEW."calendarTemplateId"
 JOIN governed_reference_versions v ON v.id=NEW."referenceVersionId"
 JOIN governed_reference_values cv ON cv."versionId"=v.id AND cv.code=NEW."bandCode"
 JOIN people p ON p.id=r."ownerPersonId" JOIN users u ON u.id=p."userId"
 WHERE r.id=NEW."riskId" AND a."riskId"=r.id AND a.kind='residual' AND a.result->>'bandCode'=NEW."bandCode"
 AND NOT EXISTS(SELECT 1 FROM ai_risk_assessment_decisions rd WHERE rd."assessmentId"=a.id AND rd.decision='return')
 AND ((NEW."bandCode"='LOW' AND d.kind='accept_owner' AND d.decision='accept') OR
 (NEW."bandCode"='MEDIUM' AND d.kind='countersign' AND d.decision='accept') OR
 (NEW."bandCode"='HIGH' AND d.kind='executive' AND d.decision='accept') OR
 (NEW."bandCode"='CRITICAL' AND d.kind='steering' AND d.decision IN ('restrict','stop')))
 AND t."caseId"=r."workflowCaseId" AND t.status='pending' AND s.code='airs-periodic-review' AND s."isActive" AND wt.code='AIRS_LIFECYCLE_V1' AND wt."isActive"
 AND t."assigneeUserId"=NEW."assignedOwnerId" AND t."assigneeRoleCode"='AI_RISK_OWNER' AND t."dueDate"=NEW."dueAt" AND t."formDataJson"->>'reviewId'=NEW.id
 AND p."userId"=NEW."assignedOwnerId" AND p."isActive" AND p."deletedAt" IS NULL AND u."isActive"
 AND o."templateId"=ct.id AND o."workflowCaseId"=r."workflowCaseId" AND o."dueAt"=NEW."dueAt" AND o.status='active'
 AND ct.type::text='ai_risk_review' AND ct.cadence='governed_days' AND ct."ownerRoleCode"='AI_RISK_OWNER'
 AND v."listCode"='R_LEVEL_DAYS' AND v.state='published' AND v."effectiveFrom"<=CURRENT_TIMESTAMP AND (v."effectiveTo" IS NULL OR v."effectiveTo">CURRENT_TIMESTAMP)
 AND (cv.metadata->>'intervalDays')::int=NEW."intervalDays" AND cv."labelEn"=NEW."cadenceLabelEn" AND cv."labelAr"=NEW."cadenceLabelAr"
 AND (cv.metadata->>'firstReviewImmediate')::boolean=(NEW."bandCode"='CRITICAL')) THEN RAISE EXCEPTION 'AI review parent/cadence/task mismatch'; END IF;
 IF NEW.round=1 THEN
   SELECT "createdAt" INTO expected_anchor FROM ai_risk_assessment_decisions WHERE id=NEW."acceptanceDecisionId";
 ELSE
   SELECT c."completedAt" INTO expected_anchor FROM ai_risk_reviews p JOIN ai_risk_review_completions c ON c."reviewId"=p.id WHERE p."riskId"=NEW."riskId" AND p.round=NEW.round-1 AND p."acceptanceDecisionId"=NEW."acceptanceDecisionId" AND p."calendarTemplateId"=NEW."calendarTemplateId";
 END IF;
 immediate=NEW.round=1 AND NEW."bandCode"='CRITICAL';
 IF expected_anchor IS NULL OR NEW."anchorAt"<>expected_anchor OR NEW."dueAt"<>(CASE WHEN immediate THEN expected_anchor ELSE date_trunc('day',expected_anchor+interval '3 hours')+(NEW."intervalDays"+1)*interval '1 day'-interval '3 hours'-interval '1 millisecond' END) THEN RAISE EXCEPTION 'AI review engine anchor/deadline mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_review_parent BEFORE INSERT ON ai_risk_reviews FOR EACH ROW EXECUTE FUNCTION ai_review_parent_guard();

CREATE FUNCTION ai_review_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN ai_risks ar ON ar.id=r."riskId" JOIN people p ON p.id=ar."ownerPersonId" JOIN workflow_tasks t ON t.id=r."taskId"
 WHERE r.id=NEW."reviewId" AND r."assignedOwnerId"=NEW."actorId" AND p."userId"=NEW."actorId" AND p."isActive" AND p."deletedAt" IS NULL AND t.status='pending' AND t."dueDate"=r."dueAt" AND t."assigneeUserId"=NEW."actorId") THEN RAISE EXCEPTION 'AI review completion requires the active actual owner and pending original task'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence n WHERE n.id=e AND n."deletedAt" IS NULL)) THEN RAISE EXCEPTION 'AI review evidence must exist'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_review_completion_parent BEFORE INSERT ON ai_risk_review_completions FOR EACH ROW EXECUTE FUNCTION ai_review_completion_guard();

CREATE FUNCTION ai_review_native_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN ai_risks ar ON ar.id=r."riskId" JOIN workflow_tasks t ON t.id=r."taskId" JOIN workflow_template_stages s ON s.id=t."templateStageId" JOIN workflow_cases wc ON wc.id=t."caseId" JOIN compliance_calendar_occurrences o ON o.id=r."calendarOccurrenceId" LEFT JOIN ai_risk_review_completions c ON c."reviewId"=r.id
 WHERE (t.id=NEW.id OR o.id=NEW.id) AND (t."caseId"<>ar."workflowCaseId" OR s.code<>'airs-periodic-review' OR s."templateId"<>wc."templateId" OR t."dueDate" IS DISTINCT FROM r."dueAt" OR t."caseId" IS DISTINCT FROM o."workflowCaseId" OR t."assigneeUserId" IS DISTINCT FROM r."assignedOwnerId" OR t."assigneeRoleCode"<>'AI_RISK_OWNER' OR t."formDataJson"->>'reviewId' IS DISTINCT FROM r.id OR o."dueAt"<>r."dueAt" OR o."templateId"<>r."calendarTemplateId" OR
 (c.id IS NULL AND (t.status<>'pending' OR o.status<>'active' OR t."completedAt" IS NOT NULL OR o."completedAt" IS NOT NULL)) OR
 (c.id IS NOT NULL AND (t.status<>'completed' OR o.status<>'completed' OR t."completedAt" IS DISTINCT FROM c."completedAt" OR o."completedAt" IS DISTINCT FROM c."completedAt")))) THEN RAISE EXCEPTION 'AI review native task/calendar history is protected'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ai_review_native_task AFTER UPDATE ON workflow_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_review_native_guard();
CREATE CONSTRAINT TRIGGER ai_review_native_calendar AFTER UPDATE ON compliance_calendar_occurrences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_review_native_guard();

ALTER TABLE ai_risk_review_signals ADD CONSTRAINT "ai_risk_review_signals_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES governance_escalations(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION ai_review_template_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN compliance_calendar_templates t ON t.id=r."calendarTemplateId" WHERE t.id=NEW.id AND
 (t.type::text<>'ai_risk_review' OR t.cadence<>'governed_days' OR t."ownerRoleCode"<>'AI_RISK_OWNER' OR t.status<>'active' OR t."defaultSlaBusinessDays"<>0)) THEN RAISE EXCEPTION 'AI review calendar configuration is protected'; END IF;
 IF EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN compliance_calendar_templates t ON t.id=r."calendarTemplateId" LEFT JOIN ai_risk_review_completions c ON c."reviewId"=r.id
 WHERE t.id=NEW.id AND c.id IS NULL AND (t."nextRunAt"<>r."dueAt" OR t."lastRunAt" IS DISTINCT FROM r."anchorAt")) THEN RAISE EXCEPTION 'AI review calendar engine dates are protected'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ai_review_native_template AFTER UPDATE ON compliance_calendar_templates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_review_template_guard();

CREATE FUNCTION ai_review_signal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN workflow_tasks t ON t.id=r."taskId" WHERE r.id=NEW."reviewId" AND t.status='pending' AND NOT EXISTS(SELECT 1 FROM ai_risk_review_completions c WHERE c."reviewId"=r.id)) THEN RAISE EXCEPTION 'AI review SLA signals require an open review'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."notificationIds") e WHERE NOT EXISTS(SELECT 1 FROM governance_notifications n JOIN ai_risk_reviews r ON r.id=NEW."reviewId" WHERE n.id=e AND n."sourceType"='ai_risk_review' AND n."sourceId"=r.id AND n."workflowTaskId"=r."taskId")) THEN RAISE EXCEPTION 'AI review notification source mismatch'; END IF;
 IF NEW."escalationId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM governance_escalations e JOIN ai_risk_reviews r ON r.id=NEW."reviewId" WHERE e.id=NEW."escalationId" AND e."sourceType"='ai_risk_review' AND e."sourceId"=r.id AND e."workflowTaskId"=r."taskId") THEN RAISE EXCEPTION 'AI review escalation source mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_review_signal_parent BEFORE INSERT ON ai_risk_review_signals FOR EACH ROW EXECUTE FUNCTION ai_review_signal_guard();
