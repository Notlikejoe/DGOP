import {
  GovernanceEscalationLevel,
  GovernanceNotificationSeverity,
} from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;
const KSA_WEEKEND_DAYS = new Set([5, 6]);

export type SlaSignal = 'on_track' | 'at_risk' | 'overdue' | 'done' | 'none';

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function recurringHolidayKey(date: Date): string {
  return date.toISOString().slice(5, 10);
}

export function isKsaBusinessDay(date: Date, holidayDates: string[] = [], recurringHolidayDates: string[] = []): boolean {
  if (KSA_WEEKEND_DAYS.has(date.getUTCDay())) return false;
  if (holidayDates.includes(dateKey(date))) return false;
  return !recurringHolidayDates.includes(recurringHolidayKey(date));
}

export function addKsaBusinessDays(start: Date, days: number, holidayDates: string[] = [], recurringHolidayDates: string[] = []): Date {
  const result = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 12));
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isKsaBusinessDay(result, holidayDates, recurringHolidayDates)) remaining--;
  }
  return result;
}

export function businessDaysBetween(from: Date, to: Date, holidayDates: string[] = [], recurringHolidayDates: string[] = []): number {
  const direction = to.getTime() >= from.getTime() ? 1 : -1;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 12));
  let days = 0;
  while (cursor.getTime() !== end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + direction);
    if (isKsaBusinessDay(cursor, holidayDates, recurringHolidayDates)) days += direction;
  }
  return days;
}

export function ksaSlaSignal(input: {
  status: string;
  dueDate: Date | null;
  completedAt?: Date | null;
}, now = new Date(), holidayDates: string[] = [], recurringHolidayDates: string[] = []): SlaSignal {
  if (['completed', 'cancelled'].includes(input.status) || input.completedAt) return 'done';
  if (!input.dueDate) return 'none';
  const remaining = businessDaysBetween(now, input.dueDate, holidayDates, recurringHolidayDates);
  if (remaining < 0) return 'overdue';
  if (remaining <= 2) return 'at_risk';
  return 'on_track';
}

export function escalationLevel(overdueBusinessDays: number): GovernanceEscalationLevel {
  if (overdueBusinessDays >= 10) return GovernanceEscalationLevel.executive_steering_committee;
  if (overdueBusinessDays >= 6) return GovernanceEscalationLevel.data_governance_board;
  if (overdueBusinessDays >= 3) return GovernanceEscalationLevel.data_stewardship_council;
  return GovernanceEscalationLevel.domain_council;
}

export function escalationPenalty(overdueBusinessDays: number): number {
  return Math.max(1, overdueBusinessDays) * 5;
}

export function notificationSeverity(signal: SlaSignal, overdueBusinessDays = 0): GovernanceNotificationSeverity {
  if (signal === 'overdue' && overdueBusinessDays >= 6) return GovernanceNotificationSeverity.critical;
  if (signal === 'overdue' || signal === 'at_risk') return GovernanceNotificationSeverity.warning;
  if (signal === 'done') return GovernanceNotificationSeverity.success;
  return GovernanceNotificationSeverity.info;
}

export const ESCALATION_LEVEL_LABELS: Record<GovernanceEscalationLevel, string> = {
  [GovernanceEscalationLevel.domain_council]: 'Domain Council',
  [GovernanceEscalationLevel.data_stewardship_council]: 'Data Stewardship Council',
  [GovernanceEscalationLevel.data_governance_board]: 'Data Governance Board',
  [GovernanceEscalationLevel.executive_steering_committee]: 'Executive Steering Committee',
};
