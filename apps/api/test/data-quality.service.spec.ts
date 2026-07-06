/**
 * Unit tests for Data Quality service scoping and bounded list behavior.
 * Run with: ts-node test/data-quality.service.spec.ts
 */
import assert from 'node:assert';
import { DataQualityService } from '../src/data-quality/data-quality.service';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

function includesScopedAsset(where: unknown, assetId: string): boolean {
  const text = JSON.stringify(where);
  return text.includes('"assetId"') && text.includes(assetId);
}

test('summary applies data-scope asset filtering to every count', async () => {
  const countWhere: unknown[] = [];
  const service = new DataQualityService(
    {
      dataAsset: {
        findMany: async () => [{ id: 'visible-asset' }],
      },
      dataQualityIssue: {
        count: async (args: { where: unknown }) => {
          countWhere.push(args.where);
          return 1;
        },
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({
        orgUnits: ['org-1'],
        domains: ['domain-1'],
        maxClassRank: 2,
      }),
    } as never,
  );

  const summary = await service.summary(['dq_steward']);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(countWhere.length, 5);
  assert.ok(countWhere.every((where) => includesScopedAsset(where, 'visible-asset')));
});

test('list returns a paged envelope only when pagination is requested', async () => {
  const findManyCalls: any[] = [];
  const service = new DataQualityService(
    {
      dataQualityIssue: {
        findMany: async (args: any) => {
          findManyCalls.push(args);
          return [{ id: 'dq-1' }, { id: 'dq-2' }];
        },
        count: async () => 3,
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  const plain = await service.list(['system_admin'], {});
  assert.ok(Array.isArray(plain));

  const paged = await service.list(['system_admin'], {}, '1', '2') as any;
  assert.deepStrictEqual(
    {
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
      totalPages: paged.totalPages,
      rowCount: paged.data.length,
    },
    { total: 3, page: 1, pageSize: 2, totalPages: 2, rowCount: 2 },
  );
  assert.strictEqual(findManyCalls[1].skip, 0);
  assert.strictEqual(findManyCalls[1].take, 2);
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
