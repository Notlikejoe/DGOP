-- A justified deadline extension requires recorded prior communication.
-- Historical requests remain unextended; no communication or proof is invented.
ALTER TABLE "privacy_dsr_requests"
  ADD COLUMN "extensionDueAt" TIMESTAMP(3),
  ADD COLUMN "extensionReason" TEXT,
  ADD COLUMN "extensionCommunicatedAt" TIMESTAMP(3),
  ADD COLUMN "extensionCommunicationReference" TEXT,
  ADD COLUMN "extensionRecordedBy" TEXT;
