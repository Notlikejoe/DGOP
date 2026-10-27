-- Additive only: historical decisions and qualifications are not relabeled as verified.
ALTER TABLE "architecture_reviews" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "decisionProof" JSONB, ADD COLUMN "previousReviewId" TEXT;
ALTER TABLE "architecture_reviews" ADD CONSTRAINT "architecture_reviews_previousReviewId_fkey"
  FOREIGN KEY ("previousReviewId") REFERENCES "architecture_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "architecture_reviews_previousReviewId_idx" ON "architecture_reviews"("previousReviewId");
ALTER TABLE "architecture_reviews" ADD CONSTRAINT "architecture_review_version_positive" CHECK ("version" > 0);
ALTER TABLE "certification_attempts" ADD COLUMN "qualificationType" TEXT, ADD COLUMN "verificationProof" JSONB;
ALTER TABLE "training_assignments" ADD COLUMN "renewedFromId" TEXT;
CREATE UNIQUE INDEX "training_assignments_renewedFromId_key" ON "training_assignments"("renewedFromId");
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_renewedFromId_fkey"
  FOREIGN KEY ("renewedFromId") REFERENCES "training_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_asset_valuations" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "actualAnnualValue" DOUBLE PRECISION, ADD COLUMN "measuredAt" TIMESTAMP(3), ADD COLUMN "realizationProof" JSONB;
ALTER TABLE "data_asset_valuations" ADD CONSTRAINT "valuation_actual_nonnegative" CHECK ("actualAnnualValue" IS NULL OR "actualAnnualValue" >= 0);
CREATE FUNCTION dgop_preserve_final_architecture_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."decision" <> 'pending' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Final architecture reviews are immutable; create a new review revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "architecture_review_final_immutable" BEFORE UPDATE ON "architecture_reviews"
  FOR EACH ROW EXECUTE FUNCTION dgop_preserve_final_architecture_review();
