-- CreateTable
CREATE TABLE "ai_lifecycle_review_retirements" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_lifecycle_review_retirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_lifecycle_review_retirements_reviewId_key" ON "ai_lifecycle_review_retirements"("reviewId");

-- CreateIndex
CREATE INDEX "ai_lifecycle_review_retirements_requestId_idx" ON "ai_lifecycle_review_retirements"("requestId");

-- AddForeignKey
ALTER TABLE "ai_lifecycle_review_retirements" ADD CONSTRAINT "ai_lifecycle_review_retirements_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ai_risk_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lifecycle_review_retirements" ADD CONSTRAINT "ai_lifecycle_review_retirements_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ai_lifecycle_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Keep original review/cancellation guards. Retirement is a distinct, immutable
-- lifecycle consequence, never a manufactured reassessment or completion.
CREATE TRIGGER ai_lifecycle_retirement_immutable BEFORE UPDATE OR DELETE ON ai_lifecycle_review_retirements FOR EACH ROW EXECUTE FUNCTION dgop_ai_proof_immutable();
CREATE FUNCTION dgop_ai_lifecycle_retirement_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_risk_reviews v JOIN ai_risks k ON k.id=v."riskId" JOIN ai_lifecycle_requests r ON r.id=NEW."requestId" JOIN workflow_tasks t ON t.id=v."taskId" WHERE v.id=NEW."reviewId" AND r."useCaseId"=k."useCaseId" AND r.action='retire' AND r.status='confirmation' AND t.status='pending' AND NOT EXISTS(SELECT 1 FROM ai_risk_review_completions c WHERE c."reviewId"=v.id) AND NOT EXISTS(SELECT 1 FROM ai_risk_review_cancellations c WHERE c."reviewId"=v.id)) THEN RAISE EXCEPTION 'Retirement requires matching pending review and independent lifecycle confirmation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_lifecycle_retirement_parent BEFORE INSERT ON ai_lifecycle_review_retirements FOR EACH ROW EXECUTE FUNCTION dgop_ai_lifecycle_retirement_parent();
CREATE FUNCTION dgop_ai_lifecycle_retirement_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_lifecycle_requests r JOIN ai_use_cases u ON u.id=r."useCaseId" JOIN ai_lifecycle_decisions d ON d."requestId"=r.id WHERE r.id=NEW."requestId" AND r.action='retire' AND r.status='applied' AND u."lifecycleState"='retired' AND d.stage='confirmation' AND d.decision='approve') THEN RAISE EXCEPTION 'Review retirement requires completed independent lifecycle decision'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ai_lifecycle_retirement_commit AFTER INSERT ON ai_lifecycle_review_retirements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dgop_ai_lifecycle_retirement_commit();
CREATE FUNCTION dgop_ai_current_configuration_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."effectiveConfigurationId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_effective_configurations c WHERE c.id=NEW."effectiveConfigurationId" AND c."useCaseId"=NEW.id) THEN RAISE EXCEPTION 'Effective configuration belongs to another AI use case'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_current_configuration_parent BEFORE INSERT OR UPDATE ON ai_use_cases FOR EACH ROW EXECUTE FUNCTION dgop_ai_current_configuration_parent();
CREATE OR REPLACE FUNCTION ai_review_native_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN ai_risks ar ON ar.id=r."riskId" JOIN workflow_tasks t ON t.id=r."taskId" JOIN workflow_template_stages s ON s.id=t."templateStageId" JOIN workflow_cases wc ON wc.id=t."caseId" JOIN compliance_calendar_occurrences o ON o.id=r."calendarOccurrenceId" LEFT JOIN ai_risk_review_completions c ON c."reviewId"=r.id LEFT JOIN ai_risk_review_cancellations x ON x."reviewId"=r.id LEFT JOIN ai_lifecycle_review_retirements z ON z."reviewId"=r.id
 WHERE (t.id=NEW.id OR o.id=NEW.id) AND (t."caseId"<>ar."workflowCaseId" OR s.code<>'airs-periodic-review' OR s."templateId"<>wc."templateId" OR t."dueDate" IS DISTINCT FROM r."dueAt" OR t."caseId" IS DISTINCT FROM o."workflowCaseId" OR t."assigneeUserId" IS DISTINCT FROM r."assignedOwnerId" OR t."assigneeRoleCode"<>'AI_RISK_OWNER' OR t."formDataJson"->>'reviewId' IS DISTINCT FROM r.id OR o."dueAt"<>r."dueAt" OR o."templateId"<>r."calendarTemplateId" OR
 (c.id IS NULL AND x.id IS NULL AND z.id IS NULL AND (t.status<>'pending' OR o.status<>'active' OR t."completedAt" IS NOT NULL OR o."completedAt" IS NOT NULL)) OR
 (x.id IS NOT NULL AND (t.status<>'cancelled' OR o.status<>'archived' OR t."completedAt" IS DISTINCT FROM x."createdAt" OR o."completedAt" IS NOT NULL)) OR
 (z.id IS NOT NULL AND (t.status<>'cancelled' OR o.status<>'archived' OR t."completedAt" IS DISTINCT FROM z."createdAt" OR o."completedAt" IS NOT NULL)) OR
 (c.id IS NOT NULL AND (t.status<>'completed' OR o.status<>'completed' OR t."completedAt" IS DISTINCT FROM c."completedAt" OR o."completedAt" IS DISTINCT FROM c."completedAt")))) THEN RAISE EXCEPTION 'AI review native task/calendar history is protected'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION ai_review_template_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN compliance_calendar_templates t ON t.id=r."calendarTemplateId" WHERE t.id=NEW.id AND
 (t.type::text<>'ai_risk_review' OR t.cadence<>'governed_days' OR t."ownerRoleCode"<>'AI_RISK_OWNER' OR t."defaultSlaBusinessDays"<>0)) THEN RAISE EXCEPTION 'AI review calendar configuration is protected'; END IF;
 IF EXISTS(SELECT 1 FROM ai_risk_reviews r JOIN compliance_calendar_templates t ON t.id=r."calendarTemplateId" LEFT JOIN ai_risk_review_completions c ON c."reviewId"=r.id LEFT JOIN ai_risk_review_cancellations x ON x."reviewId"=r.id LEFT JOIN ai_lifecycle_review_retirements z ON z."reviewId"=r.id
 WHERE t.id=NEW.id AND c.id IS NULL AND x.id IS NULL AND z.id IS NULL AND (t.status<>'active' OR t."nextRunAt"<>r."dueAt" OR t."lastRunAt" IS DISTINCT FROM r."anchorAt")) THEN RAISE EXCEPTION 'AI review calendar engine dates are protected'; END IF;
 RETURN NULL;
END $$;
