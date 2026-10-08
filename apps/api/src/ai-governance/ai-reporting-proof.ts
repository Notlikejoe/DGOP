import { Prisma } from '@prisma/client';
import { evidenceExclusion, proofDigest } from './ai-evidence.logic';
import { jsonRecord } from './ai-risk-scoring';
import { isManagedDemoProfile } from '../common/demo-profile';
import { verifyEvidenceBytes } from './ai-evidence-proof';

/** Batch current evidence evaluation for reporting. Completed work is a historical
 * fact; only current operational proof contributes to verified coverage. */
export async function reportProofs(tx: Prisma.TransactionClient, subjects: Array<{ entityType: string; entityId: string }>, now: Date) {
  const rows = subjects.length ? await tx.auditLog.findMany({ where: { AND: [{ OR: subjects }, { OR: [
    { action: { startsWith: 'aiuc.review.' } }, { action: 'aiuc.lifecycle.ethics.approve' }
  ] }], createdAt: { lte: now } }, include: { aiEvidenceProof: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) : [];
  const ids = [...new Set(rows.flatMap(row => {
    const documents = jsonRecord(row.aiEvidenceProof?.snapshot)['documents'];
    return Array.isArray(documents) ? documents.map(d => String(jsonRecord(d)['evidenceId'])) : [];
  }))];
  const documents = await tx.ndiEvidence.findMany({ where: { id: { in: ids } } }), byId = new Map(documents.map(d => [d.id, d]));
  const bytes = new Map<string, boolean>();
  for (const document of documents) {
    if (evidenceExclusion(document, now, isManagedDemoProfile())) { bytes.set(document.id, false); continue; }
    try { await verifyEvidenceBytes(document); bytes.set(document.id, true); } catch { bytes.set(document.id, false); }
  }
  const result = new Map<string, 'verified' | 'demo_verified' | 'review_needed'>();
  for (const row of rows) {
    const taskId = jsonRecord(row.metadata)['taskId']; if (typeof taskId !== 'string') continue;
    const proof = row.aiEvidenceProof, snapshot = jsonRecord(proof?.snapshot), pinned = snapshot['documents'];
    const valid = !!proof && proofDigest(proof.snapshot) === proof.digest && snapshot['targetType'] === row.entityType && snapshot['targetId'] === row.entityId
      && snapshot['action'] === row.action && Array.isArray(pinned) && pinned.length > 0 && pinned.every(d => {
        const pin = jsonRecord(d), current = byId.get(String(pin['evidenceId']));
        return current && bytes.get(current.id) && pin['approvalAuditId'] && pin['uploadAuditId'] && pin['linkId']
          && current.sha256 === pin['sha256'] && current.updatedAt.toISOString() === pin['evidenceUpdatedAt'];
      });
    const operational = valid && !proof!.demoOnly && (pinned as unknown[]).every(d => byId.get(String(jsonRecord(d)['evidenceId']))?.provenance === 'operational');
    result.set(taskId, valid ? operational ? 'verified' : 'demo_verified' : 'review_needed');
  }
  return result;
}
