-- AlterTable
ALTER TABLE "ai_risk_reviews" ADD COLUMN     "cadenceCode" TEXT,
ADD COLUMN     "cadenceReferenceVersionId" TEXT,
ADD COLUMN     "displayCadenceLabelAr" TEXT,
ADD COLUMN     "displayCadenceLabelEn" TEXT;

-- CreateTable
CREATE TABLE "ai_annual_review_handovers" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "fromOfficerId" TEXT NOT NULL,
    "toOfficerId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientIp" TEXT,

    CONSTRAINT "ai_annual_review_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_monthly_review_reports" (
    "id" TEXT NOT NULL,
    "organizationUnitId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "members" JSONB NOT NULL,
    "measures" JSONB NOT NULL,
    "clientIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_monthly_review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_annual_review_handovers_reviewId_round_key" ON "ai_annual_review_handovers"("reviewId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ai_monthly_review_reports_organizationUnitId_periodMonth_key" ON "ai_monthly_review_reports"("organizationUnitId", "periodMonth");

-- AddForeignKey
ALTER TABLE "ai_risk_reviews" ADD CONSTRAINT "ai_risk_reviews_cadenceReferenceVersionId_fkey" FOREIGN KEY ("cadenceReferenceVersionId") REFERENCES "governed_reference_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_annual_review_handovers" ADD CONSTRAINT "ai_annual_review_handovers_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ai_annual_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_monthly_review_reports" ADD CONSTRAINT "ai_monthly_review_reports_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE ai_risk_reviews ADD CONSTRAINT ai_review_cadence_label_shape CHECK (("cadenceReferenceVersionId" IS NULL AND "cadenceCode" IS NULL AND "displayCadenceLabelEn" IS NULL AND "displayCadenceLabelAr" IS NULL) OR ("cadenceReferenceVersionId" IS NOT NULL AND "cadenceCode" IS NOT NULL AND "displayCadenceLabelEn" IS NOT NULL AND "displayCadenceLabelAr" IS NOT NULL));
CREATE FUNCTION ai_review_cadence_label_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."cadenceReferenceVersionId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM governed_reference_versions v JOIN governed_reference_values cv ON cv."versionId"=v.id WHERE v.id=NEW."cadenceReferenceVersionId" AND v."listCode"='R_CADENCE' AND v.state='published' AND v."effectiveFrom"<=CURRENT_TIMESTAMP AND (v."effectiveTo" IS NULL OR v."effectiveTo">CURRENT_TIMESTAMP) AND cv.code=NEW."cadenceCode" AND cv."labelEn"=NEW."displayCadenceLabelEn" AND cv."labelAr"=NEW."displayCadenceLabelAr" AND cv.metadata->>'residualBandCode'=NEW."bandCode" AND (cv.metadata->>'intervalDays')::int=NEW."intervalDays") THEN RAISE EXCEPTION 'Review cadence labels require matching published R_CADENCE metadata'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_review_cadence_labels_parent BEFORE INSERT ON ai_risk_reviews FOR EACH ROW EXECUTE FUNCTION ai_review_cadence_label_guard();

CREATE FUNCTION ai_annual_current_officer(review_id text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT h."toOfficerId" FROM ai_annual_review_handovers h WHERE h."reviewId"=r.id ORDER BY h.round DESC LIMIT 1),r."assignedOfficerId") FROM ai_annual_reviews r WHERE r.id=review_id
$$;
ALTER TABLE ai_annual_review_handovers ADD CONSTRAINT ai_annual_handover_shape CHECK(round>0 AND "fromOfficerId"<>"toOfficerId" AND length(btrim(justification)) BETWEEN 1 AND 5000 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);
CREATE TRIGGER ai_annual_handover_immutable BEFORE UPDATE OR DELETE ON ai_annual_review_handovers FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
CREATE FUNCTION ai_annual_handover_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT ai_annual_officer_eligible(NEW."actorId") OR NOT ai_annual_officer_eligible(NEW."toOfficerId") OR NEW."fromOfficerId" IS DISTINCT FROM ai_annual_current_officer(NEW."reviewId") OR NEW.round<>(SELECT coalesce(max(round),0)+1 FROM ai_annual_review_handovers WHERE "reviewId"=NEW."reviewId") OR NOT EXISTS(SELECT 1 FROM ai_annual_reviews r JOIN workflow_tasks t ON t.id=r."taskId" WHERE r.id=NEW."reviewId" AND t.status='pending' AND t."assigneeUserId"=NEW."fromOfficerId" AND NOT EXISTS(SELECT 1 FROM ai_annual_review_completions c WHERE c."reviewId"=r.id)) THEN RAISE EXCEPTION 'Annual handover requires pending original task, current ledger source and eligible officers'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence n WHERE n.id=e AND n."deletedAt" IS NULL)) THEN RAISE EXCEPTION 'Annual handover evidence must exist'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_annual_handover_parent BEFORE INSERT ON ai_annual_review_handovers FOR EACH ROW EXECUTE FUNCTION ai_annual_handover_guard();
CREATE FUNCTION ai_annual_handover_native_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_annual_reviews r JOIN workflow_tasks t ON t.id=r."taskId" WHERE r.id=NEW."reviewId" AND t."assigneeUserId"=ai_annual_current_officer(r.id) AND t.status='pending' AND t."dueDate"=r."dueAt") THEN RAISE EXCEPTION 'Annual handover must update protected task ownership atomically'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ai_annual_handover_native AFTER INSERT ON ai_annual_review_handovers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_annual_handover_native_guard();

CREATE TRIGGER ai_monthly_report_immutable BEFORE UPDATE OR DELETE ON ai_monthly_review_reports FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
ALTER TABLE ai_monthly_review_reports ADD CONSTRAINT ai_monthly_report_shape CHECK("periodMonth"~'^[0-9]{4}-(0[1-9]|1[0-2])$' AND jsonb_typeof(members)='array' AND jsonb_typeof(measures)='object');
CREATE FUNCTION ai_monthly_report_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE start_at timestamp; end_at timestamp;
BEGIN
 start_at=to_date(NEW."periodMonth"||'-01','YYYY-MM-DD')::timestamp-interval '3 hours';
 end_at=(to_date(NEW."periodMonth"||'-01','YYYY-MM-DD')::timestamp+interval '1 month')-interval '3 hours'-interval '1 millisecond';
 IF NOT ai_annual_officer_eligible(NEW."createdBy") OR NEW."periodStart"<>start_at OR NEW."periodEnd"<>end_at OR end_at>=date_trunc('month',(clock_timestamp() AT TIME ZONE 'UTC')+interval '3 hours')-interval '3 hours' OR abs(extract(epoch FROM NEW."capturedAt"-(clock_timestamp() AT TIME ZONE 'UTC')))>60 THEN RAISE EXCEPTION 'Monthly report requires eligible officer, closed Saudi month and server capture time'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.members) m WHERE NOT EXISTS(SELECT 1 FROM ai_risks r JOIN ai_use_cases uc ON uc.id=r."useCaseId" WHERE r.id=m->>'id' AND r.version=(m->>'version')::int AND uc."organizationUnitId"=NEW."organizationUnitId" AND r."deletedAt" IS NULL AND uc."deletedAt" IS NULL AND NOT r."isSampleData" AND NOT uc."isSampleData" AND r."riskRef" IS NOT NULL)) THEN RAISE EXCEPTION 'Monthly report member source mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_monthly_report_parent BEFORE INSERT ON ai_monthly_review_reports FOR EACH ROW EXECUTE FUNCTION ai_monthly_report_guard();

CREATE OR REPLACE FUNCTION ai_annual_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT ai_annual_officer_eligible(NEW."actorId") OR NOT EXISTS(SELECT 1 FROM ai_annual_reviews r JOIN workflow_tasks t ON t.id=r."taskId" WHERE r.id=NEW."reviewId" AND ai_annual_current_officer(r.id)=NEW."actorId" AND t."assigneeUserId"=NEW."actorId" AND t.status='pending' AND t."dueDate"=r."dueAt" AND NEW."completedAt">=r."anchorAt" AND abs(extract(epoch FROM NEW."completedAt"-(clock_timestamp() AT TIME ZONE 'UTC')))<60) THEN RAISE EXCEPTION 'Annual completion requires active assigned officer and server date'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence n WHERE n.id=e AND n."deletedAt" IS NULL)) THEN RAISE EXCEPTION 'Annual evidence must exist'; END IF;
 RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION ai_annual_native_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ai_annual_reviews r JOIN workflow_tasks t ON t.id=r."taskId" JOIN compliance_calendar_occurrences o ON o.id=r."calendarOccurrenceId" JOIN compliance_calendar_templates ct ON ct.id=r."calendarTemplateId" JOIN workflow_cases wc ON wc.id=r."workflowCaseId" LEFT JOIN workflow_template_stages s ON s.id=t."templateStageId" LEFT JOIN ai_annual_review_completions c ON c."reviewId"=r.id
 WHERE ((TG_TABLE_NAME='workflow_tasks' AND r."taskId"=NEW.id) OR (TG_TABLE_NAME='compliance_calendar_occurrences' AND r."calendarOccurrenceId"=NEW.id) OR (TG_TABLE_NAME='compliance_calendar_templates' AND r."calendarTemplateId"=NEW.id) OR (TG_TABLE_NAME='workflow_cases' AND r."workflowCaseId"=NEW.id) OR (TG_TABLE_NAME='ai_annual_review_completions' AND r.id=to_jsonb(NEW)->>'reviewId')) AND (t."caseId"<>r."workflowCaseId" OR t."dueDate" IS DISTINCT FROM r."dueAt" OR t."assigneeUserId" IS DISTINCT FROM ai_annual_current_officer(r.id) OR t."assigneeRoleCode" IS DISTINCT FROM 'AI_GOVERNANCE_OFFICER' OR t."formDataJson"->>'annualReviewId' IS DISTINCT FROM r.id OR o."dueAt"<>r."dueAt" OR o."templateId"<>r."calendarTemplateId" OR o."workflowCaseId" IS DISTINCT FROM r."workflowCaseId" OR s.code IS DISTINCT FROM 'airs-annual-review' OR s."templateId" IS DISTINCT FROM wc."templateId" OR wc."assetId" IS NOT NULL OR wc.status<>'implemented' OR ct.type::text<>'ai_annual_review' OR ct.cadence<>'annual' OR ct."ownerRoleCode" IS DISTINCT FROM 'AI_GOVERNANCE_OFFICER'
 OR (c.id IS NULL AND (t.status<>'pending' OR o.status<>'active' OR ct.status<>'active' OR ct."nextRunAt"<>r."dueAt" OR ct."lastRunAt" IS DISTINCT FROM r."anchorAt"))
 OR (c.id IS NOT NULL AND (t.status<>'completed' OR t."completedAt" IS DISTINCT FROM c."completedAt" OR t."formSubmittedBy" IS DISTINCT FROM c."actorId" OR o.status<>'completed' OR o."completedAt" IS DISTINCT FROM c."completedAt" OR NOT EXISTS(SELECT 1 FROM ai_annual_reviews n WHERE n."organizationUnitId"=r."organizationUnitId" AND n.round=r.round+1 AND n."anchorAt"=c."completedAt"))))) THEN RAISE EXCEPTION 'Protected annual review native history mismatch'; END IF;
 RETURN NULL;
END $$;
