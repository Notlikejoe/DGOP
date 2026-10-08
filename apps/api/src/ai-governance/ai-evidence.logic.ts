import { createHash } from 'node:crypto';

export interface DecisionSubject { actor: string; action: string; entityType: string; entityId?: string | null; metadata?: Record<string, unknown> | null }
// Deliberate final-action contracts. Draft proposals, calculations and notifications
// cannot acquire verified-decision status simply by carrying evidence identifiers.
const contracts = [
  /^aiuc\.lifecycle\.(verification|privacy|security|ethics|authority|confirmation)\.(approve|return|reject)$/u,
  /^aiuc\.classification\.(verified|overridden|unacceptable|reversed)$/u,
  /^aiuc\.review\.[a-z0-9-]+\.(approve|return|reject)$/u,
  /^aiuc\.decision\.(approve|approve_with_conditions|return|reject|restrict|stop)$/u,
  /^aiuc\.asset\.(approve|return|reject|confirm)$/u,
  /^aiuc\.request\.(withdrawn|closed_no_action)$/u,
  /^airs\.assessment\.(ethics|adoption)\.(approve|return)$/u,
  /^airs\.response\.(officer|privacy|security)\.(approve|return)$/u,
  /^airs\.treatment\.plan\.(approve|return)$/u,
  /^airs\.treatment\.action\.completed$/u,
  /^airs\.residual\.(adoption|ethics|accept_owner|countersign|executive|steering)\.(approve|return|accept|restrict|stop)$/u,
  /^airs\.(review\.complete|reassessment\.started|reassessment\.trigger\.recorded)$/u,
  /^airs\.severity\.(approved|returned|reversed)$/u,
  /^airs\.strategy\.(avoidance_review|avoidance_closed|escalation_open|escalation_outcome)$/u,
  /^ai\.annual\.review\.(complete|handover)$/u,
  /^(airs\.library\.publish|airs\.library\.controls\.review|ai\.category\.controls\.review|ai\.control\.domain\.publish)$/u,
  /^ai\.(source\.corrections\.review|source\.corrections\.capture|migration\.preview\.review|migration\.preview\.disposition|migration\.pilot\.review|dashboard\.schedule\.configure)$/u,
];
export const requiresAiDecisionProof = (action: string) => contracts.some(pattern => pattern.test(action));
export function decisionTarget(entry: DecisionSubject) {
  if(entry.action==='ai.source.corrections.capture') return {targetType:'ai_source_correction',targetId:String(entry.metadata?.['versionId']??'')};
  if(entry.action==='ai.dashboard.schedule.configure') return {targetType:'organization_unit',targetId:String(entry.metadata?.['organizationUnitId']??'')};
  return entry.action === 'airs.review.complete'
    ? { targetType: 'ai_risk_review', targetId: String(entry.metadata?.['reviewId'] ?? '') }
    : { targetType: entry.entityType, targetId: entry.entityId ?? '' };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]));
  return value;
}
export const proofDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export interface ProofDocument {
  status: string; provenance: string; deletedAt: Date | null; expiryDate: Date | null;
  submittedBy: string; submittedAt: Date | null; reviewedBy: string | null; reviewedAt: Date | null;
  sha256: string; sizeBytes: number;
}
export function evidenceExclusion(row: ProofDocument, now: Date, managedDemo: boolean): string | null {
  if (row.deletedAt) return 'deleted';
  if (row.status !== 'approved') return 'not_approved';
  if (row.expiryDate && row.expiryDate <= now) return 'expired';
  if (row.provenance !== 'operational' && !(['synthetic_demo','seeded_uat'].includes(row.provenance) && managedDemo)) return 'provenance_not_allowed';
  if (!row.submittedAt || !row.reviewedAt || !row.reviewedBy || row.reviewedBy === row.submittedBy
    || row.submittedAt > row.reviewedAt || row.reviewedAt > now) return 'unverified_approval';
  if (!/^[a-f0-9]{64}$/u.test(row.sha256) || !Number.isInteger(row.sizeBytes) || row.sizeBytes < 1 || row.sizeBytes > 50 * 1024 * 1024) return 'unverified_file';
  return null;
}
