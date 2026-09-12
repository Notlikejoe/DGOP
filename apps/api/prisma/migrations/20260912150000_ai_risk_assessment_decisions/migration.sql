CREATE TABLE "ai_risk_assessment_decisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assessmentId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorRoleCode" TEXT NOT NULL,
  "justification" TEXT NOT NULL,
  "evidenceIds" JSONB NOT NULL,
  "clientIp" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_risk_assessment_decisions_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ai_assessment_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_risk_assessment_decisions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_risk_assessment_decision_valid" CHECK (
    kind IN ('ethics','adoption') AND decision IN ('approve','return')
    AND "actorRoleCode" = CASE kind WHEN 'ethics' THEN 'AI_ETHICS_COMMITTEE' ELSE 'AI_GOVERNANCE_OFFICER' END
    AND length(trim("actorId")) > 0 AND length(trim(justification)) BETWEEN 1 AND 5000
    AND jsonb_typeof("evidenceIds") = 'array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20
  )
);
CREATE UNIQUE INDEX "ai_risk_assessment_decisions_taskId_key" ON "ai_risk_assessment_decisions"("taskId");
CREATE UNIQUE INDEX "ai_risk_assessment_decisions_assessmentId_kind_key" ON "ai_risk_assessment_decisions"("assessmentId","kind");
CREATE TRIGGER ai_risk_assessment_decision_append_only BEFORE UPDATE OR DELETE ON "ai_risk_assessment_decisions"
FOR EACH ROW EXECUTE FUNCTION dgop_ai_immutable_snapshot();

CREATE FUNCTION dgop_ai_risk_decision_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM ai_assessment_rounds a JOIN ai_risks r ON r.id = a."riskId"
    JOIN workflow_tasks t ON t.id = NEW."taskId" AND t."caseId" = r."workflowCaseId"
    JOIN workflow_template_stages s ON s.id = t."templateStageId"
    WHERE a.id = NEW."assessmentId" AND a.kind = 'inherent'
      AND t."assigneeRoleCode" = NEW."actorRoleCode"
      AND t."formDataJson"->>'assessmentId' = a.id
      AND s.code = CASE NEW.kind WHEN 'ethics' THEN 'airs-ethics-review' ELSE 'airs-assessment-adoption' END;
  IF NOT FOUND THEN RAISE EXCEPTION 'Risk assessment decision requires its matching review task and inherent parent' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_risk_assessment_decision_parent BEFORE INSERT ON "ai_risk_assessment_decisions"
FOR EACH ROW EXECUTE FUNCTION dgop_ai_risk_decision_parent_guard();
