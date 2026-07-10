import {
  DataQualityDimension,
  DataQualityIssueStatus,
  DataQualityPriority,
  DataQualitySeverity,
  DataQualitySlaStage,
} from '@prisma/client';

export const DQ_DIMENSION_ORDER: DataQualityDimension[] = [
  DataQualityDimension.completeness,
  DataQualityDimension.accuracy,
  DataQualityDimension.validity,
  DataQualityDimension.consistency,
  DataQualityDimension.timeliness,
  DataQualityDimension.uniqueness,
];

const PRIORITY_BY_SEVERITY: Record<DataQualitySeverity, DataQualityPriority> = {
  [DataQualitySeverity.critical]: DataQualityPriority.P1,
  [DataQualitySeverity.high]: DataQualityPriority.P2,
  [DataQualitySeverity.medium]: DataQualityPriority.P3,
  [DataQualitySeverity.low]: DataQualityPriority.P4,
};

const SLA_HOURS: Record<DataQualityPriority, Record<DataQualitySlaStage, number>> = {
  [DataQualityPriority.P1]: {
    [DataQualitySlaStage.triage]: 4,
    [DataQualitySlaStage.remediation]: 24,
    [DataQualitySlaStage.validation]: 48,
    [DataQualitySlaStage.closure]: 72,
  },
  [DataQualityPriority.P2]: {
    [DataQualitySlaStage.triage]: 8,
    [DataQualitySlaStage.remediation]: 48,
    [DataQualitySlaStage.validation]: 72,
    [DataQualitySlaStage.closure]: 120,
  },
  [DataQualityPriority.P3]: {
    [DataQualitySlaStage.triage]: 24,
    [DataQualitySlaStage.remediation]: 120,
    [DataQualitySlaStage.validation]: 168,
    [DataQualitySlaStage.closure]: 240,
  },
  [DataQualityPriority.P4]: {
    [DataQualitySlaStage.triage]: 72,
    [DataQualitySlaStage.remediation]: 240,
    [DataQualitySlaStage.validation]: 336,
    [DataQualitySlaStage.closure]: 480,
  },
};

export interface ProfileColumnInput {
  completenessPct?: number | null;
  uniquenessPct?: number | null;
  validityPct?: number | null;
  anomalyCount?: number | null;
  recommendation?: string | null;
}

export interface ProfileScore {
  qualityScore: number;
  anomalyCount: number;
  recommendedRules: number;
}

export function priorityForSeverity(severity: DataQualitySeverity): DataQualityPriority {
  return PRIORITY_BY_SEVERITY[severity];
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

export function slaDueDates(
  detectedAt: Date,
  priority: DataQualityPriority,
): Record<'triageDueAt' | 'remediationDueAt' | 'validationDueAt', Date> {
  const stages = SLA_HOURS[priority];
  return {
    triageDueAt: addHours(detectedAt, stages[DataQualitySlaStage.triage]),
    remediationDueAt: addHours(detectedAt, stages[DataQualitySlaStage.remediation]),
    validationDueAt: addHours(detectedAt, stages[DataQualitySlaStage.validation]),
  };
}

export function isOpenIssue(status: DataQualityIssueStatus): boolean {
  const openStatuses: readonly DataQualityIssueStatus[] = [
    DataQualityIssueStatus.open,
    DataQualityIssueStatus.triaged,
    DataQualityIssueStatus.in_progress,
    DataQualityIssueStatus.resolved,
  ];
  return openStatuses.includes(status);
}

export function currentSlaStage(status: DataQualityIssueStatus): DataQualitySlaStage | null {
  if (status === DataQualityIssueStatus.open) return DataQualitySlaStage.triage;
  if (status === DataQualityIssueStatus.triaged || status === DataQualityIssueStatus.in_progress) {
    return DataQualitySlaStage.remediation;
  }
  if (status === DataQualityIssueStatus.resolved) return DataQualitySlaStage.validation;
  return null;
}

export function dueAtForStage(
  issue: {
    status: DataQualityIssueStatus;
    triageDueAt?: Date | null;
    remediationDueAt?: Date | null;
    validationDueAt?: Date | null;
    dueDate?: Date | null;
  },
  stage = currentSlaStage(issue.status),
): Date | null {
  if (stage === DataQualitySlaStage.triage) return issue.triageDueAt ?? issue.dueDate ?? null;
  if (stage === DataQualitySlaStage.remediation) return issue.remediationDueAt ?? issue.dueDate ?? null;
  if (stage === DataQualitySlaStage.validation) return issue.validationDueAt ?? issue.dueDate ?? null;
  if (stage === DataQualitySlaStage.closure) return issue.dueDate ?? null;
  return null;
}

export function isSlaBreached(
  issue: {
    status: DataQualityIssueStatus;
    triageDueAt?: Date | null;
    remediationDueAt?: Date | null;
    validationDueAt?: Date | null;
    dueDate?: Date | null;
  },
  now = new Date(),
): boolean {
  if (!isOpenIssue(issue.status)) return false;
  const dueAt = dueAtForStage(issue);
  return !!dueAt && dueAt.getTime() < now.getTime();
}

function clampPct(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function profileScore(columns: ProfileColumnInput[]): ProfileScore {
  if (!columns.length) return { qualityScore: 0, anomalyCount: 0, recommendedRules: 0 };
  const scores = columns.map((column) => {
    const parts = [
      clampPct(column.completenessPct),
      clampPct(column.validityPct),
      clampPct(column.uniquenessPct),
    ];
    return Math.round(parts.reduce((sum, part) => sum + part, 0) / parts.length);
  });
  const qualityScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  const anomalyCount = columns.reduce((sum, column) => sum + Math.max(0, Math.round(column.anomalyCount ?? 0)), 0);
  const recommendedRules = columns.filter((column) => {
    return !!column.recommendation || clampPct(column.completenessPct) < 95 || clampPct(column.validityPct) < 95 || (column.anomalyCount ?? 0) > 0;
  }).length;
  return { qualityScore, anomalyCount, recommendedRules };
}

export function scoreStatus(score: number): 'healthy' | 'needs_review' | 'critical' {
  if (score >= 85) return 'healthy';
  if (score >= 65) return 'needs_review';
  return 'critical';
}
