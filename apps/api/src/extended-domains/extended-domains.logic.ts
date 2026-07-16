import {
  ArchitectureReviewDecision,
  MdmMatchStatus,
  MdmResolutionStep,
  MetadataCertificationStatus,
  ReferenceDataVersionStatus,
} from '@prisma/client';

export function clampScore(value: number | undefined, fallback = 0): number {
  const score = Math.round(Number(value ?? fallback));
  if (!Number.isFinite(score)) return fallback;
  return Math.max(0, Math.min(100, score));
}

export function defaultMatchStep(score: number): MdmResolutionStep {
  if (score >= 95) return MdmResolutionStep.survivorship;
  if (score >= 80) return MdmResolutionStep.compare;
  return MdmResolutionStep.identify;
}

export function defaultMatchStatus(score: number): MdmMatchStatus {
  return score >= 80 ? MdmMatchStatus.under_review : MdmMatchStatus.candidate;
}

export function certificationStatus(input: {
  qualityScore: number;
  completenessScore: number;
  ownerConfirmed: boolean;
  glossaryAligned: boolean;
  lineageReviewed: boolean;
}): MetadataCertificationStatus {
  const ready =
    input.qualityScore >= 80 &&
    input.completenessScore >= 80 &&
    input.ownerConfirmed &&
    input.glossaryAligned &&
    input.lineageReviewed;
  return ready ? MetadataCertificationStatus.certified : MetadataCertificationStatus.needs_remediation;
}

export function referenceVersionStatus(decision: 'submit' | 'approve' | 'reject' | 'activate' | 'retire'): ReferenceDataVersionStatus {
  if (decision === 'submit') return ReferenceDataVersionStatus.under_review;
  if (decision === 'approve') return ReferenceDataVersionStatus.approved;
  if (decision === 'activate') return ReferenceDataVersionStatus.active;
  if (decision === 'retire') return ReferenceDataVersionStatus.retired;
  return ReferenceDataVersionStatus.rejected;
}

export function isArchitectureDecisionFinal(decision: ArchitectureReviewDecision): boolean {
  return decision !== ArchitectureReviewDecision.pending;
}
