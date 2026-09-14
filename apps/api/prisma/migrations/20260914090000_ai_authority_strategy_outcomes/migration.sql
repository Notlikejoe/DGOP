CREATE TABLE ai_risk_authority_reversals (
 id TEXT PRIMARY KEY, "riskId" TEXT NOT NULL REFERENCES ai_risks(id) ON DELETE RESTRICT,
 "previousDecisionId" TEXT NOT NULL UNIQUE REFERENCES ai_risk_assessment_decisions(id) ON DELETE RESTRICT,
 "reassessmentId" TEXT NOT NULL UNIQUE REFERENCES ai_risk_reassessments(id) ON DELETE RESTRICT,
 "actorId" TEXT NOT NULL, "actorRoleCode" TEXT NOT NULL, "authorityLevel" INTEGER NOT NULL,
 "previousAuthorityLevel" INTEGER NOT NULL, justification TEXT NOT NULL, "evidenceIds" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("authorityLevel">"previousAuthorityLevel" AND "authorityLevel" BETWEEN 1 AND 4 AND "previousAuthorityLevel" BETWEEN 0 AND 3),
 CHECK (length(btrim(justification)) BETWEEN 1 AND 5000 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20)
);
CREATE INDEX ai_risk_authority_reversals_riskId_createdAt_idx ON ai_risk_authority_reversals("riskId","createdAt");
CREATE TABLE ai_risk_strategy_events (
 id TEXT PRIMARY KEY, "responseId" TEXT NOT NULL REFERENCES ai_risk_responses(id) ON DELETE RESTRICT,
 round INTEGER NOT NULL CHECK(round>0), kind TEXT NOT NULL, outcome TEXT NOT NULL,
 "taskId" TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE RESTRICT,
 "basisEventId" TEXT REFERENCES ai_risk_strategy_events(id) ON DELETE RESTRICT,
 "escalationId" TEXT REFERENCES governance_escalations(id) ON DELETE RESTRICT,
 payload JSONB NOT NULL, "actorId" TEXT NOT NULL, "actorRoleCode" TEXT NOT NULL,
 justification TEXT NOT NULL, "evidenceIds" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("responseId",round),
 CHECK (length(btrim(justification)) BETWEEN 1 AND 5000 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20),
 CHECK ((kind='avoidance_proposed' AND outcome IN ('scope_change','stop_use_case')) OR (kind='avoidance_review' AND outcome IN ('approve','return')) OR (kind='avoidance_closed' AND outcome IN ('scope_change','stop_use_case')) OR (kind='escalation_open' AND outcome='domain_council') OR (kind='escalation_outcome' AND outcome IN ('advance','return-for-response')))
);
CREATE INDEX ai_risk_strategy_events_taskId_idx ON ai_risk_strategy_events("taskId");
CREATE TRIGGER ai_authority_reversal_immutable BEFORE UPDATE OR DELETE ON ai_risk_authority_reversals FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
CREATE TRIGGER ai_strategy_event_immutable BEFORE UPDATE OR DELETE ON ai_risk_strategy_events FOR EACH ROW EXECUTE FUNCTION ai_review_immutable();
ALTER TABLE ai_risk_reassessments DROP CONSTRAINT ai_reassessment_shape;
ALTER TABLE ai_risk_reassessments ADD CONSTRAINT ai_reassessment_shape CHECK ("inherentRound">0 AND "triggerCode" IN ('material_change','provider_change','data_change','incident','nonconformity','regulatory_change','detected_deviation','authority_reversal') AND length(btrim(justification)) BETWEEN 1 AND 5000 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20);

CREATE FUNCTION ai_actual_authority_level(role_code TEXT) RETURNS INTEGER LANGUAGE SQL IMMUTABLE AS $$
 SELECT CASE role_code WHEN 'AI_USECASE_OWNER' THEN 0 WHEN 'AI_GOVERNANCE_OFFICER' THEN 1 WHEN 'AI_ETHICS_COMMITTEE' THEN 2 WHEN 'AI_EXECUTIVE_TEAM' THEN 3 WHEN 'STEERING_COMMITTEE' THEN 4 ELSE -1 END
$$;
CREATE FUNCTION ai_outcome_live_grant(actor_id TEXT, role_code TEXT, resource_code TEXT, action_code TEXT) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur."userId"=u.id JOIN roles r ON r.id=ur."roleId" JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId"
 WHERE u.id=actor_id AND u."isActive" AND r.code=role_code AND r."isActive" AND r."deletedAt" IS NULL AND p.resource=resource_code AND p.action=action_code)
 AND NOT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" WHERE ur."userId"=actor_id AND r.code='auditor' AND r."isActive" AND r."deletedAt" IS NULL)
$$;
CREATE FUNCTION ai_authority_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous ai_risk_assessment_decisions; reassessment ai_risk_reassessments; risk ai_risks; owner_id TEXT; use_owner TEXT;
BEGIN
 SELECT * INTO previous FROM ai_risk_assessment_decisions WHERE id=NEW."previousDecisionId";
 SELECT * INTO reassessment FROM ai_risk_reassessments WHERE id=NEW."reassessmentId";
 SELECT * INTO risk FROM ai_risks WHERE id=NEW."riskId";
 SELECT "userId" INTO owner_id FROM people WHERE id=risk."ownerPersonId";
 SELECT p."userId" INTO use_owner FROM ai_use_cases uc JOIN people p ON p.id=uc."ownerPersonId" WHERE uc.id=risk."useCaseId";
 IF reassessment."riskId"<>risk.id OR reassessment."previousAcceptanceDecisionId"<>previous.id OR reassessment."actorId"<>NEW."actorId" OR reassessment."triggerCode"<>'authority_reversal'
 OR NEW."actorId"=previous."actorId" OR NEW."actorId"=owner_id OR NEW."actorId"=use_owner
 OR NEW."authorityLevel"<>ai_actual_authority_level(NEW."actorRoleCode") OR NEW."previousAuthorityLevel"<>ai_actual_authority_level(previous."actorRoleCode")
 OR NOT ai_outcome_live_grant(NEW."actorId",NEW."actorRoleCode",'airs.risk','reverse')
 THEN RAISE EXCEPTION 'Independent higher live authority and matching reassessment provenance required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_authority_reversal_guard BEFORE INSERT ON ai_risk_authority_reversals FOR EACH ROW EXECUTE FUNCTION ai_authority_reversal_guard();
-- An internally derived trigger cannot exist without its authority ledger, even through direct writes.
CREATE FUNCTION ai_reversal_basis_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."triggerCode"='authority_reversal' AND NOT EXISTS(SELECT 1 FROM ai_risk_authority_reversals WHERE "reassessmentId"=NEW.id) THEN RAISE EXCEPTION 'Authority reversal ledger required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ai_reversal_basis_required AFTER INSERT ON ai_risk_reassessments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_reversal_basis_required();

CREATE FUNCTION ai_strategy_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE response ai_risk_responses; risk ai_risks; task workflow_tasks; previous ai_risk_strategy_events; proposal ai_risk_strategy_events; stage_code TEXT; owner_id TEXT; use_owner TEXT; escalation governance_escalations;
BEGIN
 SELECT * INTO response FROM ai_risk_responses WHERE id=NEW."responseId";
 SELECT * INTO risk FROM ai_risks WHERE id=response."riskId";
 SELECT * INTO task FROM workflow_tasks WHERE id=NEW."taskId";
 SELECT code INTO stage_code FROM workflow_template_stages WHERE id=task."templateStageId";
 SELECT * INTO previous FROM ai_risk_strategy_events WHERE "responseId"=response.id ORDER BY round DESC LIMIT 1;
 SELECT "userId" INTO owner_id FROM people WHERE id=risk."ownerPersonId" AND "isActive" AND "deletedAt" IS NULL;
 SELECT p."userId" INTO use_owner FROM ai_use_cases uc JOIN people p ON p.id=uc."ownerPersonId" WHERE uc.id=risk."useCaseId";
 IF task."caseId"<>risk."workflowCaseId" OR task.status<>'pending' OR task."formDataJson"->>'responseId' IS DISTINCT FROM response.id
 OR NEW.round<>coalesce(previous.round,0)+1 OR NEW."basisEventId" IS DISTINCT FROM previous.id
 OR owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM workflow_cases WHERE id=risk."workflowCaseId" AND status='under_review')
 OR NOT EXISTS(SELECT 1 FROM ai_risk_response_decisions WHERE "responseId"=response.id AND kind='officer' AND decision='approve')
 OR EXISTS(SELECT 1 FROM ai_risk_responses WHERE "riskId"=risk.id AND round>response.round)
 OR NOT EXISTS(SELECT 1 FROM ai_assessment_rounds a JOIN ai_risk_assessment_decisions d ON d."assessmentId"=a.id WHERE a.id=response."assessmentId" AND a.kind='inherent' AND d.kind='adoption' AND d.decision='approve'
   AND a.round>=coalesce((SELECT max("inherentRound") FROM ai_risk_reassessments WHERE "riskId"=risk.id),1)
   AND a.round>=coalesce((SELECT max(t."requiredInherentRound") FROM ai_reassessment_triggers t JOIN ai_risk_reassessments r ON r.id=t."reassessmentId" WHERE r."riskId"=risk.id),1))
 THEN RAISE EXCEPTION 'Current approved response, protected task and sequential immutable basis required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence WHERE id=e AND "deletedAt" IS NULL)) THEN RAISE EXCEPTION 'Existing evidence required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='avoidance_proposed' THEN
   IF response."strategyCode"<>'AVOID' OR stage_code<>'airs-avoidance-review' OR NEW."actorId"<>owner_id OR NEW."actorRoleCode"<>'AI_RISK_OWNER' OR NOT ai_outcome_live_grant(NEW."actorId",'AI_RISK_OWNER','airs.risk','assess')
   OR length(btrim(coalesce(NEW.payload->>'scopeChange',''))) NOT BETWEEN 1 AND 5000 OR (previous.id IS NOT NULL AND NOT(previous.kind='avoidance_review' AND previous.outcome='return'))
   THEN RAISE EXCEPTION 'Actual Risk Owner avoidance proposal required' USING ERRCODE='23514'; END IF;
 ELSE
   IF NEW."actorId"=owner_id OR NEW."actorId"=use_owner OR NEW."actorId"=response."submittedBy" OR NEW."actorRoleCode" IS DISTINCT FROM task."assigneeRoleCode" OR (task."assigneeUserId" IS NOT NULL AND task."assigneeUserId"<>NEW."actorId")
   OR ai_actual_authority_level(NEW."actorRoleCode") NOT BETWEEN 1 AND 4 OR NOT ai_outcome_live_grant(NEW."actorId",NEW."actorRoleCode",'airs.strategy','decide') THEN RAISE EXCEPTION 'Assigned independent live operational authority required' USING ERRCODE='23514'; END IF;
   IF NEW.kind='avoidance_review' AND (response."strategyCode"<>'AVOID' OR stage_code<>'airs-avoidance-review' OR previous.kind IS DISTINCT FROM 'avoidance_proposed' OR NEW."actorRoleCode"<>'AI_GOVERNANCE_OFFICER') THEN RAISE EXCEPTION 'Avoidance proposal review required' USING ERRCODE='23514'; END IF;
   IF NEW.kind='avoidance_closed' THEN
     SELECT * INTO proposal FROM ai_risk_strategy_events WHERE id=previous."basisEventId";
     IF response."strategyCode"<>'AVOID' OR stage_code<>'airs-closure' OR previous.kind IS DISTINCT FROM 'avoidance_review' OR previous.outcome IS DISTINCT FROM 'approve' OR proposal.kind IS DISTINCT FROM 'avoidance_proposed' OR NEW.outcome IS DISTINCT FROM proposal.outcome
     OR NEW."actorRoleCode"<>(CASE WHEN NEW.outcome='stop_use_case' THEN 'STEERING_COMMITTEE' ELSE 'AI_GOVERNANCE_OFFICER' END) OR (NEW.outcome='stop_use_case' AND NEW."actorId"=previous."actorId") THEN RAISE EXCEPTION 'Approved verified avoidance and correct final closure authority required' USING ERRCODE='23514'; END IF;
   END IF;
   IF NEW.kind IN ('escalation_open','escalation_outcome') THEN
     SELECT * INTO escalation FROM governance_escalations WHERE id=NEW."escalationId";
     IF response."strategyCode"<>'ESCALATE' OR stage_code<>'airs-escalation-gate' OR escalation.id IS NULL OR escalation."sourceType"<>'ai_risk_strategy' OR escalation."sourceId"<>response.id OR escalation.status<>'open' OR escalation."workflowTaskId"<>task.id OR escalation."ownerRoleCode"<>NEW."actorRoleCode"
     OR (NEW.kind='escalation_open' AND (previous.id IS NOT NULL OR escalation.level<>'domain_council' OR NEW."actorRoleCode"<>'AI_GOVERNANCE_OFFICER'))
     OR (NEW.kind='escalation_outcome' AND (previous.kind NOT IN ('escalation_open','escalation_outcome') OR previous.outcome='return-for-response' OR NEW.payload->>'councilLevel' IS DISTINCT FROM escalation.level::TEXT OR (NEW.outcome='advance' AND escalation.level='executive_steering_committee')))
     THEN RAISE EXCEPTION 'Live assigned council escalation provenance required' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_strategy_event_guard BEFORE INSERT ON ai_risk_strategy_events FOR EACH ROW EXECUTE FUNCTION ai_strategy_event_guard();

ALTER TABLE ai_use_cases ADD COLUMN "operationalStrategyEventId" TEXT REFERENCES ai_risk_strategy_events(id) ON DELETE RESTRICT;
ALTER TABLE ai_use_cases DROP CONSTRAINT ai_use_case_operational_status;
ALTER TABLE ai_use_cases ADD CONSTRAINT ai_use_case_operational_status CHECK (("operationalStatusCode" IS NULL AND "operationalDecisionId" IS NULL AND "operationalStrategyEventId" IS NULL) OR ("operationalStatusCode" IN ('SUSPENDED','ARCHIVED') AND (("operationalDecisionId" IS NOT NULL)::INTEGER+("operationalStrategyEventId" IS NOT NULL)::INTEGER)=1));
CREATE OR REPLACE FUNCTION dgop_ai_operational_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."operationalStatusCode" IS NOT DISTINCT FROM OLD."operationalStatusCode" AND NEW."operationalDecisionId" IS NOT DISTINCT FROM OLD."operationalDecisionId" AND NEW."operationalStrategyEventId" IS NOT DISTINCT FROM OLD."operationalStrategyEventId" THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NEW."operationalStatusCode" IS NULL AND NEW."operationalDecisionId" IS NULL AND NEW."operationalStrategyEventId" IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD."operationalStatusCode"='ARCHIVED' AND NEW."operationalStatusCode" IS DISTINCT FROM 'ARCHIVED' THEN RAISE EXCEPTION 'Archived use case cannot be reopened by a lower outcome' USING ERRCODE='23514'; END IF;
 IF NEW."operationalStrategyEventId" IS NOT NULL THEN
   PERFORM 1 FROM ai_risk_strategy_events e JOIN ai_risk_responses r ON r.id=e."responseId" JOIN ai_risks a ON a.id=r."riskId" WHERE e.id=NEW."operationalStrategyEventId" AND a."useCaseId"=NEW.id AND e.kind='avoidance_closed' AND e.outcome='stop_use_case' AND e."actorRoleCode"='STEERING_COMMITTEE' AND NEW."operationalStatusCode"='ARCHIVED';
 ELSE
   PERFORM 1 FROM ai_risk_assessment_decisions d JOIN ai_assessment_rounds a ON a.id=d."assessmentId" WHERE d.id=NEW."operationalDecisionId" AND a."useCaseId"=NEW.id AND a.kind='residual' AND d.kind='steering' AND NEW."operationalStatusCode"=CASE d.decision WHEN 'restrict' THEN 'SUSPENDED' WHEN 'stop' THEN 'ARCHIVED' END;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Use-case restriction/stop requires its immutable authorized decision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
