CREATE TABLE ai_risk_responses (
  id TEXT NOT NULL PRIMARY KEY, "riskId" TEXT NOT NULL, "assessmentId" TEXT NOT NULL, round INTEGER NOT NULL,
  "proposalTaskId" TEXT NOT NULL, "referenceVersionId" TEXT NOT NULL, "strategyCode" TEXT NOT NULL,
  payload JSONB NOT NULL, "submittedBy" TEXT NOT NULL, "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_risk_responses_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES ai_risks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_risk_responses_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES ai_assessment_rounds(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_risk_responses_proposalTaskId_fkey" FOREIGN KEY ("proposalTaskId") REFERENCES workflow_tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_risk_responses_referenceVersionId_fkey" FOREIGN KEY ("referenceVersionId") REFERENCES governed_reference_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ai_risk_response_valid CHECK (round > 0 AND "strategyCode" IN ('AVOID','MITIGATE','TRANSFER','ACCEPT','ESCALATE')
    AND jsonb_typeof(payload) = 'object' AND length(trim("submittedBy")) > 0)
);
CREATE UNIQUE INDEX "ai_risk_responses_riskId_round_key" ON ai_risk_responses("riskId",round);
CREATE UNIQUE INDEX "ai_risk_responses_proposalTaskId_key" ON ai_risk_responses("proposalTaskId");
CREATE TRIGGER ai_risk_response_append_only BEFORE UPDATE OR DELETE ON ai_risk_responses FOR EACH ROW EXECUTE FUNCTION dgop_ai_immutable_snapshot();
CREATE FUNCTION dgop_ai_risk_response_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM ai_assessment_rounds a JOIN ai_risks r ON r.id = a."riskId"
    JOIN workflow_tasks t ON t.id = NEW."proposalTaskId" AND t."caseId" = r."workflowCaseId"
    JOIN workflow_template_stages s ON s.id = t."templateStageId"
    JOIN governed_reference_versions v ON v.id = NEW."referenceVersionId" AND v."listCode" = 'R_STRATEGY' AND v.state = 'published'
    JOIN governed_reference_values val ON val."versionId" = v.id AND val.code = NEW."strategyCode"
    WHERE a.id = NEW."assessmentId" AND r.id = NEW."riskId" AND a.kind = 'inherent'
      AND s.code = 'airs-response-proposal' AND t."assigneeRoleCode" = 'AI_RISK_OWNER' AND t."assigneeUserId" = NEW."submittedBy"
      AND t."formDataJson"->>'assessmentId' = a.id
      AND EXISTS (SELECT 1 FROM ai_risk_assessment_decisions d WHERE d."assessmentId" = a.id AND d.kind = 'adoption' AND d.decision = 'approve')
    FOR SHARE OF v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Response proposal requires an adopted inherent assessment, assigned task and published strategy' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_risk_response_parent BEFORE INSERT ON ai_risk_responses FOR EACH ROW EXECUTE FUNCTION dgop_ai_risk_response_guard();

CREATE TABLE ai_risk_response_decisions (
  id TEXT NOT NULL PRIMARY KEY, "responseId" TEXT NOT NULL, "taskId" TEXT NOT NULL, kind TEXT NOT NULL, decision TEXT NOT NULL,
  "actorId" TEXT NOT NULL, "actorRoleCode" TEXT NOT NULL, justification TEXT NOT NULL, "evidenceIds" JSONB NOT NULL,
  "clientIp" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_risk_response_decisions_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES ai_risk_responses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_risk_response_decisions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES workflow_tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ai_risk_response_decision_valid CHECK (kind IN ('officer','privacy','security') AND decision IN ('approve','return')
    AND "actorRoleCode" = CASE kind WHEN 'officer' THEN 'AI_GOVERNANCE_OFFICER' WHEN 'privacy' THEN 'privacy_officer' ELSE 'security_reviewer' END
    AND length(trim("actorId")) > 0 AND length(trim(justification)) BETWEEN 1 AND 5000
    AND jsonb_typeof("evidenceIds") = 'array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX "ai_risk_response_decisions_responseId_kind_key" ON ai_risk_response_decisions("responseId",kind);
CREATE UNIQUE INDEX "ai_risk_response_decisions_taskId_key" ON ai_risk_response_decisions("taskId");
CREATE TRIGGER ai_risk_response_decision_append_only BEFORE UPDATE OR DELETE ON ai_risk_response_decisions FOR EACH ROW EXECUTE FUNCTION dgop_ai_immutable_snapshot();
CREATE FUNCTION dgop_ai_risk_response_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM ai_risk_responses p JOIN ai_risks r ON r.id = p."riskId"
    JOIN workflow_tasks t ON t.id = NEW."taskId" AND t."caseId" = r."workflowCaseId"
    JOIN workflow_template_stages s ON s.id = t."templateStageId"
    WHERE p.id = NEW."responseId" AND t."formDataJson"->>'responseId' = p.id AND t."assigneeRoleCode" = NEW."actorRoleCode"
      AND s.code = CASE NEW.kind WHEN 'officer' THEN 'airs-response' ELSE 'airs-transfer-consultation' END;
  IF NOT FOUND THEN RAISE EXCEPTION 'Response decision requires its matching response and task' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_risk_response_decision_parent BEFORE INSERT ON ai_risk_response_decisions FOR EACH ROW EXECUTE FUNCTION dgop_ai_risk_response_decision_guard();
