/**
 * Single source of truth for evidence "effective status" and the canonical
 * "specification satisfied" rule. Both the evidence UI and the scoring engine
 * MUST use these helpers so readiness never disagrees with what users see.
 */

export type EvidenceEffectiveStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'revoked';

export interface EvidenceLike {
  status: string;
  expiryDate: Date | null;
}

export interface EvidenceEligibilityInput extends EvidenceLike {
  provenance?: string;
  deletedAt?: Date | null;
}

export type EvidenceExclusionReason = 'deleted' | 'synthetic_or_unknown_provenance' | 'expired' | 'not_approved';

/** Both current demo records and retained UAT records remain scenario-only. */
export const SYNTHETIC_EVIDENCE_PROVENANCES = ['synthetic_demo', 'seeded_uat'] as const;

/** Operational compliance credit requires provenance as well as approval and validity. */
export function operationalEvidenceExclusion(
  evidence: EvidenceEligibilityInput,
  now: Date = new Date(),
): EvidenceExclusionReason | null {
  if (evidence.deletedAt) return 'deleted';
  if (evidence.provenance !== 'operational') return 'synthetic_or_unknown_provenance';
  if (effectiveEvidenceStatus(evidence, now) === 'expired') return 'expired';
  return evidence.status === 'approved' ? null : 'not_approved';
}

export function isOperationalEvidence(evidence: EvidenceEligibilityInput, now: Date = new Date()): boolean {
  return operationalEvidenceExclusion(evidence, now) === null;
}

/** Database equivalent of operationalEvidenceExclusion, for bounded aggregates. */
export function operationalEvidenceWhere(now = new Date()) {
  return {
    deletedAt: null,
    provenance: 'operational' as const,
    status: 'approved' as const,
    OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
  };
}

/**
 * Derives the status that should be shown/used:
 * an `approved` record whose `expiryDate` has passed reads as `expired`.
 */
export function effectiveEvidenceStatus(
  e: EvidenceLike,
  now: Date = new Date(),
): EvidenceEffectiveStatus {
  if (
    e.status === 'approved' &&
    e.expiryDate != null &&
    e.expiryDate.getTime() <= now.getTime()
  ) {
    return 'expired';
  }
  return e.status as EvidenceEffectiveStatus;
}

/** True when a single evidence record currently counts as valid proof. */
export function isCurrentApproved(e: EvidenceLike, now: Date = new Date()): boolean {
  return effectiveEvidenceStatus(e, now) === 'approved';
}

/**
 * Canonical rule: a specification is "satisfied" (has evidence credit) when it
 * has at least one approved, not-expired, not-revoked evidence record.
 */
export function specSatisfied(evidence: EvidenceLike[], now: Date = new Date()): boolean {
  return evidence.some((e) => isCurrentApproved(e, now));
}
