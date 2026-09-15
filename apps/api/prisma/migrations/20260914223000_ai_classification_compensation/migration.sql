INSERT INTO permissions (id,resource,action,"descriptionEn")
VALUES ('aiuc-classification-reverse','aiuc.classify','reverse','Independent higher-authority reversal of a pre-registration tier override')
ON CONFLICT (resource,action) DO NOTHING;
INSERT INTO role_permissions ("roleId","permissionId")
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('AI_ETHICS_COMMITTEE','AI_EXECUTIVE_TEAM','STEERING_COMMITTEE')
 AND r."isActive" AND r."deletedAt" IS NULL AND p.resource='aiuc.classify' AND p.action='reverse'
ON CONFLICT DO NOTHING;

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
    WHERE a.id=NEW."createdBy" AND a."isActive" AND r.code=d->>'actorRole' AND r."isActive" AND r."deletedAt" IS NULL AND p.resource='aiuc.classify' AND p.action='reverse')
   OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" WHERE ur."userId"=NEW."createdBy" AND r.code='auditor' AND r."isActive" AND r."deletedAt" IS NULL)
  THEN RAISE EXCEPTION 'Classification compensation lacks live authority/evidence' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM governed_reference_versions v JOIN governed_reference_values t ON t."versionId"=v.id WHERE v.id=NEW."ruleReferenceVersionId" AND v.state IN ('published','retired') AND t.code=NEW.result->>'approvedTierCode' AND t.metadata->>'automatic'='true' FOR SHARE OF v;
 ELSE
  PERFORM 1 FROM governed_reference_versions WHERE id=NEW."ruleReferenceVersionId" AND state='published' FOR SHARE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'New calculations require published parameters; compensation requires its immutable pinned automatic tier' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION aiuc_request_closure_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF NOT EXISTS(SELECT 1 FROM users a JOIN user_roles ur ON ur."userId"=a.id JOIN roles r ON r.id=ur."roleId" JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId" WHERE a.id=actor AND a."isActive" AND r.code=NEW."assigneeRoleCode" AND r."isActive" AND r."deletedAt" IS NULL AND p.resource=CASE resolution WHEN 'withdrawn' THEN 'case.create' ELSE 'case.approve' END AND p.action='aiuc') THEN RAISE EXCEPTION 'AI closure lacks a live purpose grant' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aiuc_request_closure_protected BEFORE INSERT OR UPDATE OR DELETE ON workflow_tasks FOR EACH ROW EXECUTE FUNCTION aiuc_request_closure_guard();
