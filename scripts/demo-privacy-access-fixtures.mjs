import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { demoConfig, readManifest, atomicJson } from './demo-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = demoConfig(root), manifest = readManifest(config);
Object.assign(process.env, config.env, { WORKFLOW_EXECUTION_SCHEDULER: 'false', GOVERNANCE_OPERATIONS_SCHEDULER: 'false', DGOP_WORKFLOW_STARTUP_MAINTENANCE: 'false' });
process.env.DGOP_DEMO_ADAPTER_SCHEDULER='false';
assert.equal(process.env.DGOP_DEMO_ADAPTERS, 'true', 'Local simulated adapters must be explicitly enabled');
const require = createRequire(resolve(root, 'apps/api/package.json'));
const load = (path, name) => require(resolve(root, 'apps/api/dist', path + '.js'))[name];
const { NestFactory } = require('@nestjs/core');
const app = await NestFactory.createApplicationContext(load('app.module', 'AppModule'), { logger: false });
const db = app.get(load('prisma/prisma.service', 'PrismaService'));
const privacy = app.get(load('privacy/privacy.service', 'PrivacyService'));
const access = app.get(load('access/access-grants.service', 'AccessGrantsService'));
const connector = app.get(load('access/demo-access-connector.service', 'DemoAccessConnectorService'));
const workflow = app.get(load('workflow/workflow.service', 'WorkflowService'));
const fixtures = manifest.privacyAccess ??= { grantIds: [], dsrIds: [], breachIds: [], attachmentIds: [], provisioningAttemptIds: [], removalAttemptIds: [] };
const marker = 'SYNTHETIC DEMO ONLY ' + config.env.DGOP_DEMO_INSTALLATION_ID;
const save = () => atomicJson(config.manifestPath, manifest);

async function actor(key) {
  const id = manifest.actors[key]; assert.ok(id, 'Missing independent demonstration persona ' + key);
  const row = await db.user.findUniqueOrThrow({ where: { id }, include: { userRoles: { include: { role: true } }, person: true } });
  assert.ok(row.isActive && !row.deletedAt, 'Demonstration persona must be active');
  return { id, email: row.email, roles: row.userRoles.filter(r => r.role.isActive && !r.role.deletedAt).map(r => r.role.code), person: row.person };
}

async function attachment(caseId, scenario, actor, description) {
  assert.ok(caseId, 'Native privacy workflow case is required');
  const fileName = 'synthetic-' + scenario + '.txt';
  let row = await db.workflowTaskAttachment.findFirst({ where: { caseId, fileName, createdBy: actor.email } });
  if (!row) {
    const buffer = Buffer.from(marker + '\n' + description + '\nAll identities, decisions and delivery are local synthetic examples. No personal documents or external notifications are represented.\n');
    row = await workflow.addCaseAttachment(caseId, { kind: 'evidence' }, { originalname: fileName, mimetype: 'text/plain', size: buffer.length, buffer }, actor);
  }
  if (!fixtures.attachmentIds.includes(row.id)) fixtures.attachmentIds.push(row.id);
  save(); return row.storageUrl;
}

async function finishSimulation(grant, operation, actor) {
  let current = await db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } });
  const terminal = operation === 'revoke' ? current.status === 'revoked' : current.enforcementStatus === 'enforced';
  if (terminal) return current;
  let attempt = await db.accessEnforcementAttempt.findFirst({ where: { grantId: grant.id, connectorCode: 'demo_simulator', operation, status: { in: ['queued', 'running', 'retrying'] }, completionVersion: current.version }, orderBy: { createdAt: 'desc' } });
  if (!attempt) attempt = (await connector.dispatch(grant.id, current.version, operation, actor)).attempt;
  const keys = operation === 'revoke' ? fixtures.removalAttemptIds : fixtures.provisioningAttemptIds;
  if (!keys.includes(attempt.id)) keys.push(attempt.id); save();
  for (let i = 0; i < 15; i++) {
    await connector.tick();
    attempt = await db.accessEnforcementAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    if (attempt.status === 'failed') throw new Error('Local access simulation failed: ' + (attempt.errorCode || 'unavailable') + '. Existing failure evidence is preserved.');
    if (attempt.status === 'succeeded') {
      assert.equal(attempt.responseJson?.simulated, true); assert.equal(attempt.responseJson?.externalDelivery, false);
      assert.equal(attempt.responseJson?.appliedToGrant, true, 'Superseded simulation requires fresh confirmation');
      current = await db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } });
      assert.equal(operation === 'revoke' ? current.status : current.enforcementStatus, operation === 'revoke' ? 'revoked' : 'enforced');
      return current;
    }
    await delay(1100);
  }
  throw new Error('Local simulated access completion timed out. The queued record is preserved for diagnosis.');
}

try {
  assert.equal(manifest.core?.complete, true, 'Complete the independent core ownership journey first');
  const assetId = manifest.core.assetIds[0], requester = await actor('administrator'), owner = await actor('dataOwner'), reviewer = await actor('privacy');
  assert.notEqual(requester.id, owner.id); assert.notEqual(requester.id, reviewer.id);
  const asset = await db.dataAsset.findUniqueOrThrow({ where: { id: assetId } });
  const catalog = await access.listPermissionCatalog(asset.assetType);
  const readPermission = 'dataset.query_read';
  assert.ok(catalog.some(row => row.code === readPermission), 'Current canonical dataset read permission must be installed');

  // Native approval and immutable simulated provider handoff; never direct status seeding.
  for (const [principal, remove] of [['business_steward', false], ['technical_steward', true]]) {
    const justification = marker + ': ' + (remove ? 'provisioning and removal journey' : 'provisioning journey');
    let grant = await db.accessGrant.findFirst({ where: { assetId, principalType: 'role', principalId: principal, justification, createdBy: requester.email } });
    if (!grant) grant = await access.createGrant({ assetId, principalType: 'role', principalId: principal, permissionCode: readPermission, startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), justification }, requester);
    if (!fixtures.grantIds.includes(grant.id)) fixtures.grantIds.push(grant.id); save();
    if (grant.ownerDecision === 'pending') grant = await access.decideGrant(grant.id, { expectedVersion: grant.version, decision: 'approved', comment: marker + ' — reviewed by the independent asset owner' }, owner);
    assert.equal(grant.ownerDecision, 'approved'); assert.equal(grant.ownerDecisionBy, owner.email);
    const removalStates = ['pending_revocation', 'revocation_failed', 'expired', 'suspended', 'revoked'];
    if (!removalStates.includes(grant.status)) grant = await finishSimulation(grant, 'grant', requester);
    if (remove && !removalStates.includes(grant.status)) grant = await access.revokeGrant(grant.id, { expectedVersion: grant.version, reason: marker + ' — independent owner requested removal' }, owner);
    if (remove) grant = await finishSimulation(grant, 'revoke', requester);
    assert.equal(remove ? grant.status : grant.enforcementStatus, remove ? 'revoked' : 'enforced');
  }

  const description = marker + ': synthetic access rights request';
  let dsr = await db.privacyDsrRequest.findFirst({ where: { description, createdBy: requester.email } });
  if (!dsr) dsr = await privacy.createDsr(requester.roles, { requesterName: 'DEMO — Synthetic requester', requestType: 'access', description, assetId, assignedPersonId: reviewer.person?.id, identityValidated: false }, requester.email);
  if (!fixtures.dsrIds.includes(dsr.id)) fixtures.dsrIds.push(dsr.id); save();
  if (!['fulfilled', 'closed'].includes(dsr.status)) {
    const identityEvidenceReference = await attachment(dsr.workflowCaseId, 'identity-verification', reviewer, 'A privacy officer verified a synthetic requester reference; no real identity document was collected.');
    if (['received', 'identity_validation'].includes(dsr.status)) dsr = await privacy.updateDsr(reviewer.roles, dsr.id, { expectedVersion: dsr.version, status: 'in_progress', identityValidated: true, identityEvidenceReference }, reviewer.email);
    const completionEvidenceReference = await attachment(dsr.workflowCaseId, 'request-completion', reviewer, 'The requested synthetic register extract was prepared and its handover recorded locally.');
    dsr = await privacy.updateDsr(reviewer.roles, dsr.id, { expectedVersion: dsr.version, status: 'fulfilled', identityValidated: true, identityEvidenceReference, completionEvidenceReference, decisionSummary: marker + ' — independently verified and completed with local evidence' }, reviewer.email);
  }
  assert.equal(dsr.identityValidated, true); assert.equal(dsr.identityVerifiedBy, reviewer.email); assert.ok(dsr.completionEvidenceReference);

  for (const reportable of [true, false]) {
    const title = 'DEMO — ' + (reportable ? 'Synthetic notified incident' : 'Synthetic false-positive incident');
    let breach = await db.privacyBreach.findFirst({ where: { title, description: marker, createdBy: requester.email } });
    if (!breach) breach = await privacy.createBreach(requester.roles, { title, description: marker, assetId, assignedPersonId: reviewer.person?.id }, requester.email);
    if (!fixtures.breachIds.includes(breach.id)) fixtures.breachIds.push(breach.id); save();
    if (!['closed', 'false_positive'].includes(breach.status)) {
      if (breach.status === 'detected') breach = await privacy.updateBreach(reviewer.roles, breach.id, { expectedVersion: breach.version, status: 'triage' }, reviewer.email);
      if (reportable) {
        const proof = await attachment(breach.workflowCaseId, 'simulated-regulator-notification', reviewer, 'A regulator notification was simulated locally and independently recorded. No authority or external service received a message.');
        if (breach.status !== 'notified') breach = await privacy.updateBreach(reviewer.roles, breach.id, { expectedVersion: breach.version, status: 'notified', regulatorNotificationRequired: true, subjectNotificationRequired: false, notificationDecisionReason: marker + ' — synthetic scenario qualifies for regulator notification; no affected real subjects', regulatorNotified: true, notifiedAt: new Date().toISOString(), regulatorNotificationEvidenceReference: proof }, reviewer.email);
        breach = await privacy.updateBreach(reviewer.roles, breach.id, { expectedVersion: breach.version, status: 'closed' }, reviewer.email);
      } else {
        await attachment(breach.workflowCaseId, 'notification-obligation-review', reviewer, 'Independent review classified this synthetic report as a false positive, with no notification obligation.');
        breach = await privacy.updateBreach(reviewer.roles, breach.id, { expectedVersion: breach.version, status: 'false_positive', regulatorNotificationRequired: false, subjectNotificationRequired: false, notificationDecisionReason: marker + ' — independent review found no personal-data incident or notification obligation' }, reviewer.email);
      }
    }
    assert.equal(reportable ? breach.regulatorNotified : breach.regulatorNotificationRequired, reportable ? true : false);
    assert.equal(breach.notificationDecisionBy, reviewer.email);
  }
  fixtures.complete = true; save();
  console.log('Independent access approvals, simulated provisioning/removal, verified synthetic DSR completion and truthful local incident dispositions installed. No external system was contacted.');
} finally { await app.close(); }
