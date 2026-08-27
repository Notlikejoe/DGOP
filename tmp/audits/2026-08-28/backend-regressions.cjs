const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
require(path.join(root, 'apps/api/node_modules/ts-node/register/transpile-only'));
const { AccessGrantsService } = require(path.join(root, 'apps/api/src/access/access-grants.service.ts'));
const { SecurityGovernanceService } = require(path.join(root, 'apps/api/src/security-governance/security-governance.service.ts'));

// In-memory persistence boundaries only: this audit never connects to PostgreSQL.
const user = { id: 'audit-user', email: 'audit@example.invalid', roles: ['system_admin'] };
const audit = { log: async () => undefined };
const base = { id: 'audit-grant', code: 'AUDIT-ONLY', assetId: 'audit-asset', ownerDecision: 'approved', status: 'pending_revocation', version: 3 };
const results = [];

async function main() {
  const lifecycleService = new AccessGrantsService({}, audit, {}, {});
  for (const status of ['pending_revocation', 'revocation_failed', 'expired', 'suspended']) {
    lifecycleService.getGrant = async () => ({ ...base, status });
    for (const action of ['dispatch', 'manual']) {
      let error;
      try {
        if (action === 'dispatch') {
          await lifecycleService.dispatchEnforcement(base.id, { expectedVersion: 3, operation: 'revoke' }, user);
        } else {
          await lifecycleService.completeManualEnforcement(base.id, { expectedVersion: 3, enforcementStatus: 'enforced', evidenceReference: 'AUDIT-ONLY' }, user);
        }
      } catch (caught) { error = caught; }
      assert.equal(error?.getStatus(), 400);
      results.push({ finding: 'revocation_completion_blocked', status, action, httpStatus: error.getStatus() });
    }
  }

  let writtenGrant;
  const attempt = { id: 'audit-attempt', grantId: base.id, status: 'queued', operation: 'grant', requestJson: { grantVersion: 1 }, grant: { ...base } };
  const tx = {
    accessGrant: {
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => { writtenGrant = data; return { ...base, ...data }; },
    },
    accessEnforcementAttempt: {
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({ ...attempt, status: 'succeeded' }),
    },
  };
  const callbackService = new AccessGrantsService({
    accessEnforcementAttempt: { findUnique: async () => attempt },
    $transaction: async (fn) => fn(tx),
  }, audit, {}, {});
  callbackService.assertAssetVisible = async () => undefined;
  await callbackService.completeEnforcementAttempt(attempt.id, { expectedVersion: 3, status: 'succeeded', providerReference: 'ORIGINAL-GRANT-SUCCEEDED' }, user);
  assert.equal(writtenGrant.status, 'revoked');
  assert.equal(writtenGrant.enforcementStatus, 'revoked');
  results.push({ finding: 'grant_success_misreported_as_revocation', dispatchedOperation: attempt.operation, dispatchedVersion: 1, currentVersion: 3, resultingStatus: writtenGrant.status });

  const legacyService = new AccessGrantsService({ $transaction: async (fn) => fn(tx) }, audit, {}, {});
  legacyService.getGrant = async () => ({ ...base, status: 'active' });
  writtenGrant = null;
  await legacyService.updateEnforcement(base.id, { expectedVersion: 3, enforcementStatus: 'enforced' }, user);
  assert.equal(writtenGrant.enforcementStatus, 'enforced');
  results.push({ finding: 'legacy_enforcement_bypasses_proof', resultingStatus: writtenGrant.enforcementStatus, providerReferenceRequired: false, attemptCreated: false });

  let shortened;
  const reviewItem = { id: 'audit-review-item', reviewId: 'audit-review', grantId: base.id, review: { ownerUserId: null, status: 'in_progress' }, grant: { ...base, expiresAt: new Date('2030-12-01T00:00:00Z') } };
  const reviewTx = {
    accessReviewItem: { update: async ({ data }) => ({ ...reviewItem, ...data }), count: async () => 1 },
    accessGrant: { update: async ({ data }) => { shortened = data; return data; } },
  };
  const reviewService = Object.create(SecurityGovernanceService.prototype);
  reviewService.prisma = { accessReviewItem: { findUnique: async () => reviewItem }, $transaction: async (fn) => fn(reviewTx) };
  reviewService.audit = audit;
  reviewService.assertSecurityTarget = async () => undefined;
  await reviewService.updateReviewItem(reviewItem.id, user.roles, { decision: 'shorten_expiry', newExpiresAt: '2030-01-01T00:00:00Z' }, user.email);
  assert.equal(shortened.status, 'expiring');
  const statusFilters = [];
  const reconcileService = new AccessGrantsService({ $transaction: async (fn) => fn({ accessGrant: { updateMany: async ({ where }) => { statusFilters.push(where.status); return { count: 0 }; } } }) }, audit, {}, {});
  reconcileService.assetVisibilityWhereForUser = async () => ({});
  await reconcileService.reconcileGrantLifecycle(user);
  assert.ok(statusFilters.every((status) => typeof status === 'string' ? status !== 'expiring' : !status.in.includes('expiring')));
  results.push({ finding: 'shortened_expiry_enters_unhandled_state', status: shortened.status, lifecycleReconcilerStatusFilters: statusFilters });
  console.log(JSON.stringify({ isolation: 'in-memory service reproductions; no database writes', confirmedCases: results.length, results }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
