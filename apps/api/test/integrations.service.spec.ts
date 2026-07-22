/**
 * Unit tests for Sprint 15 catalog integration mapping, import, and write-back behavior.
 * Run with: ts-node test/integrations.service.spec.ts
 */
import assert from 'node:assert';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DataAssetCatalogSyncStatus,
  IntegrationConnectorStatus,
  IntegrationDirection,
  IntegrationEventStatus,
  IntegrationSourceTrust,
  IntegrationWritebackStatus,
} from '@prisma/client';
import { IntegrationsService } from '../src/integrations/integrations.service';
import {
  adapterMatchesConnectorType,
  buildCatalogWritebackPayload,
  catalogRowsFromExternalPayload,
  catalogMappingPreview,
  defaultAdapterForConnectorType,
  DEFAULT_INTEGRATION_CONNECTORS,
  enterpriseConnectorRuntime,
  isPrivateConnectorHost,
  isSafeConnectorHeaderName,
  normalizeIntegrationEventPayload,
  normalizeCatalogAssetRow,
  validateEnterpriseConnectorUrl,
} from '../src/integrations/integrations.logic';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

const connector = {
  id: 'connector-1',
  code: 'CATALOG-MVP',
  nameEn: 'Enterprise Catalog',
  nameAr: 'Enterprise Catalog',
  type: 'catalog',
  direction: IntegrationDirection.bidirectional,
  status: IntegrationConnectorStatus.warning,
  sourceTrust: IntegrationSourceTrust.authoritative,
  lastSuccessAt: null,
};
const TEST_WEBHOOK_TOKEN = 'test-webhook-token-32-characters-ok';

function serviceWith(
  prisma: Record<string, any>,
  auditLog: unknown[] = [],
  scope: any = { orgUnits: 'all', domains: 'all', maxClassRank: null },
) {
  return new IntegrationsService(
    prisma as never,
    { log: async (entry: unknown) => auditLog.push(entry) } as never,
    { resolve: async () => scope } as never,
  );
}

async function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function trustPublicConnectorDns(service: IntegrationsService, address = '93.184.216.34') {
  (service as any).connectorHostAddresses = async () => [
    { address, family: address.includes(':') ? 6 : 4 },
  ];
}

function prismaBase(tx: Record<string, any>) {
  const reconciliationReports: any[] = [];
  const txClient = {
    ...tx,
    integrationReconciliationReport: tx.integrationReconciliationReport ?? {
      count: async () => reconciliationReports.length,
      findUnique: async ({ where }: any) => reconciliationReports.find((report) => report.code === where.code) ?? null,
      create: async (args: any) => {
        const report = { id: `report-${reconciliationReports.length + 1}`, ...args.data };
        reconciliationReports.push(report);
        return report;
      },
    },
  };
  return {
    integrationConnector: {
      findFirst: async () => connector,
      count: async () => 1,
      update: async (args: any) => ({ ...connector, ...args.data }),
    },
    integrationImportBatch: {
      count: async () => 0,
      findUnique: async () => null,
    },
    integrationJob: { upsert: async () => ({ id: 'job-1' }) },
    dataDomain: { findMany: async () => [{ id: 'domain-1', code: 'finance' }] },
    organizationUnit: { findMany: async () => [] },
    systemPlatform: { findMany: async () => [] },
    businessCapability: { findMany: async () => [] },
    classification: { findMany: async () => [{ id: 'class-1', code: 'internal' }] },
    role: {
      findFirst: async ({ where }: any) =>
        where.code.in.some((code: string) => code === 'system_admin' || code === 'dmo_admin')
          ? { id: 'role-admin' }
          : null,
    },
    $transaction: async (fn: (client: unknown) => unknown) => fn(txClient),
  };
}

test('catalogMappingPreview maps flexible source headers for nontechnical review', () => {
  const preview = catalogMappingPreview([
    {
      external_id: 'CAT-1',
      asset_code: 'AST-1',
      name: 'Finance Feed',
      name_ar: 'Finance Feed',
      domain: 'finance',
    },
  ]);
  const codeField = preview.fields.find((field) => field.target === 'code');
  const nameField = preview.fields.find((field) => field.target === 'nameEn');
  assert.strictEqual(preview.totalRows, 1);
  assert.strictEqual(codeField?.source, 'asset_code');
  assert.strictEqual(nameField?.source, 'name');
  assert.strictEqual(preview.issues.length, 0);
});

test('normalizeCatalogAssetRow rejects missing required business fields', () => {
  const result = normalizeCatalogAssetRow({ code: 'AST-1', nameen: '' }, 2);
  assert.strictEqual(result.asset, null);
  assert.ok(result.issues.some((issue) => issue.field === 'nameEn'));
  assert.ok(result.issues.some((issue) => issue.field === 'nameAr'));
});

test('runCatalogSync creates an asset and external reference from CSV rows', async () => {
  let createdAsset: any;
  let batchUpdate: any;
  const tx = {
    integrationImportBatch: {
      create: async () => ({ id: 'batch-1' }),
      update: async (args: any) => {
        batchUpdate = args.data;
        return { id: 'batch-1', ...args.data, connector, errors: [] };
      },
    },
    integrationImportError: { create: async () => undefined },
    integrationConnector: { update: async () => undefined },
    integrationJob: { updateMany: async () => ({ count: 1 }) },
    integrationExternalReference: {
      findUnique: async () => null,
      upsert: async () => ({ id: 'ref-1' }),
    },
    dataAsset: {
      findUnique: async () => null,
      create: async (args: any) => {
        createdAsset = { id: 'asset-1', ...args.data };
        return createdAsset;
      },
    },
  };
  const auditLog: unknown[] = [];
  const service = serviceWith(prismaBase(tx), auditLog);

  const result = await service.runCatalogSync(
    ['system_admin'],
    {
      adapterType: 'catalog_csv',
      csv: 'externalId,code,nameEn,nameAr,domainCode,classificationCode\nCAT-1,AST-1,Finance Feed,Finance Feed,finance,internal',
    },
    'admin@dgop.local',
  ) as any;

  assert.strictEqual(createdAsset.externalCatalogId, 'CAT-1');
  assert.strictEqual(createdAsset.domainId, 'domain-1');
  assert.strictEqual(batchUpdate.createdRows, 1);
  assert.strictEqual(result.errorRows, 0);
  assert.strictEqual(auditLog.length, 1);
});

test('runCatalogSync records import errors instead of creating bad asset rows', async () => {
  const errors: any[] = [];
  const tx = {
    integrationImportBatch: {
      create: async () => ({ id: 'batch-1' }),
      update: async (args: any) => ({ id: 'batch-1', ...args.data, connector, errors }),
    },
    integrationImportError: {
      create: async (args: any) => {
        errors.push(args.data);
        return args.data;
      },
    },
    integrationConnector: { update: async () => undefined },
    integrationJob: { updateMany: async () => ({ count: 1 }) },
    integrationExternalReference: { findUnique: async () => null },
    dataAsset: {
      findUnique: async () => null,
      create: async () => {
        throw new Error('should not create');
      },
    },
  };
  const service = serviceWith(prismaBase(tx));

  const result = await service.runCatalogSync(
    ['system_admin'],
    {
      adapterType: 'catalog_csv',
      csv: 'externalId,code,nameEn,nameAr,domainCode\nCAT-1,AST-1,Finance Feed,Finance Feed,unknown_domain',
    },
    'admin@dgop.local',
  ) as any;

  assert.strictEqual(result.errorRows, 1);
  assert.strictEqual(errors[0].field, 'domainCode');
});

test('runCatalogSync rejects restricted data-scope users', async () => {
  const service = serviceWith({} as never, [], { orgUnits: ['org-1'], domains: 'all', maxClassRank: null });

  await assert.rejects(
    () =>
      service.runCatalogSync(
        ['catalog_operator'],
        {
          adapterType: 'catalog_csv',
          csv: 'externalId,code,nameEn,nameAr\nCAT-1,AST-1,Finance Feed,Finance Feed',
        },
        'operator@dgop.local',
      ),
    ForbiddenException,
  );
});

test('runCatalogSync rejects stale admin role codes that are not active in the database', async () => {
  const service = serviceWith(
    { role: { findFirst: async () => null } } as never,
    [],
    { orgUnits: ['org-1'], domains: 'all', maxClassRank: null },
  );

  await assert.rejects(
    () =>
      service.runCatalogSync(
        ['system_admin'],
        {
          adapterType: 'catalog_csv',
          csv: 'externalId,code,nameEn,nameAr\nCAT-1,AST-1,Finance Feed,Finance Feed',
        },
        'admin@dgop.local',
      ),
    ForbiddenException,
  );
});

test('runCatalogSync does not overwrite existing governed asset metadata', async () => {
  let assetUpdate: any;
  const warnings: any[] = [];
  const tx = {
    integrationImportBatch: {
      create: async () => ({ id: 'batch-1' }),
      update: async (args: any) => ({ id: 'batch-1', ...args.data, connector, errors: warnings }),
    },
    integrationImportError: {
      create: async (args: any) => {
        warnings.push(args.data);
        return args.data;
      },
    },
    integrationConnector: { update: async () => undefined },
    integrationJob: { updateMany: async () => ({ count: 1 }) },
    integrationExternalReference: {
      findUnique: async () => null,
      upsert: async () => ({ id: 'ref-1' }),
    },
    dataAsset: {
      findUnique: async () => ({
        id: 'asset-1',
        code: 'AST-1',
        nameEn: 'Certified finance feed',
        nameAr: 'Certified finance feed',
        description: 'Approved description',
        lifecycleStatus: 'active',
        ownerName: 'Certified owner',
        ownerStatus: 'assigned',
        domainId: 'domain-old',
        orgUnitId: null,
        systemId: null,
        capabilityId: null,
        classificationId: 'class-old',
      }),
      update: async (args: any) => {
        assetUpdate = args.data;
        return { id: 'asset-1', ...args.data };
      },
      create: async () => {
        throw new Error('should not create');
      },
    },
  };
  const service = serviceWith(prismaBase(tx));

  const result = await service.runCatalogSync(
    ['system_admin'],
    {
      adapterType: 'catalog_csv',
      csv: 'externalId,code,nameEn,nameAr,domainCode,classificationCode\nCAT-1,AST-1,Catalog finance feed,Catalog finance feed,finance,internal',
    },
    'admin@dgop.local',
  ) as any;

  assert.strictEqual(result.updatedRows, 1);
  assert.strictEqual(result.warningRows, 1);
  assert.strictEqual(warnings[0].severity, 'warning');
  assert.strictEqual(assetUpdate.nameEn, undefined);
  assert.strictEqual(assetUpdate.domainId, undefined);
  assert.strictEqual(assetUpdate.catalogSyncStatus, 'stale');
});

test('buildCatalogWritebackPayload exposes owner, steward, and governance status', () => {
  const payload = buildCatalogWritebackPayload({
    code: 'AST-1',
    ownerName: 'Chief Data Owner',
    ownerStatus: 'assigned',
    lifecycleStatus: 'active',
    catalogSyncStatus: 'synced',
    domain: { code: 'finance' },
    classification: { code: 'restricted' },
  });
  assert.deepStrictEqual(payload, {
    assetCode: 'AST-1',
    certifiedOwner: 'Chief Data Owner',
    certifiedSteward: 'Chief Data Owner',
    governanceStatus: 'active',
    syncStatus: 'synced',
    domainCode: 'finance',
    classificationCode: 'restricted',
  });
});

test('normalizeIntegrationEventPayload rejects adapter payloads that are not ready', () => {
  const result = normalizeIntegrationEventPayload('mock_data_quality', 'dq.issue.detected', {
    assetCode: 'AST-1',
    forceFail: true,
  });
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.normalized.subject, 'AST-1');
  assert.ok(result.issues.some((issue) => issue.field === 'payload'));
});

test('external catalog payload rows normalize into catalog import fields', () => {
  const rows = catalogRowsFromExternalPayload({
    assets: [
      {
        externalId: 'EXT-1',
        assetCode: 'AST-1',
        nameEn: 'Finance Feed',
        nameAr: 'Finance Feed',
        domain_code: 'finance',
        classificationCode: 'internal',
      },
    ],
  });

  assert.deepStrictEqual(rows, [
    {
      externalid: 'EXT-1',
      assetcode: 'AST-1',
      nameen: 'Finance Feed',
      namear: 'Finance Feed',
      domain_code: 'finance',
      classificationcode: 'internal',
    },
  ]);
});

test('enterprise connector runtime and URL validation distinguish real endpoints from mocks', () => {
  const runtime = enterpriseConnectorRuntime('webhook_json', 'authoritative', {
    pullUrl: 'https://catalog.example.com/assets',
    writebackUrl: 'https://catalog.example.com/writeback',
  });
  assert.strictEqual(runtime.mode, 'external_http');
  assert.strictEqual(runtime.canPull, true);
  assert.strictEqual(runtime.canWriteback, true);
  assert.strictEqual(enterpriseConnectorRuntime('mock_siem', 'simulated', {}).mode, 'simulated');
  assert.deepStrictEqual(validateEnterpriseConnectorUrl('http://catalog.example.com/assets'), [
    'Connector endpoint must use HTTPS unless insecure HTTP is explicitly enabled',
  ]);
  assert.deepStrictEqual(validateEnterpriseConnectorUrl('https://user:pass@catalog.example.com/assets'), [
    'Connector endpoint must not include credentials in the URL',
  ]);
  assert.deepStrictEqual(validateEnterpriseConnectorUrl('https://127.0.0.1/assets'), [
    'Private connector endpoint requires explicit private-network allowance',
  ]);
  assert.deepStrictEqual(validateEnterpriseConnectorUrl('https://[fc00::1]/assets'), [
    'Private connector endpoint requires explicit private-network allowance',
  ]);
  assert.deepStrictEqual(validateEnterpriseConnectorUrl('https://metadata.internal/assets'), [
    'Private connector endpoint requires explicit private-network allowance',
  ]);
  assert.deepStrictEqual(
    validateEnterpriseConnectorUrl('https://127.0.0.1/assets', { allowPrivateNetwork: true }),
    [],
  );
  assert.strictEqual(isPrivateConnectorHost('::ffff:127.0.0.1'), true);
  assert.strictEqual(isSafeConnectorHeaderName('x-source-system'), true);
  assert.strictEqual(isSafeConnectorHeaderName('Host'), false);
});

test('integration adapter compatibility prevents misleading connector engines', () => {
  assert.strictEqual(adapterMatchesConnectorType('data_quality', 'mock_data_quality'), true);
  assert.strictEqual(adapterMatchesConnectorType('data_quality', 'webhook_json'), true);
  assert.strictEqual(adapterMatchesConnectorType('data_quality', 'catalog_csv'), false);
  assert.strictEqual(adapterMatchesConnectorType('siem', 'mock_siem'), true);
  assert.strictEqual(adapterMatchesConnectorType('iam_sso', 'mock_iam_sso'), true);
  assert.strictEqual(adapterMatchesConnectorType('siem', 'mock_dlp'), false);
  assert.strictEqual(defaultAdapterForConnectorType('catalog'), 'catalog_csv');
  assert.strictEqual(defaultAdapterForConnectorType('data_quality'), 'webhook_json');
});

test('default integration connectors cover every simulated enterprise adapter', () => {
  const defaultAdapters = new Set(DEFAULT_INTEGRATION_CONNECTORS.map((connector) => connector.adapterType));
  for (const adapter of [
    'mock_data_quality',
    'mock_dlp',
    'mock_open_data',
    'mock_foi',
    'mock_lms',
    'mock_siem',
    'mock_iam_sso',
  ] as const) {
    assert.ok(defaultAdapters.has(adapter), `${adapter} must have a default connector`);
  }
  for (const connector of DEFAULT_INTEGRATION_CONNECTORS) {
    assert.ok(
      adapterMatchesConnectorType(connector.type, connector.adapterType),
      `${connector.code} must use an adapter compatible with ${connector.type}`,
    );
  }
});

test('default integration connector bootstrap is idempotent and repairs jobs separately', async () => {
  const connectorUpserts: any[] = [];
  const jobUpserts: any[] = [];
  const statusUpdates: any[] = [];
  const service = serviceWith({
    integrationConnector: {
      upsert: async (args: any) => {
        connectorUpserts.push(args);
        return {
          id: `connector-${connectorUpserts.length}`,
          status: IntegrationConnectorStatus.warning,
          lastError: null,
        };
      },
      update: async (args: any) => {
        statusUpdates.push(args);
        return { id: args.where.id, status: args.data.status, lastError: null };
      },
    },
    integrationJob: {
      upsert: async (args: any) => {
        jobUpserts.push(args);
        return { id: `job-${jobUpserts.length}`, ...args.create };
      },
    },
  } as never);

  await (service as any).ensureDefaultMockConnectors('system');

  assert.strictEqual(connectorUpserts.length, DEFAULT_INTEGRATION_CONNECTORS.length);
  assert.strictEqual(jobUpserts.length, DEFAULT_INTEGRATION_CONNECTORS.length);
  assert.strictEqual(statusUpdates.length, DEFAULT_INTEGRATION_CONNECTORS.length);
  assert.strictEqual(connectorUpserts[0].create.jobs, undefined);
  assert.strictEqual(jobUpserts[0].update.status, undefined);
  assert.ok(jobUpserts.some((args) => args.where.code === 'JOB-IAM-SSO-MOCK'));
});

test('default catalog connector bootstrap is idempotent and repairs the catalog job', async () => {
  const connectorUpserts: any[] = [];
  const jobUpserts: any[] = [];
  const statusUpdates: any[] = [];
  const service = serviceWith({
    integrationConnector: {
      findFirst: async () => null,
      upsert: async (args: any) => {
        connectorUpserts.push(args);
        return {
          id: 'catalog-connector-1',
          code: 'CATALOG-MVP',
          status: IntegrationConnectorStatus.warning,
          lastError: null,
        };
      },
      update: async (args: any) => {
        statusUpdates.push(args);
        return { id: args.where.id, status: args.data.status, lastError: null };
      },
    },
    integrationJob: {
      upsert: async (args: any) => {
        jobUpserts.push(args);
        return { id: 'catalog-job-1', ...args.create };
      },
    },
  } as never);

  const result = await (service as any).resolveCatalogConnector(null, 'system');

  assert.strictEqual(result.id, 'catalog-connector-1');
  assert.strictEqual(result.status, IntegrationConnectorStatus.healthy);
  assert.strictEqual(connectorUpserts.length, 1);
  assert.strictEqual(statusUpdates.length, 1);
  assert.strictEqual(connectorUpserts[0].create.jobs, undefined);
  assert.strictEqual(jobUpserts[0].where.code, 'JOB-CATALOG-MVP');
  assert.strictEqual(jobUpserts[0].create.connectorId, 'catalog-connector-1');
});

test('onModuleInit bootstraps the default integration registry outside read endpoints', async () => {
  const connectorUpserts: any[] = [];
  const jobUpserts: any[] = [];
  const service = serviceWith({
    integrationConnector: {
      findFirst: async () => null,
      upsert: async (args: any) => {
        connectorUpserts.push(args);
        return {
          id: `connector-${connectorUpserts.length}`,
          code: args.create?.code ?? args.where.code,
          status: IntegrationConnectorStatus.healthy,
          lastError: null,
        };
      },
      update: async (args: any) => ({ id: args.where.id, status: args.data.status, lastError: null }),
    },
    integrationJob: {
      upsert: async (args: any) => {
        jobUpserts.push(args);
        return { id: `job-${jobUpserts.length}`, ...args.create };
      },
    },
  } as never);

  await service.onModuleInit();

  assert.strictEqual(connectorUpserts.length, DEFAULT_INTEGRATION_CONNECTORS.length + 1);
  assert.strictEqual(jobUpserts.length, DEFAULT_INTEGRATION_CONNECTORS.length + 1);
  assert.ok(connectorUpserts.some((args) => args.where.code === 'CATALOG-MVP'));
  assert.ok(jobUpserts.some((args) => args.where.code === 'JOB-CATALOG-MVP'));
});

test('integration summary read does not bootstrap or mutate default connectors', async () => {
  const forbiddenWrite = async () => {
    throw new Error('read endpoint must not bootstrap integration defaults');
  };
  const service = serviceWith({
    integrationConnector: {
      count: async () => 0,
      upsert: forbiddenWrite,
      update: forbiddenWrite,
    },
    dataAsset: { count: async () => 0 },
    integrationImportBatch: { count: async () => 0, findFirst: async () => null },
    integrationImportError: { count: async () => 0 },
    integrationWritebackLog: { count: async () => 0 },
    integrationEvent: { count: async () => 0 },
    integrationReconciliationReport: { count: async () => 0 },
  } as never);

  const result = await service.summary(['system_admin']) as any;

  assert.strictEqual(result.connectors, 0);
  assert.strictEqual(result.lastRunAt, null);
});

test('integration connectors read does not bootstrap or mutate default connectors', async () => {
  const forbiddenWrite = async () => {
    throw new Error('read endpoint must not bootstrap integration defaults');
  };
  const service = serviceWith({
    integrationConnector: {
      findMany: async () => [],
      upsert: forbiddenWrite,
      update: forbiddenWrite,
    },
  } as never);

  const result = await service.connectors(['system_admin']);

  assert.deepStrictEqual(result, []);
});

test('createConnector rejects an adapter that does not match the connector type', async () => {
  const service = serviceWith({
    integrationConnector: {
      create: async () => {
        throw new Error('should not persist incompatible connector');
      },
    },
  } as never);

  await assert.rejects(
    () =>
      service.createConnector(
        {
          code: 'BAD-DQ-CATALOG',
          nameEn: 'Bad DQ catalog adapter',
          nameAr: 'Bad DQ catalog adapter',
          type: 'data_quality',
          adapterType: 'catalog_csv',
        },
        'admin@dgop.local',
      ),
    BadRequestException,
  );
});

test('createConnector persists real external connector config without inline secrets', async () => {
  let createArgs: any;
  const service = serviceWith({
    integrationConnector: {
      create: async (args: any) => {
        createArgs = args;
        return { id: 'connector-real', ...args.data, _count: {} };
      },
    },
  } as never);

  await service.createConnector(
    {
      code: 'CATALOG-REAL',
      nameEn: 'Real Catalog',
      nameAr: 'Real Catalog',
      type: 'catalog',
      adapterType: 'webhook_json',
      sourceTrust: 'authoritative',
      pullUrl: 'https://catalog.example.com/api/assets',
      writebackUrl: 'https://catalog.example.com/api/writeback',
      healthUrl: 'https://catalog.example.com/health',
      authHeaderName: 'Authorization',
      authHeaderValueEnv: 'CATALOG_TOKEN',
      headers: {
        'x-source-system': 'DGOP',
        authorization: 'Bearer must-not-persist',
      },
      timeoutMs: 5000,
    },
    'admin@dgop.local',
  );

  assert.strictEqual(createArgs.data.configJson.adapterType, 'webhook_json');
  assert.strictEqual(createArgs.data.configJson.pullUrl, 'https://catalog.example.com/api/assets');
  assert.strictEqual(createArgs.data.configJson.authHeaderValueEnv, 'CATALOG_TOKEN');
  assert.strictEqual(createArgs.data.configJson.headers['x-source-system'], 'DGOP');
  assert.strictEqual(createArgs.data.configJson.headers.authorization, undefined);
});

test('connectors exposes runtime capabilities but not raw connector config', async () => {
  const service = serviceWith({
    integrationConnector: {
      findMany: async () => [
        {
          ...connector,
          configJson: {
            adapterType: 'webhook_json',
            pullUrl: 'https://catalog.example.com/api/assets',
            writebackUrl: 'https://catalog.example.com/api/writeback',
            authHeaderValueEnv: 'SECRET_ENV',
          },
        },
      ],
    },
    integrationImportBatch: { count: async () => 0 },
    integrationExternalReference: { count: async () => 0 },
    integrationWritebackLog: { count: async () => 0 },
    integrationEvent: { count: async () => 0 },
    integrationReconciliationReport: { count: async () => 0 },
  } as never);

  const result = await service.connectors(['system_admin']) as any[];

  assert.strictEqual(result[0].runtime.mode, 'external_http');
  assert.strictEqual(result[0].runtime.canPull, true);
  assert.strictEqual(result[0].runtime.canWriteback, true);
  assert.strictEqual(result[0].configJson, undefined);
});

test('runCatalogSync pulls catalog rows from a real external connector endpoint', async () => {
  const realConnector = {
    ...connector,
    id: 'connector-real',
    code: 'CATALOG-REAL',
    status: IntegrationConnectorStatus.warning,
    sourceTrust: IntegrationSourceTrust.authoritative,
    configJson: {
      adapterType: 'webhook_json',
      pullUrl: 'https://catalog.example.com/api/assets',
      authHeaderName: 'Authorization',
      authHeaderValueEnv: 'CATALOG_TOKEN',
      headers: { 'x-source-system': 'DGOP' },
    },
  };
  let createdAsset: any;
  let batchCreate: any;
  let fetchedUrl = '';
  let fetchedHeaders: Record<string, string> = {};
  const tx = {
    integrationImportBatch: {
      create: async (args: any) => {
        batchCreate = args.data;
        return { id: 'batch-http' };
      },
      update: async (args: any) => ({ id: 'batch-http', ...args.data, connector: realConnector, errors: [] }),
    },
    integrationImportError: { create: async () => undefined },
    integrationConnector: { update: async () => undefined },
    integrationJob: { updateMany: async () => ({ count: 1 }) },
    integrationExternalReference: {
      findUnique: async () => null,
      upsert: async () => ({ id: 'ref-http' }),
    },
    dataAsset: {
      findUnique: async () => null,
      create: async (args: any) => {
        createdAsset = { id: 'asset-http', ...args.data };
        return createdAsset;
      },
    },
  };
  const prisma = prismaBase(tx) as any;
  prisma.integrationConnector.findFirst = async () => realConnector;
  const auditLog: unknown[] = [];
  const service = serviceWith(prisma, auditLog);
  trustPublicConnectorDns(service);
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchedUrl = String(input);
    fetchedHeaders = init?.headers as Record<string, string>;
    return new Response(
      JSON.stringify({
        assets: [
          {
            externalId: 'EXT-HTTP-1',
            assetCode: 'AST-HTTP-1',
            nameEn: 'HTTP Catalog Asset',
            nameAr: 'HTTP Catalog Asset',
            domainCode: 'finance',
            classificationCode: 'internal',
          },
        ],
      }),
      { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const result = await withEnv('CATALOG_TOKEN', 'Bearer catalog-token', () =>
      service.runCatalogSync(
        ['system_admin'],
        { adapterType: 'webhook_json', connectorId: realConnector.id },
        'admin@dgop.local',
      ),
    ) as any;

    assert.strictEqual(fetchedUrl, 'https://catalog.example.com/api/assets');
    assert.strictEqual(fetchedHeaders.Authorization, 'Bearer catalog-token');
    assert.strictEqual(fetchedHeaders['x-source-system'], 'DGOP');
    assert.strictEqual(createdAsset.code, 'AST-HTTP-1');
    assert.strictEqual(createdAsset.externalCatalogId, 'EXT-HTTP-1');
    assert.strictEqual(batchCreate.sourceName, 'CATALOG-REAL external HTTP');
    assert.strictEqual(result.createdRows, 1);
    assert.ok(auditLog.some((entry: any) => entry.action === 'integration.catalog_sync'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('testConnector runs real health endpoint and updates connector status', async () => {
  const auditLog: unknown[] = [];
  const realConnector = {
    ...connector,
    id: 'connector-health',
    code: 'CATALOG-HEALTH',
    sourceTrust: IntegrationSourceTrust.authoritative,
    configJson: {
      adapterType: 'webhook_json',
      healthUrl: 'https://catalog.example.com/health',
    },
  };
  let statusUpdate: any;
  let fetchedUrl = '';
  const service = serviceWith(
    {
      integrationConnector: {
        findFirst: async () => realConnector,
        update: async (args: any) => {
          statusUpdate = args.data;
          return { ...realConnector, ...args.data };
        },
      },
    } as never,
    auditLog,
  );
  trustPublicConnectorDns(service);
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: RequestInfo | URL) => {
    fetchedUrl = String(input);
    return new Response(null, { status: 204, statusText: 'No Content' });
  };

  try {
    const result = await service.testConnector(realConnector.id, 'admin@dgop.local') as any;

    assert.strictEqual(fetchedUrl, 'https://catalog.example.com/health');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(statusUpdate.status, IntegrationConnectorStatus.healthy);
    assert.strictEqual(statusUpdate.lastError, null);
    assert.ok(auditLog.some((entry: any) => entry.action === 'integration_connector.health_check'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('testConnector rejects public hostnames that resolve to private addresses', async () => {
  const realConnector = {
    ...connector,
    id: 'connector-private-dns',
    code: 'CATALOG-PRIVATE-DNS',
    sourceTrust: IntegrationSourceTrust.authoritative,
    configJson: {
      adapterType: 'webhook_json',
      healthUrl: 'https://catalog.example.com/health',
    },
  };
  const service = serviceWith({
    integrationConnector: {
      findFirst: async () => realConnector,
      update: async () => {
        throw new Error('connector status must not update for rejected DNS targets');
      },
    },
  } as never);
  (service as any).connectorHostAddresses = async () => [{ address: '127.0.0.1', family: 4 }];
  const originalFetch = globalThis.fetch;
  let fetched = false;
  (globalThis as any).fetch = async () => {
    fetched = true;
    return new Response(null, { status: 204 });
  };

  try {
    await assert.rejects(
      () => service.testConnector(realConnector.id, 'admin@dgop.local'),
      BadRequestException,
    );
    assert.strictEqual(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('simulateWriteback sends to configured external catalog instead of only simulating', async () => {
  const asset = {
    id: 'asset-1',
    code: 'AST-1',
    nameEn: 'Revenue Feed',
    nameAr: 'Revenue Feed',
    ownerName: 'Chief Data Owner',
    ownerStatus: 'assigned',
    lifecycleStatus: 'active',
    catalogSyncStatus: DataAssetCatalogSyncStatus.synced,
    domain: { code: 'finance', nameEn: 'Finance', nameAr: 'Finance' },
    classification: { code: 'restricted', nameEn: 'Restricted', nameAr: 'Restricted' },
  };
  const realConnector = {
    ...connector,
    id: 'connector-writeback',
    code: 'CATALOG-WRITEBACK',
    sourceTrust: IntegrationSourceTrust.authoritative,
    configJson: {
      adapterType: 'webhook_json',
      writebackUrl: 'https://catalog.example.com/api/writeback',
      authHeaderName: 'x-api-key',
      authHeaderValueEnv: 'CATALOG_API_KEY',
      headers: { 'x-source-system': 'DGOP' },
    },
  };
  let assetUpdate: any;
  let connectorUpdate: any;
  let writebackCreate: any;
  let fetchedUrl = '';
  let fetchedBody: any;
  let fetchedHeaders: Record<string, string> = {};
  const tx = {
    dataAsset: {
      update: async (args: any) => {
        assetUpdate = args.data;
        return { ...asset, ...args.data };
      },
    },
    integrationConnector: {
      update: async (args: any) => {
        connectorUpdate = args.data;
        return { ...realConnector, ...args.data };
      },
    },
    integrationWritebackLog: {
      create: async (args: any) => {
        writebackCreate = args.data;
        return {
          id: 'writeback-1',
          createdAt: new Date(),
          ...args.data,
          connector: realConnector,
          asset,
        };
      },
    },
  };
  const prisma = prismaBase(tx) as any;
  prisma.integrationConnector.findFirst = async () => realConnector;
  prisma.dataAsset = {
    findFirst: async () => asset,
  };
  const auditLog: unknown[] = [];
  const service = serviceWith(prisma, auditLog);
  trustPublicConnectorDns(service);
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchedUrl = String(input);
    fetchedHeaders = init?.headers as Record<string, string>;
    fetchedBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      statusText: 'Accepted',
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await withEnv('CATALOG_API_KEY', 'secret-key', () =>
      service.simulateWriteback(
        ['system_admin'],
        asset.id,
        { connectorId: realConnector.id },
        'admin@dgop.local',
      ),
    ) as any;

    assert.strictEqual(fetchedUrl, 'https://catalog.example.com/api/writeback');
    assert.strictEqual(fetchedHeaders['x-api-key'], 'secret-key');
    assert.strictEqual(fetchedHeaders['content-type'], 'application/json');
    assert.strictEqual(fetchedBody.assetCode, 'AST-1');
    assert.strictEqual(writebackCreate.simulated, false);
    assert.strictEqual(writebackCreate.status, IntegrationWritebackStatus.sent);
    assert.strictEqual(assetUpdate.catalogSyncStatus, DataAssetCatalogSyncStatus.synced);
    assert.strictEqual(connectorUpdate.status, IntegrationConnectorStatus.healthy);
    assert.strictEqual(result.status, IntegrationWritebackStatus.sent);
    assert.ok(auditLog.some((entry: any) => entry.action === 'integration.catalog_writeback.send'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('receiveWebhook rejects requests when no webhook token is configured', async () => {
  const service = serviceWith({} as never);

  await withEnv('DGOP_WEBHOOK_TOKEN', undefined, async () => {
    await assert.rejects(
      () =>
        service.receiveWebhook('DQ-MOCK', {
          externalEventId: 'DQ-1',
          eventType: 'dq.issue.detected',
          payload: { assetCode: 'AST-1', severity: 'low' },
        }),
      ForbiddenException,
    );
  });
});

test('receiveWebhook rejects requests with a missing or invalid webhook token', async () => {
  const service = serviceWith({} as never);

  await withEnv('DGOP_WEBHOOK_TOKEN', TEST_WEBHOOK_TOKEN, async () => {
    await assert.rejects(
      () =>
        service.receiveWebhook('DQ-MOCK', {
          externalEventId: 'DQ-1',
          eventType: 'dq.issue.detected',
          payload: { assetCode: 'AST-1', severity: 'low' },
        }),
      ForbiddenException,
    );
    await assert.rejects(
      () =>
        service.receiveWebhook(
          'DQ-MOCK',
          {
            externalEventId: 'DQ-1',
            eventType: 'dq.issue.detected',
            payload: { assetCode: 'AST-1', severity: 'low' },
          },
          'wrong-token',
        ),
      ForbiddenException,
    );
  });
});

test('batches scope restricted users to visible asset write-back history and omit raw batch payloads', async () => {
  let findManyArgs: any;
  const service = serviceWith(
    {
      dataAsset: { findMany: async () => [{ id: 'asset-visible' }] },
      integrationImportBatch: {
        findMany: async (args: any) => {
          findManyArgs = args;
          return [];
        },
      },
    },
    [],
    { orgUnits: ['org-1'], domains: 'all', maxClassRank: null },
  );

  await service.batches(['catalog_operator'], 10);

  assert.deepStrictEqual(findManyArgs.where, {
    writebackLogs: { some: { assetId: { in: ['asset-visible'] } } },
  });
  assert.strictEqual(findManyArgs.select.mappingPreviewJson, undefined);
  assert.strictEqual(findManyArgs.select.reconciliationJson, undefined);
});

test('integration list limits reject NaN and clamp extremes before Prisma receives take', async () => {
  const calls: any[] = [];
  const service = serviceWith(
    {
      integrationImportBatch: {
        findMany: async (args: any) => {
          calls.push({ kind: 'batch', take: args.take });
          return [];
        },
      },
      integrationEvent: {
        findMany: async (args: any) => {
          calls.push({ kind: 'event', take: args.take });
          return [];
        },
      },
      integrationReconciliationReport: {
        findMany: async (args: any) => {
          calls.push({ kind: 'reconciliation', take: args.take });
          return [];
        },
      },
    },
    [],
    { orgUnits: 'all', domains: 'all', maxClassRank: null },
  );

  await service.batches(['system_admin'], 'not-a-number');
  await service.events(['system_admin'], undefined, 250);
  await service.reconciliationReports(['system_admin'], 0);

  assert.deepStrictEqual(calls, [
    { kind: 'batch', take: 25 },
    { kind: 'event', take: 100 },
    { kind: 'reconciliation', take: 1 },
  ]);
});

test('events scope restricted users to visible asset-linked events and omit raw event payloads', async () => {
  let findManyArgs: any;
  const service = serviceWith(
    {
      dataAsset: { findMany: async () => [{ id: 'asset-visible' }] },
      integrationEvent: {
        findMany: async (args: any) => {
          findManyArgs = args;
          return [];
        },
      },
    },
    [],
    { orgUnits: ['org-1'], domains: 'all', maxClassRank: null },
  );

  await service.events(['integration_viewer'], 'failed,retry_scheduled', 10);

  assert.strictEqual(findManyArgs.where.entityType, 'data_asset');
  assert.deepStrictEqual(findManyArgs.where.entityId, { in: ['asset-visible'] });
  assert.strictEqual(findManyArgs.select.payloadJson, undefined);
  assert.strictEqual(findManyArgs.select.normalizedJson, undefined);
  assert.strictEqual(findManyArgs.select.resultJson, undefined);
});

test('retryEvent hides out-of-scope integration events from scoped users', async () => {
  let findFirstArgs: any;
  const service = serviceWith(
    {
      dataAsset: { findMany: async () => [{ id: 'asset-visible' }] },
      integrationEvent: {
        findFirst: async (args: any) => {
          findFirstArgs = args;
          return null;
        },
      },
    },
    [],
    { orgUnits: ['org-1'], domains: 'all', maxClassRank: null },
  );

  await assert.rejects(
    () => service.retryEvent(['integration_operator'], 'event-hidden', { reason: 'try hidden event' }, 'operator@dgop.local'),
    /integration event not found/,
  );
  assert.deepStrictEqual(findFirstArgs.where, {
    id: 'event-hidden',
    entityType: 'data_asset',
    entityId: { in: ['asset-visible'] },
  });
});

test('receiveWebhook persists, processes, reconciles, and audits integration events', async () => {
  const auditLog: unknown[] = [];
  const reports: any[] = [];
  let eventRow: any;
  const prisma = {
    integrationConnector: {
      findFirst: async () => ({
        ...connector,
        type: 'data_quality',
        configJson: { adapterType: 'mock_data_quality', defaultEventType: 'dq.issue.detected' },
      }),
    },
    integrationEvent: {
      count: async () => 0,
      findUnique: async (args: any) => {
        if (args.where?.dedupeKey) return null;
        if (args.where?.code) return null;
        if (args.where?.id) return { ...eventRow, connector: { id: connector.id, code: connector.code, type: 'data_quality', configJson: {} } };
        return null;
      },
      create: async (args: any) => {
        eventRow = { id: 'event-1', attempts: 0, maxAttempts: 3, ...args.data };
        return eventRow;
      },
    },
    $transaction: async (fn: (client: unknown) => unknown) =>
      fn({
        integrationEvent: {
          findUnique: async () => ({ ...eventRow, connector: { id: connector.id, code: connector.code, type: 'data_quality', configJson: {} } }),
          update: async (args: any) => {
            eventRow = { ...eventRow, ...args.data, connector };
            return eventRow;
          },
        },
        integrationReconciliationReport: {
          count: async () => reports.length,
          findUnique: async () => null,
          create: async (args: any) => {
            reports.push(args.data);
            return args.data;
          },
        },
        integrationConnector: { update: async () => undefined },
        integrationJob: { updateMany: async () => ({ count: 1 }) },
      }),
  };
  const service = serviceWith(prisma, auditLog);

  const result = await withEnv('DGOP_WEBHOOK_TOKEN', TEST_WEBHOOK_TOKEN, () =>
    service.receiveWebhook(
      'DQ-MOCK',
      {
        externalEventId: 'DQ-1',
        eventType: 'dq.issue.detected',
        payload: {
          assetCode: 'AST-1',
          severity: 'low',
          webhookToken: 'raw-token',
          nested: { authorization: 'Bearer raw-token', apiKey: 'raw-key' },
        },
      },
      TEST_WEBHOOK_TOKEN,
    ),
  ) as any;

  assert.strictEqual(result.status, IntegrationEventStatus.succeeded);
  assert.strictEqual(result.attempts, 1);
  assert.strictEqual(reports.length, 1);
  assert.strictEqual(eventRow.payloadJson.webhookToken, '[REDACTED]');
  assert.strictEqual(eventRow.payloadJson.nested.authorization, '[REDACTED]');
  assert.strictEqual(eventRow.payloadJson.nested.apiKey, '[REDACTED]');
  assert.strictEqual(eventRow.payloadJson.assetCode, 'AST-1');
  assert.strictEqual(eventRow.normalizedJson.raw.webhookToken, '[REDACTED]');
  assert.ok(auditLog.some((entry: any) => entry.action === 'integration.webhook.receive'));
  assert.ok(auditLog.some((entry: any) => entry.action === 'integration.event.process'));
});

test('retryEvent reprocesses retry-scheduled events through the same engine', async () => {
  const auditLog: unknown[] = [];
  const reports: any[] = [];
  let eventRow: any = {
    id: 'event-1',
    code: 'INT-EVT-00001',
    dedupeKey: 'connector-1:dq.issue.detected:DQ-1',
    connectorId: connector.id,
    adapterType: 'mock_data_quality',
    eventType: 'dq.issue.detected',
    payloadJson: { assetCode: 'AST-1' },
    status: IntegrationEventStatus.retry_scheduled,
    attempts: 1,
    maxAttempts: 3,
  };
  const prisma = {
    integrationEvent: {
      findFirst: async () => eventRow,
      findUnique: async () => eventRow,
    },
    $transaction: async (fn: (client: unknown) => unknown) =>
      fn({
        integrationEvent: {
          findUnique: async () => ({ ...eventRow, connector: { id: connector.id, code: connector.code, type: 'data_quality', configJson: {} } }),
          update: async (args: any) => {
            eventRow = { ...eventRow, ...args.data, connector };
            return eventRow;
          },
        },
        integrationReconciliationReport: {
          count: async () => reports.length,
          findUnique: async () => null,
          create: async (args: any) => {
            reports.push(args.data);
            return args.data;
          },
        },
        integrationConnector: { update: async () => undefined },
        integrationJob: { updateMany: async () => ({ count: 1 }) },
      }),
  };
  const service = serviceWith(prisma, auditLog);

  const result = await service.retryEvent(['system_admin'], 'event-1', { reason: 'fixed source payload' }, 'admin@dgop.local') as any;

  assert.strictEqual(result.status, IntegrationEventStatus.succeeded);
  assert.strictEqual(result.attempts, 2);
  assert.strictEqual(reports.length, 1);
  assert.ok(auditLog.some((entry: any) => entry.action === 'integration.event.retry'));
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
