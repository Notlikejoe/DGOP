/**
 * Unit tests for Sprint 15 catalog integration mapping, import, and write-back behavior.
 * Run with: ts-node test/integrations.service.spec.ts
 */
import assert from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import {
  IntegrationConnectorStatus,
  IntegrationDirection,
  IntegrationEventStatus,
  IntegrationSourceTrust,
} from '@prisma/client';
import { IntegrationsService } from '../src/integrations/integrations.service';
import {
  buildCatalogWritebackPayload,
  catalogMappingPreview,
  normalizeIntegrationEventPayload,
  normalizeCatalogAssetRow,
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
    },
    integrationImportBatch: {
      count: async () => 0,
      findUnique: async () => null,
    },
    dataDomain: { findMany: async () => [{ id: 'domain-1', code: 'finance' }] },
    organizationUnit: { findMany: async () => [] },
    systemPlatform: { findMany: async () => [] },
    businessCapability: { findMany: async () => [] },
    classification: { findMany: async () => [{ id: 'class-1', code: 'internal' }] },
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

  const result = await service.receiveWebhook('DQ-MOCK', {
    externalEventId: 'DQ-1',
    eventType: 'dq.issue.detected',
    payload: { assetCode: 'AST-1', severity: 'low' },
  }) as any;

  assert.strictEqual(result.status, IntegrationEventStatus.succeeded);
  assert.strictEqual(result.attempts, 1);
  assert.strictEqual(reports.length, 1);
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
