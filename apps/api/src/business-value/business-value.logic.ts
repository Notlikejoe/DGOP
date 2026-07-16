import {
  BusinessGlossaryStatus,
  BusinessImpactLevel,
  DataValueStatus,
  LifecycleDecisionStatus,
} from '@prisma/client';

export function clampScore(value: number | undefined | null, fallback = 0): number {
  const score = Math.round(Number(value ?? fallback));
  if (!Number.isFinite(score)) return fallback;
  return Math.max(0, Math.min(100, score));
}

export function impactLevelFromScore(score: number): BusinessImpactLevel {
  if (score >= 85) return BusinessImpactLevel.critical;
  if (score >= 65) return BusinessImpactLevel.high;
  if (score >= 35) return BusinessImpactLevel.medium;
  return BusinessImpactLevel.low;
}

export function dataValueStatus(actualValue: number | undefined, targetValue: number | undefined): DataValueStatus {
  const actual = Number(actualValue ?? 0);
  const target = Number(targetValue ?? 0);
  if (target <= 0 && actual <= 0) return DataValueStatus.planned;
  if (target <= 0 && actual > 0) return DataValueStatus.realized;
  const ratio = actual / target;
  if (ratio >= 1) return DataValueStatus.realized;
  if (ratio >= 0.7) return DataValueStatus.measuring;
  return DataValueStatus.at_risk;
}

export function glossaryHealth(rows: { status: BusinessGlossaryStatus; reviewDueAt: Date | null }[], now = new Date()) {
  const approved = rows.filter((row) => row.status === BusinessGlossaryStatus.approved).length;
  const reviewDue = rows.filter((row) => row.reviewDueAt && row.reviewDueAt.getTime() <= now.getTime()).length;
  const readinessScore = rows.length ? Math.round((approved / rows.length) * 100) : 0;
  return {
    total: rows.length,
    approved,
    reviewDue,
    readinessScore,
    status: reviewDue > 0 || readinessScore < 60 ? 'at_risk' : readinessScore >= 80 ? 'healthy' : 'watch',
  };
}

export function lifecycleSignal(input: {
  status: LifecycleDecisionStatus;
  disposalDueAt?: Date | null;
}, now = new Date()): 'ready' | 'review' | 'blocked' {
  if (input.status === LifecycleDecisionStatus.rejected) return 'blocked';
  if (input.status === LifecycleDecisionStatus.implemented) return 'ready';
  if (input.disposalDueAt && input.disposalDueAt.getTime() <= now.getTime()) return 'blocked';
  return 'review';
}

export function averageScore(values: Array<number | null | undefined>): number {
  const clean = values.map((value) => Number(value ?? 0)).filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}
