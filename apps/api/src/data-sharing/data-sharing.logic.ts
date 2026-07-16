import {
  DataSharingAgreementStatus,
  DataSharingRequestStatus,
  DataSharingReviewDecision,
  DataSharingUsageStatus,
} from '@prisma/client';

export const DATA_SHARING_REVIEW_STEPS = ['owner', 'privacy', 'security', 'technical'] as const;

export function calculateSharingRisk(input: {
  classificationRank?: number | null;
  consentRequired?: boolean;
  crossBorderTransfer?: boolean;
  hasMasking?: boolean;
  hasLegalBasis?: boolean;
}): { riskScore: number; controls: string[] } {
  let riskScore = Math.min(100, (input.classificationRank ?? 2) * 18 + 18);
  const controls: string[] = [];
  if (input.consentRequired) {
    riskScore += 10;
    controls.push('consent_check');
  }
  if (input.crossBorderTransfer) {
    riskScore += 14;
    controls.push('cross_border_review');
  }
  if (!input.hasLegalBasis) {
    riskScore += 10;
    controls.push('legal_basis_required');
  }
  if (!input.hasMasking && (input.classificationRank ?? 2) >= 3) {
    riskScore += 10;
    controls.push('masking_or_minimization');
  }
  if ((input.classificationRank ?? 2) >= 3) controls.push('security_review');
  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));
  return { riskScore, controls: [...new Set(controls)] };
}

export function statusFromReviews(reviews: { decision: DataSharingReviewDecision }[]): DataSharingRequestStatus {
  if (!reviews.length) return DataSharingRequestStatus.submitted;
  if (reviews.some((review) => review.decision === DataSharingReviewDecision.rejected)) return DataSharingRequestStatus.rejected;
  if (reviews.some((review) => review.decision === DataSharingReviewDecision.needs_changes)) return DataSharingRequestStatus.under_review;
  if (reviews.every((review) => review.decision === DataSharingReviewDecision.approved)) return DataSharingRequestStatus.approved;
  return DataSharingRequestStatus.under_review;
}

export function agreementRenewalStatus(renewalDueAt?: Date | null, status: DataSharingAgreementStatus = DataSharingAgreementStatus.draft, now = new Date()): DataSharingAgreementStatus {
  if (status === DataSharingAgreementStatus.retired || status === DataSharingAgreementStatus.expired) return status;
  if (!renewalDueAt) return status;
  if (renewalDueAt.getTime() < now.getTime()) return DataSharingAgreementStatus.renewal_due;
  const diffMs = renewalDueAt.getTime() - now.getTime();
  return diffMs <= 30 * 24 * 60 * 60 * 1000 ? DataSharingAgreementStatus.renewal_due : status;
}

export function usageStatus(input: { incidents?: number; recordsShared?: number; apiCalls?: number }): DataSharingUsageStatus {
  if ((input.incidents ?? 0) > 0) return DataSharingUsageStatus.escalated;
  if ((input.recordsShared ?? 0) > 100000 || (input.apiCalls ?? 0) > 50000) return DataSharingUsageStatus.watch;
  return DataSharingUsageStatus.normal;
}

export function addMonths(start: Date, months: number): Date {
  const next = new Date(start);
  next.setMonth(next.getMonth() + months);
  return next;
}
