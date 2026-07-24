import assert from 'node:assert/strict';
import { SearchService } from '../src/search/search.service';
import { lightStemArabicToken, parseAdvancedSearchQuery } from '../src/search/search.logic';

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

test('search logic: parses field filters, exclusions, phrases, and Arabic stems', () => {
  const parsed = parseAdvancedSearchQuery('type:asset domain:finance "Customer Records" -retired sort:recent');
  assert.equal(parsed.freeText, 'Customer Records');
  assert.deepEqual(parsed.filters.type, ['asset']);
  assert.deepEqual(parsed.filters.domain, ['finance']);
  assert.deepEqual(parsed.excludedTerms, ['retired']);
  assert.equal(parsed.sort, 'recent');
  assert.equal(lightStemArabicToken('والبيانات'), 'بيان');
});

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

test('search: indexed records apply advanced filters, Arabic NLP, and result-level DLS', async () => {
  const prisma = {
    dataAsset: { findMany: async () => [] },
    searchIndexRecord: {
      findMany: async () => [
        {
          entityType: 'asset',
          entityId: 'asset-visible',
          title: 'سجلات المرضى',
          subtitle: 'AST-CLIN',
          route: JSON.stringify({ path: '/assets', queryParams: { assetId: 'asset-visible' } }),
          source: 'database',
          permission: 'data_assets.view',
          indexedPayloadJson: { detail: 'Clinical Data', status: 'active' },
          visibilityJson: { permission: 'data_assets.view', domainId: 'domain-1', orgUnitId: 'org-1', classificationRank: 2 },
        },
        {
          entityType: 'asset',
          entityId: 'asset-hidden',
          title: 'سجلات المرضى السرية',
          subtitle: 'AST-SECRET',
          route: JSON.stringify({ path: '/assets', queryParams: { assetId: 'asset-hidden' } }),
          source: 'database',
          permission: 'data_assets.view',
          indexedPayloadJson: { detail: 'Restricted Data', status: 'active' },
          visibilityJson: { permission: 'data_assets.view', domainId: 'domain-1', orgUnitId: 'org-1', classificationRank: 5 },
        },
      ],
    },
    searchAnalyticsEvent: { create: async () => ({ id: 'evt-1' }) },
  };
  const service = new SearchService(
    prisma as any,
    accessWith(['data_assets.view']) as any,
    { resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }) } as any,
  );

  const result = await service.search({ id: 'u1', email: 'viewer@dgop.local', roles: ['steward'] }, 'type:asset المرضى');

  assert.equal(result.total, 1);
  assert.equal(result.groups[0].results[0].id, 'asset-visible');
  assert.equal(result.security?.dlsApplied, true);
  assert.ok(result.facets?.some((facet) => facet.key === 'entityType'));
});

test('search: saved searches store encrypted query payload instead of raw query', async () => {
  let savedCreate: any;
  const prisma = {
    savedSearch: {
      updateMany: async () => ({ count: 0 }),
      upsert: async (args: any) => {
        savedCreate = args.create;
        return args.create;
      },
    },
  };
  const service = new SearchService(
    prisma as any,
    accessWith(['search.view']) as any,
    { resolve: async () => allScope } as any,
  );

  await service.saveSearch({ name: 'Finance owners', query: 'owner:sara finance', isDefault: true }, { id: 'u1', email: 'admin@dgop.local', roles: ['system_admin'] });

  assert.notEqual(savedCreate.query, 'owner:sara finance');
  assert.equal(savedCreate.queryProtected, true);
  assert.ok(savedCreate.queryHash);
  assert.ok(savedCreate.queryCiphertextJson?.ciphertext);
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
