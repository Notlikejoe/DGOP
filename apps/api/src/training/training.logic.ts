export interface AwarenessCounts {
  assignments: number;
  completed: number;
  expired: number;
  overdue: number;
  certifications: number;
  certified: number;
  ceHours: number;
  mentorships: number;
}

export function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function awarenessReadinessScore(counts: AwarenessCounts): number {
  const training = pct(counts.completed, counts.assignments);
  const certification = pct(counts.certified, counts.certifications);
  const ce = Math.min(100, Math.round((counts.ceHours / 16) * 100));
  const mentoring = counts.mentorships > 0 ? 100 : 0;
  return Math.round(training * 0.45 + certification * 0.3 + ce * 0.15 + mentoring * 0.1);
}

export function certificationState(status: string, expiresAt?: Date | string | null, now = new Date()): string {
  if (status !== 'passed') return status;
  if (!expiresAt) return 'current';
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (expiry.getTime() < now.getTime()) return 'expired';
  const renewalWindow = new Date(now);
  renewalWindow.setDate(renewalWindow.getDate() + 60);
  return expiry.getTime() <= renewalWindow.getTime() ? 'renewal_due' : 'current';
}

export function assignmentEffectiveStatus(status: string, expiresAt?: Date | string | null, now = new Date()): string {
  if (status !== 'completed' || !expiresAt) return status;
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return expiry.getTime() < now.getTime() ? 'expired' : status;
}
