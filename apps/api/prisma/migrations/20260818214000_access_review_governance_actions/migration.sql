ALTER TYPE "AccessReviewDecision" ADD VALUE IF NOT EXISTS 'modify';
ALTER TYPE "AccessReviewDecision" ADD VALUE IF NOT EXISTS 'shorten_expiry';
ALTER TYPE "AccessReviewDecision" ADD VALUE IF NOT EXISTS 'suspend';
ALTER TYPE "AccessReviewDecision" ADD VALUE IF NOT EXISTS 'request_clarification';
