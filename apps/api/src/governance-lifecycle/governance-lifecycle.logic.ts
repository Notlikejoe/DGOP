import { GovernanceLifecycleStatus, GovernanceMaturityDimension } from '@prisma/client';

export type MaturityDimensionInput = {
  dimension: GovernanceMaturityDimension;
  score: number;
};

export function boundedMaturityScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function overallMaturityScore(dimensions: MaturityDimensionInput[]): number {
  if (!dimensions.length) return 0;
  const total = dimensions.reduce((sum, row) => sum + boundedMaturityScore(row.score), 0);
  return Math.round(total / dimensions.length);
}

export function lifecycleReadiness(input: {
  activeCharters: number;
  approvedPolicies: number;
  activeCouncils: number;
  activeDecisionRights: number;
  latestMaturityScore: number | null;
  openImprovements: number;
}): GovernanceLifecycleStatus {
  if (
    input.activeCharters > 0 &&
    input.approvedPolicies > 0 &&
    input.activeCouncils > 0 &&
    input.activeDecisionRights > 0 &&
    (input.latestMaturityScore ?? 0) >= 70 &&
    input.openImprovements <= 5
  ) {
    return GovernanceLifecycleStatus.approved;
  }
  if (input.activeCharters > 0 && input.approvedPolicies > 0 && input.activeDecisionRights > 0) {
    return GovernanceLifecycleStatus.under_review;
  }
  return GovernanceLifecycleStatus.draft;
}

export const REQUIRED_CHARTER_ELEMENTS = [
  'mandate',
  'scope',
  'decision_rights',
  'roles',
  'cadence',
  'evidence',
  'escalation',
  'metrics',
] as const;

export function missingCharterElements(elements: unknown): string[] {
  if (!elements || typeof elements !== 'object' || Array.isArray(elements)) return [...REQUIRED_CHARTER_ELEMENTS];
  const record = elements as Record<string, unknown>;
  return REQUIRED_CHARTER_ELEMENTS.filter((key) => !record[key]);
}
