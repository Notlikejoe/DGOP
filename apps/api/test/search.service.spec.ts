import assert from 'node:assert/strict';
import { SearchService } from '../src/search/search.service';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

function accessWith(permissions: string[]) {
  return {
    permissionsForRoleCodes: async () => permissions,
    hasPermission: (granted: string[], required: string) =>
      granted.includes('*') || granted.includes(required),
  };
}

const allScope = { orgUnits: 'all', domains: 'all', maxClassRank: null };

test('search: ignores short queries without touching Prisma', async () => {
  let touched = false;
  const prisma = {
    dataAsset: {
      findMany: async () => {
        touched = true;
        return [];
      },
    },
  };
  const service = new SearchService(
    prisma as any,
    accessWith(['data_assets.view']) as any,
    { resolve: async () => allScope } as any,
  );
  const result = await service.search({ id: 'u1', email: 'user@dgop.local', roles: ['data_owner'] }, 'a');
  assert.equal(result.total, 0);
  assert.deepEqual(result.groups, []);
  assert.equal(touched, false);
});

test('search: returns only permitted asset results with data-scope filters', async () => {
  let capturedWhere: unknown;
  const prisma = {
    dataAsset: {
      findMany: async (args: any) => {
        capturedWhere = args.where;
        if (args.select?.id && Object.keys(args.select).length === 1) {
          return [{ id: 'asset-visible' }];
        }
        return [
          {
            id: 'asset-visible',
            code: 'AST-FIN',
            nameEn: 'Finance Customer Extract',
            nameAr: 'Finance Customer Extract',
            ownerName: 'Sara',
            lifecycleStatus: 'active',
            domain: { code: 'finance', nameEn: 'Finance', nameAr: 'Finance' },
            classification: { code: 'internal', nameEn: 'Internal', nameAr: 'Internal' },
          },
        ];
      },
    },
  };
  const service = new SearchService(
    prisma as any,
    accessWith(['data_assets.view']) as any,
    { resolve: async () => ({ orgUnits: 'all', domains: ['finance'], maxClassRank: 2 }) } as any,
  );
  const result = await service.search({ id: 'u1', email: 'user@dgop.local', roles: ['steward'] }, 'finance');
  assert.equal(result.total, 1);
  assert.equal(result.groups[0].type, 'assets');
  assert.equal(result.groups[0].results[0].route.path, '/assets');
  assert.deepEqual(result.groups[0].results[0].route.queryParams, { assetId: 'asset-visible' });
  assert.ok(JSON.stringify(capturedWhere).includes('finance'));
});

test('search: does not query people without people.view', async () => {
  let peopleQueried = false;
  const prisma = {
    dataAsset: { findMany: async () => [] },
    person: {
      findMany: async () => {
        peopleQueried = true;
        return [];
      },
    },
  };
  const service = new SearchService(
    prisma as any,
    accessWith(['data_assets.view']) as any,
    { resolve: async () => allScope } as any,
  );
  await service.search({ id: 'u1', email: 'user@dgop.local', roles: ['data_owner'] }, 'sara');
  assert.equal(peopleQueried, false);
});

test('search: reference org-unit search uses fields that exist on org units', async () => {
  let capturedWhere: any;
  const prisma = {
    organizationUnit: {
      findMany: async (args: any) => {
        capturedWhere = args.where;
        return [{ id: 'org-1', code: 'FIN', nameEn: 'Finance', isActive: true }];
      },
    },
  };
  const service = new SearchService(
    prisma as any,
    accessWith(['org_units.view']) as any,
    { resolve: async () => allScope } as any,
  );
  const result = await service.search({ id: 'u1', email: 'user@dgop.local', roles: ['admin'] }, 'finance');
  assert.equal(result.groups[0].type, 'reference');
  assert.equal(JSON.stringify(capturedWhere).includes('description'), false);
});

test('search: NDI specifications are constrained to actor evidence responsibility', async () => {
  let capturedSpecWhere: unknown;
  const prisma = {
    dataAsset: { findMany: async () => [] },
    person: {
      findFirst: async () => ({ id: 'person-owner' }),
    },
    ndiSpecification: {
      findMany: async (args: any) => {
        capturedSpecWhere = args.where;
        return [
          {
            id: 'spec-visible',
            code: 'NDI-1.1',
            nameEn: 'Metadata accountability',
            type: 'standard',
            maturityLevel: 'level_2',
            domain: { nameEn: 'Governance' },
          },
        ];
      },
    },
  };
  const service = new SearchService(
    prisma as any,
    accessWith(['ndi_specifications.view']) as any,
    { resolve: async () => ({ orgUnits: 'all', domains: ['finance'], maxClassRank: null }) } as any,
  );
  const result = await service.search(
    { id: 'u1', email: 'owner@dgop.local', roles: ['data_owner'] },
    'metadata',
  );
  const specWhere = JSON.stringify(capturedSpecWhere);
  assert.equal(result.groups[0].type, 'ndi');
  assert.ok(specWhere.includes('ownerPersonId'));
  assert.ok(specWhere.includes('submittedBy'));
  assert.ok(specWhere.includes('reviewedBy'));
  assert.ok(specWhere.includes('owner@dgop.local'));
});

test('search: data quality results do not expose every unlinked issue to scoped users', async () => {
  let capturedWhere: unknown;
  const prisma = {
    dataAsset: { findMany: async () => [] },
    dataQualityIssue: {
      findMany: async (args: any) => {
        capturedWhere = args.where;
        return [];
      },
    },
  };
  const service = new SearchService(
    prisma as any,
    accessWith(['data_quality_issues.view']) as any,
    { resolve: async () => ({ orgUnits: ['org-1'], domains: 'all', maxClassRank: null }) } as any,
  );

  await service.search({ id: 'u1', email: 'viewer@dgop.local', roles: ['dq_steward'] }, 'quality');

  const text = JSON.stringify(capturedWhere);
  assert.ok(text.includes('"assetId":null'));
  assert.ok(text.includes('"createdBy"'));
  assert.ok(text.includes('viewer@dgop.local'));
});

test('search: FOI domain-only records require matching domain scope', async () => {
  let capturedWhere: unknown;
  const prisma = {
    dataAsset: { findMany: async () => [] },
    foiRequest: {
      findMany: async (args: any) => {
        capturedWhere = args.where;
        return [];
      },
    },
  };
  const service = new SearchService(
    prisma as any,
    accessWith(['foi_requests.view']) as any,
    { resolve: async () => ({ orgUnits: 'all', domains: ['domain-1'], maxClassRank: null }) } as any,
  );

  await service.search({ id: 'u1', email: 'foi@dgop.local', roles: ['foi_officer'] }, 'request');

  const text = JSON.stringify(capturedWhere);
  assert.ok(text.includes('"assetId":null'));
  assert.ok(text.includes('"dataDomainId":{"in":["domain-1"]}'));
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      console.error(`  ✗ ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
