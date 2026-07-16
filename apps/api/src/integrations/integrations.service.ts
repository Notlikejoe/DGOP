import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DataAssetCatalogSyncStatus,
  IntegrationAdapterType,
  IntegrationBatchStatus,
  IntegrationConnectorStatus,
  IntegrationConnectorType,
  IntegrationDirection,
  IntegrationEntityType,
  IntegrationEventStatus,
  IntegrationImportErrorSeverity,
  IntegrationJobStatus,
  IntegrationJobType,
  IntegrationReconciliationStatus,
  IntegrationSourceTrust,
  IntegrationWritebackStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import { parseCsv } from '../common/csv';
import {
  buildCatalogWritebackPayload,
  catalogMappingPreview,
  catalogStatusAfterImport,
  DEFAULT_INTEGRATION_CONNECTORS,
  hasBusinessAssetChanges,
  integrationAdapterProfile,
  MOCK_CATALOG_ROWS,
  nextIntegrationEventStatus,
  normalizeIntegrationEventPayload,
  normalizeCatalogAssetRow,
  reconciliationForIntegrationEvent,
  type CatalogRowIssue,
  type IntegrationAdapterKey,
  type NormalizedCatalogAsset,
} from './integrations.logic';
import {
  CreateIntegrationConnectorDto,
  PreviewCatalogMappingDto,
  ReceiveIntegrationWebhookDto,
  RetryIntegrationEventDto,
  RunCatalogSyncDto,
  SimulateWritebackDto,
} from './integrations.dto';

type PrismaWriter = PrismaService | Prisma.TransactionClient;
type LookupRow = { id: string; code: string };
type CatalogSyncResult = {
  counter: 'createdRows' | 'updatedRows' | 'unchangedRows';
  warning?: CatalogRowIssue;
};

const DEFAULT_CATALOG_CONNECTOR_CODE = 'CATALOG-MVP';

const connectorInclude = {
  _count: {
    select: {
      importBatches: true,
      externalReferences: true,
      writebackLogs: true,
      events: true,
      reconciliationReports: true,
    },
  },
};

const batchInclude = {
  connector: { select: { id: true, code: true, nameEn: true, nameAr: true, status: true } },
  errors: {
    select: { id: true, rowNumber: true, externalId: true, field: true, message: true, severity: true, createdAt: true },
    orderBy: { rowNumber: 'asc' as const },
    take: 8,
  },
};

const writebackInclude = {
  connector: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  asset: { select: { id: true, code: true, nameEn: true, nameAr: true } },
};

const eventInclude = {
  connector: { select: { id: true, code: true, nameEn: true, nameAr: true, status: true, type: true } },
};

const reconciliationInclude = {
  connector: { select: { id: true, code: true, nameEn: true, nameAr: true, status: true, type: true } },
  batch: { select: { id: true, code: true, status: true, totalRows: true, errorRows: true } },
  event: { select: { id: true, code: true, status: true, eventType: true, entityType: true, entityId: true } },
};

const EVENT_STATUSES = new Set(Object.values(IntegrationEventStatus));
const ADAPTER_TYPES = new Set<IntegrationAdapterKey>([
  'catalog_csv',
  'mock_rest',
  'webhook_json',
  'mock_data_quality',
  'mock_dlp',
  'mock_open_data',
  'mock_foi',
  'mock_lms',
  'mock_siem',
  'mock_iam_sso',
]);

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private async ensureDefaultMockConnectors(actor = 'system'): Promise<void> {
    for (const definition of DEFAULT_INTEGRATION_CONNECTORS) {
      const existing = await this.prisma.integrationConnector.findUnique({ where: { code: definition.code } });
      if (existing) continue;
      await this.prisma.integrationConnector.create({
        data: {
          code: definition.code,
          nameEn: definition.nameEn,
          nameAr: definition.nameAr,
          description: definition.description,
          type: definition.type as IntegrationConnectorType,
          direction: IntegrationDirection.inbound,
          status: IntegrationConnectorStatus.warning,
          sourceTrust: IntegrationSourceTrust.simulated,
          configJson: {
            adapterType: definition.adapterType,
            defaultEventType: definition.defaultEventType,
            sourceName: definition.sourceName,
          } as Prisma.InputJsonValue,
          createdBy: actor,
          jobs: {
            create: {
              code: `JOB-${definition.code}`,
              nameEn: `${definition.nameEn} event intake`,
              nameAr: `${definition.nameAr} event intake`,
              jobType: IntegrationJobType.signal_ingest,
              status: IntegrationJobStatus.ready,
              syncMode: 'webhook',
              createdBy: actor,
            },
          },
        },
      });
    }
  }

  private connectorAdapterType(connector: { type: IntegrationConnectorType; configJson?: Prisma.JsonValue | null }): IntegrationAdapterKey {
    const configured =
      connector.configJson && typeof connector.configJson === 'object' && !Array.isArray(connector.configJson)
        ? (connector.configJson as Record<string, unknown>)['adapterType']
        : null;
    if (typeof configured === 'string' && ADAPTER_TYPES.has(configured as IntegrationAdapterKey)) {
      return configured as IntegrationAdapterKey;
    }
    const byType: Partial<Record<IntegrationConnectorType, IntegrationAdapterKey>> = {
      [IntegrationConnectorType.catalog]: 'mock_rest',
      [IntegrationConnectorType.data_quality]: 'mock_data_quality',
      [IntegrationConnectorType.dlp]: 'mock_dlp',
      [IntegrationConnectorType.open_data]: 'mock_open_data',
      [IntegrationConnectorType.foi]: 'mock_foi',
      [IntegrationConnectorType.lms]: 'mock_lms',
      [IntegrationConnectorType.siem]: 'mock_siem',
      [IntegrationConnectorType.iam_sso]: 'mock_iam_sso',
    };
    return byType[connector.type] ?? 'webhook_json';
  }

  private connectorDefaultEventType(connector: { configJson?: Prisma.JsonValue | null; type: IntegrationConnectorType }): string {
    const configured =
      connector.configJson && typeof connector.configJson === 'object' && !Array.isArray(connector.configJson)
        ? (connector.configJson as Record<string, unknown>)['defaultEventType']
        : null;
    if (typeof configured === 'string' && configured.trim()) return configured.trim();
    return integrationAdapterProfile(this.connectorAdapterType(connector)).defaultEventType;
  }

  private webhookTokenIsValid(token?: string | null): boolean {
    const expected = process.env.DGOP_WEBHOOK_TOKEN?.trim();
    if (!expected) return process.env.NODE_ENV !== 'production';
    return token === expected;
  }

  private dedupeKey(connectorId: string, externalEventId: string | null | undefined, eventType: string, payload: unknown): string {
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(payload ?? {}))
      .digest('hex')
      .slice(0, 24);
    return [connectorId, eventType, externalEventId?.trim() || payloadHash].join(':');
  }

  private async visibleAssetIds(roleCodes: string[]): Promise<Set<string> | 'all'> {
    const scope = await this.scope.resolve(roleCodes);
    const unrestricted =
      scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
    if (unrestricted) return 'all';
    const where: Prisma.DataAssetWhereInput = { deletedAt: null };
    if (scope.orgUnits !== 'all') where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== 'all') where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [{ classificationId: null }, { classification: { rank: { lte: scope.maxClassRank } } }];
    }
    const assets = await this.prisma.dataAsset.findMany({ where, select: { id: true } });
    return new Set(assets.map((asset) => asset.id));
  }

  private assetIdWhere(assetIds: Set<string> | 'all'): Prisma.DataAssetWhereInput {
    return assetIds === 'all' ? {} : { id: { in: [...assetIds] } };
  }

  private assetRelationWhere(assetIds: Set<string> | 'all'): Record<string, unknown> {
    return assetIds === 'all' ? {} : { assetId: { in: [...assetIds] } };
  }

  private async assertCatalogSyncScope(roleCodes: string[]): Promise<void> {
    if (roleCodes.includes('system_admin') || roleCodes.includes('dmo_admin')) return;
    const scope = await this.scope.resolve(roleCodes);
    const unrestricted =
      scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
    if (!unrestricted) {
      throw new ForbiddenException('Catalog synchronization requires unrestricted data scope');
    }
  }

  private async assertAssetVisible(roleCodes: string[], assetId: string): Promise<void> {
    const assetIds = await this.visibleAssetIds(roleCodes);
    if (assetIds !== 'all' && !assetIds.has(assetId)) {
      throw new NotFoundException('data asset not found');
    }
  }

  async summary(roleCodes: string[]) {
    await this.ensureDefaultMockConnectors();
    const assetIds = await this.visibleAssetIds(roleCodes);
    const [
      connectors,
      healthyConnectors,
      attentionConnectors,
      syncedAssets,
      batches,
      failedBatches,
      openErrors,
      simulatedWritebacks,
      failedEvents,
      deadLetterEvents,
      retryReadyEvents,
      reconciliationReports,
      lastBatch,
    ] =
      await Promise.all([
        this.prisma.integrationConnector.count({ where: { deletedAt: null, isActive: true } }),
        this.prisma.integrationConnector.count({
          where: { deletedAt: null, isActive: true, status: IntegrationConnectorStatus.healthy },
        }),
        this.prisma.integrationConnector.count({
          where: {
            deletedAt: null,
            isActive: true,
            status: { in: [IntegrationConnectorStatus.warning, IntegrationConnectorStatus.failed] },
          },
        }),
        this.prisma.dataAsset.count({
          where: { deletedAt: null, externalCatalogId: { not: null }, ...this.assetIdWhere(assetIds) },
        }),
        this.prisma.integrationImportBatch.count(),
        this.prisma.integrationImportBatch.count({
          where: { status: { in: [IntegrationBatchStatus.completed_with_errors, IntegrationBatchStatus.failed] } },
        }),
        this.prisma.integrationImportError.count({
          where: { severity: IntegrationImportErrorSeverity.error },
        }),
        this.prisma.integrationWritebackLog.count({
          where: { status: IntegrationWritebackStatus.simulated, ...this.assetRelationWhere(assetIds) },
        }),
        this.prisma.integrationEvent.count({
          where: { status: { in: [IntegrationEventStatus.failed, IntegrationEventStatus.retry_scheduled] } },
        }),
        this.prisma.integrationEvent.count({
          where: { status: IntegrationEventStatus.dead_letter },
        }),
        this.prisma.integrationEvent.count({
          where: {
            status: { in: [IntegrationEventStatus.failed, IntegrationEventStatus.retry_scheduled] },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
          },
        }),
        this.prisma.integrationReconciliationReport.count({
          where: { status: { in: [IntegrationReconciliationStatus.review, IntegrationReconciliationStatus.failed] } },
        }),
        this.prisma.integrationImportBatch.findFirst({
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true, completedAt: true, status: true },
        }),
      ]);
    return {
      connectors,
      healthyConnectors,
      attentionConnectors,
      syncedAssets,
      batches,
      failedBatches,
      openErrors,
      simulatedWritebacks,
      failedEvents,
      deadLetterEvents,
      retryReadyEvents,
      reconciliationReports,
      lastRunAt: lastBatch?.completedAt ?? lastBatch?.startedAt ?? null,
      lastRunStatus: lastBatch?.status ?? null,
    };
  }

  async connectors(_roleCodes: string[]) {
    await this.ensureDefaultMockConnectors();
    return this.prisma.integrationConnector.findMany({
      where: { deletedAt: null },
      include: connectorInclude,
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }

  async batches(_roleCodes: string[], limit = 25) {
    return this.prisma.integrationImportBatch.findMany({
      include: batchInclude,
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async batchErrors(_roleCodes: string[], batchId: string) {
    const batch = await this.prisma.integrationImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('integration import batch not found');
    return this.prisma.integrationImportError.findMany({
      where: { batchId },
      select: { id: true, batchId: true, rowNumber: true, externalId: true, field: true, message: true, severity: true, createdAt: true },
      orderBy: [{ rowNumber: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async events(_roleCodes: string[], status?: string, limit = 25) {
    const statuses = (status ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is IntegrationEventStatus => EVENT_STATUSES.has(value as IntegrationEventStatus));
    return this.prisma.integrationEvent.findMany({
      where: statuses.length ? { status: { in: statuses } } : {},
      include: eventInclude,
      orderBy: [{ status: 'asc' }, { receivedAt: 'desc' }],
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async reconciliationReports(_roleCodes: string[], limit = 20) {
    return this.prisma.integrationReconciliationReport.findMany({
      include: reconciliationInclude,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async receiveWebhook(connectorCode: string, dto: ReceiveIntegrationWebhookDto, token?: string | null) {
    if (!this.webhookTokenIsValid(token)) {
      throw new ForbiddenException('Invalid integration webhook token');
    }
    const connector = await this.prisma.integrationConnector.findFirst({
      where: { code: connectorCode, deletedAt: null, isActive: true },
    });
    if (!connector) throw new NotFoundException('integration connector not found');
    const adapterType = this.connectorAdapterType(connector);
    const eventType = dto.eventType?.trim() || this.connectorDefaultEventType(connector);
    const payload = dto.payload ?? {};
    const normalization = normalizeIntegrationEventPayload(adapterType, eventType, {
      ...payload,
      externalEventId: dto.externalEventId ?? (payload as Record<string, unknown>)['externalEventId'],
    });
    const dedupeKey = this.dedupeKey(
      connector.id,
      dto.externalEventId ?? normalization.normalized.externalId,
      eventType,
      payload,
    );
    const existing = await this.prisma.integrationEvent.findUnique({
      where: { dedupeKey },
      include: eventInclude,
    });
    if (existing) return existing;

    const event = await this.prisma.integrationEvent.create({
      data: {
        code: await this.nextEventCode(),
        dedupeKey,
        connectorId: connector.id,
        adapterType: adapterType as IntegrationAdapterType,
        eventType,
        sourceName: dto.sourceName ?? normalization.normalized.sourceSystem ?? connector.code,
        externalEventId: dto.externalEventId ?? normalization.normalized.externalId,
        entityType: dto.entityType ?? null,
        entityId: dto.entityId ?? null,
        status: IntegrationEventStatus.queued,
        severity: normalization.normalized.severity as IntegrationImportErrorSeverity,
        payloadJson: payload as Prisma.InputJsonValue,
        actor: 'webhook',
      },
    });
    await this.audit.log({
      actor: 'webhook',
      action: 'integration.webhook.receive',
      entityType: 'integration_event',
      entityId: event.id,
      metadata: { connectorCode: connector.code, eventType, adapterType },
    });
    return this.processIntegrationEvent(event.id, 'webhook');
  }

  async retryEvent(_roleCodes: string[], id: string, dto: RetryIntegrationEventDto, actor: string) {
    const event = await this.prisma.integrationEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('integration event not found');
    const retryableStatuses: IntegrationEventStatus[] = [
      IntegrationEventStatus.failed,
      IntegrationEventStatus.retry_scheduled,
      IntegrationEventStatus.dead_letter,
    ];
    if (!retryableStatuses.includes(event.status)) {
      throw new BadRequestException('Only failed or queued-for-retry integration events can be retried');
    }
    await this.audit.log({
      actor,
      action: 'integration.event.retry',
      entityType: 'integration_event',
      entityId: id,
      metadata: { reason: dto.reason ?? null, previousStatus: event.status },
    });
    return this.processIntegrationEvent(id, actor, dto.reason ?? null);
  }

  async createConnector(dto: CreateIntegrationConnectorDto, actor: string) {
    const type = (dto.type ?? IntegrationConnectorType.catalog) as IntegrationConnectorType;
    const adapterType = (dto.adapterType ?? (type === IntegrationConnectorType.catalog ? 'catalog_csv' : 'webhook_json')) as IntegrationAdapterKey;
    const connector = await this.prisma.integrationConnector.create({
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description ?? null,
        type,
        direction: (dto.direction ?? IntegrationDirection.bidirectional) as IntegrationDirection,
        status: IntegrationConnectorStatus.warning,
        sourceTrust: (dto.sourceTrust ?? IntegrationSourceTrust.authoritative) as IntegrationSourceTrust,
        configJson: {
          adapterType,
          defaultEventType: integrationAdapterProfile(adapterType).defaultEventType,
        } as Prisma.InputJsonValue,
        createdBy: actor,
      },
      include: connectorInclude,
    });
    await this.audit.log({
      actor,
      action: 'integration_connector.create',
      entityType: 'integration_connector',
      entityId: connector.id,
      metadata: { code: connector.code },
    });
    return connector;
  }

  async previewCatalog(dto: PreviewCatalogMappingDto) {
    const rows = this.rowsFromAdapter(dto.adapterType, dto.csv);
    if (!rows.length) throw new BadRequestException('Catalog source has no data rows');
    return catalogMappingPreview(rows);
  }

  async runCatalogSync(roleCodes: string[], dto: RunCatalogSyncDto, actor: string) {
    await this.assertCatalogSyncScope(roleCodes);
    const rows = this.rowsFromAdapter(dto.adapterType, dto.csv);
    if (!rows.length) throw new BadRequestException('Catalog source has no data rows');

    const connector = await this.resolveCatalogConnector(dto.connectorId, actor);
    const preview = catalogMappingPreview(rows);
    const refs = await this.referenceMaps();
    const now = new Date();
    const batchCode = await this.nextBatchCode();

    const batch = await this.prisma.$transaction(async (tx) => {
      const createdBatch = await tx.integrationImportBatch.create({
        data: {
          code: batchCode,
          connectorId: connector.id,
          sourceName: dto.sourceName ?? (dto.adapterType === 'mock_rest' ? 'Mock catalog REST' : 'Catalog CSV'),
          adapterType: dto.adapterType as IntegrationAdapterType,
          status: IntegrationBatchStatus.running,
          triggeredBy: actor,
          totalRows: rows.length,
          mappingPreviewJson: preview as unknown as Prisma.InputJsonValue,
        },
      });

      const counters = {
        createdRows: 0,
        updatedRows: 0,
        unchangedRows: 0,
        errorRows: 0,
        warningRows: 0,
      };

      for (let index = 0; index < rows.length; index++) {
        const rowNumber = index + 2;
        const normalized = normalizeCatalogAssetRow(rows[index], rowNumber);
        if (!normalized.asset) {
          counters.errorRows++;
          await this.recordIssues(tx, createdBatch.id, rows[index], normalized.issues);
          continue;
        }
        const resolved = await this.resolveAssetReferences(normalized.asset, refs, rowNumber);
        if (resolved.issues.length) {
          counters.errorRows++;
          await this.recordIssues(tx, createdBatch.id, rows[index], resolved.issues);
          continue;
        }
        try {
          const result = await this.upsertAssetFromCatalog(
            tx,
            connector.id,
            connector.code,
            connector.sourceTrust,
            normalized.asset,
            resolved.ids,
            now,
            rowNumber,
          );
          counters[result.counter]++;
          if (result.warning) {
            counters.warningRows++;
            await this.recordIssues(tx, createdBatch.id, rows[index], [result.warning], IntegrationImportErrorSeverity.warning);
          }
        } catch (err) {
          counters.errorRows++;
          await this.recordIssues(tx, createdBatch.id, rows[index], [
            {
              row: rowNumber,
              code: 'row_rejected',
              message: (err as Error).message,
              params: { message: (err as Error).message },
            },
          ]);
        }
      }

      const status =
        counters.errorRows > 0
          ? IntegrationBatchStatus.completed_with_errors
          : IntegrationBatchStatus.completed;
      const connectorStatus =
        status === IntegrationBatchStatus.completed
          ? IntegrationConnectorStatus.healthy
          : IntegrationConnectorStatus.warning;

      await tx.integrationConnector.update({
        where: { id: connector.id },
        data: {
          status: connectorStatus,
          lastRunAt: now,
          lastSuccessAt: status === IntegrationBatchStatus.completed ? now : connector.lastSuccessAt,
          lastError: counters.errorRows > 0 ? `${counters.errorRows} catalog rows need review` : null,
        },
      });
      await tx.integrationJob.updateMany({
        where: { connectorId: connector.id, jobType: IntegrationJobType.catalog_sync, deletedAt: null },
        data: {
          status: status as unknown as IntegrationJobStatus,
          lastRunAt: now,
          lastSuccessAt: status === IntegrationBatchStatus.completed ? now : undefined,
          lastError: counters.errorRows > 0 ? `${counters.errorRows} catalog rows need review` : null,
        },
      });
      const updatedBatch = await tx.integrationImportBatch.update({
        where: { id: createdBatch.id },
        data: {
          ...counters,
          status,
          completedAt: now,
          reconciliationJson: {
            created: counters.createdRows,
            updated: counters.updatedRows,
            unchanged: counters.unchangedRows,
            errors: counters.errorRows,
            catalogStatus: catalogStatusAfterImport(counters.errorRows),
          } as Prisma.InputJsonValue,
        },
        include: batchInclude,
      });
      await this.createReconciliationReport(tx, {
        connectorId: connector.id,
        batchId: updatedBatch.id,
        status:
          status === IntegrationBatchStatus.completed
            ? IntegrationReconciliationStatus.healthy
            : IntegrationReconciliationStatus.review,
        totalRecords: rows.length,
        matchedRecords: counters.createdRows + counters.updatedRows + counters.unchangedRows,
        createdRecords: counters.createdRows,
        updatedRecords: counters.updatedRows,
        failedRecords: counters.errorRows,
        orphanedRecords: 0,
        missingRecords: counters.errorRows,
        summaryJson: {
          batchCode: updatedBatch.code,
          created: counters.createdRows,
          updated: counters.updatedRows,
          unchanged: counters.unchangedRows,
          errors: counters.errorRows,
          warnings: counters.warningRows,
        },
        createdBy: actor,
      });
      return updatedBatch;
    });

    await this.audit.log({
      actor,
      action: 'integration.catalog_sync',
      entityType: 'integration_import_batch',
      entityId: batch.id,
      metadata: {
        connectorCode: connector.code,
        status: batch.status,
        totalRows: batch.totalRows,
        createdRows: batch.createdRows,
        updatedRows: batch.updatedRows,
        errorRows: batch.errorRows,
      },
    });
    return batch;
  }

  async simulateWriteback(roleCodes: string[], assetId: string, dto: SimulateWritebackDto, actor: string) {
    await this.assertAssetVisible(roleCodes, assetId);
    const connector = await this.resolveCatalogConnector(dto.connectorId, actor);
    const asset = await this.prisma.dataAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: {
        domain: { select: { code: true, nameEn: true, nameAr: true } },
        classification: { select: { code: true, nameEn: true, nameAr: true } },
      },
    });
    if (!asset) throw new NotFoundException('data asset not found');
    const payload = buildCatalogWritebackPayload(asset);
    const log = await this.prisma.$transaction(async (tx) => {
      await tx.dataAsset.update({
        where: { id: asset.id },
        data: {
          catalogSource: connector.code,
          catalogSyncStatus: DataAssetCatalogSyncStatus.writeback_simulated,
          catalogWritebackStatus: IntegrationWritebackStatus.simulated,
          catalogLastSyncedAt: new Date(),
        },
      });
      return tx.integrationWritebackLog.create({
        data: {
          connectorId: connector.id,
          assetId: asset.id,
          status: IntegrationWritebackStatus.simulated,
          simulated: true,
          payloadJson: payload as Prisma.InputJsonValue,
          resultJson: {
            accepted: true,
            simulated: true,
            target: connector.code,
            message: dto.message ?? 'Certified owner, steward, and governance status prepared for catalog write-back.',
          } as Prisma.InputJsonValue,
          message: dto.message ?? 'Write-back simulation completed.',
          actor,
        },
        include: writebackInclude,
      });
    });
    await this.audit.log({
      actor,
      action: 'integration.catalog_writeback.simulate',
      entityType: 'data_asset',
      entityId: asset.id,
      metadata: { connectorCode: connector.code, assetCode: asset.code },
    });
    return log;
  }

  private async processIntegrationEvent(id: string, actor: string, retryReason?: string | null) {
    const processed = await this.prisma.$transaction(async (tx) => {
      const event = await tx.integrationEvent.findUnique({
        where: { id },
        include: { connector: { select: { id: true, code: true, type: true, configJson: true } } },
      });
      if (!event) throw new NotFoundException('integration event not found');
      const adapterType = event.adapterType as IntegrationAdapterKey;
      const normalization = normalizeIntegrationEventPayload(adapterType, event.eventType, event.payloadJson);
      const next = nextIntegrationEventStatus({
        accepted: normalization.accepted,
        currentAttempts: event.attempts,
        maxAttempts: event.maxAttempts,
      });
      const now = new Date();
      const lastError = normalization.accepted
        ? null
        : normalization.issues.map((issue) => issue.message).join('; ');
      const nextRetryAt = next.delayMinutes == null ? null : new Date(now.getTime() + next.delayMinutes * 60_000);
      const resultJson = {
        accepted: normalization.accepted,
        retryReason: retryReason ?? null,
        issues: normalization.issues,
        nextStatus: next.status,
      } as unknown as Prisma.InputJsonValue;
      const updated = await tx.integrationEvent.update({
        where: { id },
        data: {
          status: next.status as IntegrationEventStatus,
          attempts: next.attempts,
          severity: normalization.normalized.severity as IntegrationImportErrorSeverity,
          normalizedJson: normalization.normalized as unknown as Prisma.InputJsonValue,
          resultJson,
          lastError,
          nextRetryAt,
          processedAt: next.status === IntegrationEventStatus.succeeded ? now : null,
          deadLetteredAt: next.status === IntegrationEventStatus.dead_letter ? now : null,
        },
        include: eventInclude,
      });
      const reconciliation = reconciliationForIntegrationEvent({
        accepted: normalization.accepted,
        issues: normalization.issues,
        created: normalization.accepted && event.attempts === 0,
        updated: normalization.accepted && event.attempts > 0,
      });
      await this.createReconciliationReport(tx, {
        connectorId: event.connectorId,
        eventId: event.id,
        status:
          next.status === IntegrationEventStatus.dead_letter
            ? IntegrationReconciliationStatus.failed
            : (reconciliation.status as IntegrationReconciliationStatus),
        totalRecords: reconciliation.totalRecords,
        matchedRecords: reconciliation.matchedRecords,
        createdRecords: reconciliation.createdRecords,
        updatedRecords: reconciliation.updatedRecords,
        failedRecords: reconciliation.failedRecords,
        orphanedRecords: reconciliation.orphanedRecords,
        missingRecords: reconciliation.missingRecords,
        summaryJson: {
          eventCode: event.code,
          eventType: event.eventType,
          subject: normalization.normalized.subject,
          issues: normalization.issues,
        },
        createdBy: actor,
      });
      if (event.connectorId) {
        const connectorStatus =
          next.status === IntegrationEventStatus.succeeded
            ? IntegrationConnectorStatus.healthy
            : next.status === IntegrationEventStatus.dead_letter
              ? IntegrationConnectorStatus.failed
              : IntegrationConnectorStatus.warning;
        const jobStatus =
          next.status === IntegrationEventStatus.succeeded
            ? IntegrationJobStatus.completed
            : next.status === IntegrationEventStatus.dead_letter
              ? IntegrationJobStatus.failed
              : IntegrationJobStatus.completed_with_errors;
        await tx.integrationConnector.update({
          where: { id: event.connectorId },
          data: {
            status: connectorStatus,
            lastRunAt: now,
            lastSuccessAt: next.status === IntegrationEventStatus.succeeded ? now : undefined,
            lastError: lastError ?? null,
          },
        });
        await tx.integrationJob.updateMany({
          where: { connectorId: event.connectorId, jobType: IntegrationJobType.signal_ingest, deletedAt: null },
          data: {
            status: jobStatus,
            lastRunAt: now,
            lastSuccessAt: next.status === IntegrationEventStatus.succeeded ? now : undefined,
            lastError: lastError ?? null,
          },
        });
      }
      return updated;
    });

    await this.audit.log({
      actor,
      action:
        processed.status === IntegrationEventStatus.succeeded
          ? 'integration.event.process'
          : processed.status === IntegrationEventStatus.dead_letter
            ? 'integration.event.dead_letter'
            : 'integration.event.retry_scheduled',
      entityType: 'integration_event',
      entityId: processed.id,
      metadata: {
        code: processed.code,
        connectorCode: processed.connector?.code ?? null,
        status: processed.status,
        attempts: processed.attempts,
      },
    });
    return processed;
  }

  private rowsFromAdapter(adapterType: string, csv?: string | null): Record<string, string>[] {
    if (adapterType === 'mock_rest') return MOCK_CATALOG_ROWS;
    if (!csv?.trim()) throw new BadRequestException('Catalog CSV is required');
    return parseCsv(csv);
  }

  private async resolveCatalogConnector(connectorId: string | null | undefined, actor: string) {
    if (connectorId) {
      const connector = await this.prisma.integrationConnector.findFirst({
        where: { id: connectorId, deletedAt: null, type: IntegrationConnectorType.catalog },
      });
      if (!connector) throw new BadRequestException('Catalog connector not found');
      return connector;
    }
    const existing = await this.prisma.integrationConnector.findFirst({
      where: { code: DEFAULT_CATALOG_CONNECTOR_CODE, deletedAt: null },
    });
    if (existing) return existing;
    return this.prisma.integrationConnector.create({
      data: {
        code: DEFAULT_CATALOG_CONNECTOR_CODE,
        nameEn: 'Enterprise Catalog',
        nameAr: 'Enterprise Catalog',
        description: 'Default Sprint 15 catalog connector for CSV and mock REST synchronization.',
        type: IntegrationConnectorType.catalog,
        direction: IntegrationDirection.bidirectional,
        status: IntegrationConnectorStatus.warning,
        sourceTrust: IntegrationSourceTrust.authoritative,
        createdBy: actor,
        jobs: {
          create: {
            code: 'JOB-CATALOG-MVP',
            nameEn: 'Catalog asset synchronization',
            nameAr: 'Catalog asset synchronization',
            jobType: IntegrationJobType.catalog_sync,
            status: IntegrationJobStatus.ready,
            syncMode: 'manual',
            createdBy: actor,
          },
        },
      },
    });
  }

  private async nextBatchCode(): Promise<string> {
    const count = await this.prisma.integrationImportBatch.count();
    for (let i = 1; i <= 50; i++) {
      const code = `INT-BAT-${String(count + i).padStart(4, '0')}`;
      const exists = await this.prisma.integrationImportBatch.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `INT-BAT-${Date.now()}`;
  }

  private async nextEventCode(): Promise<string> {
    const count = await this.prisma.integrationEvent.count();
    for (let i = 1; i <= 50; i++) {
      const code = `INT-EVT-${String(count + i).padStart(5, '0')}`;
      const exists = await this.prisma.integrationEvent.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `INT-EVT-${Date.now()}`;
  }

  private async nextReconciliationCode(client: PrismaWriter): Promise<string> {
    const count = await client.integrationReconciliationReport.count();
    for (let i = 1; i <= 50; i++) {
      const code = `INT-REC-${String(count + i).padStart(5, '0')}`;
      const exists = await client.integrationReconciliationReport.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `INT-REC-${Date.now()}`;
  }

  private async createReconciliationReport(
    client: PrismaWriter,
    data: {
      connectorId?: string | null;
      batchId?: string | null;
      eventId?: string | null;
      status: IntegrationReconciliationStatus;
      totalRecords: number;
      matchedRecords: number;
      createdRecords: number;
      updatedRecords: number;
      failedRecords: number;
      orphanedRecords: number;
      missingRecords: number;
      summaryJson?: Record<string, unknown> | null;
      createdBy: string;
    },
  ) {
    return client.integrationReconciliationReport.create({
      data: {
        code: await this.nextReconciliationCode(client),
        connectorId: data.connectorId ?? null,
        batchId: data.batchId ?? null,
        eventId: data.eventId ?? null,
        status: data.status,
        totalRecords: data.totalRecords,
        matchedRecords: data.matchedRecords,
        createdRecords: data.createdRecords,
        updatedRecords: data.updatedRecords,
        failedRecords: data.failedRecords,
        orphanedRecords: data.orphanedRecords,
        missingRecords: data.missingRecords,
        summaryJson: (data.summaryJson ?? undefined) as Prisma.InputJsonValue | undefined,
        createdBy: data.createdBy,
      },
    });
  }

  private async referenceMaps() {
    const [domains, orgUnits, systems, capabilities, classifications] = await Promise.all([
      this.prisma.dataDomain.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
      this.prisma.organizationUnit.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
      this.prisma.systemPlatform.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
      this.prisma.businessCapability.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
      this.prisma.classification.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
    ]);
    const byCode = (rows: LookupRow[]) => new Map(rows.map((row) => [row.code.toLowerCase(), row.id]));
    return {
      domains: byCode(domains),
      orgUnits: byCode(orgUnits),
      systems: byCode(systems),
      capabilities: byCode(capabilities),
      classifications: byCode(classifications),
    };
  }

  private async resolveAssetReferences(
    asset: NormalizedCatalogAsset,
    refs: Awaited<ReturnType<IntegrationsService['referenceMaps']>>,
    rowNumber: number,
  ) {
    const issues: CatalogRowIssue[] = [];
    const resolve = (map: Map<string, string>, field: string, value: string | null): string | null => {
      if (!value) return null;
      const id = map.get(value.toLowerCase());
      if (!id) {
        issues.push({
          row: rowNumber,
          code: 'row_rejected',
          field,
          message: `Unknown ${field}: ${value}`,
          params: { field, value },
        });
        return null;
      }
      return id;
    };
    return {
      issues,
      ids: {
        domainId: resolve(refs.domains, 'domainCode', asset.domainCode),
        orgUnitId: resolve(refs.orgUnits, 'orgUnitCode', asset.orgUnitCode),
        systemId: resolve(refs.systems, 'systemCode', asset.systemCode),
        capabilityId: resolve(refs.capabilities, 'capabilityCode', asset.capabilityCode),
        classificationId: resolve(refs.classifications, 'classificationCode', asset.classificationCode),
      },
    };
  }

  private async recordIssues(
    tx: Prisma.TransactionClient,
    batchId: string,
    row: Record<string, string>,
    issues: CatalogRowIssue[],
    severity: IntegrationImportErrorSeverity = IntegrationImportErrorSeverity.error,
  ) {
    for (const issue of issues) {
      await tx.integrationImportError.create({
        data: {
          batchId,
          rowNumber: issue.row,
          externalId: row['externalid'] || row['external_id'] || row['catalogid'] || row['code'] || null,
          field: issue.field ?? null,
          message: issue.message,
          severity,
          rawRowJson: severity === IntegrationImportErrorSeverity.error ? (row as Prisma.InputJsonValue) : undefined,
        },
      });
    }
  }

  private async upsertAssetFromCatalog(
    tx: Prisma.TransactionClient,
    connectorId: string,
    connectorCode: string,
    sourceTrust: IntegrationSourceTrust,
    asset: NormalizedCatalogAsset,
    ids: {
      domainId: string | null;
      orgUnitId: string | null;
      systemId: string | null;
      capabilityId: string | null;
      classificationId: string | null;
    },
    now: Date,
    rowNumber: number,
  ): Promise<CatalogSyncResult> {
    const existingRef = await tx.integrationExternalReference.findUnique({
      where: {
        connectorId_externalId_entityType: {
          connectorId,
          externalId: asset.externalId,
          entityType: IntegrationEntityType.data_asset,
        },
      },
    });
    const existingByRef = existingRef?.assetId
      ? await tx.dataAsset.findFirst({ where: { id: existingRef.assetId, deletedAt: null } })
      : null;
    const existing = existingByRef ?? (await tx.dataAsset.findUnique({ where: { code: asset.code } }));
    const data = {
      code: asset.code,
      nameEn: asset.nameEn,
      nameAr: asset.nameAr,
      description: asset.description,
      lifecycleStatus: asset.lifecycleStatus,
      ownerName: asset.ownerName,
      ownerStatus: asset.ownerName ? 'assigned' : 'unassigned',
      domainId: ids.domainId,
      orgUnitId: ids.orgUnitId,
      systemId: ids.systemId,
      capabilityId: ids.capabilityId,
      classificationId: ids.classificationId,
      externalCatalogId: asset.externalId,
      catalogSource: connectorCode,
      catalogSyncStatus: DataAssetCatalogSyncStatus.synced,
      catalogTrustLevel: sourceTrust,
      catalogLastSyncedAt: now,
      deletedAt: null,
      isActive: true,
    };
    const changed = hasBusinessAssetChanges(existing as Record<string, unknown> | null, data);
    const saved = existing
      ? await tx.dataAsset.update({
          where: { id: existing.id },
          data: {
            externalCatalogId: asset.externalId,
            catalogSource: connectorCode,
            catalogSyncStatus: changed
              ? DataAssetCatalogSyncStatus.stale
              : DataAssetCatalogSyncStatus.synced,
            catalogTrustLevel: sourceTrust,
            catalogLastSyncedAt: now,
            deletedAt: null,
            isActive: true,
          },
        })
      : await tx.dataAsset.create({ data });
    await tx.integrationExternalReference.upsert({
      where: {
        connectorId_externalId_entityType: {
          connectorId,
          externalId: asset.externalId,
          entityType: IntegrationEntityType.data_asset,
        },
      },
      update: {
        entityId: saved.id,
        assetId: saved.id,
        sourceTrust,
        syncStatus: changed ? DataAssetCatalogSyncStatus.stale : DataAssetCatalogSyncStatus.synced,
        lastSeenAt: now,
      },
      create: {
        connectorId,
        externalId: asset.externalId,
        entityType: IntegrationEntityType.data_asset,
        entityId: saved.id,
        assetId: saved.id,
        sourceTrust,
        syncStatus: DataAssetCatalogSyncStatus.synced,
        lastSeenAt: now,
      },
    });
    if (!existing) return { counter: 'createdRows' };
    return changed
      ? {
          counter: 'updatedRows',
          warning: {
            row: rowNumber,
            code: 'row_rejected',
            message: 'Catalog row has business metadata changes; existing governed asset was not overwritten.',
            params: { assetCode: asset.code },
          },
        }
      : { counter: 'unchangedRows' };
  }
}
