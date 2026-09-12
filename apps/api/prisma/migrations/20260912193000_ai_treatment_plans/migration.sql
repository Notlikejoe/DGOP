ALTER TABLE ai_treatment_actions ADD COLUMN "responseId" TEXT, ADD COLUMN "planData" JSONB;
ALTER TABLE ai_treatment_actions ADD CONSTRAINT "ai_treatment_actions_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES ai_risk_responses(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE ai_treatment_plans (
 id TEXT PRIMARY KEY, "responseId" TEXT NOT NULL, round INTEGER NOT NULL CHECK(round > 0), "taskId" TEXT NOT NULL,
 "submittedBy" TEXT NOT NULL, snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ai_treatment_plans_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES ai_risk_responses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ai_treatment_plans_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES workflow_tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_treatment_plans_responseId_round_key" ON ai_treatment_plans("responseId",round);
CREATE UNIQUE INDEX "ai_treatment_plans_taskId_key" ON ai_treatment_plans("taskId");
CREATE TABLE ai_treatment_plan_decisions (
 id TEXT PRIMARY KEY, "planId" TEXT NOT NULL, "taskId" TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approve','return')),
 "actorId" TEXT NOT NULL, justification TEXT NOT NULL CHECK(length(trim(justification)) BETWEEN 1 AND 5000),
 "evidenceIds" JSONB NOT NULL CHECK(jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20),
 "clientIp" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ai_treatment_plan_decisions_planId_fkey" FOREIGN KEY ("planId") REFERENCES ai_treatment_plans(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ai_treatment_plan_decisions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES workflow_tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_treatment_plan_decisions_planId_key" ON ai_treatment_plan_decisions("planId");
CREATE UNIQUE INDEX "ai_treatment_plan_decisions_taskId_key" ON ai_treatment_plan_decisions("taskId");
CREATE TRIGGER ai_treatment_plan_immutable BEFORE UPDATE OR DELETE ON ai_treatment_plans FOR EACH ROW EXECUTE FUNCTION dgop_ai_immutable_snapshot();
CREATE TRIGGER ai_treatment_plan_decision_immutable BEFORE UPDATE OR DELETE ON ai_treatment_plan_decisions FOR EACH ROW EXECUTE FUNCTION dgop_ai_immutable_snapshot();
CREATE FUNCTION dgop_ai_treatment_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='ai_treatment_plans' THEN
  PERFORM 1 FROM ai_risk_responses p JOIN ai_risks r ON r.id=p."riskId" JOIN workflow_tasks t ON t.id=NEW."taskId" AND t."caseId"=r."workflowCaseId"
   JOIN workflow_template_stages s ON s.id=t."templateStageId"
   WHERE p.id=NEW."responseId" AND p."strategyCode" IN ('MITIGATE','TRANSFER') AND s.code='airs-treatment-plan'
    AND t."assigneeRoleCode"='AI_RISK_OWNER' AND t."formDataJson"->>'responseId'=p.id
    AND EXISTS(SELECT 1 FROM ai_risk_response_decisions d WHERE d."responseId"=p.id AND d.kind='officer' AND d.decision='approve');
 ELSE
  PERFORM 1 FROM ai_treatment_plans p JOIN ai_risk_responses x ON x.id=p."responseId" JOIN ai_risks r ON r.id=x."riskId"
   JOIN workflow_tasks t ON t.id=NEW."taskId" AND t."caseId"=r."workflowCaseId" JOIN workflow_template_stages s ON s.id=t."templateStageId"
   WHERE p.id=NEW."planId" AND s.code='airs-plan-approval' AND t."assigneeRoleCode"='AI_GOVERNANCE_OFFICER' AND t."formDataJson"->>'planId'=p.id;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Treatment plan parent/task mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_treatment_plan_parent BEFORE INSERT ON ai_treatment_plans FOR EACH ROW EXECUTE FUNCTION dgop_ai_treatment_parent_guard();
CREATE TRIGGER ai_treatment_plan_decision_parent BEFORE INSERT ON ai_treatment_plan_decisions FOR EACH ROW EXECUTE FUNCTION dgop_ai_treatment_parent_guard();
CREATE FUNCTION dgop_ai_treatment_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD."responseId" IS NOT NULL AND OLD."responseId" IS DISTINCT FROM NEW."responseId" THEN
  RAISE EXCEPTION 'Action response provenance is permanent' USING ERRCODE='23514';
 END IF;
 IF NEW."responseId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_risk_responses p WHERE p.id=NEW."responseId" AND p."riskId"=NEW."riskId" AND p."strategyCode" IN ('MITIGATE','TRANSFER')) THEN
  RAISE EXCEPTION 'Action requires its matching treatment response' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM ai_treatment_plans p LEFT JOIN ai_treatment_plan_decisions d ON d."planId"=p.id WHERE p."responseId"=NEW."responseId" AND (d.id IS NULL OR d.decision='approve')) THEN
  RAISE EXCEPTION 'Submitted or approved plan cannot acquire extra actions' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (OLD.title IS DISTINCT FROM NEW.title OR OLD."planData" IS DISTINCT FROM NEW."planData" OR OLD."targetDate" IS DISTINCT FROM NEW."targetDate" OR OLD."assigneePersonId" IS DISTINCT FROM NEW."assigneePersonId" OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt")
  AND EXISTS(SELECT 1 FROM ai_treatment_plans p LEFT JOIN ai_treatment_plan_decisions d ON d."planId"=p.id
   WHERE p."responseId"=OLD."responseId" AND (d.id IS NULL OR d.decision='approve') AND p.snapshot->'actionIds' ? OLD.id) THEN
  RAISE EXCEPTION 'Submitted or approved action plan details are frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_treatment_action_parent BEFORE INSERT OR UPDATE ON ai_treatment_actions FOR EACH ROW EXECUTE FUNCTION dgop_ai_treatment_action_guard();
