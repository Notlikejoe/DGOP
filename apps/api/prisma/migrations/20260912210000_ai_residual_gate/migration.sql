-- The existing immutable calculation table is reused; no mutable residual scores are added.
CREATE FUNCTION dgop_ai_residual_gate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind <> 'residual' THEN RETURN NEW; END IF;
 PERFORM 1 FROM ai_risks r
  JOIN ai_assessment_rounds i ON i.id=NEW.inputs->>'inherentAssessmentId' AND i."riskId"=r.id AND i.kind='inherent'
  JOIN ai_risk_assessment_decisions ad ON ad."assessmentId"=i.id AND ad.kind='adoption' AND ad.decision='approve'
  JOIN ai_risk_responses p ON p.id=NEW.inputs->>'responseId' AND p."riskId"=r.id AND p."assessmentId"=i.id
  JOIN ai_risk_response_decisions d ON d."responseId"=p.id AND d.kind='officer' AND d.decision='approve'
  JOIN workflow_tasks t ON t.id=NEW.inputs->>'coordinatorTaskId' AND t."caseId"=r."workflowCaseId" AND t."assigneeUserId"=NEW."createdBy" AND t."assigneeRoleCode"='AI_RISK_OWNER'
  JOIN workflow_template_stages s ON s.id=t."templateStageId" AND s.code='airs-residual-assessment'
  JOIN governed_reference_versions v ON v.id=NEW.inputs->'controlEffectiveness'->>'referenceVersionId' AND v."listCode"='R_CTRLEFF' AND v.state='published'
  JOIN governed_reference_values cv ON cv."versionId"=v.id AND cv.code=NEW.inputs->'controlEffectiveness'->>'code'
  WHERE r.id=NEW."riskId" AND t."formDataJson"->>'responseId'=p.id
   AND length(trim(NEW.inputs->>'currentControls'))>0
   AND ((p."strategyCode"='ACCEPT' AND i.result->>'bandCode' IN ('LOW','MEDIUM')) OR
    (p."strategyCode" IN ('MITIGATE','TRANSFER') AND EXISTS(
     SELECT 1 FROM ai_treatment_plans pl JOIN ai_treatment_plan_decisions pd ON pd."planId"=pl.id AND pd.decision='approve'
      WHERE pl.id=NEW.inputs->>'planId' AND pl."responseId"=p.id AND jsonb_array_length(pl.snapshot->'actionIds')>0
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(pl.snapshot->'actionIds') aid
        WHERE NOT EXISTS(SELECT 1 FROM ai_treatment_actions a JOIN workflow_tasks at ON at.id=a."workflowTaskId" AND at.status='completed'
         JOIN ai_treatment_progress pr ON pr."actionId"=a.id AND pr."taskId"=at.id AND pr."completionPct"=100 AND pr."completedAt" IS NOT NULL
         WHERE a.id=aid AND a."responseId"=p.id AND a."deletedAt" IS NULL)))))
  FOR SHARE OF v;
 IF NOT FOUND THEN RAISE EXCEPTION 'Residual calculation requires adopted provenance, controls and completed treatment (RM-24)' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_residual_gate_guard BEFORE INSERT ON ai_assessment_rounds FOR EACH ROW EXECUTE FUNCTION dgop_ai_residual_gate_guard();
