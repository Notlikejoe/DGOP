CREATE TABLE ai_risk_severity_events (
 id TEXT PRIMARY KEY, "riskId" TEXT NOT NULL REFERENCES ai_risks(id) ON DELETE RESTRICT,
 "assessmentId" TEXT NOT NULL REFERENCES ai_assessment_rounds(id) ON DELETE RESTRICT,
 round INTEGER NOT NULL CHECK(round>0), kind TEXT NOT NULL CHECK(kind IN ('proposal','approved','returned','reversed')),
 "severityCode" TEXT NOT NULL CHECK("severityCode" IN ('P1','P2','P3','P4')),
 "previousSeverityCode" TEXT NOT NULL CHECK("previousSeverityCode" IN ('P1','P2','P3','P4')),
 "relatedEventId" TEXT REFERENCES ai_risk_severity_events(id) ON DELETE RESTRICT,
 "taskId" TEXT REFERENCES workflow_tasks(id) ON DELETE RESTRICT,
 "actorId" TEXT NOT NULL, "actorRoleCode" TEXT NOT NULL, "authorityLevel" INTEGER NOT NULL CHECK("authorityLevel" BETWEEN 1 AND 4),
 justification TEXT NOT NULL CHECK(length(btrim(justification)) BETWEEN 1 AND 5000),
 "evidenceIds" JSONB NOT NULL CHECK(jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20),
 "clientIp" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("riskId",round)
);
CREATE INDEX ai_risk_severity_events_assessmentId_round_idx ON ai_risk_severity_events("assessmentId",round);
CREATE UNIQUE INDEX ai_severity_proposal_single_outcome ON ai_risk_severity_events("relatedEventId") WHERE kind IN ('approved','returned');
CREATE UNIQUE INDEX ai_severity_reversal_once ON ai_risk_severity_events("relatedEventId") WHERE kind='reversed';
CREATE TRIGGER ai_severity_event_immutable BEFORE UPDATE OR DELETE ON ai_risk_severity_events FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
INSERT INTO workflow_template_stages (id,"templateId",code,"nameEn","nameAr",kind,"taskType","assigneeRoleCode","dueDays","sortOrder","isDecision")
 SELECT 'ai-severity-stage-'||id,id,'airs-severity-override','Independent severity override review','مراجعة تعديل الأولوية المستقلة','decision','approval','AI_ETHICS_COMMITTEE',5,29,true
 FROM workflow_templates WHERE code='AIRS_LIFECYCLE_V1' AND "deletedAt" IS NULL
 ON CONFLICT ("templateId",code) DO NOTHING;

CREATE FUNCTION ai_severity_current_assessment(risk_id TEXT) RETURNS TEXT LANGUAGE SQL STABLE AS $$
 WITH inherent AS (
 SELECT a.* FROM ai_assessment_rounds a WHERE a."riskId"=risk_id AND a.kind='inherent' ORDER BY a.round DESC LIMIT 1
 ), current_inherent AS (
 SELECT a.* FROM inherent a WHERE a.round>=GREATEST(
 COALESCE((SELECT max("inherentRound") FROM ai_risk_reassessments WHERE "riskId"=risk_id),0),
 COALESCE((SELECT max(t."requiredInherentRound") FROM ai_reassessment_triggers t JOIN ai_risk_reassessments r ON r.id=t."reassessmentId" WHERE r."riskId"=risk_id),0))
 AND NOT EXISTS(SELECT 1 FROM ai_risk_assessment_decisions WHERE "assessmentId"=a.id AND decision='return')
 ), response AS (SELECT * FROM ai_risk_responses WHERE "riskId"=risk_id ORDER BY round DESC LIMIT 1),
 residual AS (SELECT * FROM ai_assessment_rounds WHERE "riskId"=risk_id AND kind='residual' ORDER BY round DESC LIMIT 1),
 paired AS (SELECT a.* FROM residual a,current_inherent i,response r
 WHERE a.inputs->>'inherentAssessmentId'=i.id AND r."assessmentId"=i.id AND a.inputs->>'responseId'=r.id
 AND a.inputs->>'planId' IS NOT DISTINCT FROM (SELECT id FROM ai_treatment_plans WHERE "responseId"=r.id ORDER BY round DESC LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM ai_risk_assessment_decisions WHERE "assessmentId"=a.id AND decision='return'))
 SELECT COALESCE((SELECT id FROM paired),(SELECT id FROM current_inherent))
$$;
CREATE FUNCTION ai_severity_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE risk ai_risks; assessment ai_assessment_rounds; basis ai_risk_severity_events; task workflow_tasks; owner_id TEXT; use_owner TEXT; previous_round INTEGER; effective TEXT;
BEGIN
 SELECT * INTO risk FROM ai_risks WHERE id=NEW."riskId" FOR UPDATE;
 SELECT * INTO assessment FROM ai_assessment_rounds WHERE id=NEW."assessmentId";
 SELECT "userId" INTO owner_id FROM people WHERE id=risk."ownerPersonId";
 SELECT p."userId" INTO use_owner FROM ai_use_cases uc JOIN people p ON p.id=uc."ownerPersonId" WHERE uc.id=risk."useCaseId";
 SELECT COALESCE(MAX(round),0) INTO previous_round FROM ai_risk_severity_events WHERE "riskId"=risk.id;
 IF risk."deletedAt" IS NOT NULL OR risk."riskRef" IS NULL OR assessment."riskId" IS DISTINCT FROM risk.id OR assessment.kind NOT IN ('inherent','residual')
 OR NEW.round<>previous_round+1 OR NEW."authorityLevel"<>ai_actual_authority_level(NEW."actorRoleCode")
 OR NEW."actorId"=owner_id OR NEW."actorId"=use_owner OR NOT ai_outcome_live_grant(NEW."actorId",NEW."actorRoleCode",'airs.severity','override')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence WHERE id=e AND "deletedAt" IS NULL))
 THEN RAISE EXCEPTION 'Scoped independent live severity authority and assessment/evidence lineage required' USING ERRCODE='23514'; END IF;
 IF NEW.kind<>'returned' AND assessment.id IS DISTINCT FROM ai_severity_current_assessment(risk.id) THEN RAISE EXCEPTION 'Severity override must reference the current eligible calculation' USING ERRCODE='23514'; END IF;
 SELECT "severityCode" INTO effective FROM ai_risk_severity_events WHERE "riskId"=risk.id AND "assessmentId"=assessment.id AND kind IN ('approved','reversed') ORDER BY round DESC LIMIT 1;
 effective:=COALESCE(effective,assessment.result->>'severityCode');
 IF NEW.kind='proposal' THEN
   IF NEW."previousSeverityCode" IS DISTINCT FROM effective OR EXISTS(SELECT 1 FROM ai_risk_severity_events e JOIN workflow_tasks t ON t.id=e."taskId" WHERE e."riskId"=risk.id AND e.kind='proposal' AND t.status='pending' AND NOT EXISTS(SELECT 1 FROM ai_risk_severity_events o WHERE o."relatedEventId"=e.id AND o.kind IN ('approved','returned'))) THEN RAISE EXCEPTION 'Current effective severity and exactly one pending proposal required' USING ERRCODE='23514'; END IF;
   IF NEW."relatedEventId" IS NOT NULL OR NEW."authorityLevel"=4 OR NEW."severityCode"=NEW."previousSeverityCode" THEN RAISE EXCEPTION 'Distinct proposed severity with higher review authority required' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT * INTO basis FROM ai_risk_severity_events WHERE id=NEW."relatedEventId";
   IF basis.id IS NULL OR basis."riskId"<>risk.id OR basis."assessmentId"<>assessment.id OR basis."actorId"=NEW."actorId" OR NEW."authorityLevel"<=basis."authorityLevel"
   OR (NEW.kind='reversed' AND basis.id IS DISTINCT FROM (SELECT id FROM ai_risk_severity_events WHERE "riskId"=risk.id AND "assessmentId"=assessment.id AND kind IN ('approved','reversed') ORDER BY round DESC LIMIT 1))
   OR (NEW.kind IN ('approved','returned') AND (basis.kind<>'proposal' OR NEW."taskId" IS DISTINCT FROM basis."taskId" OR NEW."severityCode"<>basis."severityCode" OR NEW."previousSeverityCode"<>basis."previousSeverityCode"))
   OR (NEW.kind='reversed' AND (basis.kind<>'approved' OR NEW."severityCode"<>basis."previousSeverityCode" OR NEW."previousSeverityCode"<>basis."severityCode"))
   THEN RAISE EXCEPTION 'Independent higher authority and unchanged compensating severity lineage required' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.kind<>'reversed' THEN
   SELECT * INTO task FROM workflow_tasks WHERE id=NEW."taskId";
   IF task.id IS NULL OR task."caseId"<>risk."workflowCaseId" OR task.status<>'pending' OR task."formDataJson"->>'assessmentId' IS DISTINCT FROM assessment.id
   OR NOT EXISTS(SELECT 1 FROM workflow_template_stages s JOIN workflow_templates t ON t.id=s."templateId" WHERE s.id=task."templateStageId" AND s.code='airs-severity-override' AND s."isActive" AND t.code='AIRS_LIFECYCLE_V1' AND t."isActive" AND t."deletedAt" IS NULL)
   OR (NEW.kind<>'proposal' AND (task."assigneeRoleCode"<>NEW."actorRoleCode" OR task."assigneeUserId" IS NOT NULL AND task."assigneeUserId"<>NEW."actorId"))
   THEN RAISE EXCEPTION 'Native assigned pending severity review required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_severity_event_guard BEFORE INSERT ON ai_risk_severity_events FOR EACH ROW EXECUTE FUNCTION ai_severity_event_guard();

CREATE FUNCTION ai_severity_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposal ai_risk_severity_events; task workflow_tasks;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workflow_template_stages WHERE id=NEW."templateStageId" AND code='airs-severity-override') THEN RETURN NEW; END IF;
 SELECT * INTO task FROM workflow_tasks WHERE id=NEW.id;
 SELECT * INTO proposal FROM ai_risk_severity_events WHERE id=task."formDataJson"->>'proposalId' AND kind='proposal';
 IF proposal.id IS NULL OR proposal."taskId"<>task.id OR task."formDataJson"->>'assessmentId' IS DISTINCT FROM proposal."assessmentId"
 OR task."assigneeRoleCode" IS NULL OR ai_actual_authority_level(task."assigneeRoleCode")<>proposal."authorityLevel"+1
 OR NOT EXISTS(SELECT 1 FROM ai_risks WHERE id=proposal."riskId" AND "workflowCaseId"=task."caseId")
 OR (task.status='completed' AND NOT EXISTS(SELECT 1 FROM ai_risk_severity_events WHERE "relatedEventId"=proposal.id AND kind IN ('approved','returned') AND "actorId"=task."assigneeUserId" AND "actorRoleCode"=task."assigneeRoleCode"))
 THEN RAISE EXCEPTION 'Native severity task requires immutable proposal and independent outcome' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ai_severity_task_guard AFTER INSERT OR UPDATE ON workflow_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_severity_task_guard();

