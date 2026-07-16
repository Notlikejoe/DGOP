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
  const due = new Date(start);
  due.setHours(due.getHours() + Math.max(0, hours));
  return due;
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
): 'notified' | 'overdue' | 'urgent' | 'on_track' {
  if (notifiedAt || status === BreachStatus.notified || status === BreachStatus.closed) return 'notified';
  const diffMs = notificationDueAt.getTime() - now.getTime();
  if (diffMs < 0) return 'overdue';
  return diffMs <= 12 * 60 * 60 * 1000 ? 'urgent' : 'on_track';
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
  if (gates.every((gate) => gate.status === PrivacyGateStatus.approved || gate.status === PrivacyGateStatus.not_required)) {
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
