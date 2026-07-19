import assert from 'node:assert/strict';
import { OpenDataCandidateStatus } from '@prisma/client';
import { contentDispositionAttachment, sanitizeAttachmentFilename } from '../src/common/download';
import { ReportsService } from '../src/reports/reports.service';
import { filterDefinitions, toCsv, toSimplePdf, type ReportDefinition } from '../src/reports/reports.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

const user = { id: 'u1', email: 'user@dgop.local', roles: ['od_officer'] };
const allScope = { orgUnits: 'all', domains: 'all', maxClassRank: null };

function accessWith(permissions: string[]) {
  return {
    permissionsForRoleCodes: async () => permissions,
    hasPermission: (granted: string[], required: string) =>
      granted.includes('*') || granted.includes(required),
  };
}

test('report catalog hides definitions without an underlying permission', () => {
  const defs: ReportDefinition[] = [
    {
      id: 'allowed',
      title: 'Allowed',
      description: '',
      tower: 'Tower',
      requiredAnyPermissions: ['open_data_candidates.view'],
      supportedFormats: ['json'],
      filters: [],
      scheduledPlaceholder: true,
    },
    {
      id: 'hidden',
      title: 'Hidden',
      description: '',
      tower: 'Tower',
      requiredAnyPermissions: ['foi_requests.view'],
      supportedFormats: ['json'],
      filters: [],
      scheduledPlaceholder: true,
    },
  ];
  const visible = filterDefinitions(defs, ['open_data_candidates.view'], (granted, permission) =>
    granted.includes(permission),
  );
  assert.deepEqual(visible.map((definition) => definition.id), ['allowed']);
});

test('CSV export quotes commas and PDF export returns a PDF buffer', () => {
  const result = {
    id: 'r1',
    title: 'Report',
    generatedAt: '2026-07-14T00:00:00Z',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'value', label: 'Value' },
    ],
    rows: [{ name: 'Finance, Customer', value: 7 }],
    summary: { total: 1 },
  };
  const csv = toCsv(result);
  assert.ok(csv.includes('"Finance, Customer"'));
  const pdf = toSimplePdf(result);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('CSV export neutralizes spreadsheet formula text without changing numbers', () => {
  const result = {
    id: 'r1',
    title: 'Report',
    generatedAt: '2026-07-14T00:00:00Z',
    columns: [
      { key: 'value', label: 'Value' },
      { key: 'number', label: 'Number' },
    ],
    rows: [
      { value: '=HYPERLINK("https://example.invalid","open")', number: -7 },
      { value: '+SUM(1,2)', number: 3 },
      { value: '-1+2', number: 4 },
      { value: '@cmd', number: 5 },
      { value: '  =SUM(1,2)', number: 6 },
    ],
    summary: { total: 5 },
  };
  const csv = toCsv(result);
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.invalid"",""open"")"'));
  assert.ok(csv.includes("'+SUM(1,2)"));
  assert.ok(csv.includes("'-1+2"));
  assert.ok(csv.includes("'@cmd"));
  assert.ok(csv.includes("'  =SUM(1,2)"));
  assert.ok(csv.includes(',-7'));
});

test('download headers sanitize unsafe attachment filenames', () => {
  assert.equal(sanitizeAttachmentFilename('..bad\"\\\r\nX-Trace: yep.csv'), 'bad-X-Trace- yep.csv');
  assert.equal(contentDispositionAttachment('NDI-PACK-20260719-001.zip'), 'attachment; filename="NDI-PACK-20260719-001.zip"');
});

test('reports service exposes only accessible reports and runs open data workload', async () => {
  const prisma = {
    dataAsset: { findMany: async () => [] },
    openDataCandidate: {
      findMany: async () => [
        {
          code: 'OD-1',
          titleEn: 'Customer dataset',
          status: OpenDataCandidateStatus.published,
          eligibilityScore: 92,
          nextReviewAt: new Date('2026-08-01T00:00:00Z'),
          asset: { code: 'AST-1', nameEn: 'Customer Asset' },
        },
      ],
    },
  };
  const service = new ReportsService(
    prisma as any,
    { resolve: async () => allScope } as any,
    accessWith(['dashboard.view', 'open_data_candidates.view']) as any,
  );
  const catalog = await service.catalog(user);
  assert.ok(catalog.some((definition) => definition.id === 'open-data-workload'));
  assert.equal(catalog.some((definition) => definition.id === 'foi-sla'), false);

  const report = await service.run(user, 'open-data-workload');
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].eligibility, 92);

  const exported = await service.export(user, 'open-data-workload', 'csv');
  assert.equal(exported.contentType.startsWith('text/csv'), true);
  assert.ok(String(exported.body).includes('Customer dataset'));
});

test('operational transparency report only includes permitted areas', async () => {
  let openDataQueried = false;
  const prisma = {
    openDataCandidate: {
      findMany: async () => {
        openDataQueried = true;
        return [
          { status: OpenDataCandidateStatus.assessment },
          { status: OpenDataCandidateStatus.published },
        ];
      },
    },
    foiRequest: { findMany: async () => { throw new Error('FOI should not be queried'); } },
    privacyDpia: { findMany: async () => { throw new Error('Privacy should not be queried'); } },
    dataSharingRequest: { findMany: async () => { throw new Error('Data sharing should not be queried'); } },
  };
  const service = new ReportsService(
    prisma as any,
    { resolve: async () => allScope } as any,
    accessWith(['dashboard.view', 'open_data_candidates.view']) as any,
  );

  const report = await service.run(user, 'operational-transparency');
  assert.equal(openDataQueried, true);
  assert.deepEqual(report.rows.map((row) => row.area), ['Open Data']);
  assert.equal(report.rows[0].total, 2);
});

test('NDI readiness report hides specifications outside the actor visibility scope', async () => {
  let ndiArgs: any;
  const scopedUser = { id: 'u-ndi', email: 'owner@dgop.local', roles: ['ndi_owner'] };
  const prisma = {
    person: { findFirst: async () => ({ id: 'person-1' }) },
    ndiDomain: {
      findMany: async (args: any) => {
        ndiArgs = args;
        return [
          {
            id: 'ndi-domain-1',
            code: 'NDI-1',
            shortCode: 'D1',
            nameEn: 'Governance',
            specifications: [
              {
                id: 'spec-1',
                code: 'NDI-1.1',
                evidence: [{ status: 'approved' }],
              },
            ],
          },
          {
            id: 'ndi-domain-hidden',
            code: 'NDI-H',
            shortCode: 'DH',
            nameEn: 'Hidden domain',
            specifications: [],
          },
        ];
      },
    },
  };
  const service = new ReportsService(
    prisma as any,
    { resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }) } as any,
    accessWith(['ndi_scoring.view']) as any,
  );

  const report = await service.run(scopedUser, 'ndi-readiness');

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].domain, 'D1');
  const specWhere = JSON.stringify(ndiArgs.include.specifications.where);
  const evidenceWhere = JSON.stringify(ndiArgs.include.specifications.select.evidence.where);
  assert.ok(specWhere.includes('ownerPersonId'));
  assert.ok(specWhere.includes('submittedBy'));
  assert.ok(evidenceWhere.includes('reviewedBy'));
});

test('FOI reports do not expose unanchored records to restricted users', async () => {
  let foiWhere: unknown;
  const scopedUser = { id: 'u-foi', email: 'foi@dgop.local', roles: ['foi_officer'] };
  const service = new ReportsService(
    {
      dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
      foiRequest: {
        findMany: async (args: any) => {
          foiWhere = args.where;
          return [];
        },
      },
    } as any,
    { resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }) } as any,
    accessWith(['foi_requests.view']) as any,
  );

  const report = await service.run(scopedUser, 'foi-sla');

  assert.equal(report.rows.length, 0);
  const whereText = JSON.stringify(foiWhere);
  assert.ok(whereText.includes('visible-asset'));
  assert.ok(!whereText.includes('"assetId":null'));
  assert.ok(!whereText.includes('"dataDomainId"'));
});

test('reports service rejects inaccessible reports', async () => {
  const service = new ReportsService(
    {} as any,
    { resolve: async () => allScope } as any,
    accessWith(['dashboard.view']) as any,
  );
  await assert.rejects(() => service.run(user, 'foi-sla'), /report access denied/);
});

test('reports service rejects invalid date filters before querying Prisma', async () => {
  let queried = false;
  const service = new ReportsService(
    {
      dataAsset: { findMany: async () => [] },
      openDataCandidate: {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
    } as any,
    { resolve: async () => allScope } as any,
    accessWith(['dashboard.view', 'open_data_candidates.view']) as any,
  );

  await assert.rejects(() => service.run(user, 'open-data-workload', { from: 'not-a-date' }), /Invalid from date filter/);
  assert.equal(queried, false);
});

test('reports service rejects reversed date ranges before querying Prisma', async () => {
  let queried = false;
  const service = new ReportsService(
    {
      dataAsset: { findMany: async () => [] },
      openDataCandidate: {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
    } as any,
    { resolve: async () => allScope } as any,
    accessWith(['dashboard.view', 'open_data_candidates.view']) as any,
  );

  await assert.rejects(
    () => service.run(user, 'open-data-workload', { from: '2026-08-02', to: '2026-08-01' }),
    /Invalid report date range/,
  );
  assert.equal(queried, false);
});

test('reports service rejects invalid status filters before querying Prisma', async () => {
  let queried = false;
  const service = new ReportsService(
    {
      dataAsset: { findMany: async () => [] },
      openDataCandidate: {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
    } as any,
    { resolve: async () => allScope } as any,
    accessWith(['dashboard.view', 'open_data_candidates.view']) as any,
  );

  await assert.rejects(
    () => service.run(user, 'open-data-workload', { status: 'published;drop' }),
    /Invalid open data status filter/,
  );
  assert.equal(queried, false);
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
