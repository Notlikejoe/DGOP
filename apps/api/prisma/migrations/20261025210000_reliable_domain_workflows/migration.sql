-- Preserve historical records; add an optimistic version to golden records.
ALTER TABLE "mdm_golden_records" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "mdm_golden_records" ADD CONSTRAINT "mdm_golden_record_version_positive" CHECK ("version" > 0);
-- Requests for changes are nonterminal; approved and rejected reviews remain immutable.
CREATE OR REPLACE FUNCTION dgop_preserve_final_architecture_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."decision" IN ('approved','approved_with_conditions','rejected') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Final architecture reviews are immutable; create a new review revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
