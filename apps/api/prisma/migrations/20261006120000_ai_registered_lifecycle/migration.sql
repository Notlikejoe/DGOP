-- AlterTable
ALTER TABLE "ai_approval_obligations" ADD COLUMN     "operationalState" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "ai_use_cases" ADD COLUMN     "effectiveConfigurationId" TEXT,
ADD COLUMN     "lifecycleState" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "ai_effective_configurations" (
    "id" TEXT NOT NULL,
    "useCaseId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "tierCode" TEXT NOT NULL,
    "referencePins" JSONB NOT NULL,
    "assessmentSnapshot" JSONB NOT NULL,
    "riskSnapshot" JSONB NOT NULL,
    "obligationSnapshot" JSONB NOT NULL,
    "sourceRequestId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_effective_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_lifecycle_requests" (
    "id" TEXT NOT NULL,
    "useCaseId" TEXT NOT NULL,
    "workflowCaseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assessment',
    "version" INTEGER NOT NULL DEFAULT 1,
    "baseVersion" INTEGER NOT NULL,
    "baseConfigurationId" TEXT NOT NULL,
    "proposedPayload" JSONB NOT NULL,
    "assignments" JSONB NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "assessmentSnapshot" JSONB,
    "riskSnapshot" JSONB,
    "approvedConditions" JSONB NOT NULL DEFAULT '[]',
    "authorityTier" TEXT NOT NULL,
    "authorityRole" TEXT,
    "authorityActorId" TEXT,
    "proposerId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_lifecycle_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_lifecycle_decisions" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_lifecycle_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_effective_configurations_sourceRequestId_key" ON "ai_effective_configurations"("sourceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_effective_configurations_useCaseId_sequence_key" ON "ai_effective_configurations"("useCaseId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ai_lifecycle_requests_workflowCaseId_key" ON "ai_lifecycle_requests"("workflowCaseId");

-- CreateIndex
CREATE INDEX "ai_lifecycle_requests_useCaseId_status_createdAt_idx" ON "ai_lifecycle_requests"("useCaseId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_lifecycle_decisions_taskId_key" ON "ai_lifecycle_decisions"("taskId");

-- CreateIndex
CREATE INDEX "ai_lifecycle_decisions_requestId_createdAt_idx" ON "ai_lifecycle_decisions"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_use_cases_effectiveConfigurationId_key" ON "ai_use_cases"("effectiveConfigurationId");

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_effectiveConfigurationId_fkey" FOREIGN KEY ("effectiveConfigurationId") REFERENCES "ai_effective_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_effective_configurations" ADD CONSTRAINT "ai_effective_configurations_useCaseId_fkey" FOREIGN KEY ("useCaseId") REFERENCES "ai_use_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lifecycle_requests" ADD CONSTRAINT "ai_lifecycle_requests_useCaseId_fkey" FOREIGN KEY ("useCaseId") REFERENCES "ai_use_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lifecycle_requests" ADD CONSTRAINT "ai_lifecycle_requests_workflowCaseId_fkey" FOREIGN KEY ("workflowCaseId") REFERENCES "workflow_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lifecycle_decisions" ADD CONSTRAINT "ai_lifecycle_decisions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ai_lifecycle_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lifecycle_decisions" ADD CONSTRAINT "ai_lifecycle_decisions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve proposals, source pins and approved decisions as immutable history.
ALTER TABLE ai_use_cases ADD CONSTRAINT ai_lifecycle_state CHECK ("lifecycleState" IN ('active','suspended','retired'));
ALTER TABLE ai_lifecycle_requests ADD CONSTRAINT ai_lifecycle_shape CHECK (action IN ('change','suspend','resume','retire') AND status IN ('assessment','review','authority','confirmation','applied','returned','rejected','withdrawn') AND version>0 AND "baseVersion">0 AND length(trim(justification)) BETWEEN 1 AND 5000);
CREATE UNIQUE INDEX ai_one_pending_lifecycle ON ai_lifecycle_requests("useCaseId") WHERE status IN ('assessment','review','authority','confirmation');
CREATE TRIGGER ai_configuration_immutable BEFORE UPDATE OR DELETE ON ai_effective_configurations FOR EACH ROW EXECUTE FUNCTION dgop_ai_proof_immutable();
CREATE TRIGGER ai_lifecycle_decision_immutable BEFORE UPDATE OR DELETE ON ai_lifecycle_decisions FOR EACH ROW EXECUTE FUNCTION dgop_ai_proof_immutable();
CREATE FUNCTION dgop_ai_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Lifecycle requests preserve history'; END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW."useCaseId",NEW."workflowCaseId",NEW.action,NEW."baseVersion",NEW."baseConfigurationId",NEW."proposedPayload",NEW.assignments,NEW."sourceSnapshot",NEW."proposerId",NEW.justification,NEW."createdAt") IS DISTINCT FROM ROW(OLD."useCaseId",OLD."workflowCaseId",OLD.action,OLD."baseVersion",OLD."baseConfigurationId",OLD."proposedPayload",OLD.assignments,OLD."sourceSnapshot",OLD."proposerId",OLD.justification,OLD."createdAt") OR OLD.status IN ('applied','returned','rejected','withdrawn')) THEN RAISE EXCEPTION 'Lifecycle proposal and closed history are immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_effective_configurations c WHERE c.id=NEW."baseConfigurationId" AND c."useCaseId"=NEW."useCaseId") THEN RAISE EXCEPTION 'Lifecycle baseline must belong to the same AI use case'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_lifecycle_history_guard BEFORE INSERT OR UPDATE OR DELETE ON ai_lifecycle_requests FOR EACH ROW EXECUTE FUNCTION dgop_ai_lifecycle_guard();
CREATE FUNCTION dgop_ai_lifecycle_decision_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM audit_logs a JOIN ai_decision_evidence_proofs p ON p."auditLogId"=a.id WHERE a."entityType"='ai_lifecycle_request' AND a."entityId"=NEW."requestId" AND a.actor=NEW."actorId" AND a.metadata->>'decisionId'=NEW.id AND a.action='aiuc.lifecycle.'||NEW.stage||'.'||NEW.decision) THEN RAISE EXCEPTION 'Lifecycle decision requires its bound required audit and verified proof'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ai_lifecycle_required_audit AFTER INSERT ON ai_lifecycle_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dgop_ai_lifecycle_decision_audit();
