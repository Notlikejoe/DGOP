/**
 * Lightweight unit tests for the NDI specification service (no jest dependency).
 * Run with: ts-node test/ndi.service.spec.ts
 */
import assert from 'node:assert';
import { NdiSpecificationsService } from '../src/ndi/ndi.service';

type Over = {
  specFindMany?: (args: any) => Promise<any[]>;
  specCount?: () => Promise<number>;
  specFindUnique?: (args: any) => Promise<any>;
  specCreate?: (args: any) => Promise<any>;
  specUpdate?: (args: any) => Promise<any>;
  domainFindUnique?: (args: any) => Promise<any>;
  domainFindMany?: () => Promise<any[]>;
};

function makeService(over: Over): NdiSpecificationsService {
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
  };
  const audit = { log: async () => {} };
  return new NdiSpecificationsService(prisma as never, audit as never);
}

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

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
