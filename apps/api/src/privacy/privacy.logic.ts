import {
  BreachSeverity,
  BreachStatus,
  DpiaRiskLevel,
  DsrRequestStatus,
  PrivacyGateStatus,
  PrivacyWorkStatus,
} from '@prisma/client';

const KSA_WEEKEND_DAYS = new Set([5, 6]);

export function addKsaBusinessDays(start: Date, days: number): Date {
  const due = new Date(start);
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    due.setDate(due.getDate() + 1);
    if (!KSA_WEEKEND_DAYS.has(due.getDay())) remaining -= 1;
  }
  return due;
}

export function addHours(start: Date, hours: number): Date {
  return new Date(start.getTime() + Math.max(0, hours) * 60 * 60 * 1000);
}

export function addCalendarDays(start: Date, days: number): Date {
  const due = new Date(start);
  due.setUTCDate(due.getUTCDate() + Math.max(0, Math.floor(days)));
  return due;
}

export function dsrDeadlineExtensionError(row: { status: string; identityValidated: boolean; identityEvidenceReference?: string | null; receivedAt: Date; dueAt: Date; extensionDueAt?: Date | null }, extension: { dueAt: Date; reason: string; communicatedAt: Date; communicationReference: string }, now = new Date()): string | null {
  if (row.extensionDueAt) return 'An approved deadline extension cannot be replaced';
  if (['fulfilled', 'rejected', 'closed'].includes(row.status)) return 'Completed requests cannot receive a deadline extension';
  if (!row.identityValidated || !row.identityEvidenceReference?.trim()) return 'Verify the requester identity before extending the deadline';
  if (!extension.reason.trim() || !extension.communicationReference.trim()) return 'A deadline extension requires justification and communication evidence';
  if (!Number.isFinite(extension.dueAt.getTime()) || !Number.isFinite(extension.communicatedAt.getTime())) return 'Extension dates must be valid';
  if (extension.communicatedAt < row.receivedAt || extension.communicatedAt > now || extension.communicatedAt >= row.dueAt || now >= row.dueAt) return 'Record and communicate the extension before the original deadline';
  if (extension.dueAt <= row.dueAt || extension.dueAt > addCalendarDays(row.dueAt, 30)) return 'A deadline extension must add no more than 30 calendar days';
  return null;
}

export function privacySlaStatus(
  dueAt: Date | null | undefined,
  status: PrivacyWorkStatus | DsrRequestStatus | BreachStatus,
  now = new Date(),
): 'closed' | 'overdue' | 'due_soon' | 'on_track' {
  if (!dueAt) return 'on_track';
  const closedStatuses = new Set<string>([
    PrivacyWorkStatus.closed,
    PrivacyWorkStatus.approved,
    DsrRequestStatus.fulfilled,
    DsrRequestStatus.closed,
    BreachStatus.closed,
    BreachStatus.false_positive,
  ]);
  if (closedStatuses.has(status)) {
    return 'closed';
  }
  const diffMs = dueAt.getTime() - now.getTime();
  if (diffMs < 0) return 'overdue';
  return diffMs <= 3 * 24 * 60 * 60 * 1000 ? 'due_soon' : 'on_track';
}

export function breachNotificationStatus(
  notificationDueAt: Date,
  status: BreachStatus,
  notifiedAt?: Date | null,
  now = new Date(),
  obligations?: BreachNotificationFacts,
): 'notified' | 'not_required' | 'assessment_required' | 'overdue' | 'urgent' | 'on_track' {
  if (obligations) {
    const resolved = notificationObligationsResolved(obligations);
    if (resolved) return obligations.regulatorNotificationRequired === false && obligations.subjectNotificationRequired === false ? 'not_required' : 'notified';
  } else if (notifiedAt && status === BreachStatus.notified) return 'notified';
  const diffMs = notificationDueAt.getTime() - now.getTime();
  if (diffMs < 0) return 'overdue';
  if (diffMs <= 12 * 60 * 60 * 1000) return 'urgent';
  return obligations && (obligations.regulatorNotificationRequired == null || obligations.subjectNotificationRequired == null) ? 'assessment_required' : 'on_track';
}

export interface BreachNotificationFacts {
  regulatorNotificationRequired?: boolean | null;
  subjectNotificationRequired?: boolean | null;
  notificationDecisionReason?: string | null;
  regulatorNotified: boolean;
  subjectNotified: boolean;
  notifiedAt?: Date | null;
  subjectNotifiedAt?: Date | null;
  regulatorNotificationEvidenceReference?: string | null;
  subjectNotificationEvidenceReference?: string | null;
}

export function notificationObligationsResolved(row: BreachNotificationFacts): boolean {
  const reason = !!row.notificationDecisionReason?.trim();
  const regulator = row.regulatorNotificationRequired === false ? reason : row.regulatorNotificationRequired === true && row.regulatorNotified && !!row.notifiedAt && !!row.regulatorNotificationEvidenceReference?.trim();
  const subject = row.subjectNotificationRequired === false ? reason : row.subjectNotificationRequired === true && row.subjectNotified && !!row.subjectNotifiedAt && !!row.subjectNotificationEvidenceReference?.trim();
  return regulator && subject;
}

export function dsrTransitionError(previousStatus: string, row: { status: string; identityValidated: boolean; identityEvidenceReference?: string | null; completionEvidenceReference?: string | null; decisionSummary?: string | null; receivedAt: Date; fulfilledAt?: Date | null }, now = new Date()): string | null {
  const transitions: Record<string, string[]> = { received: ['identity_validation', 'in_progress', 'rejected'], identity_validation: ['in_progress', 'rejected'], in_progress: ['awaiting_data_owner', 'fulfilled', 'rejected'], awaiting_data_owner: ['in_progress', 'fulfilled', 'rejected'], fulfilled: ['closed'], rejected: ['closed'], closed: [] };
  if (row.status !== previousStatus && !transitions[previousStatus]?.includes(row.status)) return 'Invalid DSR lifecycle transition';
  if (row.identityValidated && !row.identityEvidenceReference?.trim()) return 'Identity verification evidence is required';
  if (['in_progress', 'awaiting_data_owner', 'fulfilled'].includes(row.status) && !row.identityValidated) return 'Verify the requester identity before executing the request';
  if (row.status === 'fulfilled' || row.fulfilledAt) {
    if (!row.identityValidated || !row.identityEvidenceReference?.trim() || !row.completionEvidenceReference?.trim() || !row.decisionSummary?.trim() || !row.fulfilledAt) return 'Fulfillment requires verified identity, completion evidence, a decision summary and a fulfillment time';
    if (row.fulfilledAt < row.receivedAt || row.fulfilledAt > now) return 'Fulfillment time must be between receipt and the current time';
  }
  if (row.status === 'rejected' && !row.decisionSummary?.trim()) return 'A rejection reason is required';
  return null;
}

export function breachTransitionError(previousStatus: string, row: BreachNotificationFacts & { status: string; detectedAt: Date; containedAt?: Date | null }, now = new Date()): string | null {
  const transitions: Record<string, string[]> = { detected: ['triage', 'contained', 'false_positive'], triage: ['contained', 'notified', 'closed', 'false_positive'], contained: ['notified', 'closed', 'false_positive'], notified: ['closed'], closed: [], false_positive: [] };
  if (row.status !== previousStatus && !transitions[previousStatus]?.includes(row.status)) return 'Invalid breach lifecycle transition';
  if ((row.regulatorNotificationRequired === false || row.subjectNotificationRequired === false) && !row.notificationDecisionReason?.trim()) return 'A notification obligation decision requires a reason';
  for (const date of [row.containedAt, row.notifiedAt, row.subjectNotifiedAt]) if (date && (date < row.detectedAt || date > now)) return 'Incident action dates must be between awareness and the current time';
  if (row.regulatorNotified && (row.regulatorNotificationRequired !== true || !row.notifiedAt || !row.regulatorNotificationEvidenceReference?.trim())) return 'Regulator notification requires an applicable obligation, time and evidence';
  if (row.subjectNotified && (row.subjectNotificationRequired !== true || !row.subjectNotifiedAt || !row.subjectNotificationEvidenceReference?.trim())) return 'Subject notification requires an applicable obligation, time and evidence';
  if (row.status === 'contained' && !row.containedAt) return 'Containment time is required';
  if (['notified', 'closed', 'false_positive'].includes(row.status) && !notificationObligationsResolved(row)) return 'Resolve and document notification obligations before completing the incident';
  if (row.status === 'false_positive' && (row.regulatorNotificationRequired !== false || row.subjectNotificationRequired !== false)) return 'A false positive requires a documented decision that notifications are not required';
  return null;
}

export function riskLevelFromScore(score: number): DpiaRiskLevel {
  if (score >= 80) return DpiaRiskLevel.critical;
  if (score >= 60) return DpiaRiskLevel.high;
  if (score >= 35) return DpiaRiskLevel.medium;
  return DpiaRiskLevel.low;
}

export function calculateDpiaRisk(input: {
  classificationRank?: number | null;
  crossBorderTransfer?: boolean;
  sensitiveSubjects?: boolean;
  existingControls?: number;
}): { inherentRiskScore: number; residualRiskScore: number; riskLevel: DpiaRiskLevel; controls: string[] } {
  const rank = input.classificationRank ?? 2;
  const controls = Math.max(0, Math.min(100, input.existingControls ?? 40));
  let inherentRiskScore = Math.min(100, rank * 18 + 20);
  if (input.crossBorderTransfer) inherentRiskScore += 12;
  if (input.sensitiveSubjects) inherentRiskScore += 12;
  inherentRiskScore = Math.min(100, inherentRiskScore);
  const residualRiskScore = Math.max(0, Math.round(inherentRiskScore - controls * 0.45));
  const requiredControls: string[] = [];
  if (rank >= 3) requiredControls.push('classification_review');
  if (input.crossBorderTransfer) requiredControls.push('cross_border_transfer_review');
  if (input.sensitiveSubjects) requiredControls.push('sensitive_subject_controls');
  if (residualRiskScore >= 60) requiredControls.push('dpo_approval');
  return {
    inherentRiskScore,
    residualRiskScore,
    riskLevel: riskLevelFromScore(residualRiskScore),
    controls: requiredControls,
  };
}

export function dpiaStatusFromGates(gates: { status: PrivacyGateStatus }[]): PrivacyWorkStatus {
  if (!gates.length) return PrivacyWorkStatus.draft;
  if (gates.some((gate) => gate.status === PrivacyGateStatus.blocked)) return PrivacyWorkStatus.action_required;
  if (gates.length === 5 && gates.every((gate) => gate.status === PrivacyGateStatus.approved || gate.status === PrivacyGateStatus.not_required)) {
    return PrivacyWorkStatus.approved;
  }
  return PrivacyWorkStatus.under_review;
}

export function breachDefaultSeverity(score: number): BreachSeverity {
  if (score >= 80) return BreachSeverity.critical;
  if (score >= 60) return BreachSeverity.high;
  if (score >= 30) return BreachSeverity.medium;
  return BreachSeverity.low;
}
