import { FoiDecisionOutcome, FoiRequestStatus } from '@prisma/client';

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

export function foiSlaStatus(dueAt: Date, status: FoiRequestStatus, now = new Date()): 'closed' | 'overdue' | 'due_soon' | 'on_track' {
  if (
    status === FoiRequestStatus.closed ||
    status === FoiRequestStatus.cancelled ||
    status === FoiRequestStatus.disclosed ||
    status === FoiRequestStatus.rejected
  ) {
    return 'closed';
  }
  const diffMs = dueAt.getTime() - now.getTime();
  if (diffMs < 0) return 'overdue';
  const dayMs = 24 * 60 * 60 * 1000;
  return diffMs <= 3 * dayMs ? 'due_soon' : 'on_track';
}

export function statusForFoiDecision(outcome: FoiDecisionOutcome): FoiRequestStatus {
  if (outcome === FoiDecisionOutcome.approved) return FoiRequestStatus.approved;
  if (outcome === FoiDecisionOutcome.partially_approved) return FoiRequestStatus.partially_approved;
  if (outcome === FoiDecisionOutcome.rejected) return FoiRequestStatus.rejected;
  return FoiRequestStatus.extended;
}

export function canDiscloseFoi(status: FoiRequestStatus): boolean {
  return status === FoiRequestStatus.approved || status === FoiRequestStatus.partially_approved;
}
