ALTER TABLE "governed_reference_versions" ADD COLUMN "approvalDigest" VARCHAR(64);
ALTER TABLE "governed_reference_versions" ADD CONSTRAINT "reference_approval_digest_valid"
CHECK ("approvalDigest" IS NULL OR "approvalDigest" ~ '^[a-f0-9]{64}$');
