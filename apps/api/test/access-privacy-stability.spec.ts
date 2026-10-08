import 'reflect-metadata';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessGrantsService } from '../src/access/access-grants.service';
import { PrivacyService } from '../src/privacy/privacy.service';
import { enforcementOperationAllowed, enforcementGrantOutcome } from '../src/access/access-enforcement.logic';
import { addCalendarDays, breachNotificationStatus, dsrTransitionError, dsrDeadlineExtensionError, notificationObligationsResolved } from '../src/privacy/privacy.logic';
import { BreachStatus } from '@prisma/client';

const tests: [string, () => void | Promise<void>][] = [];
function test(name: string, fn: () => void | Promise<void>) { tests.push([name, fn]); }
const user = { id: 'independent', email: 'reviewer@example.test', roles: ['system_admin', 'privacy_officer'] };
const past = new Date('2026-01-01T00:00:00Z');
const future = new Date('2090-01-01T00:00:00Z');

function fixture(businessScoped = false) {
  let state: any = {
    grant: { id: 'grant-1', code: 'AGR-1', assetId: 'asset-1', version: 1, status: 'active', ownerDecision: 'approved', enforcementStatus: 'pending', createdBy: 'requester@example.test', startsAt: past, expiresAt: future, permissions: [], permissionCode: 'dataset.read', principalType: 'role', principalId: 'reader' },
    dsr: { id: 'dsr-1', status: 'in_progress', version: 1, assignedPersonId: 'person-reviewer', receivedAt: past, dueAt: new Date(Date.now() + 5 * 86400000), extensionDueAt: null, identityValidated: false, identityEvidenceReference: null, completionEvidenceReference: null, fulfilledAt: null, decisionSummary: null, createdBy: 'requester@example.test', workflowCaseId: null, deletedAt: null },
    breach: { id: 'breach-1', status: 'triage', version: 1, assignedPersonId: 'person-reviewer', detectedAt: past, notificationDueAt: past, notifiedAt: null, subjectNotifiedAt: null, regulatorNotified: false, subjectNotified: false, regulatorNotificationRequired: null, subjectNotificationRequired: null, notificationDecisionReason: null, createdBy: 'requester@example.test', workflowCaseId: null, deletedAt: null },
    dpia: { id: 'dpia-1', createdBy: 'requester@example.test', gates: [] },
    attempts: [] as any[], audits: [] as any[],
  };
  let failAudit = false;
  const update = (row: any, data: any) => { for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = (value as any)?.increment ? (row[key] ?? 0) + (value as any).increment : value; return structuredClone(row); };
  const delegate = (key: string) => ({
    findFirst: async (args: any) => JSON.stringify(args).includes('__no_visible_privacy_records__') || businessScoped && JSON.stringify(args).includes('allowed-domain') ? null : structuredClone(state[key]), findUniqueOrThrow: async () => structuredClone(state[key]),
    update: async (args: any) => update(state[key], args.data),
    updateMany: async (args: any) => { if (args.where.version !== undefined && state[key].version !== args.where.version) return { count: 0 }; update(state[key], args.data); return { count: 1 }; },
  });
  const attempts = {
    findUnique: async (args: any) => { const row = state.attempts.find((a: any) => args.where.id ? a.id === args.where.id : a.idempotencyKey === args.where.idempotencyKey); return row ? { ...structuredClone(row), ...(args.include?.grant ? { grant: structuredClone(state.grant) } : {}) } : null; },
    findUniqueOrThrow: async (args: any) => { const found = await attempts.findUnique(args); if (!found) throw new Error('Missing attempt'); return found; },
    findFirst: async (args: any) => state.attempts.find((a: any) => a.operation === args.where.operation && a.completionVersion === args.where.completionVersion && args.where.status.in.includes(a.status)) ?? null,
    create: async (args: any) => { const row = { id: 'attempt-' + (state.attempts.length + 1), status: 'queued', ...args.data }; state.attempts.push(row); return structuredClone(row); },
    updateMany: async (args: any) => { const row = state.attempts.find((a: any) => a.id === args.where.id); if (!row || !args.where.status.in.includes(row.status)) return { count: 0 }; update(row, args.data); return { count: 1 }; },
  };
  const tx: any = { accessGrant: delegate('grant'), privacyDsrRequest: delegate('dsr'), privacyBreach: delegate('breach'), privacyDpia: delegate('dpia'), accessEnforcementAttempt: attempts, person: { findFirst: async (args: any) => args.where.id === 'person-reviewer' ? { id: 'person-reviewer' } : null }, $queryRaw: async () => [] };
  const db: any = { ...tx, role: { findFirst: async () => ({ code: 'privacy_officer' }), findMany: async () => [{ code: 'data_owner' }] }, dataAsset: { findMany: async () => [], findFirst: async () => businessScoped ? null : { id: 'asset-1' } }, $transaction: async (fn: any) => { const before = structuredClone(state); try { return await fn(tx); } catch (e) { state = before; throw e; } } };
  const audit: any = { logRequired: async (entry: any, writer: any) => { assert.equal(writer, tx); if (failAudit) throw new Error('Audit unavailable'); state.audits.push(entry); } };
  const scope = { resolve: async (roles: string[]) => {
    if (businessScoped && !roles.includes('system_admin')) return { orgUnits: 'all', domains: ['allowed-domain'], maxClassRank: 2 };
    return { orgUnits: 'all', domains: 'all', maxClassRank: null };
  } };
  const access = new AccessGrantsService(db, audit, scope as never, { validateActiveOwnerOrDelegate: async () => ({ allowed: true }) } as never);
  (access as any).getGrant = async () => structuredClone(state.grant);
  (access as any).assertAssetVisible = async () => undefined;
  const privacy = new PrivacyService(db, audit, scope as never);
  return { access, privacy, state: () => state, breakAudit: () => { failAudit = true; } };
}

test('operation rules distinguish removal from provisioning and respect dates', () => {
  const grant = fixture().state().grant;
  for (const status of ['pending_revocation', 'revocation_failed', 'expired', 'suspended']) {
    assert.equal(enforcementOperationAllowed('revoke', { ...grant, status, ownerDecision: 'pending' }), true);
    assert.equal(enforcementOperationAllowed('grant', { ...grant, status }), false);
  }
  assert.equal(enforcementOperationAllowed('grant', { ...grant, expiresAt: past }), false);
  assert.equal(enforcementGrantOutcome('grant', true, user.email, past).status, undefined);
  assert.equal(enforcementGrantOutcome('revoke', true, user.email, past).status, 'revoked');
  assert.deepEqual(enforcementGrantOutcome('verify', true, user.email, past), {});
});

test('dispatch replay survives grant version increment and completion deduplicates identical proof', async () => {
  const f = fixture();
  const first = await f.access.dispatchEnforcement('grant-1', { expectedVersion: 1, operation: 'grant' }, user);
  assert.equal(first.attempt.requestVersion, 1); assert.equal(first.attempt.completionVersion, 2);
  assert.equal((await f.access.dispatchEnforcement('grant-1', { expectedVersion: 1, operation: 'grant' }, user)).deduplicated, true);
  const proof = { expectedVersion: 2, status: 'succeeded' as const, providerReference: 'provider-proof-1' };
  await f.access.completeEnforcementAttempt(first.attempt.id, proof, user);
  assert.equal(f.state().grant.enforcementStatus, 'enforced');
  const eventCount = f.state().audits.length;
  assert.equal((await f.access.completeEnforcementAttempt(first.attempt.id, proof, user)).deduplicated, true);
  assert.equal(f.state().audits.length, eventCount);
  await assert.rejects(f.access.completeEnforcementAttempt(first.attempt.id, { ...proof, status: 'failed' }, user), ConflictException);
});

test('late grant success cannot prove revocation and preserves reconciliation warning', async () => {
  const f = fixture();
  const dispatched = await f.access.dispatchEnforcement('grant-1', { expectedVersion: 1, operation: 'grant' }, user);
  f.state().grant.version = 3; f.state().grant.status = 'pending_revocation';
  const result = await f.access.completeEnforcementAttempt(dispatched.attempt.id, { expectedVersion: 2, status: 'succeeded', providerReference: 'late-proof' }, user);
  assert.equal(result.appliedToGrant, false); assert.equal(result.requiresReconciliation, true);
  assert.equal(f.state().grant.status, 'pending_revocation'); assert.notEqual(f.state().grant.enforcementStatus, 'revoked');
});

test('completion rejects supplied current version that differs from the dispatched binding', async () => {
  const f = fixture(); const result = await f.access.dispatchEnforcement('grant-1', { expectedVersion: 1, operation: 'grant' }, user);
  f.state().grant.version = 3; f.state().grant.status = 'pending_revocation';
  await assert.rejects(f.access.completeEnforcementAttempt(result.attempt.id, { expectedVersion: 3, status: 'succeeded', providerReference: 'wrong-version' }, user), ConflictException);
  assert.equal(f.state().attempts[0].status, 'queued');
});

test('normal removal dispatch and explicit manual removal both complete', async () => {
  const f = fixture(); f.state().grant.status = 'pending_revocation';
  const result = await f.access.dispatchEnforcement('grant-1', { expectedVersion: 1, operation: 'revoke' }, user);
  await f.access.completeEnforcementAttempt(result.attempt.id, { expectedVersion: 2, status: 'succeeded', providerReference: 'removal-proof' }, user);
  assert.equal(f.state().grant.status, 'revoked');
  const m = fixture(); m.state().grant.status = 'suspended';
  await m.access.completeManualEnforcement('grant-1', { expectedVersion: 1, operation: 'revoke', enforcementStatus: 'revoked', evidenceReference: 'manual-removal-proof' }, user);
  assert.equal(m.state().grant.status, 'revoked');
  await assert.rejects(m.access.updateEnforcement('grant-1', { expectedVersion: 2, enforcementStatus: 'enforced' }, user), BadRequestException);
});

test('audit failure rolls back provider observation and grant mutation', async () => {
  const f = fixture(); const result = await f.access.dispatchEnforcement('grant-1', { expectedVersion: 1, operation: 'grant' }, user);
  f.breakAudit(); await assert.rejects(f.access.completeEnforcementAttempt(result.attempt.id, { expectedVersion: 2, status: 'succeeded', providerReference: 'provider-proof' }, user));
  assert.equal(f.state().grant.version, 2); assert.equal(f.state().attempts[0].status, 'queued');
});

test('DSR identity and completion evidence are authoritative and versioned', async () => {
  const f = fixture();
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, status: 'fulfilled', decisionSummary: 'Completed' }, user.email), BadRequestException);
  await f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, status: 'fulfilled', identityValidated: true, identityEvidenceReference: 'restricted-identity-check', completionEvidenceReference: 'completion-record', decisionSummary: 'Completed independently' }, user.email);
  assert.equal(f.state().dsr.status, 'fulfilled'); assert.equal(f.state().dsr.version, 2);
  assert.equal(f.state().dsr.identityVerifiedBy, user.email);
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, status: 'closed' }, user.email), ConflictException);
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 2, identityValidated: false }, user.email), BadRequestException);
});

test('DSR final decision remains independent for administrators and rolls back if audit fails', async () => {
  const f = fixture(); f.state().dsr.createdBy = user.email;
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, status: 'rejected', decisionSummary: 'Invalid request' }, user.email), ForbiddenException);
  const a = fixture(); a.breakAudit();
  await assert.rejects(a.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, status: 'rejected', decisionSummary: 'Invalid request' }, user.email));
  assert.equal(a.state().dsr.status, 'in_progress'); assert.equal(a.state().dsr.version, 1);
});

test('platform administrator requires an actual privacy business role for final decisions', async () => {
  const f = fixture();
  await assert.rejects(f.privacy.updateDsr(['system_admin'], 'dsr-1', { expectedVersion: 1, status: 'rejected', decisionSummary: 'Administrative override' }, user.email), ForbiddenException);
  await assert.rejects(f.privacy.updateBreach(['system_admin'], 'breach-1', { expectedVersion: 1, regulatorNotificationRequired: false, subjectNotificationRequired: false, notificationDecisionReason: 'Administrative override' }, user.email), ForbiddenException);
  assert.equal(f.state().audits.length, 0);
});

test('platform oversight cannot broaden a constrained business decision scope', async () => {
  const f = fixture(true);
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, status: 'rejected', decisionSummary: 'Outside business scope' }, user.email), NotFoundException);
  await assert.rejects(f.privacy.updateBreach(user.roles, 'breach-1', { expectedVersion: 1, status: 'closed' }, user.email), NotFoundException);
  await assert.rejects(f.privacy.saveGate(user.roles, 'dpia-1', { phase: 'requirements', status: 'approved' }, user.email), NotFoundException);
  await assert.rejects(f.access.decideGrant('grant-1', { expectedVersion: 1, decision: 'approved' }, { ...user, roles: ['system_admin', 'data_owner'] }), NotFoundException);
  assert.equal(f.state().audits.length, 0);
});

test('DSR extension requires an assigned independent reviewer, identity and prior notice', async () => {
  const f = fixture(); const deadline = f.state().dsr.dueAt;
  const extension = { dueAt: addCalendarDays(deadline, 30).toISOString(), reason: 'Complex synthetic search requires additional time', communicatedAt: new Date().toISOString(), communicationReference: 'restricted-prior-notice' };
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, deadlineExtension: extension }, user.email), BadRequestException);
  f.state().dsr.identityValidated = true; f.state().dsr.identityEvidenceReference = 'identity-proof';
  f.state().dsr.assignedPersonId = null;
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, deadlineExtension: extension }, user.email), ForbiddenException);
  f.state().dsr.assignedPersonId = 'person-reviewer';
  f.state().dsr.createdBy = user.email;
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, deadlineExtension: extension }, user.email), ForbiddenException);
  f.state().dsr.createdBy = 'requester@example.test';
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, deadlineExtension: { ...extension, dueAt: addCalendarDays(deadline, 31).toISOString() } }, user.email), BadRequestException);
  const result = await f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, deadlineExtension: extension }, user.email);
  assert.equal(result.version, 2); assert.equal(result.extensionRecordedBy, user.email);
  assert.equal(result.effectiveDueAt.toISOString(), extension.dueAt); assert.equal(f.state().dsr.dueAt.toISOString(), deadline.toISOString());
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 2, deadlineExtension: extension }, user.email), BadRequestException);
  assert.match(dsrDeadlineExtensionError({ ...f.state().dsr, extensionDueAt: null, dueAt: past }, { dueAt: future, reason: 'Reason', communicatedAt: past, communicationReference: 'notice' })!, /before/);
});

test('DSR extension and its audit commit atomically', async () => {
  const f = fixture(); f.state().dsr.identityValidated = true; f.state().dsr.identityEvidenceReference = 'identity-proof'; f.breakAudit();
  await assert.rejects(f.privacy.updateDsr(user.roles, 'dsr-1', { expectedVersion: 1, deadlineExtension: { dueAt: addCalendarDays(f.state().dsr.dueAt, 20).toISOString(), reason: 'Documented complexity', communicatedAt: new Date().toISOString(), communicationReference: 'prior-notice' } }, user.email));
  assert.equal(f.state().dsr.version, 1); assert.equal(f.state().dsr.extensionDueAt, null);
});

test('incident closure requires a truthful independently assessed notification disposition', async () => {
  const f = fixture();
  await assert.rejects(f.privacy.updateBreach(user.roles, 'breach-1', { expectedVersion: 1, status: 'closed' }, user.email), BadRequestException);
  await f.privacy.updateBreach(user.roles, 'breach-1', { expectedVersion: 1, status: 'closed', regulatorNotificationRequired: false, subjectNotificationRequired: false, notificationDecisionReason: 'Documented nonreportable synthetic incident' }, user.email);
  assert.equal(f.state().breach.status, 'closed'); assert.equal(f.state().breach.regulatorNotified, false);
  assert.equal(notificationObligationsResolved(f.state().breach), true);
  assert.equal(breachNotificationStatus(past, BreachStatus.closed, null, new Date(), f.state().breach), 'not_required');
  assert.equal(breachNotificationStatus(past, BreachStatus.closed, null), 'overdue');
});

test('partial incident notification needs proof and audit failure leaves record unchanged', async () => {
  const f = fixture();
  await assert.rejects(f.privacy.updateBreach(user.roles, 'breach-1', { expectedVersion: 1, regulatorNotificationRequired: true, regulatorNotified: true, notifiedAt: past.toISOString() }, user.email), BadRequestException);
  f.breakAudit(); await assert.rejects(f.privacy.updateBreach(user.roles, 'breach-1', { expectedVersion: 1, status: 'closed', regulatorNotificationRequired: false, subjectNotificationRequired: false, notificationDecisionReason: 'Independent documented decision' }, user.email));
  assert.equal(f.state().breach.status, 'triage'); assert.equal(f.state().breach.version, 1);
});

test('calendar deadlines and fulfillment dates are deterministic', () => {
  assert.equal(addCalendarDays(new Date('2026-01-31T12:00:00Z'), 30).toISOString(), '2026-03-02T12:00:00.000Z');
  assert.match(dsrTransitionError('in_progress', { status: 'fulfilled', identityValidated: true, identityEvidenceReference: 'identity', completionEvidenceReference: 'proof', decisionSummary: 'done', receivedAt: past, fulfilledAt: future })!, /time/);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log('PASS ' + name); passed++; } catch (e) { console.error('FAIL ' + name, e); process.exitCode = 1; } }
  console.log(passed + '/' + tests.length + ' access/privacy stability scenarios passed');
})();
