import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AssetsService } from '../src/assets/assets.service';
import {
  normalizeAssetCode,
  uniqueIds,
  validateAssetCrossFields,
  validateAssetText,
} from '../src/assets/assets.logic';

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

test('asset text validation normalizes and rejects weak identifiers', () => {
  assert.equal(normalizeAssetCode(' ast-fin-01 '), 'AST-FIN-01');
  assert.deepEqual(
    validateAssetText(
      { code: 'bad code', nameEn: 'Asset', nameAr: 'أصل', lifecycleStatus: 'active' },
      { requireCode: true, requireNames: true, allowCode: true },
    ),
    ['Asset code must use uppercase letters, numbers, and hyphens, starting with a letter'],
  );
  assert.deepEqual(
    validateAssetText({ code: 'AST-NEW' }, { requireCode: false, requireNames: false, allowCode: false }),
    ['Asset code is immutable after creation'],
  );
});

test('asset text validation rejects invalid runtime types before Prisma', () => {
  assert.deepEqual(
    validateAssetText(
      { code: 123, nameEn: 456, nameAr: 'أصل', description: false, ownerName: [], lifecycleStatus: 1 },
      { requireCode: true, requireNames: true, allowCode: true },
    ),
    [
      'Asset code must be text',
      'English asset name must be text',
      'Description must be text',
      'Owner name must be text',
      'Lifecycle status must be text',
    ],
  );
});

test('asset cross-field validation protects personal data and system ownership integrity', () => {
  assert.deepEqual(uniqueIds(['subject-1', 'subject-1', 'subject-2']), ['subject-1', 'subject-2']);
  assert.deepEqual(
    validateAssetCrossFields({ subjectIds: ['subject-1'], classification: null }),
    ['Assets with data subjects require a classification of Internal or higher'],
  );
  assert.deepEqual(
    validateAssetCrossFields({ subjectIds: ['subject-1'], classification: { rank: 1, code: 'public' } }),
    ['Assets with data subjects cannot be classified as Public'],
  );
  assert.deepEqual(
    validateAssetCrossFields({
      subjectIds: [],
      classification: null,
      orgUnitId: 'ou-finance',
      system: { ownerOrgUnitId: 'ou-health', code: 'SYS-HEALTH' },
    }),
    ['Selected system belongs to a different organization unit'],
  );
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
