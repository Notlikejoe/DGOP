import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { AccessGrantsService } from '../src/access/access-grants.service';
import { AccessService, WILDCARD } from '../src/access/access.service';
import { OwnerDelegateValidationService } from '../src/access/owner-delegate-validation.service';

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

test('owner/delegate validation allows the active approved asset owner directly', async () => {
  let delegationQueried = false;
  const service = new OwnerDelegateValidationService({
    stewardshipAssignment: {
      findFirst: async () => ({
        personId: 'person-owner',
        person: {
          id: 'person-owner',
          email: 'owner@dgop.local',
          userId: 'user-owner',
          isActive: true,
          deletedAt: null,
        },
      }),
    },
    workflowDelegation: {
      findFirst: async () => {
        delegationQueried = true;
        return null;
      },
    },
    user: { findFirst: async () => null },
  } as never);

  const result = await service.validateActiveOwnerOrDelegate({
    assetId: 'asset-1',
    actorUserId: 'user-owner',
    actorEmail: 'owner@dgop.local',
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'Actor is the active asset owner');
  assert.equal(result.ownerUserId, 'user-owner');
  assert.equal(delegationQueried, false);
});

test('owner/delegate validation allows an active delegated owner decision path', async () => {
  const service = new OwnerDelegateValidationService({
    stewardshipAssignment: {
      findFirst: async () => ({
        personId: 'person-owner',
        person: {
          id: 'person-owner',
          email: 'owner@dgop.local',
          userId: 'user-owner',
          isActive: true,
          deletedAt: null,
        },
      }),
    },
    workflowDelegation: {
      findFirst: async () => ({ id: 'delegation-1', delegatorUserId: 'user-owner' }),
    },
    user: { findFirst: async () => null },
  } as never);

  const result = await service.validateActiveOwnerOrDelegate({
    assetId: 'asset-1',
    actorUserId: 'user-delegate',
    actorEmail: 'delegate@dgop.local',
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'Actor is an approved active owner delegate');
  assert.equal(result.delegatedByUserId, 'user-owner');
  assert.equal(result.delegationId, 'delegation-1');
});

test('access grant CSV commit creates rows only after governed validation', async () => {
  const created: any[] = [];
  const versions: any[] = [];
  const auditActions: string[] = [];
  const tx = {
    businessSequence: {
      upsert: async () => ({ value: BigInt(created.length + 1) }),
    },
    accessGrant: {
      findUnique: async () => null,
      create: async (args: any) => {
        const row = { id: `grant-${created.length + 1}`, version: 1, ...args.data };
        created.push(row);
        return row;
      },
    },
    accessGrantVersion: {
      create: async (args: any) => {
        versions.push(args.data);
        return args.data;
      },
    },
  };
  const prisma = {
    accessGrant: { findMany: async () => [] },
    dataAsset: {
      findMany: async () => [{ id: '550e8400-e29b-41d4-a716-446655440000', code: 'AST-DEMO', assetType: 'dataset' }],
    },
    accessPermissionCatalog: {
      findFirst: async () => ({ id: 'permission-1', code: 'dataset.read', assetType: 'dataset' }),
    },
    role: {
      findFirst: async () => ({ id: 'role-steward' }),
    },
    $transaction: async (fn: any) => fn(tx),
  };
  const service = new AccessGrantsService(
    prisma as never,
    { log: async (entry: any) => auditActions.push(entry.action) } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
    {} as never,
  );

  const csv = [
    'action,code,expectedVersion,assetId,principalType,principalId,permissionCode,profileId,startsAt,expiresAt,justification',
    'create,,,550e8400-e29b-41d4-a716-446655440000,role,data_steward,dataset.read,,2026-08-18T00:00:00.000Z,2026-09-18T00:00:00.000Z,Approved campaign access',
  ].join('\n');
  const result = await service.commitGrantImport(
    { csv, changeReason: 'demo campaign' },
    { id: 'admin', email: 'admin@dgop.local', roles: ['dmo_admin'] },
  );

  assert.equal(result.committed, true);
  assert.equal(result.creates, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].code, 'AGR-00001');
  assert.equal(created[0].principalType, 'role');
  assert.equal(created[0].permissionCode, 'dataset.read');
  assert.equal(versions.length, 1);
  assert.equal(versions[0].grantId, created[0].id);
  assert.equal(versions[0].changeReason, 'demo campaign');
  assert.ok(auditActions.includes('access_grant.import_commit'));
});

test('effective access expands role grants into active user memberships', async () => {
  const startsAt = new Date('2026-08-01T00:00:00.000Z');
  const prisma = {
    accessGrant: {
      findMany: async () => [{
        id: 'grant-role-1',
        code: 'AGR-ROLE',
        version: 3,
        assetId: 'asset-1',
        principalType: 'role',
        principalId: 'data_steward',
        permissionCode: 'dataset.read',
        status: 'active',
        ownerDecision: 'approved',
        enforcementStatus: 'enforced',
        startsAt,
        expiresAt: null,
        asset: { id: 'asset-1', code: 'AST-1', nameEn: 'Dataset', nameAr: 'Dataset', assetType: 'dataset', domainId: null, orgUnitId: null, classificationId: null },
        profile: null,
        workflowCase: null,
      }],
    },
    userRole: {
      findMany: async () => [{
        userId: 'user-1',
        user: { id: 'user-1', email: 'steward@dgop.local', displayName: 'Data Steward' },
        role: { id: 'role-1', code: 'data_steward', nameEn: 'Data Steward' },
      }],
    },
    user: { findMany: async () => [] },
  };
  const service = new AccessGrantsService(
    prisma as never,
    { log: async () => undefined } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
    {} as never,
  );

  const result = await service.listEffectiveAccess(
    { id: 'admin', email: 'admin@dgop.local', roles: ['dmo_admin'] },
    { page: 1, pageSize: 50 },
  );

  assert.equal(result.total, 1);
  assert.equal(result.summary.current, 1);
  assert.equal(result.data[0].subjectId, 'user-1');
  assert.equal((result.data[0] as any).expandedFromRoleCode, 'data_steward');
  assert.equal(result.data[0].expansionStatus, 'resolved');
});

test('access grant state changes claim the exact expected version', async () => {
  let captured: unknown;
  const service = new AccessGrantsService({} as never, {} as never, {} as never, {} as never);
  await (service as any).claimGrantVersion(
    {
      accessGrant: {
        updateMany: async (args: unknown) => {
          captured = args;
          return { count: 1 };
        },
      },
    },
    'grant-1',
    7,
  );
  assert.deepEqual(captured, {
    where: { id: 'grant-1', version: 7 },
    data: { version: 7 },
  });
});

test('access grant state changes reject a stale expected version', async () => {
  const service = new AccessGrantsService({} as never, {} as never, {} as never, {} as never);
  await assert.rejects(
    () => (service as any).claimGrantVersion(
      { accessGrant: { updateMany: async () => ({ count: 0 }) } },
      'grant-1',
      6,
    ),
    /Grant changed before the operation could be committed/,
  );
});

test('approved grant rules are applied atomically to the DGOP policy store', async () => {
  const attempts: any[] = [];
  const updates: any[] = [];
  const auditActions: string[] = [];
  const tx = {
    accessGrant: {
      updateMany: async () => ({ count: 1 }),
      update: async (args: any) => {
        updates.push(args);
        return args.data;
      },
    },
    accessEnforcementAttempt: {
      create: async (args: any) => {
        const attempt = { id: 'attempt-policy-1', ...args.data };
        attempts.push(attempt);
        return attempt;
      },
    },
  };
  const prisma = {
    accessEnforcementAttempt: { findUnique: async () => null },
    $transaction: async (fn: any) => fn(tx),
  };
  const service = new AccessGrantsService(
    prisma as never,
    { log: async (entry: any) => auditActions.push(entry.action) } as never,
    {} as never,
    {} as never,
  );
  (service as any).getGrant = async () => ({
    id: 'grant-1',
    code: 'AGR-00001',
    version: 4,
    assetId: 'asset-1',
    principalType: 'role',
    principalId: 'data_steward',
    profileId: 'profile-1',
    permissionCode: 'dataset.read',
    permissions: [
      { permissionCode: 'dataset.read' },
      { permissionCode: 'dataset.update' },
    ],
    ownerDecision: 'approved',
    status: 'active',
  });

  const result = await service.applyGrantRules(
    'grant-1',
    { expectedVersion: 4, comment: 'Approved policy activation' },
    { id: 'admin', email: 'admin@dgop.local', roles: ['dmo_admin'] },
  );

  assert.equal(result.deduplicated, false);
  assert.equal(attempts[0].connectorCode, 'dgop_policy_store');
  assert.deepEqual(attempts[0].requestJson.permissionCodes, ['dataset.read', 'dataset.update']);
  assert.equal(updates[0].data.enforcementStatus, 'enforced');
  assert.ok(auditActions.includes('access_grant.rules_applied'));
});

test('policy-store deduplication still enforces grant visibility', async () => {
  let lookupAttempted = false;
  const prisma = {
    accessEnforcementAttempt: {
      findUnique: async () => {
        lookupAttempted = true;
        return { id: 'hidden-attempt' };
      },
    },
  };
  const service = new AccessGrantsService(prisma as never, {} as never, {} as never, {} as never);
  (service as any).getGrant = async () => {
    throw new ForbiddenException('Grant is outside the actor data scope');
  };

  await assert.rejects(
    service.applyGrantRules(
      'hidden-grant',
      { expectedVersion: 1 },
      { id: 'scoped-user', email: 'scoped@dgop.local', roles: ['data_steward'] },
    ),
    ForbiddenException,
  );
  assert.equal(lookupAttempted, false);
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
