-- CreateTable
CREATE TABLE "ai_risk_reassessments" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "previousAcceptanceDecisionId" TEXT NOT NULL,
    "coordinatorTaskId" TEXT NOT NULL,
    "sourceIntakeTaskId" TEXT NOT NULL,
    "inherentRound" INTEGER NOT NULL,
    "triggerCode" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "clientIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_risk_reassessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_risk_review_cancellations" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reassessmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_risk_review_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_reassessments_previousAcceptanceDecisionId_key" ON "ai_risk_reassessments"("previousAcceptanceDecisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_reassessments_coordinatorTaskId_key" ON "ai_risk_reassessments"("coordinatorTaskId");

-- CreateIndex
CREATE INDEX "ai_risk_reassessments_riskId_inherentRound_idx" ON "ai_risk_reassessments"("riskId", "inherentRound");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_review_cancellations_reviewId_key" ON "ai_risk_review_cancellations"("reviewId");

-- AddForeignKey
ALTER TABLE "ai_risk_reassessments" ADD CONSTRAINT "ai_risk_reassessments_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "ai_risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_reassessments" ADD CONSTRAINT "ai_risk_reassessments_previousAcceptanceDecisionId_fkey" FOREIGN KEY ("previousAcceptanceDecisionId") REFERENCES "ai_risk_assessment_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_reassessments" ADD CONSTRAINT "ai_risk_reassessments_coordinatorTaskId_fkey" FOREIGN KEY ("coordinatorTaskId") REFERENCES "workflow_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_review_cancellations" ADD CONSTRAINT "ai_risk_review_cancellations_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ai_risk_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_review_cancellations" ADD CONSTRAINT "ai_risk_review_cancellations_reassessmentId_fkey" FOREIGN KEY ("reassessmentId") REFERENCES "ai_risk_reassessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE ai_risk_reassessments ADD CONSTRAINT ai_reassessment_shape CHECK ("inherentRound">0 AND "triggerCode" IN ('material_change','provider_change','data_change','incident','nonconformity','regulatory_change','detected_deviation') AND length(btrim(justification)) BETWEEN 1 AND 5000 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);
CREATE TRIGGER ai_reassessment_immutable BEFORE UPDATE OR DELETE ON ai_risk_reassessments FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
CREATE TRIGGER ai_review_cancellation_immutable BEFORE UPDATE OR DELETE ON ai_risk_review_cancellations FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
CREATE FUNCTION ai_reassessment_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_risks r JOIN workflow_cases wc ON wc.id=r."workflowCaseId" JOIN ai_risk_assessment_decisions d ON d.id=NEW."previousAcceptanceDecisionId" JOIN ai_assessment_rounds a ON a.id=d."assessmentId" JOIN workflow_tasks t ON t.id=NEW."coordinatorTaskId" JOIN workflow_template_stages s ON s.id=t."templateStageId" JOIN workflow_tasks i ON i.id=NEW."sourceIntakeTaskId" JOIN workflow_template_stages si ON si.id=i."templateStageId" JOIN people p ON p.id=r."ownerPersonId"
 WHERE r.id=NEW."riskId" AND a."riskId"=r.id AND a.kind='residual' AND wc.status IN ('implemented','decision_made') AND a.round=(SELECT max(round) FROM ai_assessment_rounds WHERE "riskId"=r.id AND kind='residual') AND NOT EXISTS(SELECT 1 FROM ai_risk_assessment_decisions rd WHERE rd."assessmentId"=a.id AND rd.decision='return') AND ((d.kind IN ('accept_owner','countersign','executive') AND d.decision='accept') OR (d.kind='steering' AND d.decision IN ('restrict','stop')))
 AND t."caseId"=wc.id AND t.status='pending' AND s.code='airs-inherent-assessment' AND s."templateId"=wc."templateId" AND s."isActive" AND t."assigneeRoleCode"='AI_RISK_OWNER' AND t."assigneeUserId"=p."userId" AND p."isActive" AND p."deletedAt" IS NULL
 AND i."caseId"=wc.id AND i.status='completed' AND si.code='airs-identification' AND i."formDataJson"->'submittedIntake'=r."intakeData" AND t."formDataJson"->>'sourceIntakeTaskId'=i.id
 AND NEW."inherentRound"=(SELECT coalesce(max(round),0)+1 FROM ai_assessment_rounds WHERE "riskId"=r.id AND kind='inherent')) THEN RAISE EXCEPTION 'AI reassessment requires current authority, original intake and fresh owner coordinator'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence n WHERE n.id=e AND n."deletedAt" IS NULL)) THEN RAISE EXCEPTION 'AI reassessment evidence must exist'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_reassessment_parent BEFORE INSERT ON ai_risk_reassessments FOR EACH ROW EXECUTE FUNCTION ai_reassessment_parent_guard();
CREATE FUNCTION ai_review_cancellation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN ai_risk_reassessments a ON a.id=NEW."reassessmentId" JOIN workflow_tasks t ON t.id=r."taskId" WHERE r.id=NEW."reviewId" AND r."riskId"=a."riskId" AND r."acceptanceDecisionId"=a."previousAcceptanceDecisionId" AND t.status='pending' AND NOT EXISTS(SELECT 1 FROM ai_risk_review_completions c WHERE c."reviewId"=r.id)) THEN RAISE EXCEPTION 'AI review cancellation requires a matching fresh reassessment and pending source'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_review_cancellation_parent BEFORE INSERT ON ai_risk_review_cancellations FOR EACH ROW EXECUTE FUNCTION ai_review_cancellation_guard();

CREATE OR REPLACE FUNCTION ai_review_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_anchor timestamp; immediate boolean; previous_decision text;
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
   SELECT p."acceptanceDecisionId" INTO previous_decision FROM ai_risk_reviews p WHERE p."riskId"=NEW."riskId" AND p.round=NEW.round-1;
   IF previous_decision=NEW."acceptanceDecisionId" THEN
   SELECT c."completedAt" INTO expected_anchor FROM ai_risk_reviews p JOIN ai_risk_review_completions c ON c."reviewId"=p.id WHERE p."riskId"=NEW."riskId" AND p.round=NEW.round-1 AND p."acceptanceDecisionId"=NEW."acceptanceDecisionId" AND p."calendarTemplateId"=NEW."calendarTemplateId";
   ELSE
     SELECT d."createdAt" INTO expected_anchor FROM ai_risk_reviews p JOIN ai_risk_review_cancellations x ON x."reviewId"=p.id JOIN ai_risk_reassessments ra ON ra.id=x."reassessmentId" JOIN ai_risk_assessment_decisions d ON d.id=NEW."acceptanceDecisionId" JOIN ai_assessment_rounds a ON a.id=d."assessmentId" JOIN ai_assessment_rounds i ON i.id=a.inputs->>'inherentAssessmentId'
      WHERE p."riskId"=NEW."riskId" AND p.round=NEW.round-1 AND p."calendarTemplateId"=NEW."calendarTemplateId" AND ra."previousAcceptanceDecisionId"=previous_decision AND ra."riskId"=p."riskId" AND i."riskId"=p."riskId" AND i.kind='inherent' AND i.round>=ra."inherentRound";
   END IF;
 END IF;
 immediate=(NEW.round=1 OR previous_decision IS DISTINCT FROM NEW."acceptanceDecisionId") AND NEW."bandCode"='CRITICAL';
 IF expected_anchor IS NULL OR NEW."anchorAt"<>expected_anchor OR NEW."dueAt"<>(CASE WHEN immediate THEN expected_anchor ELSE date_trunc('day',expected_anchor+interval '3 hours')+(NEW."intervalDays"+1)*interval '1 day'-interval '3 hours'-interval '1 millisecond' END) THEN RAISE EXCEPTION 'AI review engine anchor/deadline mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION ai_review_native_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN ai_risks ar ON ar.id=r."riskId" JOIN workflow_tasks t ON t.id=r."taskId" JOIN workflow_template_stages s ON s.id=t."templateStageId" JOIN workflow_cases wc ON wc.id=t."caseId" JOIN compliance_calendar_occurrences o ON o.id=r."calendarOccurrenceId" LEFT JOIN ai_risk_review_completions c ON c."reviewId"=r.id LEFT JOIN ai_risk_review_cancellations x ON x."reviewId"=r.id
 WHERE (t.id=NEW.id OR o.id=NEW.id) AND (t."caseId"<>ar."workflowCaseId" OR s.code<>'airs-periodic-review' OR s."templateId"<>wc."templateId" OR t."dueDate" IS DISTINCT FROM r."dueAt" OR t."caseId" IS DISTINCT FROM o."workflowCaseId" OR t."assigneeUserId" IS DISTINCT FROM r."assignedOwnerId" OR t."assigneeRoleCode"<>'AI_RISK_OWNER' OR t."formDataJson"->>'reviewId' IS DISTINCT FROM r.id OR o."dueAt"<>r."dueAt" OR o."templateId"<>r."calendarTemplateId" OR
 (c.id IS NULL AND x.id IS NULL AND (t.status<>'pending' OR o.status<>'active' OR t."completedAt" IS NOT NULL OR o."completedAt" IS NOT NULL)) OR
 (x.id IS NOT NULL AND (t.status<>'cancelled' OR o.status<>'archived' OR t."completedAt" IS DISTINCT FROM x."createdAt" OR o."completedAt" IS NOT NULL)) OR
 (c.id IS NOT NULL AND (t.status<>'completed' OR o.status<>'completed' OR t."completedAt" IS DISTINCT FROM c."completedAt" OR o."completedAt" IS DISTINCT FROM c."completedAt")))) THEN RAISE EXCEPTION 'AI review native task/calendar history is protected'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION ai_review_template_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN compliance_calendar_templates t ON t.id=r."calendarTemplateId" WHERE t.id=NEW.id AND
 (t.type::text<>'ai_risk_review' OR t.cadence<>'governed_days' OR t."ownerRoleCode"<>'AI_RISK_OWNER' OR t."defaultSlaBusinessDays"<>0)) THEN RAISE EXCEPTION 'AI review calendar configuration is protected'; END IF;
 IF EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN compliance_calendar_templates t ON t.id=r."calendarTemplateId" LEFT JOIN ai_risk_review_completions c ON c."reviewId"=r.id LEFT JOIN ai_risk_review_cancellations x ON x."reviewId"=r.id
 WHERE t.id=NEW.id AND c.id IS NULL AND x.id IS NULL AND (t.status<>'active' OR t."nextRunAt"<>r."dueAt" OR t."lastRunAt" IS DISTINCT FROM r."anchorAt")) THEN RAISE EXCEPTION 'AI review calendar engine dates are protected'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION ai_review_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN ai_risks ar ON ar.id=r."riskId" JOIN people p ON p.id=ar."ownerPersonId" JOIN workflow_tasks t ON t.id=r."taskId"
 WHERE r.id=NEW."reviewId" AND r."assignedOwnerId"=NEW."actorId" AND p."userId"=NEW."actorId" AND p."isActive" AND p."deletedAt" IS NULL AND t.status='pending' AND NOT EXISTS(SELECT 1 FROM ai_risk_review_cancellations x WHERE x."reviewId"=r.id) AND t."dueDate"=r."dueAt" AND t."assigneeUserId"=NEW."actorId") THEN RAISE EXCEPTION 'AI review completion requires the active actual owner and pending original task'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence n WHERE n.id=e AND n."deletedAt" IS NULL)) THEN RAISE EXCEPTION 'AI review evidence must exist'; END IF;
 RETURN NEW;
END $$;
