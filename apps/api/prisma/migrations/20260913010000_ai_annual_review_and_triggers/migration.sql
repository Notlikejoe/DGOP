-- AlterEnum
ALTER TYPE "ComplianceCalendarType" ADD VALUE 'ai_annual_review';

-- CreateTable
CREATE TABLE "ai_reassessment_triggers" (
    "id" TEXT NOT NULL,
    "reassessmentId" TEXT NOT NULL,
    "coordinatorTaskId" TEXT NOT NULL,
    "requiredInherentRound" INTEGER NOT NULL,
    "triggerCode" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "clientIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_reassessment_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_annual_reviews" (
    "id" TEXT NOT NULL,
    "organizationUnitId" TEXT NOT NULL,
    "calendarTemplateId" TEXT NOT NULL,
    "calendarOccurrenceId" TEXT NOT NULL,
    "workflowCaseId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assignedOfficerId" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_annual_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_annual_review_completions" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "trendsSummary" TEXT NOT NULL,
    "controlEffectivenessSummary" TEXT NOT NULL,
    "nonconformitySummary" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "clientIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_annual_review_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_reassessment_triggers_coordinatorTaskId_key" ON "ai_reassessment_triggers"("coordinatorTaskId");

-- CreateIndex
CREATE INDEX "ai_reassessment_triggers_reassessmentId_createdAt_idx" ON "ai_reassessment_triggers"("reassessmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_annual_reviews_calendarOccurrenceId_key" ON "ai_annual_reviews"("calendarOccurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_annual_reviews_taskId_key" ON "ai_annual_reviews"("taskId");

-- CreateIndex
CREATE INDEX "ai_annual_reviews_dueAt_idx" ON "ai_annual_reviews"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_annual_reviews_organizationUnitId_round_key" ON "ai_annual_reviews"("organizationUnitId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_annual_review_completions_reviewId_key" ON "ai_annual_review_completions"("reviewId");

-- AddForeignKey
ALTER TABLE "ai_reassessment_triggers" ADD CONSTRAINT "ai_reassessment_triggers_reassessmentId_fkey" FOREIGN KEY ("reassessmentId") REFERENCES "ai_risk_reassessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reassessment_triggers" ADD CONSTRAINT "ai_reassessment_triggers_coordinatorTaskId_fkey" FOREIGN KEY ("coordinatorTaskId") REFERENCES "workflow_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_annual_reviews" ADD CONSTRAINT "ai_annual_reviews_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_annual_reviews" ADD CONSTRAINT "ai_annual_reviews_calendarTemplateId_fkey" FOREIGN KEY ("calendarTemplateId") REFERENCES "compliance_calendar_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_annual_reviews" ADD CONSTRAINT "ai_annual_reviews_calendarOccurrenceId_fkey" FOREIGN KEY ("calendarOccurrenceId") REFERENCES "compliance_calendar_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_annual_reviews" ADD CONSTRAINT "ai_annual_reviews_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_annual_reviews" ADD CONSTRAINT "ai_annual_reviews_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_annual_review_completions" ADD CONSTRAINT "ai_annual_review_completions_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ai_annual_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Append-only annual findings and additional-trigger provenance.
CREATE TRIGGER ai_annual_review_immutable BEFORE UPDATE OR DELETE ON ai_annual_reviews FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
CREATE TRIGGER ai_annual_completion_immutable BEFORE UPDATE OR DELETE ON ai_annual_review_completions FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
CREATE TRIGGER ai_additional_trigger_immutable BEFORE UPDATE OR DELETE ON ai_reassessment_triggers FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
ALTER TABLE ai_reassessment_triggers ADD CONSTRAINT ai_additional_trigger_shape CHECK ("requiredInherentRound">0 AND "triggerCode" IN ('material_change','provider_change','data_change','incident','nonconformity','regulatory_change','detected_deviation') AND length(btrim(justification)) BETWEEN 1 AND 5000 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);
ALTER TABLE ai_annual_reviews ADD CONSTRAINT ai_annual_review_shape CHECK(round>0 AND "dueAt">"anchorAt");
ALTER TABLE ai_annual_review_completions ADD CONSTRAINT ai_annual_findings_shape CHECK(length(btrim("trendsSummary")) BETWEEN 1 AND 5000 AND length(btrim("controlEffectivenessSummary")) BETWEEN 1 AND 5000 AND length(btrim("nonconformitySummary")) BETWEEN 1 AND 5000 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);

CREATE FUNCTION ai_annual_officer_eligible(actor text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur."userId"=u.id JOIN roles r ON r.id=ur."roleId" JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId" WHERE u.id=actor AND u."isActive" AND r.code='AI_GOVERNANCE_OFFICER' AND r."isActive" AND r."deletedAt" IS NULL AND p.resource='airs.cadence' AND p.action='manage') AND NOT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" WHERE ur."userId"=actor AND r.code='auditor' AND r."isActive" AND r."deletedAt" IS NULL)
$$;
CREATE FUNCTION ai_additional_trigger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_risk_reassessments ra JOIN ai_risks r ON r.id=ra."riskId" JOIN workflow_cases wc ON wc.id=r."workflowCaseId" JOIN people owner ON owner.id=r."ownerPersonId" JOIN workflow_tasks t ON t.id=NEW."coordinatorTaskId" JOIN workflow_template_stages s ON s.id=t."templateStageId" JOIN workflow_tasks i ON i.id=ra."sourceIntakeTaskId"
 WHERE ra.id=NEW."reassessmentId" AND ra."inherentRound"=(SELECT max("inherentRound") FROM ai_risk_reassessments WHERE "riskId"=r.id) AND r."deletedAt" IS NULL AND wc.status='under_review' AND wc.type='AIRS' AND owner."isActive" AND owner."deletedAt" IS NULL
 AND t."caseId"=wc.id AND t.status='pending' AND t."assigneeUserId"=owner."userId" AND t."assigneeRoleCode"='AI_RISK_OWNER' AND s.code='airs-inherent-assessment' AND s."templateId"=wc."templateId" AND s."isActive"
 AND i."caseId"=wc.id AND i.status='completed' AND i."formDataJson"->'submittedIntake'=r."intakeData" AND t."formDataJson"->>'sourceIntakeTaskId'=i.id AND (t."formDataJson"->>'reassessmentRequiredRound')::int=NEW."requiredInherentRound"
 AND NEW."requiredInherentRound"=(SELECT coalesce(max(round),0)+1 FROM ai_assessment_rounds WHERE "riskId"=r.id AND kind='inherent')
 AND EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur."userId"=u.id JOIN roles role ON role.id=ur."roleId" JOIN role_permissions rp ON rp."roleId"=role.id JOIN permissions p ON p.id=rp."permissionId" WHERE u.id=NEW."actorId" AND u."isActive" AND role."isActive" AND role."deletedAt" IS NULL AND ((role.code IN ('AI_GOVERNANCE_OFFICER','AI_WORKING_GROUP') AND p.resource='airs.cadence' AND p.action='manage') OR (role.code='AI_RISK_OWNER' AND owner."userId"=u.id AND p.resource='airs.risk' AND p.action='assess')))) THEN RAISE EXCEPTION 'Additional trigger requires active reassessment, eligible authority and fresh original-intake coordinator'; END IF;
 IF EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" WHERE ur."userId"=NEW."actorId" AND r.code='auditor' AND r."isActive" AND r."deletedAt" IS NULL) THEN RAISE EXCEPTION 'Auditor cannot record reassessment triggers'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence n WHERE n.id=e AND n."deletedAt" IS NULL)) THEN RAISE EXCEPTION 'Trigger evidence must exist'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_additional_trigger_parent BEFORE INSERT ON ai_reassessment_triggers FOR EACH ROW EXECUTE FUNCTION ai_additional_trigger_guard();

CREATE FUNCTION ai_additional_decision_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE risk_id text; inherent_round int; required_round int;
BEGIN
 SELECT a."riskId",CASE WHEN a.kind='inherent' THEN a.round ELSE i.round END INTO risk_id,inherent_round FROM ai_assessment_rounds a LEFT JOIN ai_assessment_rounds i ON i.id=a.inputs->>'inherentAssessmentId' WHERE a.id=NEW."assessmentId";
 SELECT greatest(ra."inherentRound",coalesce((SELECT max(t."requiredInherentRound") FROM ai_reassessment_triggers t WHERE t."reassessmentId"=ra.id),0)) INTO required_round FROM ai_risk_reassessments ra WHERE ra."riskId"=risk_id ORDER BY ra."inherentRound" DESC LIMIT 1;
 IF required_round IS NOT NULL AND (inherent_round IS NULL OR inherent_round<required_round) THEN RAISE EXCEPTION 'Reassessment decision requires latest trigger fresh inherent round'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_additional_decision_fresh BEFORE INSERT ON ai_risk_assessment_decisions FOR EACH ROW EXECUTE FUNCTION ai_additional_decision_gate();

CREATE FUNCTION ai_annual_review_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_anchor timestamp;
BEGIN
 IF NOT ai_annual_officer_eligible(NEW."assignedOfficerId") OR NEW."createdBy"<>NEW."assignedOfficerId" THEN RAISE EXCEPTION 'Annual review requires eligible assigned Responsible AI Officer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM organization_units ou JOIN compliance_calendar_templates c ON c.id=NEW."calendarTemplateId" JOIN compliance_calendar_occurrences o ON o.id=NEW."calendarOccurrenceId" JOIN workflow_cases wc ON wc.id=NEW."workflowCaseId" JOIN workflow_tasks t ON t.id=NEW."taskId" JOIN workflow_template_stages s ON s.id=t."templateStageId" JOIN workflow_templates wt ON wt.id=s."templateId"
 WHERE ou.id=NEW."organizationUnitId" AND ou."isActive" AND ou."deletedAt" IS NULL AND c.type::text='ai_annual_review' AND c.cadence='annual' AND c."ownerRoleCode"='AI_GOVERNANCE_OFFICER' AND c.status='active' AND c."nextRunAt"=NEW."dueAt" AND c."lastRunAt"=NEW."anchorAt"
 AND o."templateId"=c.id AND o."workflowCaseId"=wc.id AND o."dueAt"=NEW."dueAt" AND o.status='active' AND wc.type='AIRS' AND wc.status='implemented' AND wc."assetId" IS NULL
 AND t."caseId"=wc.id AND t.status='pending' AND t."assigneeUserId"=NEW."assignedOfficerId" AND t."assigneeRoleCode"='AI_GOVERNANCE_OFFICER' AND t."dueDate"=NEW."dueAt" AND t."formDataJson"->>'annualReviewId'=NEW.id AND t."formDataJson"->>'organizationUnitId'=ou.id
 AND s.code='airs-annual-review' AND s."isActive" AND wt.code='AIRS_LIFECYCLE_V1' AND wt."isActive" AND wt."deletedAt" IS NULL AND wc."templateId"=wt.id) THEN RAISE EXCEPTION 'Annual review parent/calendar/task mismatch'; END IF;
 IF NEW.round=1 THEN
   IF abs(extract(epoch FROM NEW."anchorAt"-(clock_timestamp() AT TIME ZONE 'UTC')))>60 THEN RAISE EXCEPTION 'Annual anchor must be server time'; END IF;
   expected_anchor=NEW."anchorAt";
 ELSE
   SELECT c."completedAt" INTO expected_anchor FROM ai_annual_reviews p JOIN ai_annual_review_completions c ON c."reviewId"=p.id WHERE p."organizationUnitId"=NEW."organizationUnitId" AND p.round=NEW.round-1 AND p."calendarTemplateId"=NEW."calendarTemplateId" AND p."workflowCaseId"=NEW."workflowCaseId";
 END IF;
 IF expected_anchor IS NULL OR NEW."anchorAt"<>expected_anchor OR NEW."dueAt"<>date_trunc('day',expected_anchor+interval '3 hours')+interval '366 days'-interval '3 hours'-interval '1 millisecond' THEN RAISE EXCEPTION 'Annual review engine anchor/deadline mismatch'; END IF;
 IF jsonb_typeof(NEW."sourceSnapshot"->'members') IS DISTINCT FROM 'array' OR NEW."sourceSnapshot"->>'asOf' IS NULL THEN RAISE EXCEPTION 'Annual review requires register source snapshot'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."sourceSnapshot"->'members') m WHERE NOT EXISTS(SELECT 1 FROM ai_risks r JOIN ai_use_cases uc ON uc.id=r."useCaseId" WHERE r.id=m->>'id' AND r."riskRef"=m->>'riskRef' AND r.version=(m->>'version')::int AND uc."organizationUnitId"=NEW."organizationUnitId" AND NOT r."isSampleData" AND NOT uc."isSampleData" AND r."deletedAt" IS NULL AND uc."deletedAt" IS NULL)) THEN RAISE EXCEPTION 'Annual register snapshot member mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_annual_review_parent BEFORE INSERT ON ai_annual_reviews FOR EACH ROW EXECUTE FUNCTION ai_annual_review_parent_guard();
CREATE FUNCTION ai_annual_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT ai_annual_officer_eligible(NEW."actorId") OR NOT EXISTS(SELECT 1 FROM ai_annual_reviews r JOIN workflow_tasks t ON t.id=r."taskId" WHERE r.id=NEW."reviewId" AND r."assignedOfficerId"=NEW."actorId" AND t."assigneeUserId"=NEW."actorId" AND t.status='pending' AND t."dueDate"=r."dueAt" AND NEW."completedAt">=r."anchorAt" AND abs(extract(epoch FROM NEW."completedAt"-(clock_timestamp() AT TIME ZONE 'UTC')))<60) THEN RAISE EXCEPTION 'Annual completion requires active assigned officer and server date'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence n WHERE n.id=e AND n."deletedAt" IS NULL)) THEN RAISE EXCEPTION 'Annual evidence must exist'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_annual_completion_parent BEFORE INSERT ON ai_annual_review_completions FOR EACH ROW EXECUTE FUNCTION ai_annual_completion_guard();

-- Native maintenance must retain immutable review dates, ownership, instances and completion provenance.
CREATE FUNCTION ai_annual_native_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ai_annual_reviews r JOIN workflow_tasks t ON t.id=r."taskId" JOIN compliance_calendar_occurrences o ON o.id=r."calendarOccurrenceId" JOIN compliance_calendar_templates ct ON ct.id=r."calendarTemplateId" JOIN workflow_cases wc ON wc.id=r."workflowCaseId" LEFT JOIN workflow_template_stages s ON s.id=t."templateStageId" LEFT JOIN ai_annual_review_completions c ON c."reviewId"=r.id
 WHERE ((TG_TABLE_NAME='workflow_tasks' AND r."taskId"=NEW.id) OR (TG_TABLE_NAME='compliance_calendar_occurrences' AND r."calendarOccurrenceId"=NEW.id) OR (TG_TABLE_NAME='compliance_calendar_templates' AND r."calendarTemplateId"=NEW.id) OR (TG_TABLE_NAME='workflow_cases' AND r."workflowCaseId"=NEW.id) OR (TG_TABLE_NAME='ai_annual_review_completions' AND r.id=to_jsonb(NEW)->>'reviewId')) AND (t."caseId"<>r."workflowCaseId" OR t."dueDate" IS DISTINCT FROM r."dueAt" OR t."assigneeUserId" IS DISTINCT FROM r."assignedOfficerId" OR t."assigneeRoleCode" IS DISTINCT FROM 'AI_GOVERNANCE_OFFICER' OR t."formDataJson"->>'annualReviewId' IS DISTINCT FROM r.id OR o."dueAt"<>r."dueAt" OR o."templateId"<>r."calendarTemplateId" OR o."workflowCaseId" IS DISTINCT FROM r."workflowCaseId" OR s.code IS DISTINCT FROM 'airs-annual-review' OR s."templateId" IS DISTINCT FROM wc."templateId" OR wc."assetId" IS NOT NULL OR wc.status<>'implemented' OR ct.type::text<>'ai_annual_review' OR ct.cadence<>'annual' OR ct."ownerRoleCode" IS DISTINCT FROM 'AI_GOVERNANCE_OFFICER'
 OR (c.id IS NULL AND (t.status<>'pending' OR o.status<>'active' OR ct.status<>'active' OR ct."nextRunAt"<>r."dueAt" OR ct."lastRunAt" IS DISTINCT FROM r."anchorAt"))
 OR (c.id IS NOT NULL AND (t.status<>'completed' OR t."completedAt" IS DISTINCT FROM c."completedAt" OR t."formSubmittedBy" IS DISTINCT FROM c."actorId" OR o.status<>'completed' OR o."completedAt" IS DISTINCT FROM c."completedAt" OR NOT EXISTS(SELECT 1 FROM ai_annual_reviews n WHERE n."organizationUnitId"=r."organizationUnitId" AND n.round=r.round+1 AND n."anchorAt"=c."completedAt"))))) THEN RAISE EXCEPTION 'Protected annual review native history mismatch'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ai_annual_task_native AFTER UPDATE ON workflow_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_annual_native_guard();
CREATE CONSTRAINT TRIGGER ai_annual_occurrence_native AFTER UPDATE ON compliance_calendar_occurrences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_annual_native_guard();
CREATE CONSTRAINT TRIGGER ai_annual_calendar_native AFTER UPDATE ON compliance_calendar_templates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_annual_native_guard();
CREATE CONSTRAINT TRIGGER ai_annual_case_native AFTER UPDATE ON workflow_cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_annual_native_guard();
CREATE CONSTRAINT TRIGGER ai_annual_completion_native AFTER INSERT ON ai_annual_review_completions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_annual_native_guard();
