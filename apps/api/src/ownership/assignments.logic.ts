import { AssignmentTargetType } from '@prisma/client';

export type RecommendationConfidenceLabel = 'authoritative' | 'high' | 'medium' | 'low' | 'none';

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
