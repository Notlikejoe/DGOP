import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AssetsService } from '../src/assets/assets.service';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('asset list rejects invalid owner and lifecycle filters before Prisma receives them', async () => {
  let assetFinds = 0;
  const service = new AssetsService(
    {
      dataAsset: {
        findMany: async () => {
          assetFinds++;
          return [];
        },
        count: async () => 0,
      },
    } as never,
    { log: async () => undefined } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  await assert.rejects(
    () => service.list(['data_steward'], { ownerStatus: 'owned' }, '1', '10'),
    BadRequestException,
  );
  await assert.rejects(
    () => service.list(['data_steward'], { lifecycleStatus: 'almost_active' }, '1', '10'),
    BadRequestException,
  );
  assert.equal(assetFinds, 0);
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  \u2713 ${t.name}`);
    } catch (error) {
      console.error(`  \u2717 ${t.name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
