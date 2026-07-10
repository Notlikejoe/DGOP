/**
 * Lightweight unit tests for ScopeService (no jest dependency).
 * Run with: npm test  (ts-node test/scope.service.spec.ts)
 */
import assert from 'node:assert';
import { ScopeService } from '../src/access/scope.service';

type Role = {
  code: string;
  isSystem?: boolean;
  maxClassificationRank: number | null;
  dataScopes: {
    scopeType: 'org_unit' | 'data_domain';
    refId: string;
    includeDescendants: boolean;
  }[];
};

// Org-unit tree: ou1 -> ou1a -> ou1a1 ; ou2
const ORG_UNITS = [
  { id: 'ou1', parentId: null },
  { id: 'ou1a', parentId: 'ou1' },
  { id: 'ou1a1', parentId: 'ou1a' },
  { id: 'ou2', parentId: null },
];
const DOMAINS = [
  { id: 'd1', parentId: null },
  { id: 'd1a', parentId: 'd1' },
];

function makePrisma(roles: Role[]) {
  return {
    role: {
      findMany: async () => roles.map((role) => ({ ...role, isSystem: role.isSystem ?? false })),
    },
    organizationUnit: {
      findMany: async () => ORG_UNITS,
    },
    dataDomain: {
      findMany: async () => DOMAINS,
    },
  };
}

function makeService(roles: Role[]) {
  return new ScopeService(makePrisma(roles) as never);
}

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

test('system_admin is fully unrestricted', async () => {
  const svc = makeService([]);
  const r = await svc.resolve(['system_admin']);
  assert.deepStrictEqual(r, { orgUnits: 'all', domains: 'all', maxClassRank: null });
});

test('no roles -> empty data scope', async () => {
  const svc = makeService([]);
  const r = await svc.resolve(['unknown_role']);
  assert.deepStrictEqual(r, { orgUnits: [], domains: [], maxClassRank: null });
});

test('system role with no scopes is unrestricted', async () => {
  const svc = makeService([{ code: 'r1', isSystem: true, maxClassificationRank: null, dataScopes: [] }]);
  const r = await svc.resolve(['r1']);
  assert.strictEqual(r.orgUnits, 'all');
  assert.strictEqual(r.domains, 'all');
  assert.strictEqual(r.maxClassRank, null);
});

test('custom role with no scopes is empty until explicit scope is granted', async () => {
  const svc = makeService([{ code: 'r1', maxClassificationRank: null, dataScopes: [] }]);
  const r = await svc.resolve(['r1']);
  assert.deepStrictEqual(r.orgUnits, []);
  assert.deepStrictEqual(r.domains, []);
  assert.strictEqual(r.maxClassRank, null);
});

test('org_unit scope without descendants restricts to the single id', async () => {
  const svc = makeService([
    {
      code: 'r1',
      maxClassificationRank: null,
      dataScopes: [{ scopeType: 'org_unit', refId: 'ou1', includeDescendants: false }],
    },
  ]);
  const r = await svc.resolve(['r1']);
  assert.deepStrictEqual([...(r.orgUnits as string[])].sort(), ['ou1']);
  assert.strictEqual(r.domains, 'all');
});

test('org_unit scope with descendants expands the subtree', async () => {
  const svc = makeService([
    {
      code: 'r1',
      maxClassificationRank: null,
      dataScopes: [{ scopeType: 'org_unit', refId: 'ou1', includeDescendants: true }],
    },
  ]);
  const r = await svc.resolve(['r1']);
  assert.deepStrictEqual([...(r.orgUnits as string[])].sort(), ['ou1', 'ou1a', 'ou1a1']);
});

test('union: one unrestricted role makes the dimension unrestricted', async () => {
  const svc = makeService([
    {
      code: 'restricted',
      maxClassificationRank: null,
      dataScopes: [{ scopeType: 'org_unit', refId: 'ou2', includeDescendants: false }],
    },
    { code: 'open', isSystem: true, maxClassificationRank: null, dataScopes: [] },
  ]);
  const r = await svc.resolve(['restricted', 'open']);
  assert.strictEqual(r.orgUnits, 'all');
});

test('clearance: max across roles, null wins (unrestricted)', async () => {
  const a = makeService([
    { code: 'r2', maxClassificationRank: 2, dataScopes: [{ scopeType: 'org_unit', refId: 'ou2', includeDescendants: false }] },
    { code: 'r4', maxClassificationRank: 4, dataScopes: [{ scopeType: 'org_unit', refId: 'ou1', includeDescendants: false }] },
  ]);
  const ra = await a.resolve(['r2', 'r4']);
  assert.strictEqual(ra.maxClassRank, 4);

  const b = makeService([
    { code: 'r2', maxClassificationRank: 2, dataScopes: [{ scopeType: 'org_unit', refId: 'ou2', includeDescendants: false }] },
    { code: 'rnull', maxClassificationRank: null, dataScopes: [{ scopeType: 'org_unit', refId: 'ou1', includeDescendants: false }] },
  ]);
  const rb = await b.resolve(['r2', 'rnull']);
  assert.strictEqual(rb.maxClassRank, null);
});

test('buildWhere produces a constrained Prisma fragment', () => {
  const svc = makeService([]);
  const where = svc.buildWhere(
    { orgUnits: ['ou1', 'ou2'], domains: 'all', maxClassRank: 3 },
    { classRankField: 'classRank' },
  );
  assert.deepStrictEqual(where, {
    orgUnitId: { in: ['ou1', 'ou2'] },
    classRank: { lte: 3 },
  });
});

test('buildWhere is empty when fully unrestricted', () => {
  const svc = makeService([]);
  const where = svc.buildWhere({ orgUnits: 'all', domains: 'all', maxClassRank: null });
  assert.deepStrictEqual(where, {});
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${t.name}`);
      console.error(`    ${(err as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
