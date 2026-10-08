import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureDefinition, demoConfig, readManifest, atomicJson, sha256 } from './demo-profile.mjs';
import { directoryFingerprint } from './demo-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = demoConfig(root), manifest = readManifest(config);
Object.assign(process.env, config.env);
const require = createRequire(join(root, 'apps/api/package.json'));
const { PrismaClient } = require('@prisma/client'), { AuditService } = require(join(root, 'apps/api/dist/audit/audit.service.js'));
const db = new PrismaClient({ datasources: { db: { url: config.env.DATABASE_URL } } });
const core = manifest.core, fixtures = manifest.privacyAccess;
try {
  assert.equal(core?.complete, true); assert.equal(fixtures?.complete, true);
  assert.equal(manifest.cases.length, fixtureDefinition(root,manifest.fixtureVersion).completedAiJourneys.length); assert.ok(manifest.cases.every(row => row.complete));
  const personas = await db.user.findMany({ where: { id: { in: Object.values(manifest.actors) } } });
  assert.equal(personas.length, Object.keys(manifest.actors).length); assert.ok(personas.every(row => row.isActive && !row.deletedAt));
  const email = key => personas.find(row => row.id === manifest.actors[key])?.email;
  const evidenceIds = [...core.evidenceIds, manifest.evidenceId];
  for (const id of evidenceIds) {
    const row = await db.ndiEvidence.findUniqueOrThrow({ where: { id } });
    assert.ok(['synthetic_demo', 'seeded_uat'].includes(row.provenance), 'Only managed synthetic evidence may satisfy demo fixtures'); assert.equal(row.status, 'approved'); assert.notEqual(row.submittedBy, row.reviewedBy); assert.equal(row.reviewedBy, email('custodian'));
    assert.equal(sha256(readFileSync(join(config.evidencePath, row.fileName))), row.sha256);
  }
  assert.equal(core.assignmentIds.length,2);assert.ok(core.stewardshipCaseId);
  const assignmentRoles=[];
  for (const id of core.assignmentIds) { const row = await db.stewardshipAssignment.findUniqueOrThrow({ where: { id },include:{roleType:true} }); assert.equal(row.approvalStatus, 'approved'); assert.ok(core.assetIds.includes(row.targetId));assignmentRoles.push(row.roleType.code); }
  assert.deepEqual(assignmentRoles.sort(),['business_steward','data_owner']);
  for (const id of core.dqIssueIds) { const row = await db.dataQualityIssue.findUniqueOrThrow({ where: { id } }); assert.equal(row.status, 'closed'); assert.ok(row.resolutionSummary); }
  assert.equal(fixtures.grantIds.length, 2);
  for (const id of fixtures.grantIds) { const row = await db.accessGrant.findUniqueOrThrow({ where: { id } }); assert.equal(row.ownerDecision, 'approved'); assert.equal(row.ownerDecisionBy, email('dataOwner')); assert.notEqual(row.createdBy, row.ownerDecisionBy); assert.ok(row.status === 'revoked' || row.enforcementStatus === 'enforced'); }
  for (const id of [...fixtures.provisioningAttemptIds, ...fixtures.removalAttemptIds]) { const row = await db.accessEnforcementAttempt.findUniqueOrThrow({ where: { id } }); assert.equal(row.connectorCode, 'demo_simulator'); assert.equal(row.status, 'succeeded'); assert.equal(row.responseJson?.simulated, true); assert.equal(row.responseJson?.externalDelivery, false); assert.equal(row.responseJson?.appliedToGrant, true); assert.ok(row.attemptCount >= 1 && row.attemptCount <= 3); }
  for (const id of fixtures.dsrIds) { const row = await db.privacyDsrRequest.findUniqueOrThrow({ where: { id } }); assert.ok(['fulfilled', 'closed'].includes(row.status)); assert.equal(row.identityValidated, true); assert.equal(row.identityVerifiedBy, email('privacy')); assert.ok(row.identityEvidenceReference && row.completionEvidenceReference); }
  for (const id of fixtures.breachIds) { const row = await db.privacyBreach.findUniqueOrThrow({ where: { id } }); assert.ok(['closed', 'false_positive'].includes(row.status)); assert.equal(row.notificationDecisionBy, email('privacy')); assert.equal(typeof row.regulatorNotificationRequired, 'boolean'); assert.equal(typeof row.subjectNotificationRequired, 'boolean'); }
  const attachmentFiles = directoryFingerprint(config.attachmentPath);
  for (const id of fixtures.attachmentIds) { const row = await db.workflowTaskAttachment.findUniqueOrThrow({ where: { id } }); const bytes = attachmentFiles.find(file => file.path === row.storedName); assert.ok(bytes, 'Native privacy attachment must exist in the isolated storage'); assert.equal(bytes.sha256, row.checksum); }
  const delivery = await db.governanceNotificationDeliveryAttempt.findMany({ where: { provider: { in: ['dgop-in-app-demo', 'demo-email-simulator'] } } });
  assert.ok(delivery.every(row => row.payloadJson?.simulated === true && row.payloadJson?.externalDelivery === false && row.attemptCount <= 3));
  const chain = await new AuditService(db).verifyChain(); assert.equal(chain.valid, true); assert.equal(chain.legacyRows, 0); assert.equal(chain.truncated, false);
  atomicJson(join(config.installationRoot, 'governance-verification.json'), { demoOnly: true, fixtureVersion: manifest.fixtureVersion, verifiedAt: new Date().toISOString(), nativeGovernancePassed: true, evidenceRecords: evidenceIds.length, simulatedAccessAttempts: fixtures.provisioningAttemptIds.length + fixtures.removalAttemptIds.length, localNotificationAttempts: delivery.length, auditRows: chain.totalRows, externalDelivery: false });
  console.log('Native governance fixtures, independent approvals, synthetic evidence provenance, local access outcomes, attachment hashes and complete audit chain passed.');
} finally { await db.$disconnect(); }
