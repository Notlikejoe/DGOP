import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AssetsService } from '../src/assets/assets.service';
import {
  DATA_ASSET_TYPES,
  assetTypePanel,
  normalizeAssetCode,
  normalizeAssetType,
  uniqueIds,
  validateAssetCrossFields,
  validateAssetText,
  validateAssetTypeFields,
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
  await assert.rejects(
    () => service.list(['data_steward'], { assetType: 'mystery_type' }, '1', '10'),
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

test('v6 asset type foundation exposes the six registered asset types', () => {
  assert.deepEqual(DATA_ASSET_TYPES, [
    'dataset',
    'file',
    'document_record',
    'api_data_feed',
    'bi_report_dashboard',
    'ai_data_product',
  ]);
  assert.equal(normalizeAssetType('API / Data Feed'), 'api_data_feed');
  assert.equal(normalizeAssetType('document'), 'document_record');
});

test('v6 asset type validation blocks subtype drift across asset types', () => {
  assert.deepEqual(validateAssetTypeFields({ assetType: 'dataset', assetSubtype: 'transactional_dataset' }), []);
  assert.deepEqual(
    validateAssetTypeFields({ assetType: 'api_data_feed', assetSubtype: 'transactional_dataset' }),
    ['Asset subtype transactional_dataset is not registered for asset type api_data_feed'],
  );
});

test('v6 asset type validation blocks metadata drift and invalid lifecycle movement', () => {
  assert.deepEqual(
    validateAssetTypeFields({
      assetType: 'dataset',
      typeMetadataJson: { endpointUrl: 'https://example.test/feed' },
    }),
    ['Unsupported dataset metadata field(s): endpointUrl'],
  );
  assert.deepEqual(
    validateAssetTypeFields({
      assetType: 'dataset',
      previousV6LifecycleState: 'operational',
      v6LifecycleState: 'designed',
    }),
    ['Invalid v6 lifecycle transition from operational to designed'],
  );
  assert.deepEqual(
    validateAssetTypeFields({
      assetType: 'file',
      lifecyclePhase: 'retire',
      v6LifecycleState: 'operational',
    }),
    ['Retire phase requires a deprecated or retired v6 lifecycle state'],
  );
});

test('Asset 360 type panels expose expected evidence skeletons', () => {
  const panel = assetTypePanel('ai_data_product');
  assert.equal(panel.code, 'ai_data_product');
  assert.equal(panel.title, 'AI data product governance panel');
  assert.deepEqual(panel.expectedEvidence, ['model_card', 'training_data_lineage', 'risk_assessment', 'human_oversight']);
});

test('asset import preview reports valid rows and type metadata errors without writing assets', async () => {
  let writes = 0;
  const service = new AssetsService(
    {
      dataDomain: { findMany: async () => [{ id: 'domain-finance', code: 'finance' }] },
      organizationUnit: { findMany: async () => [] },
      systemPlatform: { findMany: async () => [] },
      businessCapability: { findMany: async () => [{ id: 'cap-revenue', code: 'revenue_cycle' }] },
      classification: { findMany: async () => [{ id: 'class-internal', code: 'internal', rank: 2 }] },
      dataSubject: {
        findMany: async () => [
          { id: 'subject-patient', code: 'patient' },
          { id: 'subject-supplier', code: 'supplier' },
        ],
      },
      dataAsset: {
        findUnique: async () => null,
        create: async () => {
          writes++;
          return {};
        },
        update: async () => {
          writes++;
          return {};
        },
      },
    } as never,
    { log: async () => undefined } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );
  const csv = [
    'code,nameEn,nameAr,description,lifecycleStatus,domainCode,capabilityCode,classificationCode,subjectCodes,assetType,assetSubtype,v6LifecycleState,lifecyclePhase,typeMetadataJson',
    'AST-OK,Claims,Claims,Valid row,active,finance,revenue_cycle,internal,patient|supplier,dataset,transactional_dataset,registered,discover,"{""refreshCadence"":""daily""}"',
    'AST-BAD,Feed,Feed,Bad row,active,finance,revenue_cycle,internal,,dataset,transactional_dataset,registered,discover,"{""endpointUrl"":""https://example.test/feed""}"',
  ].join('\n');

  const preview = await service.importPreview(['system_admin'], csv);

  assert.equal(preview.processed, 2);
  assert.equal(preview.validRows, 1);
  assert.equal(preview.rows[0].action, 'create');
  assert.equal(preview.rows[0].assetType, 'dataset');
  assert.equal(preview.rows[0].subjectCount, 2);
  assert.equal(preview.errors[0].row, 3);
  assert.match(preview.errors[0].message, /Unsupported dataset metadata/);
  assert.equal(writes, 0);
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
