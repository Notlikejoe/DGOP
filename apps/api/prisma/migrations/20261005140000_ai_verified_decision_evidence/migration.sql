-- Additive only. Existing business decisions are retained without invented proof.
CREATE TABLE "ai_evidence_links" (
 "id" TEXT NOT NULL PRIMARY KEY, "evidenceId" TEXT NOT NULL,
 "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL,
 "evidenceUpdatedAt" TIMESTAMP(3) NOT NULL, "sha256" VARCHAR(64) NOT NULL,
 "actorId" TEXT NOT NULL, "justification" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ai_evidence_links_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ndi_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ai_evidence_link_shape" CHECK (length(trim("targetType"))>0 AND length(trim("targetId"))>0 AND length(trim("justification")) BETWEEN 1 AND 5000 AND "sha256" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "ai_evidence_link_revision_key" ON "ai_evidence_links"("evidenceId","targetType","targetId","evidenceUpdatedAt");
CREATE INDEX "ai_evidence_links_targetType_targetId_idx" ON "ai_evidence_links"("targetType","targetId");
CREATE TABLE "ai_decision_evidence_proofs" (
 "id" TEXT NOT NULL PRIMARY KEY, "auditLogId" TEXT NOT NULL,
 "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "digest" VARCHAR(64) NOT NULL, "demoOnly" BOOLEAN NOT NULL,
 "evaluatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ai_decision_evidence_proofs_auditLogId_fkey" FOREIGN KEY ("auditLogId") REFERENCES "audit_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ai_decision_proof_shape" CHECK ("digest" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("snapshot"->'documents')='array' AND jsonb_array_length("snapshot"->'documents') BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX "ai_decision_evidence_proofs_auditLogId_key" ON "ai_decision_evidence_proofs"("auditLogId");
CREATE INDEX "ai_decision_evidence_proofs_targetType_targetId_createdAt_idx" ON "ai_decision_evidence_proofs"("targetType","targetId","createdAt");
CREATE FUNCTION dgop_ai_proof_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI evidence links and decision proof are append-only'; END $$;
CREATE TRIGGER ai_evidence_links_immutable BEFORE UPDATE OR DELETE ON ai_evidence_links FOR EACH ROW EXECUTE FUNCTION dgop_ai_proof_immutable();
CREATE TRIGGER ai_decision_proof_immutable BEFORE UPDATE OR DELETE ON ai_decision_evidence_proofs FOR EACH ROW EXECUTE FUNCTION dgop_ai_proof_immutable();
CREATE FUNCTION dgop_ai_required_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.metadata->>'aiEvidencePolicyVersion'='1' AND NOT EXISTS (
  SELECT 1 FROM ai_decision_evidence_proofs p WHERE p."auditLogId"=NEW.id
  AND p.digest=NEW.metadata->>'aiEvidenceDigest' AND p."targetId"=p.snapshot->>'targetId'
  AND p."targetType"=p.snapshot->>'targetType' AND p."demoOnly"=(p.snapshot->>'demoOnly')::boolean
  AND p.snapshot->>'action'=NEW.action AND p.snapshot->>'actorId'=NEW.actor
 ) THEN RAISE EXCEPTION 'Required AI decision evidence proof missing or inconsistent'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ai_audit_required_proof AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dgop_ai_required_proof();
