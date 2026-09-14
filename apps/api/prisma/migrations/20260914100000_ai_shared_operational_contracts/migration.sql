-- Serialize risk intake against an authorized stop/restriction. Existing governance
-- assessment, remediation and monitoring history remains operable and immutable.
CREATE FUNCTION ai_risk_active_intake_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operational TEXT;
BEGIN
 IF TG_OP='UPDATE' AND NEW."useCaseId"=OLD."useCaseId" AND
   NEW."intakeData" IS NOT DISTINCT FROM OLD."intakeData" AND
   NEW."ownerPersonId" IS NOT DISTINCT FROM OLD."ownerPersonId" AND
   NEW."riskRef" IS NOT DISTINCT FROM OLD."riskRef" AND NEW.title IS NOT DISTINCT FROM OLD.title
   AND NEW.cause IS NOT DISTINCT FROM OLD.cause AND NEW.event IS NOT DISTINCT FROM OLD.event
   AND NEW.effect IS NOT DISTINCT FROM OLD.effect AND NEW."controlPins" IS NOT DISTINCT FROM OLD."controlPins" THEN RETURN NEW; END IF;
 SELECT "operationalStatusCode" INTO operational FROM ai_use_cases WHERE id=NEW."useCaseId" FOR SHARE;
 IF operational IN ('SUSPENDED','ARCHIVED') AND (TG_OP='INSERT' OR OLD."riskRef" IS NULL) THEN
   RAISE EXCEPTION 'New risk intake requires an operational AI use case' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_risk_active_intake_guard BEFORE INSERT OR UPDATE ON ai_risks FOR EACH ROW EXECUTE FUNCTION ai_risk_active_intake_guard();

-- Native escalation mutations cannot bypass the append-only AI council outcomes.
-- Deferred evaluation permits the strategy service's event + next task transaction.
CREATE FUNCTION ai_shared_escalation_outcome_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest ai_risk_strategy_events; current_row governance_escalations; expected_level TEXT; expected_role TEXT;
BEGIN
 IF OLD."sourceType" IS DISTINCT FROM 'ai_risk_strategy' THEN RETURN NULL; END IF;
 SELECT * INTO current_row FROM governance_escalations WHERE id=OLD.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI council escalations cannot be deleted' USING ERRCODE='23514'; END IF;
 IF current_row."sourceType" IS DISTINCT FROM OLD."sourceType" OR current_row."sourceId" IS DISTINCT FROM OLD."sourceId"
   OR current_row."workflowCaseId" IS DISTINCT FROM OLD."workflowCaseId" OR current_row."dedupeKey" IS DISTINCT FROM OLD."dedupeKey" THEN
   RAISE EXCEPTION 'AI escalation provenance is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO latest FROM ai_risk_strategy_events WHERE "escalationId"=OLD.id ORDER BY round DESC LIMIT 1;
 IF latest.id IS NULL THEN RAISE EXCEPTION 'AI escalation requires an immutable council outcome' USING ERRCODE='23514'; END IF;
 IF latest.outcome='return-for-response' THEN
   expected_level=latest.payload->>'councilLevel';
   IF current_row.status<>'resolved' OR current_row."resolvedAt" IS NULL THEN RAISE EXCEPTION 'AI response return must resolve its escalation' USING ERRCODE='23514'; END IF;
 ELSE
   expected_level=CASE WHEN latest.kind='escalation_open' THEN 'domain_council' ELSE CASE latest.payload->>'councilLevel'
     WHEN 'domain_council' THEN 'data_stewardship_council' WHEN 'data_stewardship_council' THEN 'data_governance_board'
     WHEN 'data_governance_board' THEN 'executive_steering_committee' END END;
   IF current_row.status<>'open' OR current_row."resolvedAt" IS NOT NULL THEN RAISE EXCEPTION 'AI council escalation stays open until its governed return' USING ERRCODE='23514'; END IF;
 END IF;
 expected_role=CASE expected_level WHEN 'domain_council' THEN 'AI_GOVERNANCE_OFFICER' WHEN 'data_stewardship_council' THEN 'AI_ETHICS_COMMITTEE'
   WHEN 'data_governance_board' THEN 'AI_EXECUTIVE_TEAM' WHEN 'executive_steering_committee' THEN 'STEERING_COMMITTEE' END;
 IF current_row.level::TEXT IS DISTINCT FROM expected_level OR current_row."ownerRoleCode" IS DISTINCT FROM expected_role OR
   (latest.outcome='return-for-response' AND current_row."workflowTaskId" IS DISTINCT FROM latest."taskId") OR
   (latest.outcome<>'return-for-response' AND NOT EXISTS(SELECT 1 FROM workflow_tasks WHERE id=current_row."workflowTaskId" AND "caseId"=current_row."workflowCaseId"
    AND "assigneeRoleCode"=expected_role AND "formDataJson"->>'strategyEventId'=latest.id)
   ) THEN
   RAISE EXCEPTION 'AI escalation must match its latest council event and assigned task' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ai_shared_escalation_outcome_guard AFTER UPDATE OR DELETE ON governance_escalations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_shared_escalation_outcome_guard();
