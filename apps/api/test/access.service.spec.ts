import assert from 'node:assert/strict';
import { AccessService, WILDCARD } from '../src/access/access.service';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('permissionsForRoleCodes grants wildcard only for active system_admin role rows', async () => {
  let permissionQueried = false;
  const service = new AccessService({
    role: {
      findMany: async (args: any) => {
        assert.deepEqual(args.where, {
          code: { in: ['system_admin'] },
          isActive: true,
          deletedAt: null,
        });
        return [];
      },
    },
    rolePermission: {
      findMany: async () => {
        permissionQueried = true;
        return [];
      },
    },
  } as never);

  const permissions = await service.permissionsForRoleCodes(['system_admin']);
  assert.deepEqual(permissions, []);
  assert.equal(permissionQueried, false);
});

test('permissionsForRoleCodes reads active custom role permissions by role id', async () => {
  let capturedWhere: unknown;
  const service = new AccessService({
    role: {
      findMany: async () => [{ id: 'role-steward', code: 'data_steward' }],
    },
    rolePermission: {
      findMany: async (args: any) => {
        capturedWhere = args.where;
        return [
          { permission: { resource: 'data_assets', action: 'view' } },
          { permission: { resource: 'data_assets', action: 'view' } },
          { permission: { resource: 'workflow_cases', action: 'view' } },
        ];
      },
    },
  } as never);

  const permissions = await service.permissionsForRoleCodes(['data_steward']);
  assert.deepEqual(capturedWhere, { roleId: { in: ['role-steward'] } });
  assert.deepEqual(permissions.sort(), ['data_assets.view', 'workflow_cases.view']);
});

test('permissionsForRoleCodes returns wildcard for active system_admin from database', async () => {
  let permissionQueried = false;
  const service = new AccessService({
    role: {
      findMany: async () => [{ id: 'role-admin', code: 'system_admin' }],
    },
    rolePermission: {
      findMany: async () => {
        permissionQueried = true;
        return [];
      },
    },
  } as never);

  const permissions = await service.permissionsForRoleCodes(['system_admin']);
  assert.deepEqual(permissions, [WILDCARD]);
  assert.equal(permissionQueried, false);
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
