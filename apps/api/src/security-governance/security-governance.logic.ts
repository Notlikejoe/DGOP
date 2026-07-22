import { AccessDecision } from '@prisma/client';

export const ABAC_ACTIONS = [
  'read',
  'view',
  'query',
  'download',
  'export',
  'bulk_export',
  'share',
  'extract',
  'write',
  'update',
  'delete',
  'admin',
  'publish',
] as const;

export const ABAC_PURPOSES = [
  'governance',
  'quality',
  'security',
  'privacy',
  'compliance',
  'audit',
  'operations',
  'analytics',
  'open_data',
  'training',
  'break_glass',
] as const;

export const ABAC_NETWORK_ZONES = ['trusted', 'internal', 'partner', 'public', 'unknown'] as const;

export type AbacAction = (typeof ABAC_ACTIONS)[number];
export type AbacPurpose = (typeof ABAC_PURPOSES)[number];
export type AbacNetworkZone = (typeof ABAC_NETWORK_ZONES)[number];
export type AbacRisk = 'low' | 'medium' | 'high' | 'critical';
export type AbacRuleOutcome = 'pass' | 'fail' | 'review' | 'obligation';

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

export interface AbacDecisionInput extends AccessDecisionInput {
  purpose?: string | null;
  legalBasisConfirmed?: boolean;
  emergencyAccess?: boolean;
  approvalTicketId?: string | null;
  businessJustification?: string | null;
  networkZone?: string | null;
}

export interface AbacRuleTrace {
  rule: string;
  outcome: AbacRuleOutcome;
  message: string;
}

export interface AbacDecisionResult {
  decision: AccessDecision;
  reason: string;
  normalizedAction: AbacAction | 'invalid';
  purpose: AbacPurpose | 'invalid';
  networkZone: AbacNetworkZone | 'invalid';
  risk: AbacRisk;
  obligations: string[];
  violations: string[];
  ruleTrace: AbacRuleTrace[];
}

export interface RoleDataAccessMapIntegrityInput {
  domainId?: string | null;
  classificationId?: string | null;
  maskingPolicyId?: string | null;
  personalDataAllowed?: boolean | null;
  approvalRequired?: boolean | null;
  businessJustification?: string | null;
  reviewCadenceDays?: number | null;
}

const REVIEW_ACTIONS = new Set<AbacAction>(['download', 'export', 'share', 'extract', 'bulk_export']);
const DESTRUCTIVE_ACTIONS = new Set<AbacAction>(['write', 'update', 'delete', 'admin', 'publish']);
const HIGH_RISK_NETWORK_ZONES = new Set<AbacNetworkZone>(['partner', 'public', 'unknown']);
const ACTIONS = new Set<string>(ABAC_ACTIONS);
const PURPOSES = new Set<string>(ABAC_PURPOSES);
const NETWORK_ZONES = new Set<string>(ABAC_NETWORK_ZONES);

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeAction(value: string | null | undefined): AbacAction | null {
  const action = normalizeText(value || 'read').toLowerCase();
  return ACTIONS.has(action) ? (action as AbacAction) : null;
}

function normalizePurpose(value: string | null | undefined): AbacPurpose | null {
  const purpose = normalizeText(value || 'governance').toLowerCase();
  return PURPOSES.has(purpose) ? (purpose as AbacPurpose) : null;
}

function normalizeNetworkZone(value: string | null | undefined): AbacNetworkZone | null {
  const zone = normalizeText(value || 'internal').toLowerCase();
  return NETWORK_ZONES.has(zone) ? (zone as AbacNetworkZone) : null;
}

function hasJustification(value: string | null | undefined, minimumLength = 12): boolean {
  return normalizeText(value).length >= minimumLength;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function formatReason(base: string, obligations: string[], violations: string[]): string {
  const suffixes: string[] = [];
  if (violations.length) suffixes.push(`violations: ${violations.join(', ')}`);
  if (obligations.length) suffixes.push(`obligations: ${obligations.join(', ')}`);
  return suffixes.length ? `${base} (${suffixes.join('; ')}).` : base;
}

function result(
  decision: AccessDecision,
  reason: string,
  context: Omit<AbacDecisionResult, 'decision' | 'reason'>,
): AbacDecisionResult {
  return {
    ...context,
    decision,
    reason: formatReason(reason, context.obligations, context.violations),
    obligations: uniq(context.obligations),
    violations: uniq(context.violations),
  };
}

export function classificationRisk(rank: number | null | undefined): AbacRisk {
  if (rank == null || rank <= 2) return 'low';
  if (rank === 3) return 'medium';
  if (rank === 4) return 'high';
  return 'critical';
}

export function validateRoleDataAccessMapIntegrity(input: RoleDataAccessMapIntegrityInput): string[] {
  const errors: string[] = [];
  const justification = normalizeText(input.businessJustification);
  const personalDataAllowed = input.personalDataAllowed ?? false;
  const approvalRequired = input.approvalRequired ?? true;
  const isGlobalScope = !input.domainId && !input.classificationId;

  if (input.reviewCadenceDays != null && (input.reviewCadenceDays < 1 || input.reviewCadenceDays > 366)) {
    errors.push('review cadence must be between 1 and 366 days');
  }

  if (personalDataAllowed && justification.length < 12) {
    errors.push('personal data access requires a business justification');
  }

  if (!approvalRequired && justification.length < 12) {
    errors.push('approval bypass requires a business justification');
  }

  if (isGlobalScope && personalDataAllowed) {
    errors.push('global mappings cannot grant direct personal data access');
  }

  if (isGlobalScope && !approvalRequired) {
    errors.push('global mappings must keep approval required');
  }

  if (input.maskingPolicyId && personalDataAllowed && justification.length < 20) {
    errors.push('direct personal data access with masking requires stronger justification');
  }

  return errors;
}

export function evaluateAbacDecision(input: AbacDecisionInput): AbacDecisionResult {
  const normalizedAction = normalizeAction(input.requestedAction);
  const purpose = normalizePurpose(input.purpose);
  const networkZone = normalizeNetworkZone(input.networkZone);
  const risk = classificationRisk(input.assetClassificationRank);
  const obligations: string[] = [];
  const violations: string[] = [];
  const ruleTrace: AbacRuleTrace[] = [];
  const context = {
    normalizedAction: normalizedAction ?? 'invalid' as const,
    purpose: purpose ?? 'invalid' as const,
    networkZone: networkZone ?? 'invalid' as const,
    risk,
    obligations,
    violations,
    ruleTrace,
  };

  if (!normalizedAction) {
    violations.push('invalid_action');
    ruleTrace.push({ rule: 'action-vocabulary', outcome: 'fail', message: 'Requested action is not recognized by ABAC policy.' });
    return result(AccessDecision.deny, 'The requested action is not a recognized access operation.', context);
  }
  ruleTrace.push({ rule: 'action-vocabulary', outcome: 'pass', message: `Action ${normalizedAction} is recognized.` });

  if (!purpose) {
    violations.push('invalid_purpose');
    ruleTrace.push({ rule: 'purpose-vocabulary', outcome: 'fail', message: 'Requested purpose is not recognized by ABAC policy.' });
    return result(AccessDecision.deny, 'The requested purpose is not a recognized governance purpose.', context);
  }
  ruleTrace.push({ rule: 'purpose-vocabulary', outcome: 'pass', message: `Purpose ${purpose} is recognized.` });

  if (!networkZone) {
    violations.push('invalid_network_zone');
    ruleTrace.push({ rule: 'network-zone-vocabulary', outcome: 'fail', message: 'Network zone is not recognized by ABAC policy.' });
    return result(AccessDecision.deny, 'The network zone is not recognized by ABAC policy.', context);
  }
  ruleTrace.push({ rule: 'network-zone-vocabulary', outcome: 'pass', message: `Network zone ${networkZone} is recognized.` });

  if (!input.hasMapping) {
    violations.push('missing_role_data_mapping');
    ruleTrace.push({ rule: 'role-data-mapping', outcome: 'fail', message: 'No active role-to-data mapping matched this asset.' });
    return result(AccessDecision.deny, 'No approved role-to-data mapping exists for this domain and classification.', context);
  }
  ruleTrace.push({ rule: 'role-data-mapping', outcome: 'pass', message: 'An active role-to-data mapping matched this asset.' });

  if (
    input.assetClassificationRank != null &&
    input.allowedClassificationRank != null &&
    input.assetClassificationRank > input.allowedClassificationRank
  ) {
    violations.push('classification_above_role_limit');
    ruleTrace.push({ rule: 'classification-limit', outcome: 'fail', message: 'Asset classification exceeds the role limit.' });
    return result(AccessDecision.deny, 'Requested data is above the role classification limit.', context);
  }
  ruleTrace.push({ rule: 'classification-limit', outcome: 'pass', message: 'Asset classification is within the role limit.' });

  if (input.emergencyAccess || purpose === 'break_glass') {
    obligations.push('record_break_glass_review');
    if (!input.approvalTicketId) obligations.push('record_approval_ticket');
    if (!hasJustification(input.businessJustification)) obligations.push('capture_business_justification');
    ruleTrace.push({ rule: 'break-glass', outcome: 'review', message: 'Emergency access always requires explicit review and audit evidence.' });
    return result(AccessDecision.review_required, 'Break-glass access requires expedited security review before release.', context);
  }

  if (input.personalDataRequested && !input.legalBasisConfirmed) {
    obligations.push('verify_legal_basis');
    ruleTrace.push({ rule: 'legal-basis', outcome: 'review', message: 'Personal data access must include a confirmed legal basis.' });
    return result(AccessDecision.review_required, 'Personal data access requires confirmed legal basis before release.', context);
  }
  if (input.personalDataRequested) {
    ruleTrace.push({ rule: 'legal-basis', outcome: 'pass', message: 'Personal data legal basis is confirmed.' });
  }

  if (HIGH_RISK_NETWORK_ZONES.has(networkZone) && (risk === 'high' || risk === 'critical')) {
    obligations.push('route_security_network_review');
    ruleTrace.push({ rule: 'network-risk', outcome: 'review', message: 'High classification data requested from a higher-risk network zone.' });
    return result(AccessDecision.review_required, 'High-sensitivity data from this network zone requires security review.', context);
  }
  ruleTrace.push({ rule: 'network-risk', outcome: 'pass', message: 'Network zone does not force additional review for this classification.' });

  if (input.approvalRequired && REVIEW_ACTIONS.has(normalizedAction)) {
    obligations.push('route_owner_security_review');
    if (!input.approvalTicketId) obligations.push('record_approval_ticket');
    ruleTrace.push({ rule: 'high-risk-action-approval', outcome: 'review', message: 'This action requires owner or security approval.' });
    return result(AccessDecision.review_required, 'The requested action requires owner or security approval.', context);
  }

  if (DESTRUCTIVE_ACTIONS.has(normalizedAction)) {
    if (!input.approvalTicketId) obligations.push('record_approval_ticket');
    if (!hasJustification(input.businessJustification)) obligations.push('capture_business_justification');
    ruleTrace.push({ rule: 'change-action-control', outcome: 'review', message: 'Write, delete, admin, and publish actions require explicit change approval.' });
    return result(AccessDecision.review_required, 'Change-oriented access requires an approval ticket and business justification.', context);
  }

  if (input.personalDataRequested && !input.personalDataAllowed) {
    if (input.hasMaskingPolicy) {
      obligations.push('apply_masking_policy');
      ruleTrace.push({ rule: 'personal-data-direct-access', outcome: 'obligation', message: 'Personal data is not directly allowed, so masking is mandatory.' });
      return result(AccessDecision.masked, 'Personal data is not directly allowed for this role, so masking is required.', context);
    }
    obligations.push('route_privacy_review');
    ruleTrace.push({ rule: 'personal-data-direct-access', outcome: 'review', message: 'Personal data is not directly allowed and no masking policy is available.' });
    return result(AccessDecision.review_required, 'Personal data requires an explicit approval before access is granted.', context);
  }

  if (input.hasMaskingPolicy) {
    obligations.push('apply_masking_policy');
    ruleTrace.push({ rule: 'masking-policy', outcome: 'obligation', message: 'A masking policy is attached to the matching access map.' });
    return result(AccessDecision.masked, 'Access is allowed with the configured masking policy applied.', context);
  }

  ruleTrace.push({ rule: 'final-allow', outcome: 'pass', message: 'All ABAC checks passed without masking or review obligations.' });
  return result(AccessDecision.allow, 'Access is allowed by the active role-to-data mapping.', context);
}

export function evaluateAccessDecision(input: AccessDecisionInput): {
  decision: AccessDecision;
  reason: string;
} {
  const result = evaluateAbacDecision({
    ...input,
    purpose: 'governance',
    legalBasisConfirmed: true,
    networkZone: 'internal',
  });
  return {
    decision: result.decision,
    reason: result.reason,
  };
}
