/**
 * Unit tests for the role-aware dashboard summary (service orchestration with mocks).
 * Run with: ts-node test/dashboard.service.spec.ts
 */
import assert from 'node:assert';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { AuthUser } from '../src/auth/auth.types';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

interface MockData {
  perms: string[];
  assets?: { id: string; ownerStatus: string }[];
  stewardedAssetIds?: string[];
  pendingApprovals?: number;
  myOpenTasks?: number;
  myOverdueTasks?: number;
  person?: { id: string } | null;
  ownedAssignmentTargetIds?: string[];
  ownedSpecs?: number;
  evidenceToReview?: number;
  people?: number;
  readiness?: any;
}

function makeService(d: MockData): DashboardService {
  const prisma = {
    dataAsset: {
      findMany: async () => d.assets ?? [],
    },
    stewardshipAssignment: {
      findMany: async (args: any) => {
        // distinct steward coverage vs. my owned assignments distinguished by personId filter
        if (args?.where?.personId) {
          return (d.ownedAssignmentTargetIds ?? []).map((targetId) => ({ targetId }));
        }
        return (d.stewardedAssetIds ?? []).map((targetId) => ({ targetId }));
      },
      count: async () => d.pendingApprovals ?? 0,
    },
    workflowTask: {
      count: async (args: any) =>
        args?.where?.dueDate ? d.myOverdueTasks ?? 0 : d.myOpenTasks ?? 0,
    },
    person: {
      findFirst: async () => d.person ?? null,
      count: async () => d.people ?? 0,
    },
    ndiSpecification: {
      count: async () => d.ownedSpecs ?? 0,
    },
    ndiEvidence: {
      count: async () => d.evidenceToReview ?? 0,
    },
  };
  const scope = { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) };
  const access = {
    permissionsForRoleCodes: async () => d.perms,
    hasPermission: (granted: string[], required: string) =>
      granted.includes('*') || granted.includes(required),
  };
  const scoring = {
    readiness: async () =>
      d.readiness ?? {
        overall: { score: 42, maturity: 'activated', specCount: 10, satisfiedCount: 4 },
        domains: [],
        gapTotals: { missing: 3, expired: 1, rejected: 0, unassigned: 2, stuck: 0 },
      },
  };
  return new DashboardService(prisma as never, scope as never, access as never, scoring as never);
}

const user: AuthUser = { id: 'u1', email: 'u@x.io', roles: ['dmo_admin'] };

test('governance section gated by data_assets.view', async () => {
  const without = await makeService({ perms: ['dashboard.view'] }).summary(user);
  assert.strictEqual(without.governance, null);

  const svc = makeService({
    perms: ['data_assets.view'],
    assets: [
      { id: 'a1', ownerStatus: 'assigned' },
      { id: 'a2', ownerStatus: 'assigned' },
      { id: 'a3', ownerStatus: 'unassigned' },
      { id: 'a4', ownerStatus: 'unassigned' },
    ],
    stewardedAssetIds: ['a1'],
    pendingApprovals: 7,
  });
  const s = await svc.summary(user);
  assert.ok(s.governance);
  assert.strictEqual(s.governance!.assets.total, 4);
  assert.strictEqual(s.governance!.assets.withOwner, 2);
  assert.strictEqual(s.governance!.assets.unassigned, 2);
  assert.strictEqual(s.governance!.ownershipCoveragePct, 50);
  assert.strictEqual(s.governance!.stewardshipCoveragePct, 25);
  assert.strictEqual(s.governance!.pendingApprovals, 7);
});

test('ndi section reuses scoring engine, gated by ndi_scoring.view', async () => {
  const off = await makeService({ perms: ['dashboard.view'] }).summary(user);
  assert.strictEqual(off.ndi, null);

  const s = await makeService({ perms: ['ndi_scoring.view'] }).summary(user);
  assert.ok(s.ndi);
  assert.strictEqual(s.ndi!.readinessPct, 42);
  assert.strictEqual(s.ndi!.maturity, 'activated');
  assert.strictEqual(s.ndi!.satisfied, 4);
  assert.strictEqual(s.ndi!.specifications, 10);
  assert.strictEqual(s.ndi!.gaps.missing, 3);
  assert.strictEqual(s.ndi!.gaps.unassigned, 2);
});

test('workflow section reports open and overdue tasks', async () => {
  const s = await makeService({
    perms: ['workflow_tasks.view'],
    myOpenTasks: 5,
    myOverdueTasks: 2,
  }).summary(user);
  assert.ok(s.workflow);
  assert.strictEqual(s.workflow!.myOpenTasks, 5);
  assert.strictEqual(s.workflow!.myOverdueTasks, 2);
});

test('myWork only present when user is linked to a Person', async () => {
  const none = await makeService({ perms: ['*'], person: null }).summary(user);
  assert.strictEqual(none.myWork, null);

  const s = await makeService({
    perms: ['*'],
    person: { id: 'p1' },
    ownedAssignmentTargetIds: ['a1', 'a2'],
    ownedSpecs: 3,
    evidenceToReview: 4,
  }).summary(user);
  assert.ok(s.myWork);
  assert.strictEqual(s.myWork!.ownedAssets, 2);
  assert.strictEqual(s.myWork!.ownedSpecs, 3);
  assert.strictEqual(s.myWork!.evidenceToReview, 4);
});

test('myWork.evidenceToReview is null without evidence.review permission', async () => {
  const s = await makeService({
    perms: ['ndi_specifications.view'],
    person: { id: 'p1' },
    ownedAssignmentTargetIds: [],
    ownedSpecs: 1,
    evidenceToReview: 9,
  }).summary(user);
  assert.ok(s.myWork);
  assert.strictEqual(s.myWork!.evidenceToReview, null);
});

test('reference section gated by people.view', async () => {
  const off = await makeService({ perms: ['dashboard.view'] }).summary(user);
  assert.strictEqual(off.reference, null);
  const on = await makeService({ perms: ['people.view'], people: 12 }).summary(user);
  assert.ok(on.reference);
  assert.strictEqual(on.reference!.people, 12);
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
