import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AccessGrantsService } from '../src/access/access-grants.service';
import { PrivacyService } from '../src/privacy/privacy.service';
import { addCalendarDays } from '../src/privacy/privacy.logic';
import { ScopeService } from '../src/access/scope.service';

export async function testAccessPrivacyStability(db: PrismaClient) {
  const stamp = randomUUID().slice(0, 8);
  const actor = { id: 'stability-' + stamp, email: 'independent-' + stamp + '@example.test', roles: ['system_admin', 'privacy_officer', 'data_owner'] };
  const creator = 'requester-' + stamp + '@example.test';
  const prisma = db as PrismaService;
  const audit = new AuditService(prisma);
  const scope: any = { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) };
  const owner: any = { validateActiveOwnerOrDelegate: async () => ({ allowed: true }) };
  const access = new AccessGrantsService(prisma, audit, scope, owner);
  const privacy = new PrivacyService(prisma, audit, scope);
  const reviewer = await db.person.create({ data: { fullNameEn: 'Synthetic independent reviewer', fullNameAr: 'مراجع اختبار مستقل', email: actor.email } });
  for (const [code, resource] of [['privacy_officer', 'privacy_operations'], ['data_owner', 'access_grants']]) {
    const role = await db.role.upsert({ where: { code }, create: { code, nameEn: 'Synthetic ' + code, nameAr: 'دور اختبار', isSystem: true }, update: {} });
    const permission = await db.permission.upsert({ where: { resource_action: { resource, action: 'edit' } }, create: { resource, action: 'edit' }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, create: { roleId: role.id, permissionId: permission.id }, update: {} });
  }
  const asset = await db.dataAsset.create({ data: { code: 'STABILITY-' + stamp, nameEn: 'Synthetic stability fixture', nameAr: 'بيانات اختبار الاستقرار' } });
  let n = 0;
  const newGrant = () => db.accessGrant.create({ data: { code: 'STABILITY-' + stamp + '-' + ++n, assetId: asset.id, principalType: 'role', principalId: 'stability-reader-' + n, permissionCode: 'dataset.read', status: 'active', ownerDecision: 'approved', startsAt: new Date(Date.now() - 60000), expiresAt: new Date(Date.now() + 86400000), justification: 'Isolated synthetic stability fixture', createdBy: creator } });
  const newDsr = () => db.privacyDsrRequest.create({ data: { requestNumber: 'STABILITY-' + stamp + '-' + ++n, requesterName: 'Synthetic requester', requestType: 'access', description: 'Isolated synthetic request', status: 'in_progress', assignedPersonId: reviewer.id, receivedAt: new Date(Date.now() - 60000), dueAt: new Date(Date.now() + 86400000), createdBy: creator } });
  const newBreach = () => db.privacyBreach.create({ data: { code: 'STABILITY-' + stamp + '-' + ++n, title: 'Synthetic incident', status: 'triage', assignedPersonId: reviewer.id, detectedAt: new Date(Date.now() - 60000), notificationDueAt: new Date(Date.now() + 72 * 3600000), createdBy: creator } });
  const rejectingAudit: any = { logRequired: async () => { throw new Error('Injected audit failure'); } };
  const brokenAccess = new AccessGrantsService(prisma, rejectingAudit, scope, owner);
  const brokenPrivacy = new PrivacyService(prisma, rejectingAudit, scope);

  const grant = await newGrant();
  const dispatches = await Promise.all([0, 1].map(() => access.dispatchEnforcement(grant.id, { expectedVersion: 1, operation: 'grant' }, actor)));
  assert.equal(dispatches[0].attempt.id, dispatches[1].attempt.id);
  assert.equal(await db.accessEnforcementAttempt.count({ where: { grantId: grant.id } }), 1);
  assert.equal((await db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })).version, 2);
  const attempt = dispatches[0].attempt;
  await assert.rejects(db.accessEnforcementAttempt.update({ where: { id: attempt.id }, data: { operation: 'revoke' } }));
  await access.revokeGrant(grant.id, { expectedVersion: 2, reason: 'Synthetic removal requested before provisioning callback' }, actor);
  const late = await access.completeEnforcementAttempt(attempt.id, { expectedVersion: 2, status: 'succeeded', providerReference: 'synthetic-late-provider-result' }, actor);
  assert.equal(late.appliedToGrant, false); assert.equal(late.requiresReconciliation, true);
  let current = await db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } });
  assert.equal(current.status, 'pending_revocation'); assert.notEqual(current.enforcementStatus, 'revoked');
  const removal = await access.dispatchEnforcement(grant.id, { expectedVersion: current.version, operation: 'revoke' }, actor);
  const proof = { expectedVersion: removal.attempt.completionVersion!, status: 'succeeded' as const, providerReference: 'synthetic-removal-proof' };
  const observations = await Promise.all([access.completeEnforcementAttempt(removal.attempt.id, proof, actor), access.completeEnforcementAttempt(removal.attempt.id, proof, actor)]);
  assert.equal(observations.filter(x => x.deduplicated).length, 1);
  assert.equal((await db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })).status, 'revoked');
  await assert.rejects(access.completeEnforcementAttempt(removal.attempt.id, { ...proof, status: 'failed' }, actor), ConflictException);
  await assert.rejects(access.updateEnforcement(grant.id, { expectedVersion: current.version, enforcementStatus: 'enforced' }, actor), BadRequestException);

  const rollbackGrant = await newGrant();
  const rollbackAttempt = await access.dispatchEnforcement(rollbackGrant.id, { expectedVersion: 1, operation: 'grant' }, actor);
  const auditBefore = await db.auditLog.count();
  await assert.rejects(brokenAccess.completeEnforcementAttempt(rollbackAttempt.attempt.id, { expectedVersion: 2, status: 'succeeded', providerReference: 'rollback-provider-proof' }, actor));
  assert.equal((await db.accessGrant.findUniqueOrThrow({ where: { id: rollbackGrant.id } })).version, 2);
  assert.equal((await db.accessEnforcementAttempt.findUniqueOrThrow({ where: { id: rollbackAttempt.attempt.id } })).status, 'queued');
  assert.equal(await db.auditLog.count(), auditBefore);

  const manualGrant = await newGrant();
  await access.completeManualEnforcement(manualGrant.id, { expectedVersion: 1, operation: 'grant', enforcementStatus: 'enforced', evidenceReference: 'synthetic-manual-grant' }, actor);
  await access.revokeGrant(manualGrant.id, { expectedVersion: 2, reason: 'Synthetic manual removal' }, actor);
  await access.completeManualEnforcement(manualGrant.id, { expectedVersion: 3, operation: 'revoke', enforcementStatus: 'revoked', evidenceReference: 'synthetic-manual-removal' }, actor);
  assert.equal((await db.accessGrant.findUniqueOrThrow({ where: { id: manualGrant.id } })).status, 'revoked');

  const dsr = await newDsr();
  await assert.rejects(privacy.updateDsr(['system_admin'], dsr.id, { expectedVersion: 1, status: 'rejected', decisionSummary: 'Technical administrator is not a business approver' }, actor.email), ForbiddenException);
  const fulfill = { expectedVersion: 1, status: 'fulfilled' as const, identityValidated: true, identityEvidenceReference: 'restricted-synthetic-identity-check', completionEvidenceReference: 'synthetic-execution-record', decisionSummary: 'Independent synthetic completion' };
  await assert.rejects(privacy.updateDsr(actor.roles, dsr.id, { expectedVersion: 1, status: 'fulfilled' }, actor.email), BadRequestException);
  await assert.rejects(privacy.updateDsr(actor.roles, dsr.id, fulfill, creator), ForbiddenException);
  await assert.rejects(brokenPrivacy.updateDsr(actor.roles, dsr.id, fulfill, actor.email));
  assert.equal((await db.privacyDsrRequest.findUniqueOrThrow({ where: { id: dsr.id } })).version, 1);
  await privacy.updateDsr(actor.roles, dsr.id, fulfill, actor.email);
  assert.equal((await db.privacyDsrRequest.findUniqueOrThrow({ where: { id: dsr.id } })).identityVerifiedBy, actor.email);

  const concurrentDsr = await newDsr();
  const results = await Promise.allSettled([0, 1].map(i => privacy.updateDsr(actor.roles, concurrentDsr.id, { expectedVersion: 1, status: 'rejected', decisionSummary: 'Independent rejection ' + i }, actor.email)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason instanceof ConflictException).length, 1);
  assert.equal(await db.auditLog.count({ where: { entityId: concurrentDsr.id, action: 'privacy_dsr.update' } }), 1);

  const extendedDsr = await newDsr();
  const extension = { dueAt: addCalendarDays(extendedDsr.dueAt, 30).toISOString(), reason: 'Synthetic complex search', communicatedAt: new Date().toISOString(), communicationReference: 'synthetic-prior-notice' };
  const extend = { expectedVersion: 1, identityValidated: true, identityEvidenceReference: 'synthetic-verified-requester', deadlineExtension: extension };
  await assert.rejects(brokenPrivacy.updateDsr(actor.roles, extendedDsr.id, extend, actor.email));
  assert.equal((await db.privacyDsrRequest.findUniqueOrThrow({ where: { id: extendedDsr.id } })).extensionDueAt, null);
  const extended = await privacy.updateDsr(actor.roles, extendedDsr.id, extend, actor.email);
  assert.equal(extended.extensionRecordedBy, actor.email); assert.equal(extended.effectiveDueAt.toISOString(), extension.dueAt);
  assert.equal(extended.dueAt.toISOString(), extendedDsr.dueAt.toISOString());
  await assert.rejects(privacy.updateDsr(actor.roles, extendedDsr.id, { expectedVersion: 2, deadlineExtension: extension }, actor.email), BadRequestException);

  const breach = await newBreach();
  await assert.rejects(privacy.updateBreach(actor.roles, breach.id, { expectedVersion: 1, status: 'closed' }, actor.email), BadRequestException);
  const noNotification = { expectedVersion: 1, status: 'closed' as const, regulatorNotificationRequired: false, subjectNotificationRequired: false, notificationDecisionReason: 'Independent synthetic determination; notification not required' };
  await assert.rejects(privacy.updateBreach(actor.roles, breach.id, noNotification, creator), ForbiddenException);
  await assert.rejects(brokenPrivacy.updateBreach(actor.roles, breach.id, noNotification, actor.email));
  assert.equal((await db.privacyBreach.findUniqueOrThrow({ where: { id: breach.id } })).status, 'triage');
  const closed = await privacy.updateBreach(actor.roles, breach.id, noNotification, actor.email);
  assert.equal(closed.notificationStatus, 'not_required'); assert.equal(closed.regulatorNotified, false);

  const mismatch = await db.person.create({ data: { fullNameEn: 'Different synthetic privacy assignee', fullNameAr: 'مكلف اختبار آخر', email: 'other-' + stamp + '@example.test' } });
  const staleAssignee = await newBreach();
  await db.privacyBreach.update({ where: { id: staleAssignee.id }, data: { assignedPersonId: mismatch.id } });
  await assert.rejects(privacy.updateBreach(actor.roles, staleAssignee.id, { ...noNotification, expectedVersion: 1 }, actor.email), ForbiddenException);
  const inactiveAssignee = await newBreach();
  await db.person.update({ where: { id: reviewer.id }, data: { isActive: false } });
  try { await assert.rejects(privacy.updateBreach(actor.roles, inactiveAssignee.id, { ...noNotification, expectedVersion: 1 }, actor.email), ForbiddenException); }
  finally { await db.person.update({ where: { id: reviewer.id }, data: { isActive: true } }); }
  assert.equal(await db.auditLog.count({ where: { entityId: { in: [staleAssignee.id, inactiveAssignee.id] }, action: 'privacy_breach.update' } }), 0);

  const selfNotification = await newBreach();
  await db.privacyBreach.update({ where: { id: selfNotification.id }, data: { createdBy: actor.email, regulatorNotificationRequired: true, subjectNotificationRequired: false, notificationDecisionReason: 'Previously independently assessed synthetic report' } });
  await assert.rejects(privacy.updateBreach(actor.roles, selfNotification.id, { expectedVersion: 1, regulatorNotified: true, notifiedAt: new Date().toISOString(), regulatorNotificationEvidenceReference: 'synthetic-observation' }, actor.email), ForbiddenException);

  // Real scope resolution must use the role granting this business purpose,
  // even while a second system role provides unrestricted platform visibility.
  const privacyRole = await db.role.findUniqueOrThrow({ where: { code: 'privacy_officer' } });
  await db.role.upsert({ where: { code: 'system_admin' }, create: { code: 'system_admin', nameEn: 'Platform administrator', nameAr: 'مسؤول المنصة', isSystem: true }, update: {} });
  const allowedDomain = await db.dataDomain.create({ data: { code: 'STABILITY-ALLOWED-' + stamp, nameEn: 'Allowed synthetic domain', nameAr: 'مجال اختبار مسموح' } });
  const deniedDomain = await db.dataDomain.create({ data: { code: 'STABILITY-DENIED-' + stamp, nameEn: 'Other synthetic domain', nameAr: 'مجال اختبار آخر' } });
  const restricted = await db.roleDataScope.create({ data: { roleId: privacyRole.id, scopeType: 'data_domain', refId: allowedDomain.id, includeDescendants: false } });
  const scopedPrivacy = new PrivacyService(prisma, audit, new ScopeService(prisma));
  const outsideBreach = await newBreach(), outsideDsr = await newDsr();
  await db.privacyBreach.update({ where: { id: outsideBreach.id }, data: { domainId: deniedDomain.id } });
  await db.privacyDsrRequest.update({ where: { id: outsideDsr.id }, data: { domainId: deniedDomain.id } });
  try {
    await assert.rejects(scopedPrivacy.updateBreach(actor.roles, outsideBreach.id, noNotification, actor.email), NotFoundException);
    await assert.rejects(scopedPrivacy.updateDsr(actor.roles, outsideDsr.id, { expectedVersion: 1, status: 'rejected', decisionSummary: 'Outside business duty scope' }, actor.email), NotFoundException);
    const overview = await scopedPrivacy.listBreaches(actor.roles, { page: 1, pageSize: 200 });
    assert.ok(overview.data.some(row => row.id === outsideBreach.id), 'Platform oversight can still read the synthetic incident');
  } finally { await db.roleDataScope.delete({ where: { id: restricted.id } }); }

  const importedGrant = await newGrant();
  const csv = [
    'action,code,expectedVersion,assetId,principalType,principalId,permissionCode,profileId,startsAt,expiresAt,justification',
    'update,' + importedGrant.code + ',1,,,,,,,,' + 'Synthetic revised request',
  ].join('\n');
  await access.commitGrantImport({ csv, changeReason: 'Synthetic change requires fresh independent approval' }, actor);
  const imported = await db.accessGrant.findUniqueOrThrow({ where: { id: importedGrant.id } });
  assert.equal(imported.ownerDecision, 'pending'); assert.equal(imported.status, 'requested');
  await assert.rejects(access.decideGrant(imported.id, { expectedVersion: imported.version, decision: 'approved' }, actor), ForbiddenException);

  const legacy = await newGrant();
  await assert.rejects(db.accessGrant.update({ where: { id: legacy.id }, data: { status: 'expiring' } }));
  await db.accessGrant.update({ where: { id: legacy.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await access.reconcileGrantLifecycle(actor);
  const repaired = await db.accessGrant.findUniqueOrThrow({ where: { id: legacy.id } });
  assert.equal(repaired.status, 'expired'); assert.equal(repaired.enforcementStatus, 'pending');
  assert.ok(await db.auditLog.count({ where: { action: 'access_grant.lifecycle_reconcile' } }));
  console.log('PostgreSQL access/privacy stability passed: concurrent idempotency, operation binding, immutable dispatch, late callback, provider/manual removal, audit rollback, independent privacy decisions, optimistic concurrency and truthful expiry reconciliation.');
}

if (require.main === module) {
  const url = new URL(process.env.DGOP_AI_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55438'); assert.match(url.pathname, /^\/dgop_ai_test_[a-z0-9_]+$/);
  process.env.DATABASE_URL = url.href; process.env.NODE_ENV = 'test';
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  testAccessPrivacyStability(db).catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
}
