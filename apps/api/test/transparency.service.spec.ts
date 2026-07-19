import assert from 'node:assert/strict';
import { FoiRequestStatus, OpenDataCandidateStatus, OpenDataSignalStatus } from '@prisma/client';
import { TransparencyService } from '../src/transparency/transparency.service';
import {
  addTrendDate,
  emptyTrendBuckets,
  releaseReadiness,
  sortRisks,
} from '../src/transparency/transparency.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

const user = { id: 'u1', email: 'admin@dgop.local', roles: ['od_officer'] };
const allScope = { orgUnits: 'all', domains: 'all', maxClassRank: null };

function accessWith(permissions: string[]) {
  return {
    permissionsForRoleCodes: async () => permissions,
    hasPermission: (granted: string[], required: string) =>
      granted.includes('*') || granted.includes(required),
  };
}

test('trend buckets collect dates into the right month', () => {
  const buckets = emptyTrendBuckets(new Date('2026-07-14T00:00:00Z'), 2);
  addTrendDate(buckets, 'openDataCreated', '2026-07-01T00:00:00Z');
  addTrendDate(buckets, 'foiReceived', '2026-06-20T00:00:00Z');
  assert.equal(buckets[0].foiReceived, 1);
  assert.equal(buckets[1].openDataCreated, 1);
});

test('release readiness is blocked by privacy, sharing, or overdue workflow risks', () => {
  const result = releaseReadiness({
    openDataPublished: 8,
    openDataTotal: 10,
    foiClosed: 8,
    foiTotal: 10,
    privacyBlockers: 1,
    sharingBlockers: 0,
    overdueWorkflow: 2,
  });
  assert.equal(result.status, 'blocked');
  assert.ok(result.score < 80);
  assert.deepEqual(result.blockers, ['privacy', 'workflow']);
});

test('risk queue sorts severe and due risks first', () => {
  const risks = sortRisks([
    { id: 'low', source: 'foi', title: 'Low', detail: 'Low', severity: 'low', route: '/' },
    { id: 'critical-late', source: 'foi', title: 'Critical', detail: 'Critical', severity: 'critical', route: '/', dueAt: '2026-07-10T00:00:00Z' },
    { id: 'critical-early', source: 'foi', title: 'Critical', detail: 'Critical', severity: 'critical', route: '/', dueAt: '2026-07-01T00:00:00Z' },
  ]);
  assert.equal(risks[0].id, 'critical-early');
  assert.equal(risks[2].id, 'low');
});

test('cockpit only includes sections granted by underlying permissions', async () => {
  let foiTouched = false;
  const prisma = {
    dataAsset: { findMany: async () => [] },
    openDataCandidate: {
      count: async (args: any) => {
        const status = args?.where?.status;
        if (!status) return 2;
        if (status === OpenDataCandidateStatus.assessment) return 1;
        if (status === OpenDataCandidateStatus.under_review) return 1;
        if (status === OpenDataCandidateStatus.approved) return 0;
        if (status === OpenDataCandidateStatus.published) return 1;
        return 0;
      },
      findMany: async (args: any) => {
        if (args?.select?.createdAt) return [{ createdAt: new Date('2026-07-01T00:00:00Z') }];
        return [
          {
            id: 'od-risk',
            code: 'OD-1',
            titleEn: 'Customer export',
            eligibilityScore: 35,
            status: OpenDataCandidateStatus.assessment,
            nextReviewAt: null,
          },
        ];
      },
    },
    openDataApproval: { count: async () => 1 },
    openDataPublication: { findMany: async () => [{ publishedAt: new Date('2026-07-02T00:00:00Z') }] },
    foiRequest: {
      findMany: async () => {
        foiTouched = true;
        return [];
      },
    },
  };
  const service = new TransparencyService(
    prisma as any,
    { resolve: async () => allScope } as any,
    accessWith(['dashboard.view', 'open_data_candidates.view']) as any,
  );
  const result = await service.cockpit(user);
  assert.ok(result.openData);
  assert.equal(result.foi, null);
  assert.equal(result.openData!.pendingApprovals, 1);
  assert.equal(result.risks[0].source, 'open_data');
  assert.equal(foiTouched, false);
  assert.equal(result.trends.some((bucket) => bucket.openDataPublished === 1), true);
});

test('cockpit FOI rollups do not expose unanchored records to restricted users', async () => {
  let foiWhere: unknown;
  const prisma = {
    dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
    foiRequest: {
      findMany: async (args: any) => {
        foiWhere = args.where;
        return [];
      },
    },
    foiDisclosure: { findMany: async () => [] },
    foiAppeal: { count: async () => 0 },
  };
  const service = new TransparencyService(
    prisma as any,
    { resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }) } as any,
    accessWith(['foi_requests.view']) as any,
  );

  const result = await service.cockpit({ ...user, roles: ['foi_officer'] });

  assert.equal(result.foi?.total, 0);
  const whereText = JSON.stringify(foiWhere);
  assert.ok(whereText.includes('visible-asset'));
  assert.ok(!whereText.includes('"assetId":null'));
  assert.ok(!whereText.includes('"dataDomainId"'));
});

test('cockpit FOI rollups allow domain-only records only for matching domain scope', async () => {
  let foiWhere: unknown;
  const prisma = {
    dataAsset: { findMany: async () => [] },
    foiRequest: {
      findMany: async (args: any) => {
        foiWhere = args.where;
        return [
          {
            id: 'foi-1',
            requestNumber: 'FOI-2026-0001',
            subject: 'Domain-only request',
            requesterType: 'individual',
            status: FoiRequestStatus.registered,
            dueAt: new Date('2026-07-25T00:00:00Z'),
            receivedAt: new Date('2026-07-15T00:00:00Z'),
          },
        ];
      },
    },
    foiDisclosure: { findMany: async () => [] },
    foiAppeal: { count: async () => 0 },
  };
  const service = new TransparencyService(
    prisma as any,
    { resolve: async () => ({ orgUnits: 'all', domains: ['domain-1'], maxClassRank: 2 }) } as any,
    accessWith(['foi_requests.view']) as any,
  );

  const result = await service.cockpit({ ...user, roles: ['foi_officer'] });

  assert.equal(result.foi?.total, 1);
  const whereText = JSON.stringify(foiWhere);
  assert.ok(whereText.includes('"assetId":null'));
  assert.ok(whereText.includes('"dataDomainId":{"in":["domain-1"]}'));
});

test('cockpit workflow rollups apply data scope and unanchored ownership visibility', async () => {
  let workflowWhere: unknown;
  const prisma = {
    dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
    workflowCase: {
      findMany: async (args: any) => {
        workflowWhere = args.where;
        return [];
      },
    },
  };
  const service = new TransparencyService(
    prisma as any,
    { resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }) } as any,
    accessWith(['workflow_cases.view']) as any,
  );

  const result = await service.cockpit({ id: 'user-1', email: 'owner@dgop.local', roles: ['foi_officer'] });

  assert.equal(result.workflow?.cases, 0);
  const whereText = JSON.stringify(workflowWhere);
  assert.ok(whereText.includes('visible-asset'));
  assert.ok(whereText.includes('"createdBy":"owner@dgop.local"'));
  assert.ok(whereText.includes('"assigneeUserId":"user-1"'));
  assert.ok(whereText.includes('"assigneeRoleCode":{"in":["foi_officer"]}'));
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
