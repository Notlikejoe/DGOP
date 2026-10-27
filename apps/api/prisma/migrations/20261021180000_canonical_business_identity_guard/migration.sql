-- Preserve canonical identities while allowing task queues to name actual scoped roles.
CREATE OR REPLACE FUNCTION dgop_guard_business_role_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical roles%ROWTYPE;
allowed CONSTANT TEXT[] := ARRAY[
  'AI_WORKING_GROUP','AI_USECASE_OWNER','AI_RISK_OWNER','AI_MODEL_OWNER','AI_MLOPS_LEAD',
  'AI_COMPLIANCE_OFFICER','AI_ETHICS_COMMITTEE','AI_EXECUTIVE_TEAM','STEERING_COMMITTEE',
  'data_owner','privacy_officer','security_reviewer','business_steward','AI_GOVERNANCE_OFFICER','ndi_reviewer',
  'security_officer','technical_steward','data_custodian','foi_officer'];
BEGIN
  IF TG_OP='UPDATE' AND NEW."businessRoleCode" IS DISTINCT FROM OLD."businessRoleCode" THEN
    RAISE EXCEPTION 'Business responsibility binding is immutable after role creation' USING ERRCODE='23514';
  END IF;
  IF NEW."businessRoleCode" IS NOT NULL THEN
    IF NEW."isSystem" OR NEW.code=ANY(allowed) OR NEW.code IN ('system_admin','dmo_admin','auditor','executive')
       OR NOT (NEW."businessRoleCode"=ANY(allowed)) THEN
      RAISE EXCEPTION 'Canonical and administrative identities cannot be departmental aliases' USING ERRCODE='23514';
    END IF;
    SELECT * INTO canonical FROM roles WHERE code=NEW."businessRoleCode";
    IF NOT FOUND OR canonical."businessRoleCode" IS NOT NULL OR canonical.code=NEW.code THEN
      RAISE EXCEPTION 'Business responsibility must be an existing canonical definition; chains are forbidden' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
