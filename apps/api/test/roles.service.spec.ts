import assert from 'node:assert/strict';
import { RolesService } from '../src/roles/roles.service';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('list counts only active user assignments for access governance metrics', async () => {
  let capturedInclude: unknown;
  const service = new RolesService(
    {
      role: {
        findMany: async (args: any) => {
          capturedInclude = args.include;
          return [
            {
              id: 'role-1',
              code: 'data_steward',
              nameEn: 'Data Steward',
              nameAr: 'Data Steward',
              description: null,
              isSystem: false,
              isActive: true,
              maxClassificationRank: 3,
              userRoles: [{ userId: 'active-user' }],
              _count: { permissions: 4 },
            },
          ];
        },
      },
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: [], domains: [], maxClassRank: null }) } as never,
  );

  const roles = await service.list();
  assert.deepEqual(capturedInclude, {
    _count: { select: { permissions: true } },
    userRoles: {
      where: { user: { isActive: true } },
      select: { userId: true },
    },
  });
  assert.equal(roles[0].userCount, 1);
  assert.equal(roles[0].permissionCount, 4);
});

test('setScopes rejects unknown or inactive polymorphic scope references before replacing scopes', async () => {
  let deletedScopes = false;
  const service = new RolesService(
    {
      role: {
        findFirst: async () => ({ id: 'role-1', code: 'data_steward', isSystem: false }),
      },
      organizationUnit: {
        findMany: async (args: any) => {
          assert.deepEqual(args.where, { id: { in: ['ou-missing'] }, deletedAt: null, isActive: true });
          return [];
        },
      },
      dataDomain: {
        findMany: async () => [],
      },
      roleDataScope: {
        deleteMany: () => {
          deletedScopes = true;
          return {};
        },
        createMany: () => ({}),
      },
      $transaction: async () => {
        throw new Error('invalid scope refs should block before scope replacement');
      },
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: [], domains: [], maxClassRank: null }) } as never,
  );

  await assert.rejects(
    () =>
      service.setScopes(
        'role-1',
        {
          scopes: [{ scopeType: 'org_unit' as never, refId: 'ou-missing', includeDescendants: true }],
        },
        'admin@dgop.local',
      ),
    /Unknown or inactive scope references: org_unit:ou-missing/,
  );
  assert.equal(deletedScopes, false);
});

test('update blocks system_admin mutation before persistence', async () => {
  let updated = false;
  const service = new RolesService(
    {
      role: {
        findFirst: async () => ({ id: 'role-admin', code: 'system_admin', isSystem: true }),
        update: async () => {
          updated = true;
          return {};
        },
      },
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  await assert.rejects(
    () => service.update('role-admin', { nameEn: 'Changed' }, 'admin@dgop.local'),
    /system_admin role is immutable/,
  );
  assert.equal(updated, false);
});

test('update prevents deactivating seeded system roles', async () => {
  let updated = false;
  const service = new RolesService(
    {
      role: {
        findFirst: async () => ({ id: 'role-dmo', code: 'dmo_admin', isSystem: true }),
        update: async () => {
          updated = true;
          return {};
        },
      },
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  await assert.rejects(
    () => service.update('role-dmo', { isActive: false }, 'admin@dgop.local'),
    /System roles cannot be deactivated/,
  );
  assert.equal(updated, false);
});

test('setScopes accepts active org-unit and domain refs and writes them transactionally', async () => {
  const writes: any[] = [];
  const service = new RolesService(
    {
      role: {
        findFirst: async () => ({ id: 'role-1', code: 'data_steward', isSystem: false }),
        update: (args: any) => {
          writes.push({ model: 'role', args });
          return args;
        },
      },
      organizationUnit: {
        findMany: async () => [{ id: 'ou-1' }],
      },
      dataDomain: {
        findMany: async () => [{ id: 'domain-1' }],
      },
      roleDataScope: {
        deleteMany: (args: any) => {
          writes.push({ model: 'roleDataScope.deleteMany', args });
          return args;
        },
        createMany: (args: any) => {
          writes.push({ model: 'roleDataScope.createMany', args });
          return args;
        },
      },
      $transaction: async (operations: any[]) => operations,
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: [], domains: [], maxClassRank: null }) } as never,
  );
  (service as any).get = async () => ({ id: 'role-1' });

  await service.setScopes(
    'role-1',
    {
      scopes: [
        { scopeType: 'org_unit' as never, refId: 'ou-1', includeDescendants: false },
        { scopeType: 'data_domain' as never, refId: 'domain-1', includeDescendants: true },
      ],
      maxClassificationRank: 3,
    },
    'admin@dgop.local',
  );

  const createMany = writes.find((write) => write.model === 'roleDataScope.createMany');
  assert.equal(createMany.args.data.length, 2);
  assert.deepEqual(
    createMany.args.data.map((row: any) => `${row.scopeType}:${row.refId}`),
    ['org_unit:ou-1', 'data_domain:domain-1'],
  );
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  OK ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}`);
      console.error(err);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
