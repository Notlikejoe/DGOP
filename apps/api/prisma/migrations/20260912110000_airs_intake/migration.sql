ALTER TABLE "ai_risks" ADD COLUMN "intakeData" JSONB;
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_intake_object"
  CHECK ("intakeData" IS NULL OR jsonb_typeof("intakeData") = 'object');
