/**
 * Unit tests for bounded legacy list endpoints.
 * Run with: ts-node test/bounded-lists.spec.ts
 */
import assert from 'node:assert';
import { AssetsService } from '../src/assets/assets.service';
import { UsersService } from '../src/users/users.service';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

test('assets list keeps array compatibility while capping the default query', async () => {
  const findManyCalls: any[] = [];
  const service = new AssetsService(
    {
      dataAsset: {
        findMany: async (args: any) => {
          findManyCalls.push(args);
          return [{ id: 'asset-1' }];
        },
        count: async () => 3,
      },
    } as never,
    {} as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  const legacy = await service.list(['system_admin'], {});
  assert.ok(Array.isArray(legacy));
  assert.strictEqual(findManyCalls[0].skip, 0);
  assert.strictEqual(findManyCalls[0].take, 200);

  const paged = await service.list(['system_admin'], {}, '2', '2') as any;
  assert.strictEqual(paged.page, 2);
  assert.strictEqual(paged.pageSize, 2);
  assert.strictEqual(paged.total, 3);
  assert.strictEqual(findManyCalls[1].skip, 2);
  assert.strictEqual(findManyCalls[1].take, 2);
});

test('asset create rejects scoped writes outside the user domain scope', async () => {
  const service = new AssetsService(
    {} as never,
    {} as never,
    { resolve: async () => ({ orgUnits: 'all', domains: ['domain-allowed'], maxClassRank: null }) } as never,
  );

  await assert.rejects(
    () => service.create(
      ['data_owner'],
      { code: 'AST-HIDDEN', nameEn: 'Hidden', nameAr: 'Hidden', domainId: 'domain-hidden' } as never,
      'actor@dgop.local',
    ),
    /outside your data scope/,
  );
});

test('asset CSV import records a row error for scoped writes outside visible domains', async () => {
  const service = new AssetsService(
    {
      dataDomain: { findMany: async () => [{ id: 'domain-hidden', code: 'HIDDEN' }] },
      organizationUnit: { findMany: async () => [] },
      systemPlatform: { findMany: async () => [] },
      businessCapability: { findMany: async () => [] },
      classification: { findMany: async () => [] },
      dataSubject: { findMany: async () => [] },
    } as never,
    { log: async () => undefined } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: ['domain-allowed'], maxClassRank: null }) } as never,
  );

  const result = await service.importCsv(
    ['data_owner'],
    'code,nameEn,nameAr,domainCode\nAST-HIDDEN,Hidden asset,Hidden asset,HIDDEN',
    'actor@dgop.local',
  );

  assert.strictEqual(result.created, 0);
  assert.strictEqual(result.updated, 0);
  assert.match(result.errors[0].message, /outside your data scope/);
});

test('users list keeps array compatibility while capping the default query', async () => {
  const createdAt = new Date();
  const findManyCalls: any[] = [];
  const user = {
    id: 'user-1',
    email: 'admin@dgop.local',
    displayName: 'Admin',
    isActive: true,
    lastLoginAt: null,
    createdAt,
    userRoles: [{ role: { code: 'system_admin', nameEn: 'System Administrator', nameAr: 'System Administrator' } }],
  };
  const service = new UsersService(
    {
      user: {
        findMany: async (args: any) => {
          findManyCalls.push(args);
          return [user];
        },
        count: async () => 1,
      },
    } as never,
    {} as never,
  );

  const legacy = await service.listUsers();
  assert.ok(Array.isArray(legacy));
  assert.strictEqual(findManyCalls[0].skip, 0);
  assert.strictEqual(findManyCalls[0].take, 200);

  const paged = await service.listUsers('1', '1') as any;
  assert.strictEqual(paged.total, 1);
  assert.strictEqual(paged.data[0].email, 'admin@dgop.local');
  assert.strictEqual(findManyCalls[1].take, 1);
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
