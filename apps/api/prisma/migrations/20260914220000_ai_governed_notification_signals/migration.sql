-- SLA observations are independent of optional governed notification publication.
-- Keep native thresholds, escalation binding, append-only and source guards.
ALTER TABLE ai_risk_review_signals DROP CONSTRAINT ai_review_signal_shape;
ALTER TABLE ai_risk_review_signals ADD CONSTRAINT ai_review_signal_shape CHECK (
  threshold IN (50,80,95,100)
  AND jsonb_typeof("notificationIds")='array'
  AND (threshold=100)=("escalationId" IS NOT NULL)
);
