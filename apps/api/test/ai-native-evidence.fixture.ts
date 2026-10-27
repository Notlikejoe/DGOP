import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService, AuditEntry } from '../src/audit/audit.service';
import { EvidenceService } from '../src/evidence/evidence.service';
import { ScopeService } from '../src/access/scope.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiEvidenceService } from '../src/ai-governance/ai-evidence.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiAnnualReviewService } from '../src/ai-governance/ai-annual-review.service';
import { AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { decisionTarget, requiresAiDecisionProof } from '../src/ai-governance/ai-evidence.logic';

/** Legacy integration setup only: native originals and review replace fabricated approved rows. */
export async function nativeIntegrationEvidence(db: PrismaClient, specId: string) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.NODE_ENV, 'test'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55438'); assert.match(url.pathname, /^\/dgop_ai_test_/);
  process.env.EVIDENCE_STORAGE_DIR = join(process.env.DGOP_DEMO_ROOT!, 'evidence'); mkdirSync(process.env.EVIDENCE_STORAGE_DIR, { recursive: true });
  const dmo = await db.role.findUniqueOrThrow({ where: { code: 'dmo_admin' } }), officer = await db.role.findUniqueOrThrow({ where: { code: 'AI_GOVERNANCE_OFFICER' } });
  const permission = await db.permission.upsert({ where: { resource_action: { resource: 'evidence', action: 'review' } }, update: {}, create: { resource: 'evidence', action: 'review' } });
  await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: dmo.id, permissionId: permission.id } }, create: { roleId: dmo.id, permissionId: permission.id }, update: {} });
  const uploader = await db.user.create({ data: { email: 'native-proof-uploader@integration.test', displayName: 'Native synthetic evidence custodian', passwordHash: 'not-a-login', userRoles: { create: [{ roleId: dmo.id }, { roleId: officer.id }] } } });
  const reviewer = await db.user.create({ data: { email: 'native-proof-reviewer@integration.test', displayName: 'Independent native evidence reviewer', passwordHash: 'not-a-login', userRoles: { create: { roleId: dmo.id } } } });
  const person = await db.person.create({ data: { fullNameEn: reviewer.displayName, fullNameAr: 'مراجع مستقل', userId: reviewer.id, email: reviewer.email } });
  await db.ndiSpecification.update({ where: { id: specId }, data: { ownerPersonId: person.id } });
  const prisma = db as PrismaService, audit = new AuditService(prisma), evidence = new EvidenceService(prisma, audit), bytes = Buffer.from('SYNTHETIC ENGINEERING FIXTURE ONLY\nIndependently reviewed native original for named integration scenarios. No operational compliance credit.\n');
  const proof = await evidence.create({ specId, title: 'Native synthetic integration decision evidence', submit: 'true', expiryDate: new Date(Date.now() + 86400000 * 365).toISOString() }, { originalname: 'synthetic-native-proof.txt', mimetype: 'text/plain', buffer: bytes, size: bytes.length }, { ...uploader, roles: ['dmo_admin', 'AI_GOVERNANCE_OFFICER'] });
  const approved = await evidence.review(proof.id, { decision: 'approve', comment: 'Independently inspected the authentic synthetic original for the integration scenarios; no operational credit.' }, { ...reviewer, roles: ['dmo_admin'] });
  assert.equal(approved.provenance, 'synthetic_demo'); assert.notEqual(approved.submittedBy, approved.reviewedBy);
  installNativeEvidenceRelevance(uploader.id, approved.id);
  return approved;
}

export function installNativeEvidenceRelevance(uploaderId: string, evidenceId: string) {
  const original = AuditService.prototype.logRequired;
  // Fixture relevance setup uses the real native linker inside the same test transaction.
  // It applies only to this exact verified fixture ID; invalid/missing evidence remains rejected.
  AuditService.prototype.logRequired = async function(entry: AuditEntry, client?: PrismaService | Prisma.TransactionClient) {
    const ids = entry.metadata?.['evidenceIds'];
    if (client && requiresAiDecisionProof(entry.action) && Array.isArray(ids) && ids.length && ids.every(id => id === evidenceId)) {
      const tx = client as Prisma.TransactionClient, facade = new Proxy(tx, { get(target, key) { return key === '$transaction' ? (work: (writer: Prisma.TransactionClient) => Promise<unknown>) => work(tx) : Reflect.get(target, key); } }) as PrismaService;
      const nativeAudit = new AuditService(facade), auth = new AiAuthorizationService(facade, nativeAudit), scope = new ScopeService(facade), routing = new AiWorkflowRoutingService(facade), identifiers = new AiIdentifiersService();
      const risks = new AiRiskIntakeService(facade, auth, scope, routing, identifiers, nativeAudit), annual = new AiAnnualReviewService(facade, auth, scope, risks, routing, identifiers, nativeAudit);
      const target = decisionTarget(entry);
      const evidence = await tx.ndiEvidence.findUniqueOrThrow({ where: { id: evidenceId }, select: { updatedAt: true } });
      const existing = target.targetId && await tx.aiEvidenceLink.findUnique({ where: { evidenceId_targetType_targetId_evidenceUpdatedAt: { evidenceId, targetType: target.targetType, targetId: target.targetId, evidenceUpdatedAt: evidence.updatedAt } }, select: { id: true } });
      // The required-audit proof builder still checks status, bytes and current relevance.
      if (target.targetId && !existing) await new AiEvidenceService(facade, auth, risks, annual, nativeAudit).link(uploaderId, target.targetType, target.targetId, ids as string[], 'Explicit synthetic fixture relevance to this exact integration case, review or governed change.');
    }
    return original.call(this, entry, client);
  };
}
