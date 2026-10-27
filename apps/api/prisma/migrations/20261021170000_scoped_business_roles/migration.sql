ALTER TABLE "roles" ADD COLUMN "businessRoleCode" TEXT;
CREATE INDEX "roles_businessRoleCode_idx" ON "roles"("businessRoleCode");
ALTER TABLE "roles" ADD CONSTRAINT "roles_businessRoleCode_fkey"
  FOREIGN KEY ("businessRoleCode") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION dgop_guard_business_role_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical roles%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."businessRoleCode" IS DISTINCT FROM OLD."businessRoleCode" THEN
    RAISE EXCEPTION 'Business responsibility binding is immutable after role creation' USING ERRCODE = '23514';
  END IF;
  IF NEW."businessRoleCode" IS NOT NULL THEN
    IF NEW."isSystem" OR NEW."businessRoleCode" NOT IN (
      'AI_WORKING_GROUP','AI_USECASE_OWNER','AI_RISK_OWNER','AI_MODEL_OWNER','AI_MLOPS_LEAD',
      'AI_COMPLIANCE_OFFICER','AI_ETHICS_COMMITTEE','AI_EXECUTIVE_TEAM','STEERING_COMMITTEE',
      'data_owner','privacy_officer','security_reviewer','business_steward','AI_GOVERNANCE_OFFICER','ndi_reviewer',
      'security_officer','technical_steward','data_custodian','foi_officer') THEN
      RAISE EXCEPTION 'Only custom roles may bind to canonical business responsibilities' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO canonical FROM roles WHERE code=NEW."businessRoleCode";
    IF NOT FOUND OR canonical."businessRoleCode" IS NOT NULL OR canonical.code=NEW.code THEN
      RAISE EXCEPTION 'Business responsibility must be an existing canonical definition; chains are forbidden' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roles_business_binding_guard BEFORE INSERT OR UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION dgop_guard_business_role_binding();
