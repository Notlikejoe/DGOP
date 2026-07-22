import { ApprovalStatus, AssignmentTargetType } from '@prisma/client';

export type RecommendationConfidenceLabel = 'authoritative' | 'high' | 'medium' | 'low' | 'none';

export const OWNERSHIP_NAME_MAX = 180;
export const OWNERSHIP_DESCRIPTION_MAX = 1000;
export const OWNERSHIP_JUSTIFICATION_MAX = 1000;
export const OWNERSHIP_PRIORITY_MAX = 9999;
export const ASSIGNMENT_TARGET_TYPES = Object.values(AssignmentTargetType);
export const ASSIGNMENT_APPROVAL_STATUSES = Object.values(ApprovalStatus);
export const ASSIGNMENT_STATUS_FILTERS = ['active', 'inactive'] as const;

export interface OwnershipTextInput {
  nameEn?: unknown;
  nameAr?: unknown;
  description?: unknown;
  justification?: unknown;
}

export interface OwnershipWindowInput {
  effectiveDate: Date;
  expiryDate: Date | null;
}

export function normalizeOwnershipText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value as never;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function validateOwnershipText(input: OwnershipTextInput, requireNames = false): string[] {
  const errors: string[] = [];
  const nameEn = typeof input.nameEn === 'string' ? input.nameEn.trim() : input.nameEn;
  const nameAr = typeof input.nameAr === 'string' ? input.nameAr.trim() : input.nameAr;
  const description = normalizeOwnershipText(input.description);
  const justification = normalizeOwnershipText(input.justification);

  if (nameEn != null && typeof nameEn !== 'string') errors.push('English name must be text');
  if (nameAr != null && typeof nameAr !== 'string') errors.push('Arabic name must be text');
  if (requireNames && !nameEn) errors.push('English name is required');
  if (requireNames && !nameAr) errors.push('Arabic name is required');
  if (!requireNames && input.nameEn !== undefined && !nameEn) errors.push('English name cannot be blank');
  if (!requireNames && input.nameAr !== undefined && !nameAr) errors.push('Arabic name cannot be blank');
  if (typeof nameEn === 'string' && nameEn.length > OWNERSHIP_NAME_MAX) {
    errors.push(`English name must be ${OWNERSHIP_NAME_MAX} characters or fewer`);
  }
  if (typeof nameAr === 'string' && nameAr.length > OWNERSHIP_NAME_MAX) {
    errors.push(`Arabic name must be ${OWNERSHIP_NAME_MAX} characters or fewer`);
  }
  if (description != null && typeof description !== 'string') errors.push('Description must be text');
  if (typeof description === 'string' && description.length > OWNERSHIP_DESCRIPTION_MAX) {
    errors.push(`Description must be ${OWNERSHIP_DESCRIPTION_MAX} characters or fewer`);
  }
  if (justification != null && typeof justification !== 'string') errors.push('Justification must be text');
  if (typeof justification === 'string' && justification.length > OWNERSHIP_JUSTIFICATION_MAX) {
    errors.push(`Justification must be ${OWNERSHIP_JUSTIFICATION_MAX} characters or fewer`);
  }
  return errors;
}

export function validateOwnershipWindow(input: OwnershipWindowInput): string[] {
  return input.expiryDate && input.expiryDate <= input.effectiveDate
    ? ['Expiry date must be after the effective date']
    : [];
}

export function isAssignmentTargetType(value: unknown): value is AssignmentTargetType {
  return typeof value === 'string' && ASSIGNMENT_TARGET_TYPES.includes(value as AssignmentTargetType);
}

export function isAssignmentApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === 'string' && ASSIGNMENT_APPROVAL_STATUSES.includes(value as ApprovalStatus);
}

export function isAssignmentStatusFilter(value: unknown): value is (typeof ASSIGNMENT_STATUS_FILTERS)[number] {
  return typeof value === 'string' && ASSIGNMENT_STATUS_FILTERS.includes(value as (typeof ASSIGNMENT_STATUS_FILTERS)[number]);
}

const SCOPE_BASE: Record<string, number> = {
  [AssignmentTargetType.domain]: 92,
  [AssignmentTargetType.capability]: 86,
  [AssignmentTargetType.subject]: 82,
  [AssignmentTargetType.org_unit]: 78,
  [AssignmentTargetType.system]: 72,
};

export interface RecommendationScoreInput {
  scopeType?: string | null;
  rulePriority?: number | null;
  activeAssignments?: number;
  approvedAssignments?: number;
  conflictCount?: number;
  certificationState?: string | null;
}

export function recommendationConfidence(input: RecommendationScoreInput): number {
  if (!input.scopeType) return 0;
  const priorityPenalty = Math.min(Math.max((input.rulePriority ?? 100) - 1, 0), 100) / 10;
  const workloadPenalty = Math.min(Math.max(input.activeAssignments ?? 0, 0) * 3, 18);
  const historyBonus = Math.min(Math.max(input.approvedAssignments ?? 0, 0) * 2, 10);
  const conflictPenalty = Math.min(Math.max(input.conflictCount ?? 0, 0) * 12, 24);
  const certificationBonus =
    input.certificationState === 'current'
      ? 6
      : input.certificationState === 'renewal_due'
        ? 2
        : input.certificationState === 'expired'
          ? -8
          : 0;
  const raw = (SCOPE_BASE[input.scopeType] ?? 65) - priorityPenalty - workloadPenalty - conflictPenalty + historyBonus + certificationBonus;
  return Math.min(99, Math.max(35, Math.round(raw)));
}

export function confidenceLabel(score: number, assigned = false): RecommendationConfidenceLabel {
  if (assigned) return 'authoritative';
  if (score >= 85) return 'high';
  if (score >= 65) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

export function recommendationReasons(input: RecommendationScoreInput & { assigned?: boolean }): string[] {
  if (input.assigned) return ['Current approved primary assignment is active for this asset and role.'];
  if (!input.scopeType) return ['No active assignment rule matches this asset context.'];
  const reasons = [`Matched ${input.scopeType.replace('_', ' ')} assignment rule.`];
  if ((input.rulePriority ?? 100) <= 10) reasons.push('Rule priority is high.');
  if ((input.approvedAssignments ?? 0) > 0) reasons.push('Person has approved stewardship history.');
  if ((input.activeAssignments ?? 0) >= 5) reasons.push('Person already has a notable active stewardship workload.');
  if ((input.conflictCount ?? 0) > 0) reasons.push('Person has existing overlapping assignment conflict signals.');
  if (input.certificationState === 'current') reasons.push('Person has current governance certification evidence.');
  if (input.certificationState === 'expired') reasons.push('Person certification signal is expired and should be checked before assignment.');
  return reasons;
}
