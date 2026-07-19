/**
 * Pure NDI scoring math — no database access — so it can be unit-tested directly.
 *
 * Readiness model (documented for reviewers):
 * - A specification is SATISFIED when it has at least one approved, not-expired,
 *   not-revoked piece of evidence (the canonical rule in evidence-status.ts).
 * - Each specification is weighted by its TYPE (controls/policies matter more than
 *   guidelines) and a small MATURITY bonus (higher target levels weigh slightly more).
 * - Domain readiness % = sum(weight of satisfied specs) / sum(weight of all specs) * 100.
 * - The percentage maps to a maturity band (Initial -> Leading).
 */

export const TYPE_WEIGHTS: Record<string, number> = {
  policy: 1.0,
  standard: 1.0,
  control: 1.2,
  procedure: 0.8,
  guideline: 0.6,
};

export const MATURITY_INDEX: Record<string, number> = {
  level_1: 0,
  level_2: 1,
  level_3: 2,
  level_4: 3,
  level_5: 4,
};

/** Number of days a submitted/under-review item may sit before it counts as "stuck". */
export const STUCK_DAYS = 14;

export type GapType = 'missing' | 'expired' | 'rejected' | 'unassigned' | 'stuck';
export const GAP_TYPES = ['missing', 'expired', 'rejected', 'unassigned', 'stuck'] as const satisfies readonly GapType[];

export interface MaturityBand {
  key: string;
  /** inclusive lower bound (percentage) */
  min: number;
}

/** Five readiness bands, ascending. */
export const MATURITY_BANDS: MaturityBand[] = [
  { key: 'initial', min: 0 },
  { key: 'defined', min: 20 },
  { key: 'activated', min: 40 },
  { key: 'enabled', min: 60 },
  { key: 'leading', min: 80 },
];

export function maturityBand(pct: number): string {
  let band = MATURITY_BANDS[0].key;
  for (const b of MATURITY_BANDS) if (pct >= b.min) band = b.key;
  return band;
}

/** Combined weight of a specification: type weight with a +10% per maturity level bonus. */
export function specWeight(type: string, maturityLevel: string): number {
  const typeW = TYPE_WEIGHTS[type] ?? 1.0;
  const matBonus = 1 + (MATURITY_INDEX[maturityLevel] ?? 0) * 0.1;
  return typeW * matBonus;
}

/** Binary compliance score for a specification: 100 if satisfied, else 0. */
export function specScore(hasCurrentApproved: boolean): number {
  return hasCurrentApproved ? 100 : 0;
}

export interface WeightedSpec {
  weight: number;
  satisfied: boolean;
}

/** Weighted readiness percentage (0-100) for a set of specs. Empty set -> 0. */
export function readinessPct(specs: WeightedSpec[]): number {
  const totalWeight = specs.reduce((s, x) => s + x.weight, 0);
  if (totalWeight === 0) return 0;
  const got = specs.reduce((s, x) => s + (x.satisfied ? x.weight : 0), 0);
  return Math.round((got / totalWeight) * 100);
}

export interface GapInput {
  ownerPersonId: string | null;
  hasCurrentApproved: boolean;
  total: number;
  expired: number;
  rejected: number;
  pendingCount: number;
  oldestPendingAt: Date | null;
}

/**
 * Derives the gap types for a single specification. A spec can have several gaps.
 * Satisfied specs only ever surface the "unassigned" governance gap.
 */
export function detectGaps(input: GapInput, now: Date = new Date()): GapType[] {
  const gaps: GapType[] = [];
  if (!input.hasCurrentApproved) {
    if (input.total === 0) gaps.push('missing');
    if (input.expired > 0) gaps.push('expired');
    if (input.rejected > 0) gaps.push('rejected');
    if (input.pendingCount > 0 && input.oldestPendingAt) {
      const ageDays = (now.getTime() - input.oldestPendingAt.getTime()) / 86_400_000;
      if (ageDays >= STUCK_DAYS) gaps.push('stuck');
    }
  }
  if (!input.ownerPersonId) gaps.push('unassigned');
  return gaps;
}

export const GAP_SEVERITY: Record<GapType, 'high' | 'medium' | 'low'> = {
  missing: 'high',
  expired: 'high',
  rejected: 'medium',
  stuck: 'medium',
  unassigned: 'low',
};
