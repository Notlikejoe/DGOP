-- Defensive database boundary for operational paths, in addition to service checks.
CREATE FUNCTION ai_strategy_authority_provenance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE response ai_risk_responses; risk ai_risks; task workflow_tasks; previous ai_risk_strategy_events; escalation governance_escalations; expected_role TEXT;
BEGIN
 SELECT * INTO response FROM ai_risk_responses WHERE id=NEW."responseId";
 SELECT * INTO risk FROM ai_risks WHERE id=response."riskId";
 SELECT * INTO task FROM workflow_tasks WHERE id=NEW."taskId";
 IF NOT EXISTS(SELECT 1 FROM workflow_template_stages s JOIN workflow_templates t ON t.id=s."templateId" JOIN workflow_cases wc ON wc.id=task."caseId"
 WHERE s.id=task."templateStageId" AND s."templateId"=wc."templateId" AND s."isActive" AND t."isActive" AND t."deletedAt" IS NULL AND t.code='AIRS_LIFECYCLE_V1') THEN RAISE EXCEPTION 'Active bound AIRS stage required' USING ERRCODE='23514'; END IF;
 IF NEW.outcome NOT IN ('return','return-for-response') AND NOT EXISTS(SELECT 1 FROM governed_reference_versions WHERE id=response."referenceVersionId" AND "listCode"='R_STRATEGY' AND state='published' AND "effectiveFrom"<=CURRENT_TIMESTAMP AND ("effectiveTo" IS NULL OR "effectiveTo">CURRENT_TIMESTAMP)) THEN RAISE EXCEPTION 'Current pinned strategy publication required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='escalation_outcome' THEN
   SELECT * INTO previous FROM ai_risk_strategy_events WHERE id=NEW."basisEventId";
   SELECT * INTO escalation FROM governance_escalations WHERE id=NEW."escalationId";
   expected_role=CASE escalation.level WHEN 'domain_council' THEN 'AI_GOVERNANCE_OFFICER' WHEN 'data_stewardship_council' THEN 'AI_ETHICS_COMMITTEE' WHEN 'data_governance_board' THEN 'AI_EXECUTIVE_TEAM' WHEN 'executive_steering_committee' THEN 'STEERING_COMMITTEE' END;
   IF previous.id IS NULL OR previous.kind NOT IN ('escalation_open','escalation_outcome') OR previous.outcome='return-for-response'
   OR NEW."actorRoleCode" IS DISTINCT FROM expected_role OR task."formDataJson"->>'strategyEventId' IS DISTINCT FROM previous.id
   OR escalation.id IS NULL OR previous."escalationId" IS DISTINCT FROM escalation.id
   OR escalation.level::TEXT IS DISTINCT FROM (CASE WHEN previous.kind='escalation_open' THEN 'domain_council' ELSE CASE previous.payload->>'councilLevel' WHEN 'domain_council' THEN 'data_stewardship_council' WHEN 'data_stewardship_council' THEN 'data_governance_board' WHEN 'data_governance_board' THEN 'executive_steering_committee' END END)
   THEN RAISE EXCEPTION 'Exact live council role and immutable predecessor level required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_strategy_authority_provenance_guard BEFORE INSERT ON ai_risk_strategy_events FOR EACH ROW EXECUTE FUNCTION ai_strategy_authority_provenance_guard();
