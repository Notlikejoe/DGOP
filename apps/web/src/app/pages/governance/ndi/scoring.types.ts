import { StatusKind } from '../../../shared/status-chip';

export type GapType = 'missing' | 'expired' | 'rejected' | 'unassigned' | 'stuck';
export type GapSeverity = 'high' | 'medium' | 'low';

export interface DomainReadiness {
  domainId: string;
  code: string;
  shortCode: string | null;
  nameEn: string;
  nameAr: string;
  specCount: number;
  satisfiedCount: number;
  score: number;
  maturity: string;
}

export interface ReadinessOverview {
  overall: { score: number; maturity: string; specCount: number; satisfiedCount: number };
  domains: DomainReadiness[];
  gapTotals: Record<GapType, number>;
}

export interface SpecScoreRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  type: string;
  maturityLevel: string;
  ownerPersonId: string | null;
  ownerName: string | null;
  weight: number;
  satisfied: boolean;
  score: number;
  evidenceStatus: string;
  evidenceCounts: Record<string, number> | null;
  gaps: GapType[];
}

export interface DomainDetail extends DomainReadiness {
  specs: SpecScoreRow[];
}

export interface GapRow {
  specId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  domainId: string;
  domainCode: string;
  domainShortCode: string | null;
  gapType: GapType;
  severity: GapSeverity;
}

export const MATURITY_KIND: Record<string, StatusKind> = {
  initial: 'danger',
  defined: 'warning',
  activated: 'info',
  enabled: 'info',
  leading: 'success',
};

export const SEVERITY_KIND: Record<GapSeverity, StatusKind> = {
  high: 'danger',
  medium: 'warning',
  low: 'muted',
};

export const GAP_TYPES: GapType[] = ['missing', 'expired', 'rejected', 'unassigned', 'stuck'];

/** Colour for the readiness progress bar based on score. */
export function scoreKind(score: number): StatusKind {
  if (score >= 80) return 'success';
  if (score >= 40) return 'info';
  if (score >= 20) return 'warning';
  return 'danger';
}
