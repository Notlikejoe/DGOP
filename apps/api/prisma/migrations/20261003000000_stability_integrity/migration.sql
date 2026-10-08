-- Additive integrity fields. Historical proof/obligation/binding remains unknown.
ALTER TABLE "access_enforcement_attempts"
  ADD COLUMN "requestVersion" INTEGER,
  ADD COLUMN "completionVersion" INTEGER;

ALTER TABLE "privacy_dsr_requests"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "identityVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "identityVerifiedBy" TEXT,
  ADD COLUMN "identityEvidenceReference" TEXT,
  ADD COLUMN "completionEvidenceReference" TEXT;
UPDATE "privacy_dsr_requests" SET "receivedAt" = "createdAt";
ALTER TABLE "privacy_dsr_requests" ALTER COLUMN "receivedAt" SET NOT NULL,
  ALTER COLUMN "receivedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "privacy_breaches"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "regulatorNotificationRequired" BOOLEAN,
  ADD COLUMN "subjectNotificationRequired" BOOLEAN,
  ADD COLUMN "notificationDecisionReason" TEXT,
  ADD COLUMN "notificationDecisionAt" TIMESTAMP(3),
  ADD COLUMN "notificationDecisionBy" TEXT,
  ADD COLUMN "regulatorNotificationEvidenceReference" TEXT,
  ADD COLUMN "subjectNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "subjectNotificationEvidenceReference" TEXT;

CREATE FUNCTION dgop_access_attempt_context_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."grantId", NEW."idempotencyKey", NEW.operation, NEW."connectorCode", NEW."requestVersion", NEW."completionVersion", NEW."requestJson")
     IS DISTINCT FROM ROW(OLD."grantId", OLD."idempotencyKey", OLD.operation, OLD."connectorCode", OLD."requestVersion", OLD."completionVersion", OLD."requestJson") THEN
    RAISE EXCEPTION 'Access enforcement dispatch context is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER access_attempt_context_immutable BEFORE UPDATE ON access_enforcement_attempts
FOR EACH ROW EXECUTE FUNCTION dgop_access_attempt_context_immutable();
ALTER TABLE access_enforcement_attempts ADD CONSTRAINT access_attempt_version_binding_check
CHECK (("requestVersion" IS NULL AND "completionVersion" IS NULL)
OR ("requestVersion" IS NOT NULL AND "completionVersion" IS NOT NULL
    AND "requestVersion" >= 1 AND "completionVersion" = "requestVersion" + 1));

ALTER TABLE "privacy_dsr_requests" ADD CONSTRAINT privacy_dsr_version_positive CHECK ("version" >= 1);
ALTER TABLE "privacy_breaches" ADD CONSTRAINT privacy_breach_version_positive CHECK ("version" >= 1);
-- Existing task lineage, approval independence and append-only audit triggers remain intact.
