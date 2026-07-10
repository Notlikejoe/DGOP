import { AccessDecision } from '@prisma/client';

export interface AccessDecisionInput {
  hasMapping: boolean;
  requestedAction: string;
  personalDataRequested: boolean;
  personalDataAllowed: boolean;
  approvalRequired: boolean;
  hasMaskingPolicy: boolean;
  assetClassificationRank: number | null;
  allowedClassificationRank: number | null;
}

const REVIEW_ACTIONS = new Set(['download', 'export', 'share', 'extract', 'bulk_export']);

export function classificationRisk(rank: number | null | undefined): 'low' | 'medium' | 'high' | 'critical' {
  if (rank == null || rank <= 2) return 'low';
  if (rank === 3) return 'medium';
  if (rank === 4) return 'high';
  return 'critical';
}

export function evaluateAccessDecision(input: AccessDecisionInput): {
  decision: AccessDecision;
  reason: string;
} {
  if (!input.hasMapping) {
    return {
      decision: AccessDecision.deny,
      reason: 'No approved role-to-data mapping exists for this domain and classification.',
    };
  }

  if (
    input.assetClassificationRank != null &&
    input.allowedClassificationRank != null &&
    input.assetClassificationRank > input.allowedClassificationRank
  ) {
    return {
      decision: AccessDecision.deny,
      reason: 'Requested data is above the role classification limit.',
    };
  }

  if (input.personalDataRequested && !input.personalDataAllowed) {
    return input.hasMaskingPolicy
      ? {
          decision: AccessDecision.masked,
          reason: 'Personal data is not directly allowed for this role, so masking is required.',
        }
      : {
          decision: AccessDecision.review_required,
          reason: 'Personal data requires an explicit approval before access is granted.',
        };
  }

  if (input.approvalRequired && REVIEW_ACTIONS.has(input.requestedAction.toLowerCase())) {
    return {
      decision: AccessDecision.review_required,
      reason: 'The requested action requires owner or security approval.',
    };
  }

  if (input.hasMaskingPolicy) {
    return {
      decision: AccessDecision.masked,
      reason: 'Access is allowed with the configured masking policy applied.',
    };
  }

  return {
    decision: AccessDecision.allow,
    reason: 'Access is allowed by the active role-to-data mapping.',
  };
}

