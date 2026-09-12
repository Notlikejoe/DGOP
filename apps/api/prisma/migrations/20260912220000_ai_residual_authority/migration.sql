ALTER TABLE ai_risk_assessment_decisions ADD COLUMN conditions JSONB NOT NULL DEFAULT '[]';
ALTER TABLE ai_risk_assessment_decisions DROP CONSTRAINT ai_risk_assessment_decision_valid;
ALTER TABLE ai_risk_assessment_decisions ADD CONSTRAINT ai_risk_assessment_decision_valid CHECK (
 ((kind IN ('ethics','adoption') AND decision IN ('approve','return')) OR
  (kind IN ('accept_owner','countersign','executive') AND decision IN ('accept','return')) OR
  (kind='steering' AND decision IN ('restrict','stop','return')))
 AND "actorRoleCode"=CASE kind WHEN 'ethics' THEN 'AI_ETHICS_COMMITTEE' WHEN 'accept_owner' THEN 'AI_USECASE_OWNER'
  WHEN 'executive' THEN 'AI_EXECUTIVE_TEAM' WHEN 'steering' THEN 'STEERING_COMMITTEE' ELSE 'AI_GOVERNANCE_OFFICER' END
 AND length(trim("actorId"))>0 AND length(trim(justification)) BETWEEN 1 AND 5000
 AND jsonb_typeof("evidenceIds")='array' AND jsonb_array_length("evidenceIds") BETWEEN 1 AND 20
 AND jsonb_typeof(conditions)='array' AND jsonb_array_length(conditions)<=20
);
CREATE OR REPLACE FUNCTION dgop_ai_risk_decision_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM ai_assessment_rounds a JOIN ai_risks r ON r.id=a."riskId"
  JOIN ai_use_cases u ON u.id=a."useCaseId"
  LEFT JOIN people ro ON ro.id=r."ownerPersonId" LEFT JOIN people uo ON uo.id=u."ownerPersonId"
  JOIN workflow_tasks t ON t.id=NEW."taskId" AND t."caseId"=r."workflowCaseId"
  JOIN workflow_template_stages s ON s.id=t."templateStageId"
  JOIN workflow_cases c ON c.id=t."caseId" JOIN workflow_templates wt ON wt.id=c."templateId"
  WHERE a.id=NEW."assessmentId" AND t."assigneeRoleCode"=NEW."actorRoleCode" AND t."formDataJson"->>'assessmentId'=a.id
   AND ((a.kind='inherent' AND NEW.kind IN ('ethics','adoption') AND s.code=CASE NEW.kind WHEN 'ethics' THEN 'airs-ethics-review' ELSE 'airs-assessment-adoption' END)
    OR (a.kind='residual' AND s."templateId"=c."templateId" AND s."isActive" AND wt.code='AIRS_LIFECYCLE_V1' AND wt."isActive" AND wt."deletedAt" IS NULL
     AND t.status='pending' AND (t."assigneeUserId" IS NULL OR t."assigneeUserId"=NEW."actorId")
     AND s.code=CASE NEW.kind WHEN 'adoption' THEN 'airs-residual-adoption' WHEN 'ethics' THEN 'airs-residual-ethics'
      WHEN 'accept_owner' THEN CASE a.result->>'bandCode' WHEN 'LOW' THEN 'airs-accept-low' ELSE 'airs-accept-medium-owner' END
      WHEN 'countersign' THEN 'airs-accept-medium-countersign' WHEN 'executive' THEN 'airs-accept-high' ELSE 'airs-restrict-critical' END
     AND NOT EXISTS(SELECT 1 FROM ai_risk_assessment_decisions d WHERE d."assessmentId"=a.id AND d.decision='return')
     AND (NEW.kind='adoption' OR EXISTS(SELECT 1 FROM ai_risk_assessment_decisions d WHERE d."assessmentId"=a.id AND d.kind='adoption' AND d.decision='approve'))
     AND CASE NEW.kind
      WHEN 'adoption' THEN NEW."actorId" IS DISTINCT FROM ro."userId" AND NEW."actorId" IS DISTINCT FROM uo."userId" AND NEW."actorId"<>a."createdBy"
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.inputs->'dimensions') x WHERE x->>'assessedBy'=NEW."actorId")
      WHEN 'ethics' THEN a.result->>'bandCode'='HIGH' AND NEW."actorId" IS DISTINCT FROM ro."userId" AND NEW."actorId" IS DISTINCT FROM uo."userId"
      WHEN 'accept_owner' THEN a.result->>'bandCode' IN ('LOW','MEDIUM') AND NEW."actorId"=uo."userId" AND (a.result->>'bandCode'='LOW' OR NEW."actorId" IS DISTINCT FROM ro."userId")
      WHEN 'countersign' THEN a.result->>'bandCode'='MEDIUM' AND NEW."actorId" IS DISTINCT FROM ro."userId" AND NEW."actorId" IS DISTINCT FROM uo."userId"
       AND EXISTS(SELECT 1 FROM ai_risk_assessment_decisions d WHERE d."assessmentId"=a.id AND d.kind='accept_owner' AND d.decision='accept' AND d."actorId"<>NEW."actorId")
      WHEN 'executive' THEN a.result->>'bandCode'='HIGH' AND NEW."actorId" IS DISTINCT FROM ro."userId"
       AND EXISTS(SELECT 1 FROM ai_risk_assessment_decisions d WHERE d."assessmentId"=a.id AND d.kind='ethics' AND d.decision='approve' AND d."actorId"<>NEW."actorId")
      WHEN 'steering' THEN a.result->>'bandCode'='CRITICAL' AND NEW."actorId" IS DISTINCT FROM ro."userId"
      ELSE false END));
 IF NOT FOUND THEN RAISE EXCEPTION 'Residual decision requires matching protected stage, band authority, independent prerequisites and parent' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

ALTER TABLE ai_use_cases ADD COLUMN "operationalStatusCode" TEXT, ADD COLUMN "operationalDecisionId" TEXT;
ALTER TABLE ai_use_cases ADD CONSTRAINT ai_use_case_operational_decision_fk FOREIGN KEY ("operationalDecisionId") REFERENCES ai_risk_assessment_decisions(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE ai_use_cases ADD CONSTRAINT ai_use_case_operational_status CHECK (("operationalStatusCode" IS NULL AND "operationalDecisionId" IS NULL) OR ("operationalStatusCode" IN ('SUSPENDED','ARCHIVED') AND "operationalDecisionId" IS NOT NULL));
CREATE FUNCTION dgop_ai_operational_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."operationalStatusCode" IS NOT DISTINCT FROM OLD."operationalStatusCode" AND NEW."operationalDecisionId" IS NOT DISTINCT FROM OLD."operationalDecisionId" THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NEW."operationalStatusCode" IS NULL AND NEW."operationalDecisionId" IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM ai_risk_assessment_decisions d JOIN ai_assessment_rounds a ON a.id=d."assessmentId"
 WHERE d.id=NEW."operationalDecisionId" AND a."useCaseId"=NEW.id AND a.kind='residual' AND d.kind='steering'
  AND NEW."operationalStatusCode"=CASE d.decision WHEN 'restrict' THEN 'SUSPENDED' WHEN 'stop' THEN 'ARCHIVED' END;
 IF NOT FOUND THEN RAISE EXCEPTION 'Use-case restriction/stop requires its immutable Steering decision' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD."operationalStatusCode"='ARCHIVED' AND NEW."operationalStatusCode"<>'ARCHIVED' THEN RAISE EXCEPTION 'Archived use case cannot be reopened by a lower outcome' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_use_case_operational_status_guard BEFORE INSERT OR UPDATE ON ai_use_cases FOR EACH ROW EXECUTE FUNCTION dgop_ai_operational_status_guard();
