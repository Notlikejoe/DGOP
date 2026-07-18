/**
 * Lightweight unit tests for the ownership recommendation / conflict / exception logic
 * (no jest dependency). Run with: ts-node test/ownership.service.spec.ts
 */
import assert from 'node:assert';
import { AssignmentsService } from '../src/ownership/assignments.service';
import {
  confidenceLabel,
  recommendationConfidence,
  recommendationReasons,
} from '../src/ownership/assignments.logic';

const PAST = new Date('2020-01-01');

type Over = {
  asset?: any;
  assets?: any[];
  roleTypes?: any[];
  assignments?: any[];
  rules?: any[];
  certificationAttempts?: any[];
  auditLogs?: any[];
};

// Builds an AssignmentsService backed by canned data. Scope resolves as unrestricted,
// so scope filtering is a no-op and we exercise the pure recommendation/conflict logic.
function makeService(over: Over): AssignmentsService {
  const assignmentRows = over.assignments ?? [];
  const prisma = {
    dataAsset: {
      findFirst: async () => over.asset ?? null,
      findMany: async () => over.assets ?? [],
    },
    roleType: { findMany: async () => over.roleTypes ?? [] },
    stewardshipAssignment: {
      findMany: async (args?: any) => {
        const where = args?.where ?? {};
        if (where.targetType && where.targetId) {
          return assignmentRows.filter(
            (assignment) =>
              (!assignment.targetType || assignment.targetType === where.targetType) &&
              (!assignment.targetId || assignment.targetId === where.targetId) &&
              (!where.roleTypeId || assignment.roleTypeId === where.roleTypeId),
          );
        }
        return assignmentRows;
      },
    },
    assignmentRule: { findMany: async () => over.rules ?? [] },
    certificationAttempt: { findMany: async () => over.certificationAttempts ?? [] },
    dataDomain: { findMany: async () => [] },
    businessCapability: { findMany: async () => [] },
    dataSubject: { findMany: async () => [] },
    organizationUnit: { findMany: async () => [] },
    systemPlatform: { findMany: async () => [] },
  };
  const audit = { log: async (entry: any) => { over.auditLogs?.push(entry); } };
  const scope = {
    resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
  };
  return new AssignmentsService(prisma as never, audit as never, scope as never);
}

const owner = { id: 'rt_owner', code: 'data_owner', nameEn: 'Data Owner', nameAr: '' };

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

test('recommend: a direct asset assignment is authoritative (status assigned)', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: 's1', subjects: [] },
    roleTypes: [owner],
    assignments: [
      {
        id: 'as1',
        roleTypeId: 'rt_owner',
        isPrimary: true,
        isActive: true,
        approvalStatus: 'approved',
        effectiveDate: PAST,
        expiryDate: null,
        source: 'manual',
        person: { id: 'p1', fullNameEn: 'Alice' },
      },
    ],
    rules: [{ id: 'r1', roleTypeId: 'rt_owner', scopeType: 'domain', refId: 'd1', priority: 100, person: { id: 'p2' } }],
  });
  const recs = await svc.recommend(['system_admin'], 'a1');
  const rec = recs[0];
  assert.strictEqual(rec.status, 'assigned');
  assert.strictEqual(rec.current?.person.id, 'p1');
});

test('recommend: a pending assignment is NOT authoritative (falls back to rule)', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [] },
    roleTypes: [owner],
    assignments: [
      {
        id: 'as1',
        roleTypeId: 'rt_owner',
        isPrimary: true,
        isActive: true,
        approvalStatus: 'pending',
        effectiveDate: PAST,
        expiryDate: null,
        source: 'manual',
        person: { id: 'p1', fullNameEn: 'Alice' },
      },
    ],
    rules: [{ id: 'r1', roleTypeId: 'rt_owner', scopeType: 'domain', refId: 'd1', priority: 100, person: { id: 'p2' } }],
  });
  const rec = (await svc.recommend(['system_admin'], 'a1'))[0];
  assert.strictEqual(rec.status, 'recommended');
  assert.strictEqual(rec.recommended?.person.id, 'p2');
});

test('recommend: domain scope wins over system scope regardless of priority number', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: 's1', subjects: [] },
    roleTypes: [owner],
    assignments: [],
    rules: [
      { id: 'rSys', roleTypeId: 'rt_owner', scopeType: 'system', refId: 's1', priority: 1, person: { id: 'pSys' } },
      { id: 'rDom', roleTypeId: 'rt_owner', scopeType: 'domain', refId: 'd1', priority: 100, person: { id: 'pDom' } },
    ],
  });
  const rec = (await svc.recommend(['system_admin'], 'a1'))[0];
  assert.strictEqual(rec.status, 'recommended');
  assert.strictEqual(rec.recommended?.scopeType, 'domain');
  assert.strictEqual(rec.recommended?.person.id, 'pDom');
});

test('recommend: recommendations include confidence, signals, and readable reasons', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [] },
    roleTypes: [owner],
    assignments: [],
    certificationAttempts: [
      {
        personId: 'p2',
        status: 'passed',
        expiresAt: new Date('2099-01-01'),
        renewalDueAt: null,
      },
    ],
    rules: [
      {
        id: 'r1',
        roleTypeId: 'rt_owner',
        scopeType: 'domain',
        refId: 'd1',
        priority: 1,
        personId: 'p2',
        person: { id: 'p2', fullNameEn: 'Certified Owner' },
      },
    ],
  });
  const rec = (await svc.recommend(['system_admin'], 'a1'))[0];
  assert.strictEqual(rec.status, 'recommended');
  assert.strictEqual(rec.recommended?.confidenceLabel, 'high');
  assert.strictEqual(rec.recommended?.signals.certificationState, 'current');
  assert.ok(rec.recommended?.reasons.some((reason: string) => reason.includes('certification')));
});

test('recommendation scoring helpers expose explainable confidence levels', () => {
  const score = recommendationConfidence({
    scopeType: 'domain',
    rulePriority: 1,
    activeAssignments: 1,
    approvedAssignments: 2,
    certificationState: 'current',
  });
  assert.ok(score >= 85);
  assert.strictEqual(confidenceLabel(score), 'high');
  assert.deepStrictEqual(confidenceLabel(0), 'none');
  assert.ok(recommendationReasons({ scopeType: 'domain', rulePriority: 1 }).length > 0);
});

test('recommend: no assignment and no rule is an exception', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: null, capabilityId: null, orgUnitId: null, systemId: null, subjects: [] },
    roleTypes: [owner],
    assignments: [],
    rules: [],
  });
  const rec = (await svc.recommend(['system_admin'], 'a1'))[0];
  assert.strictEqual(rec.status, 'exception');
});

test('recordRecommendationFeedback: captures accepted or override decisions in the audit trail', async () => {
  const auditLogs: any[] = [];
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [] },
    roleTypes: [owner],
    assignments: [],
    rules: [
      {
        id: 'r1',
        roleTypeId: 'rt_owner',
        scopeType: 'domain',
        refId: 'd1',
        priority: 1,
        personId: 'p2',
        person: { id: 'p2', fullNameEn: 'Alice' },
      },
    ],
    auditLogs,
  });
  const result = await svc.recordRecommendationFeedback(
    ['system_admin'],
    'a1',
    'rt_owner',
    { decision: 'accepted', comment: 'Good match' },
    'admin@dgop.local',
  );

  assert.strictEqual(result.recorded, true);
  assert.strictEqual(auditLogs.length, 1);
  assert.strictEqual(auditLogs[0].action, 'assignment_recommendation.feedback');
  assert.strictEqual(auditLogs[0].metadata.recommendedPersonId, 'p2');
  assert.strictEqual(auditLogs[0].metadata.confidenceLabel, 'high');
});

test('conflicts: two overlapping approved primaries on the same target+role conflict', async () => {
  const base = {
    targetType: 'asset',
    targetId: 'a1',
    roleTypeId: 'rt_owner',
    isPrimary: true,
    isActive: true,
    approvalStatus: 'approved',
    roleType: owner,
    person: { id: 'p', fullNameEn: 'X' },
    source: 'manual',
  };
  const svc = makeService({
    assignments: [
      { ...base, id: 'c1', effectiveDate: new Date('2020-01-01'), expiryDate: null },
      { ...base, id: 'c2', effectiveDate: new Date('2021-01-01'), expiryDate: null },
    ],
  });
  const conflicts = await svc.conflicts(['system_admin']);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual((conflicts[0] as any).assignments.length, 2);
});

test('conflicts: non-overlapping windows do not conflict', async () => {
  const base = {
    targetType: 'asset',
    targetId: 'a1',
    roleTypeId: 'rt_owner',
    isPrimary: true,
    isActive: true,
    approvalStatus: 'approved',
    roleType: owner,
    person: { id: 'p', fullNameEn: 'X' },
    source: 'manual',
  };
  const svc = makeService({
    assignments: [
      { ...base, id: 'c1', effectiveDate: new Date('2020-01-01'), expiryDate: new Date('2020-12-31') },
      { ...base, id: 'c2', effectiveDate: new Date('2021-01-01'), expiryDate: null },
    ],
  });
  const conflicts = await svc.conflicts(['system_admin']);
  assert.strictEqual(conflicts.length, 0);
});

test('exceptions: asset with no owner and no covering rule is an exception', async () => {
  const svc = makeService({
    assets: [
      { id: 'a1', code: 'A1', nameEn: 'Asset 1', nameAr: '', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [], domain: null, classification: null },
    ],
    assignments: [],
    rules: [],
  });
  const ex = await svc.exceptions(['system_admin']);
  assert.strictEqual(ex.length, 1);
  assert.strictEqual(ex[0].code, 'A1');
});

test('exceptions: a covering data_owner rule clears the exception', async () => {
  const svc = makeService({
    assets: [
      { id: 'a1', code: 'A1', nameEn: 'Asset 1', nameAr: '', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [], domain: null, classification: null },
    ],
    assignments: [],
    rules: [{ id: 'r1', scopeType: 'domain', refId: 'd1' }],
  });
  const ex = await svc.exceptions(['system_admin']);
  assert.strictEqual(ex.length, 0);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  \u2713 ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  \u2717 ${t.name}`);
      console.error(`    ${(err as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
