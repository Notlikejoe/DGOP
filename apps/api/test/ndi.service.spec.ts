/**
 * Lightweight unit tests for the NDI specification service (no jest dependency).
 * Run with: ts-node test/ndi.service.spec.ts
 */
import assert from 'node:assert';
import { NdiSpecificationsService } from '../src/ndi/ndi.service';
import {
  domainModelGapCount,
  domainModelStatus,
  evidenceQualityScore,
} from '../src/ndi/ndi.logic';

type Over = {
  specFindMany?: (args: any) => Promise<any[]>;
  specCount?: () => Promise<number>;
  specFindUnique?: (args: any) => Promise<any>;
  specCreate?: (args: any) => Promise<any>;
  specUpdate?: (args: any) => Promise<any>;
  domainFindUnique?: (args: any) => Promise<any>;
  domainFindMany?: () => Promise<any[]>;
  workflowGroupBy?: () => Promise<any[]>;
  counts?: Record<string, number>;
};

function makeService(over: Over): NdiSpecificationsService {
  const count = (name: string) => async () => over.counts?.[name] ?? 0;
  const prisma = {
    ndiSpecification: {
      findMany: over.specFindMany ?? (async () => []),
      count: over.specCount ?? (async () => 0),
      findUnique: over.specFindUnique ?? (async () => null),
      create: over.specCreate ?? (async (a: any) => ({ id: 'new', ...a.data })),
      update: over.specUpdate ?? (async (a: any) => ({ id: 'upd', ...a.data })),
      groupBy: async () => [],
    },
    ndiDomain: {
      findUnique: over.domainFindUnique ?? (async () => ({ id: 'd1', code: 'data_quality' })),
      findMany: over.domainFindMany ?? (async () => []),
    },
    workflowCase: { groupBy: over.workflowGroupBy ?? (async () => []) },
    ndiAuditPack: { count: count('ndiAuditPack') },
    mdmMatchCandidate: { count: count('mdmMatchCandidate') },
    referenceDataVersion: { count: count('referenceDataVersion') },
    metadataCertification: { count: count('metadataCertification') },
    architectureReview: { count: count('architectureReview') },
    businessGlossaryTerm: { count: count('businessGlossaryTerm') },
    businessLineageMap: { count: count('businessLineageMap') },
    businessImpactAssessment: { count: count('businessImpactAssessment') },
    dataAssetValuation: { count: count('dataAssetValuation') },
    dataValueKpi: { count: count('dataValueKpi') },
  };
  const audit = { log: async () => {} };
  return new NdiSpecificationsService(prisma as never, audit as never);
}

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

test('domain model logic: evidence quality and status are derived from operating proof', () => {
  const readyInput = {
    specCount: 3,
    approvedEvidenceCount: 3,
    evidenceCount: 3,
    expiredEvidenceCount: 0,
    rejectedEvidenceCount: 0,
    pendingEvidenceCount: 0,
    operationalRecordCount: 2,
    workflowCaseCount: 1,
  };
  assert.strictEqual(evidenceQualityScore(readyInput), 100);
  assert.strictEqual(domainModelStatus(readyInput), 'ready');
  assert.strictEqual(domainModelGapCount(readyInput), 0);

  const weakInput = { ...readyInput, approvedEvidenceCount: 0, evidenceCount: 0 };
  assert.strictEqual(domainModelStatus(weakInput), 'watch');
  assert.ok(domainModelGapCount(weakInput) > 0);

  const blockedInput = { ...weakInput, specCount: 0, operationalRecordCount: 0, workflowCaseCount: 0 };
  assert.strictEqual(domainModelStatus(blockedInput), 'blocked');
});

test('list: composes filters into the AND where-clause', async () => {
  let captured: any = null;
  const svc = makeService({
    specFindMany: async (args) => {
      captured = args.where;
      return [];
    },
  });
  await svc.list({ domainId: 'd1', type: 'policy', maturityLevel: 'level_3', status: 'active', search: 'foo' });
  const and = captured.AND as any[];
  assert.ok(and.some((c) => c.deletedAt === null), 'soft-delete filter present');
  assert.ok(and.some((c) => c.domainId === 'd1'), 'domain filter present');
  assert.ok(and.some((c) => c.type === 'policy'), 'type filter present');
  assert.ok(and.some((c) => c.maturityLevel === 'level_3'), 'maturity filter present');
  assert.ok(and.some((c) => c.isActive === true), 'active status filter present');
  assert.ok(and.some((c) => Array.isArray(c.OR)), 'search OR clause present');
});

test('list: rejects invalid enum filters before Prisma receives them', async () => {
  let queried = false;
  const svc = makeService({
    specFindMany: async () => {
      queried = true;
      return [];
    },
  });
  await assert.rejects(
    () => svc.list({ type: 'spreadsheet', maturityLevel: 'level_3' }),
    /invalid ndi specification type/i,
  );
  await assert.rejects(
    () => svc.list({ type: 'policy', maturityLevel: 'level_9' }),
    /invalid ndi maturity level/i,
  );
  await assert.rejects(
    () => svc.list({ status: 'archived' }),
    /invalid ndi status filter/i,
  );
  assert.strictEqual(queried, false);
});

test('list: returns a plain array when no page is requested', async () => {
  const svc = makeService({ specFindMany: async () => [{ id: 's1' }] });
  const res = await svc.list({});
  assert.ok(Array.isArray(res), 'expected an array');
  assert.strictEqual((res as any[]).length, 1);
});

test('list: returns a paged envelope when a page is requested', async () => {
  const svc = makeService({
    specFindMany: async () => [{ id: 's1' }, { id: 's2' }],
    specCount: async () => 42,
  });
  const res: any = await svc.list({}, 1, 2);
  assert.strictEqual(res.total, 42);
  assert.strictEqual(res.page, 1);
  assert.strictEqual(res.pageSize, 2);
  assert.strictEqual(res.totalPages, 21);
  assert.strictEqual(res.data.length, 2);
});

test('create: rejects a duplicate code', async () => {
  const svc = makeService({
    domainFindUnique: async () => ({ id: 'd1', code: 'data_quality' }),
    specFindUnique: async () => ({ id: 'existing', code: 'DUP-1' }),
  });
  await assert.rejects(
    () =>
      svc.create(
        { code: 'DUP-1', domainId: 'd1', nameEn: 'A', nameAr: 'ا' } as never,
        'tester',
      ),
    /already exists/i,
  );
});

test('create: rejects an unknown domainId', async () => {
  const svc = makeService({ domainFindUnique: async () => null });
  await assert.rejects(
    () =>
      svc.create(
        { code: 'NEW-1', domainId: 'ghost', nameEn: 'A', nameAr: 'ا' } as never,
        'tester',
      ),
    /domain not found/i,
  );
});

test('importCsv: upserts by code (existing -> update, new -> create)', async () => {
  let created = 0;
  let updated = 0;
  const svc = makeService({
    domainFindMany: async () => [{ id: 'd1', code: 'data_quality' }],
    specFindUnique: async (args) => (args.where.code === 'EXIST' ? { id: 'e1', code: 'EXIST' } : null),
    specCreate: async () => {
      created++;
      return {};
    },
    specUpdate: async () => {
      updated++;
      return {};
    },
  });
  const csv = [
    'code,nameEn,nameAr,domainCode',
    'EXIST,Existing,موجود,data_quality',
    'BRAND-NEW,New,جديد,data_quality',
  ].join('\n');
  const res = await svc.importCsv(csv, 'tester');
  assert.strictEqual(res.processed, 2);
  assert.strictEqual(res.created, 1);
  assert.strictEqual(res.updated, 1);
  assert.strictEqual(created, 1);
  assert.strictEqual(updated, 1);
  assert.strictEqual(res.errors.length, 0);
});

test('importCsv: reports an error row for an unknown domainCode', async () => {
  const svc = makeService({
    domainFindMany: async () => [{ id: 'd1', code: 'data_quality' }],
  });
  const csv = ['code,nameEn,nameAr,domainCode', 'X-1,Spec,مواصفة,does_not_exist'].join('\n');
  const res = await svc.importCsv(csv, 'tester');
  assert.strictEqual(res.created, 0);
  assert.strictEqual(res.updated, 0);
  assert.strictEqual(res.errors.length, 1);
  assert.match(res.errors[0].message, /unknown domaincode/i);
});

test('importCsv: rejects invalid type and maturity before persistence', async () => {
  let createCalled = false;
  const svc = makeService({
    domainFindMany: async () => [{ id: 'd1', code: 'data_quality' }],
    specCreate: async () => {
      createCalled = true;
      return {};
    },
  });
  const csv = [
    'code,nameEn,nameAr,domainCode,type,maturityLevel',
    'BAD-TYPE,Spec,Spec,data_quality,unsupported,level_2',
    'BAD-LEVEL,Spec,Spec,data_quality,standard,level_9',
  ].join('\n');
  const res = await svc.importCsv(csv, 'tester');
  assert.strictEqual(createCalled, false);
  assert.strictEqual(res.created, 0);
  assert.strictEqual(res.updated, 0);
  assert.strictEqual(res.errors.length, 2);
  assert.match(res.errors[0].message, /invalid type/i);
  assert.match(res.errors[1].message, /invalid maturitylevel/i);
});

test('domainTraceability: maps v5 operating models to live specs, evidence, records, and workflow cases', async () => {
  const now = new Date();
  const svc = makeService({
    specFindMany: async () => [
      {
        id: 'spec-dg',
        domain: { id: 'ndi-dg', code: 'data_strategy', shortCode: 'DG', nameEn: 'Data Strategy', nameAr: 'Data Strategy' },
        evidence: [{ status: 'approved', expiryDate: new Date(now.getTime() + 86_400_000) }],
      },
      {
        id: 'spec-rmd',
        domain: { id: 'ndi-rmd', code: 'reference_master_data', shortCode: 'RMD', nameEn: 'Reference Data', nameAr: 'Reference Data' },
        evidence: [{ status: 'submitted', expiryDate: null }],
      },
    ],
    workflowGroupBy: async () => [{ type: 'policy_lifecycle', _count: { _all: 1 } }],
    counts: {
      ndiAuditPack: 1,
      mdmMatchCandidate: 1,
      referenceDataVersion: 1,
      metadataCertification: 0,
      architectureReview: 0,
      businessGlossaryTerm: 0,
      businessLineageMap: 0,
      businessImpactAssessment: 0,
      dataAssetValuation: 0,
      dataValueKpi: 0,
    },
  });

  const result = await svc.domainTraceability();
  assert.strictEqual(result.summary.models, 7);
  assert.strictEqual(result.summary.specifications, 2);
  const dg = result.models.find((row) => row.code === 'DG')!;
  const rmd = result.models.find((row) => row.code === 'RMD')!;
  assert.strictEqual(dg.status, 'ready');
  assert.strictEqual(dg.metrics.workflowCaseCount, 1);
  assert.strictEqual(rmd.status, 'watch');
  assert.strictEqual(rmd.metrics.pendingEvidenceCount, 1);
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
