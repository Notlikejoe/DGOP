import { Prisma } from '@prisma/client';
import { jsonRecord } from './ai-risk-scoring';
import { governanceDigest } from './ai-governance-ledger';

export const AI_REPORTING_VERSION = 'ai-dashboard-v3';
export type ReportAssessment = { id: string; riskId: string; kind: string; round: number; result: Prisma.JsonValue; inputs: Prisma.JsonValue; createdAt: Date };
export type EffectiveReportConfiguration = { id: string; sourceRequestId: string | null; tierCode: string; payload: Prisma.JsonValue; riskSnapshot: Prisma.JsonValue; createdAt: Date };

/** Historical baselines retain their original provenance. A changed configuration
 * cannot inherit an assessment, response or residual result for the old setup. */
export function reportingAssessments(risk: { id: string; version: number }, native: ReportAssessment[], configuration: EffectiveReportConfiguration | null): ReportAssessment[] {
  if (!configuration?.sourceRequestId) return native;
  const fresh = native.filter(a => a.createdAt >= configuration.createdAt);
  if (fresh.some(a => a.kind === 'inherent')) return fresh;
  const snapshots = Array.isArray(configuration.riskSnapshot) ? configuration.riskSnapshot.map(jsonRecord) : [];
  const candidates = snapshots.filter(s => s['riskId'] === risk.id && s['version'] === risk.version && s['configurationDigest'] === governanceDigest(configuration.payload));
  if (candidates.length !== 1) return [];
  const result = candidates[0];
  if (!Number.isInteger(result['score']) || Number(result['score']) < 1 || Number(result['score']) > 16) return [];
  return [{ id: `configuration:${configuration.id}:${risk.id}`, riskId: risk.id, kind: 'inherent', round: Number.MAX_SAFE_INTEGER,
    result: result as Prisma.JsonObject, inputs: { effectiveConfigurationId: configuration.id }, createdAt: configuration.createdAt }];
}

/** Index once; task traversal grows with the population rather than its square. */
export function indexBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) { const id = key(row), group = result.get(id); if (group) group.push(row); else result.set(id, [row]); }
  return result;
}
