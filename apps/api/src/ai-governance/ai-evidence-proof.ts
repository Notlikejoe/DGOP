import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isManagedDemoProfile } from '../common/demo-profile';
import { DecisionSubject, decisionTarget, evidenceExclusion, proofDigest, requiresAiDecisionProof } from './ai-evidence.logic';

export async function verifyEvidenceBytes(row: { fileName: string; sha256: string; sizeBytes: number }) {
  try {
    const root = await realpath(resolve(process.env.EVIDENCE_STORAGE_DIR || 'storage/evidence'));
    const file = await realpath(resolve(root, row.fileName)), rel = relative(root,file);
    if (!rel || rel === '..' || rel.startsWith('..'+sep) || isAbsolute(rel)) throw Error('Invalid file path');
    const info = await stat(file);
    if (!info.isFile() || info.size !== row.sizeBytes || info.size > 50 * 1024 * 1024) throw Error('Invalid file size');
    const hash = createHash('sha256'); let size=0;
    for await (const chunk of createReadStream(file)) { size+=chunk.length; if(size>row.sizeBytes) throw Error('File changed'); hash.update(chunk); }
    if (size!==row.sizeBytes || hash.digest('hex')!==row.sha256) throw Error('File hash changed');
  } catch { throw new BadRequestException('Evidence file is missing or its checksum cannot be verified'); }
}
export async function lockVerifiedEvidence(tx: Prisma.TransactionClient, ids: string[], now = new Date()) {
  if (!ids.length || ids.length > 20 || ids.some(id => !/^[0-9a-f-]{36}$/iu.test(id)) || new Set(ids).size !== ids.length)
    throw new BadRequestException('Decision requires 1–20 distinct approved evidence identifiers');
  // Deterministic row locks serialize revocation/deletion with decisions. Acquire
  // these before the audit-chain lock to match the evidence service's lock order.
  await tx.$queryRaw`SELECT id FROM ndi_evidence WHERE id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`;
  const rows = await tx.ndiEvidence.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
  if (rows.length !== ids.length) throw new BadRequestException('Every decision evidence identifier must exist');
  const managed = isManagedDemoProfile();
  for (const row of rows) {
    const reason = evidenceExclusion(row,now,managed);
    if (reason) throw new BadRequestException(`Evidence ${row.id} is ineligible: ${reason}`);
    await verifyEvidenceBytes(row);
  }
  const trail=await tx.auditLog.findMany({where:{entityType:'evidence',entityId:{in:ids},action:{in:['evidence.create','evidence.submit','evidence.approve']}},select:{id:true,actor:true,action:true,entityId:true,metadata:true,entryHash:true,createdAt:true},orderBy:{createdAt:'desc'}});
  return rows.map(row=>{
    const upload=trail.find(a=>a.entityId===row.id&&['evidence.create','evidence.submit'].includes(a.action)&&a.metadata&&typeof a.metadata==='object'&&!Array.isArray(a.metadata)&&a.metadata['sha256']===row.sha256);
    const approval=trail.find(a=>a.entityId===row.id&&a.action==='evidence.approve'&&a.actor===row.reviewedBy&&a.createdAt>=row.reviewedAt!&&a.createdAt.getTime()-row.reviewedAt!.getTime()<60000);
    if(!upload?.entryHash||!approval?.entryHash||upload.createdAt>approval.createdAt) throw new BadRequestException(`Evidence ${row.id} has no trustworthy native upload and approval trail; review needed`);
    return {...row,uploadAuditId:upload.id,uploadAuditHash:upload.entryHash,approvalAuditId:approval.id,approvalAuditHash:approval.entryHash};
  });
}
export async function prepareAiDecisionProof(tx: Prisma.TransactionClient, entry: DecisionSubject) {
  if (!requiresAiDecisionProof(entry.action)) return null;
  const target = decisionTarget(entry);
  if (!target.targetId) throw new BadRequestException('Decision evidence target is missing');
  const ids = entry.metadata?.['evidenceIds'];
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new BadRequestException('Approved relevant evidence is required');
  const evaluatedAt = new Date(), rows = await lockVerifiedEvidence(tx,ids as string[],evaluatedAt);
  const links = await tx.aiEvidenceLink.findMany({ where: { ...target, evidenceId: { in: rows.map(r=>r.id) } }, orderBy: { createdAt: 'desc' } });
  const documents = rows.map(row => {
    const link = links.find(link=>link.evidenceId===row.id && link.evidenceUpdatedAt.getTime()===row.updatedAt.getTime() && link.sha256===row.sha256);
    if (!link) throw new ConflictException(`Evidence ${row.id} needs an explicit current link to this case, review or change`);
    return { evidenceId:row.id,linkId:link.id,linkReason:link.justification,linkedBy:link.actorId,title:row.title,
      uploadAuditId:row.uploadAuditId,uploadAuditHash:row.uploadAuditHash,approvalAuditId:row.approvalAuditId,approvalAuditHash:row.approvalAuditHash,
      sha256:row.sha256,sizeBytes:row.sizeBytes,provenance:row.provenance,submittedBy:row.submittedBy,submittedAt:row.submittedAt!.toISOString(),
      reviewedBy:row.reviewedBy,reviewedAt:row.reviewedAt!.toISOString(),reviewComment:row.reviewComment,
      expiryDate:row.expiryDate?.toISOString()??null,evidenceUpdatedAt:row.updatedAt.toISOString() };
  });
  const demoOnly = documents.some(row=>row.provenance!=='operational');
  const snapshot = { policyVersion:1,...target,action:entry.action,actorId:entry.actor,evaluatedAt:evaluatedAt.toISOString(),demoOnly,operationalComplianceCredit:false,
    decisionContext:JSON.parse(JSON.stringify(entry.metadata??{})) as Prisma.InputJsonObject,documents };
  return { ...target,snapshot:snapshot as Prisma.InputJsonObject,digest:proofDigest(snapshot),demoOnly,evaluatedAt };
}
