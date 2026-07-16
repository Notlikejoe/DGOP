export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface TrendBucket {
  key: string;
  label: string;
  openDataCreated: number;
  openDataPublished: number;
  foiReceived: number;
  foiDisclosed: number;
}

export interface RiskSignal {
  id: string;
  source: 'open_data' | 'foi' | 'privacy' | 'data_sharing' | 'workflow';
  title: string;
  detail: string;
  severity: RiskSeverity;
  route: string;
  dueAt?: string | null;
  metric?: number | null;
}

export function pct(done: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function severityRank(severity: RiskSeverity): number {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

export function riskSeverity(score: number): RiskSeverity {
  if (score >= 85) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

export function sortRisks<T extends RiskSignal>(risks: T[]): T[] {
  return [...risks].sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity);
    if (severityDiff) return severityDiff;
    const aDate = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDate = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (aDate !== bDate) return aDate - bDate;
    return (b.metric ?? 0) - (a.metric ?? 0);
  });
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleString('en', { month: 'short' });
}

export function emptyTrendBuckets(now = new Date(), months = 6): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    date.setMonth(date.getMonth() - offset);
    buckets.push({
      key: monthKey(date),
      label: monthLabel(date),
      openDataCreated: 0,
      openDataPublished: 0,
      foiReceived: 0,
      foiDisclosed: 0,
    });
  }
  return buckets;
}

export function addTrendDate(
  buckets: TrendBucket[],
  field: keyof Omit<TrendBucket, 'key' | 'label'>,
  date?: Date | string | null,
): void {
  if (!date) return;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return;
  const bucket = buckets.find((row) => row.key === monthKey(parsed));
  if (bucket) bucket[field] += 1;
}

export function releaseReadiness(input: {
  openDataPublished: number;
  openDataTotal: number;
  foiClosed: number;
  foiTotal: number;
  privacyBlockers: number;
  sharingBlockers: number;
  overdueWorkflow: number;
}): { score: number; status: 'ready' | 'watch' | 'blocked'; blockers: string[] } {
  const blockers: string[] = [];
  const openDataScore = pct(input.openDataPublished, input.openDataTotal);
  const foiScore = pct(input.foiClosed, input.foiTotal);
  let score = Math.round((openDataScore + foiScore) / 2);

  if (input.privacyBlockers > 0) {
    blockers.push('privacy');
    score -= Math.min(25, input.privacyBlockers * 5);
  }
  if (input.sharingBlockers > 0) {
    blockers.push('data_sharing');
    score -= Math.min(20, input.sharingBlockers * 5);
  }
  if (input.overdueWorkflow > 0) {
    blockers.push('workflow');
    score -= Math.min(20, input.overdueWorkflow * 4);
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    status: blockers.length ? 'blocked' : score >= 75 ? 'ready' : 'watch',
    blockers,
  };
}
