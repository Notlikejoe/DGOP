-- Extend native responsibility matching only. All purpose grants, independence,
-- parent/task/version/evidence and immutable-history predicates remain intact.
CREATE FUNCTION dgop_role_responsibility_matches(actual_role_id TEXT, expected_responsibility TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM roles r LEFT JOIN roles canonical ON canonical.code=r."businessRoleCode"
 WHERE r.id=actual_role_id AND r."isActive" AND r."deletedAt" IS NULL
 AND r.code NOT IN ('system_admin','auditor')
 AND (r.code=expected_responsibility OR r."businessRoleCode"=expected_responsibility)
 AND (r."businessRoleCode" IS NULL OR (canonical."isActive" AND canonical."deletedAt" IS NULL AND canonical."businessRoleCode" IS NULL)))
$$;

CREATE OR REPLACE FUNCTION ai_annual_officer_eligible(actor text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur."userId"=u.id JOIN roles r ON r.id=ur."roleId" JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId" WHERE u.id=actor AND u."isActive" AND dgop_role_responsibility_matches(r.id,'AI_GOVERNANCE_OFFICER') AND r."isActive" AND r."deletedAt" IS NULL AND p.resource='airs.cadence' AND p.action='manage') AND NOT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" WHERE ur."userId"=actor AND r.code='auditor' AND r."isActive" AND r."deletedAt" IS NULL)
$$;

CREATE OR REPLACE FUNCTION ai_additional_trigger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_risk_reassessments ra JOIN ai_risks r ON r.id=ra."riskId" JOIN workflow_cases wc ON wc.id=r."workflowCaseId" JOIN people owner ON owner.id=r."ownerPersonId" JOIN workflow_tasks t ON t.id=NEW."coordinatorTaskId" JOIN workflow_template_stages s ON s.id=t."templateStageId" JOIN workflow_tasks i ON i.id=ra."sourceIntakeTaskId"
 WHERE ra.id=NEW."reassessmentId" AND ra."inherentRound"=(SELECT max("inherentRound") FROM ai_risk_reassessments WHERE "riskId"=r.id) AND r."deletedAt" IS NULL AND wc.status='under_review' AND wc.type='AIRS' AND owner."isActive" AND owner."deletedAt" IS NULL
 AND t."caseId"=wc.id AND t.status='pending' AND t."assigneeUserId"=owner."userId" AND t."assigneeRoleCode"='AI_RISK_OWNER' AND s.code='airs-inherent-assessment' AND s."templateId"=wc."templateId" AND s."isActive"
 AND i."caseId"=wc.id AND i.status='completed' AND i."formDataJson"->'submittedIntake'=r."intakeData" AND t."formDataJson"->>'sourceIntakeTaskId'=i.id AND (t."formDataJson"->>'reassessmentRequiredRound')::int=NEW."requiredInherentRound"
 AND NEW."requiredInherentRound"=(SELECT coalesce(max(round),0)+1 FROM ai_assessment_rounds WHERE "riskId"=r.id AND kind='inherent')
 AND EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur."userId"=u.id JOIN roles role ON role.id=ur."roleId" JOIN role_permissions rp ON rp."roleId"=role.id JOIN permissions p ON p.id=rp."permissionId" WHERE u.id=NEW."actorId" AND u."isActive" AND role."isActive" AND role."deletedAt" IS NULL AND (((dgop_role_responsibility_matches(role.id,'AI_GOVERNANCE_OFFICER') OR dgop_role_responsibility_matches(role.id,'AI_WORKING_GROUP')) AND p.resource='airs.cadence' AND p.action='manage') OR (dgop_role_responsibility_matches(role.id,'AI_RISK_OWNER') AND owner."userId"=u.id AND p.resource='airs.risk' AND p.action='assess')))) THEN RAISE EXCEPTION 'Additional trigger requires active reassessment, eligible authority and fresh original-intake coordinator'; END IF;
 IF EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" WHERE ur."userId"=NEW."actorId" AND r.code='auditor' AND r."isActive" AND r."deletedAt" IS NULL) THEN RAISE EXCEPTION 'Auditor cannot record reassessment triggers'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."evidenceIds") e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence n WHERE n.id=e AND n."deletedAt" IS NULL)) THEN RAISE EXCEPTION 'Trigger evidence must exist'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION ai_outcome_live_grant(actor_id TEXT, role_code TEXT, resource_code TEXT, action_code TEXT) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur."userId"=u.id JOIN roles r ON r.id=ur."roleId" JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId"
 WHERE u.id=actor_id AND u."isActive" AND dgop_role_responsibility_matches(r.id,role_code) AND r."isActive" AND r."deletedAt" IS NULL AND p.resource=resource_code AND p.action=action_code)
 AND NOT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" WHERE ur."userId"=actor_id AND r.code='auditor' AND r."isActive" AND r."deletedAt" IS NULL)
$$;

CREATE OR REPLACE FUNCTION dgop_ai_reference_pin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s ai_assessment_rounds%ROWTYPE; u ai_use_cases%ROWTYPE; d jsonb; old_level integer; new_level integer;
BEGIN
 IF NEW.kind='classification' AND NEW.result->'officerDecision'->>'decisionType'='reversal' THEN
  SELECT * INTO s FROM ai_assessment_rounds WHERE "useCaseId"=NEW."useCaseId" AND kind='classification' ORDER BY round DESC LIMIT 1;
  SELECT * INTO u FROM ai_use_cases WHERE id=NEW."useCaseId" FOR SHARE;
  d:=NEW.result->'officerDecision';
  old_level:=CASE s.result->'officerDecision'->>'actorRole' WHEN 'AI_GOVERNANCE_OFFICER' THEN 1 WHEN 'AI_ETHICS_COMMITTEE' THEN 2 WHEN 'AI_EXECUTIVE_TEAM' THEN 3 WHEN 'STEERING_COMMITTEE' THEN 4 ELSE 0 END;
  new_level:=CASE d->>'actorRole' WHEN 'AI_ETHICS_COMMITTEE' THEN 2 WHEN 'AI_EXECUTIVE_TEAM' THEN 3 WHEN 'STEERING_COMMITTEE' THEN 4 ELSE 0 END;
  IF s.id IS NULL OR u."assetId" IS NOT NULL OR u."deletedAt" IS NOT NULL OR u."isSampleData"
   OR NOT EXISTS(SELECT 1 FROM workflow_cases WHERE id=u."workflowCaseId" AND status IN ('under_review','decision_made','approved'))
   OR s."engineVersion"<>'AIUC_CLASSIFICATION_DECISION_V1' OR s.result->'officerDecision'->>'decisionType' NOT IN ('override','unacceptable')
   OR NEW."engineVersion"<>s."engineVersion" OR NEW.round<>s.round+1 OR NEW."ruleReferenceVersionId"<>s."ruleReferenceVersionId" OR NEW.inputs<>s.inputs
   OR NEW.result->'scoreMax' IS DISTINCT FROM s.result->'scoreMax' OR NEW.result->'proposedTierCode' IS DISTINCT FROM s.result->'proposedTierCode'
   OR NEW.result->'approvedTierCode' IS DISTINCT FROM s.result->'proposedTierCode'
   OR NEW.result->>'sourceAssessmentId' IS DISTINCT FROM s.id OR d->>'reversesAssessmentId' IS DISTINCT FROM s.id
   OR old_level=0 OR new_level<=old_level OR NEW."createdBy" IN (s."createdBy",u."requesterUserId")
   OR NEW."createdBy" IN (SELECT "createdBy" FROM ai_assessment_rounds WHERE id=s.result->>'sourceAssessmentId')
   OR EXISTS(SELECT 1 FROM people WHERE id=u."ownerPersonId" AND "userId"=NEW."createdBy")
   OR d->>'verifiedBy' IS DISTINCT FROM NEW."createdBy" OR length(trim(coalesce(d->>'justification','')))=0 OR length(trim(coalesce(d->>'authorityReference','')))=0
   OR jsonb_typeof(d->'evidenceIds') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'evidenceIds')=0
  THEN RAISE EXCEPTION 'Invalid higher-authority classification compensation' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'evidenceIds') e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence WHERE id=e AND "deletedAt" IS NULL))
   OR NOT EXISTS(SELECT 1 FROM users a JOIN user_roles ur ON ur."userId"=a.id JOIN roles r ON r.id=ur."roleId" JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId"
    WHERE a.id=NEW."createdBy" AND a."isActive" AND dgop_role_responsibility_matches(r.id,d->>'actorRole') AND r."isActive" AND r."deletedAt" IS NULL AND p.resource='aiuc.classify' AND p.action='reverse')
   OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" WHERE ur."userId"=NEW."createdBy" AND r.code='auditor' AND r."isActive" AND r."deletedAt" IS NULL)
  THEN RAISE EXCEPTION 'Classification compensation lacks live authority/evidence' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM governed_reference_versions v JOIN governed_reference_values t ON t."versionId"=v.id WHERE v.id=NEW."ruleReferenceVersionId" AND v.state IN ('published','retired') AND t.code=NEW.result->>'approvedTierCode' AND t.metadata->>'automatic'='true' FOR SHARE OF v;
 ELSE
  PERFORM 1 FROM governed_reference_versions WHERE id=NEW."ruleReferenceVersionId" AND state='published' FOR SHARE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'New calculations require published parameters; compensation requires its immutable pinned automatic tier' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION aiuc_request_closure_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u ai_use_cases%ROWTYPE; actor text; resolution text;
BEGIN
 IF TG_OP<>'INSERT' AND OLD."formDataJson"->>'operation'='aiuc_request_closure' AND OLD.status='completed' THEN
  RAISE EXCEPTION 'Native AI request closure history is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW."formDataJson"->>'operation' IS DISTINCT FROM 'aiuc_request_closure' OR NEW.status<>'completed' THEN RETURN NEW; END IF;
 SELECT * INTO u FROM ai_use_cases WHERE "workflowCaseId"=NEW."caseId" FOR SHARE;
 actor:=NEW."formDataJson"->>'actorId'; resolution:=NEW."formDataJson"->>'resolutionCode';
 IF u.id IS NULL OR u."assetId" IS NOT NULL OR u."deletedAt" IS NOT NULL OR u."isSampleData"
  OR actor IS DISTINCT FROM NEW."assigneeUserId" OR actor IS DISTINCT FROM NEW."formSubmittedBy"
  OR NEW."completedAt" IS NULL OR length(trim(coalesce(NEW."formDataJson"->>'justification','')))=0
  OR jsonb_typeof(NEW."formDataJson"->'evidenceIds') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW."formDataJson"->'evidenceIds')=0
  OR NOT EXISTS(SELECT 1 FROM workflow_cases WHERE id=NEW."caseId" AND type='AIUC' AND status NOT IN ('closed','rejected','cancelled'))
  OR NOT EXISTS(SELECT 1 FROM workflow_template_stages s JOIN workflow_templates t ON t.id=s."templateId" WHERE s.id=NEW."templateStageId" AND s.code='aiuc-decision' AND s."isActive" AND t.code='AIUC_APPROVAL_V1' AND t."isActive" AND t."deletedAt" IS NULL)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."formDataJson"->'evidenceIds') e WHERE NOT EXISTS(SELECT 1 FROM ndi_evidence WHERE id=e AND "deletedAt" IS NULL))
  OR NEW."assigneeRoleCode" IN ('auditor','executive')
  OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" WHERE ur."userId"=actor AND r.code='auditor' AND r."isActive" AND r."deletedAt" IS NULL)
 THEN RAISE EXCEPTION 'Invalid native AI request closure' USING ERRCODE='23514'; END IF;
 IF resolution='withdrawn' THEN
  IF actor IS DISTINCT FROM u."requesterUserId" THEN RAISE EXCEPTION 'Only the actual requester may withdraw' USING ERRCODE='23514'; END IF;
 ELSIF resolution='closed_no_action' THEN
  IF NEW."assigneeRoleCode"<>'AI_GOVERNANCE_OFFICER' OR NOT EXISTS(SELECT 1 FROM workflow_tasks i JOIN workflow_template_stages s ON s.id=i."templateStageId" JOIN workflow_cases c ON c.id=i."caseId" WHERE i.id=NEW."formDataJson"->>'informationTaskId' AND i."caseId"=NEW."caseId" AND i."assigneeUserId"=u."requesterUserId" AND i.status='pending' AND s.code='aiuc-completion' AND i."dueDate"<=clock_timestamp() AND c.status='awaiting_information') THEN RAISE EXCEPTION 'Officer closure requires an expired native information task' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Use a native AI request closure resolution' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users a JOIN user_roles ur ON ur."userId"=a.id JOIN roles r ON r.id=ur."roleId" JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId" WHERE a.id=actor AND a."isActive" AND dgop_role_responsibility_matches(r.id,NEW."assigneeRoleCode") AND r."isActive" AND r."deletedAt" IS NULL AND p.resource=CASE resolution WHEN 'withdrawn' THEN 'case.create' ELSE 'case.approve' END AND p.action='aiuc') THEN RAISE EXCEPTION 'AI closure lacks a live purpose grant' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
