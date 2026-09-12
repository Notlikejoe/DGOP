CREATE TABLE ai_treatment_progress (
 id TEXT PRIMARY KEY, "actionId" TEXT NOT NULL, "taskId" TEXT NOT NULL, round INTEGER NOT NULL CHECK(round>0),
 "completionPct" INTEGER NOT NULL CHECK("completionPct" BETWEEN 0 AND 100), justification TEXT NOT NULL CHECK(length(trim(justification)) BETWEEN 1 AND 5000),
 "evidenceIds" JSONB NOT NULL CHECK(jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds")<=20),
 "actorId" TEXT NOT NULL, "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ai_treatment_progress_completion CHECK(("completionPct"=100)=("completedAt" IS NOT NULL)),
 CONSTRAINT "ai_treatment_progress_actionId_fkey" FOREIGN KEY("actionId") REFERENCES ai_treatment_actions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ai_treatment_progress_taskId_fkey" FOREIGN KEY("taskId") REFERENCES workflow_tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_treatment_progress_actionId_round_key" ON ai_treatment_progress("actionId",round);
CREATE TRIGGER ai_treatment_progress_immutable BEFORE UPDATE OR DELETE ON ai_treatment_progress FOR EACH ROW EXECUTE FUNCTION dgop_ai_immutable_snapshot();
CREATE FUNCTION dgop_ai_treatment_progress_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM ai_treatment_actions a JOIN ai_risks r ON r.id=a."riskId" JOIN workflow_tasks t ON t.id=NEW."taskId" AND t.id=a."workflowTaskId" AND t."caseId"=r."workflowCaseId"
  JOIN ai_treatment_plans p ON p.id=t."formDataJson"->>'planId' AND p."responseId"=a."responseId"
  JOIN ai_treatment_plan_decisions d ON d."planId"=p.id AND d.decision='approve'
  WHERE a.id=NEW."actionId" AND p.snapshot->'actionIds' ? a.id AND t."assigneeUserId"=NEW."actorId" AND d."actorId"<>NEW."actorId";
 IF NOT FOUND THEN RAISE EXCEPTION 'Progress requires its approved plan and assigned independent executor task' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_treatment_progress_parent BEFORE INSERT ON ai_treatment_progress FOR EACH ROW EXECUTE FUNCTION dgop_ai_treatment_progress_parent();
