import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { AppIcon } from '../../../shared/app-icon';

interface Ref {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

interface AssetRef extends Ref {
  externalCatalogId?: string | null;
  catalogSource?: string | null;
  catalogSyncStatus?: string | null;
  catalogWritebackStatus?: string | null;
}

interface IntegrationSummary {
  connectors: number;
  healthyConnectors: number;
  attentionConnectors: number;
  syncedAssets: number;
  batches: number;
  failedBatches: number;
  openErrors: number;
  simulatedWritebacks: number;
  failedEvents: number;
  deadLetterEvents: number;
  retryReadyEvents: number;
  reconciliationReports: number;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
}

interface IntegrationConnector {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  type: string;
  direction: string;
  status: string;
  sourceTrust: string;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  _count?: {
    importBatches: number;
    externalReferences: number;
    writebackLogs: number;
    events: number;
    reconciliationReports: number;
  };
}

interface IntegrationImportError {
  id: string;
  rowNumber: number;
  externalId?: string | null;
  field?: string | null;
  message: string;
  severity: string;
}

interface IntegrationBatch {
  id: string;
  code: string;
  sourceName?: string | null;
  adapterType: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  unchangedRows: number;
  errorRows: number;
  warningRows: number;
  connector: Pick<IntegrationConnector, 'id' | 'code' | 'nameEn' | 'nameAr' | 'status'>;
  errors: IntegrationImportError[];
}

interface MappingPreview {
  totalRows: number;
  fields: {
    target: string;
    source: string | null;
    required: boolean;
    status: 'mapped' | 'missing';
  }[];
  sampleRows: Record<string, string | null>[];
  issues: {
    row: number;
    code: string;
    field?: string | null;
    message: string;
  }[];
}

interface WritebackLog {
  id: string;
  status: string;
  message?: string | null;
  createdAt: string;
  connector: Ref;
  asset: Ref;
}

interface IntegrationEvent {
  id: string;
  code: string;
  eventType: string;
  sourceName?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  status: string;
  severity: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  receivedAt: string;
  processedAt?: string | null;
  connector?: Pick<IntegrationConnector, 'id' | 'code' | 'nameEn' | 'nameAr' | 'status' | 'type'> | null;
}

interface IntegrationReconciliationReport {
  id: string;
  code: string;
  status: string;
  totalRecords: number;
  matchedRecords: number;
  createdRecords: number;
  updatedRecords: number;
  failedRecords: number;
  orphanedRecords: number;
  missingRecords: number;
  createdAt: string;
  connector?: Pick<IntegrationConnector, 'id' | 'code' | 'nameEn' | 'nameAr' | 'status' | 'type'> | null;
  batch?: { id: string; code: string; status: string; totalRows: number; errorRows: number } | null;
  event?: { id: string; code: string; status: string; eventType: string; entityType?: string | null; entityId?: string | null } | null;
}

const ADAPTERS = [
  { value: 'catalog_csv', labelKey: 'integrations.adapter.csv' },
  { value: 'mock_rest', labelKey: 'integrations.adapter.mock' },
] as const;

@Component({
  selector: 'app-integrations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, StatusChip, AppIcon],
  templateUrl: './integrations.html',
  styleUrl: './integrations.scss',
})
export class IntegrationsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly summary = signal<IntegrationSummary | null>(null);
  protected readonly connectors = signal<IntegrationConnector[]>([]);
  protected readonly batches = signal<IntegrationBatch[]>([]);
  protected readonly events = signal<IntegrationEvent[]>([]);
  protected readonly reports = signal<IntegrationReconciliationReport[]>([]);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly selectedConnectorId = signal('');
  protected readonly selectedBatchId = signal('');
  protected readonly selectedErrors = signal<IntegrationImportError[]>([]);
  protected readonly adapterType = signal<'catalog_csv' | 'mock_rest'>('catalog_csv');
  protected readonly csvText = signal('');
  protected readonly csvFileName = signal('');
  protected readonly preview = signal<MappingPreview | null>(null);
  protected readonly running = signal(false);
  protected readonly previewing = signal(false);
  protected readonly selectedWritebackAssetId = signal('');
  protected readonly writeback = signal<WritebackLog | null>(null);
  protected readonly writingBack = signal(false);
  protected readonly retryingEventId = signal('');

  protected readonly adapters = ADAPTERS;

  protected readonly selectedConnector = computed(() => {
    const id = this.selectedConnectorId();
    return this.connectors().find((connector) => connector.id === id) ?? this.connectors()[0] ?? null;
  });

  protected readonly selectedBatch = computed(() => {
    const id = this.selectedBatchId();
    return this.batches().find((batch) => batch.id === id) ?? this.batches()[0] ?? null;
  });

  protected readonly syncedAssets = computed(() =>
    this.assets().filter((asset) => asset.externalCatalogId || asset.catalogSyncStatus === 'synced'),
  );

  ngOnInit(): void {
    this.load();
  }

  protected get canRun(): boolean {
    return this.auth.hasPermission('integrations.run');
  }

  protected get canWriteback(): boolean {
    return this.auth.hasPermission('integrations.writeback');
  }

  protected load(): void {
    this.state.set('loading');
    forkJoin({
      summary: this.http.get<IntegrationSummary>('/api/integrations/summary'),
      connectors: this.http.get<IntegrationConnector[]>('/api/integrations/connectors'),
      batches: this.http.get<IntegrationBatch[]>('/api/integrations/batches'),
      events: this.http.get<IntegrationEvent[]>('/api/integrations/events?status=failed,retry_scheduled,dead_letter&limit=12'),
      reports: this.http.get<IntegrationReconciliationReport[]>('/api/integrations/reconciliation?limit=8'),
      assets: this.http.get<AssetRef[]>('/api/assets'),
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary);
        this.connectors.set(result.connectors);
        this.batches.set(result.batches);
        this.events.set(result.events);
        this.reports.set(result.reports);
        this.assets.set(result.assets);
        this.ensureSelection();
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  private ensureSelection(): void {
    if (!this.selectedConnectorId() && this.connectors().length) {
      this.selectedConnectorId.set(this.connectors()[0].id);
    }
    if (!this.selectedBatchId() && this.batches().length) {
      this.selectBatch(this.batches()[0].id);
    } else if (this.selectedBatchId()) {
      this.loadBatchErrors(this.selectedBatchId());
    }
    if (!this.selectedWritebackAssetId() && this.syncedAssets().length) {
      this.selectedWritebackAssetId.set(this.syncedAssets()[0].id);
    }
  }

  protected selectConnector(id: string): void {
    this.selectedConnectorId.set(id);
  }

  protected selectBatch(id: string): void {
    this.selectedBatchId.set(id);
    this.loadBatchErrors(id);
  }

  private loadBatchErrors(id: string): void {
    this.http.get<IntegrationImportError[]>(`/api/integrations/batches/${id}/errors`).subscribe({
      next: (errors) => this.selectedErrors.set(errors),
      error: () => this.selectedErrors.set([]),
    });
  }

  protected previewMapping(): void {
    if (this.previewing()) return;
    this.previewing.set(true);
    this.http.post<MappingPreview>('/api/integrations/catalog/preview', this.syncBody()).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.previewing.set(false);
      },
      error: (err) => { this.toast.errorFrom(err, this.t('integrations.error'));
        this.previewing.set(false);
      },
    });
  }

  protected runSync(): void {
    if (!this.canRun || this.running()) return;
    this.running.set(true);
    this.http.post<IntegrationBatch>('/api/integrations/catalog/sync', this.syncBody()).subscribe({
      next: (batch) => {
        this.toast.success(this.t('integrations.sync.started'));
        this.running.set(false);
        this.selectedBatchId.set(batch.id);
        this.preview.set(null);
        this.load();
      },
      error: (err) => { this.toast.errorFrom(err, this.t('integrations.error'));
        this.running.set(false);
      },
    });
  }

  protected simulateWriteback(): void {
    const assetId = this.selectedWritebackAssetId();
    if (!assetId || !this.canWriteback || this.writingBack()) return;
    this.writingBack.set(true);
    this.http
      .post<WritebackLog>(`/api/integrations/assets/${assetId}/writeback`, {
        connectorId: this.selectedConnector()?.id ?? null,
      })
      .subscribe({
        next: (result) => {
          this.writeback.set(result);
          this.toast.success(this.t('integrations.writeback.done'));
          this.writingBack.set(false);
          this.load();
        },
        error: (err) => { this.toast.errorFrom(err, this.t('integrations.error'));
          this.writingBack.set(false);
        },
      });
  }

  protected retryEvent(event: IntegrationEvent): void {
    if (!this.canRun || this.retryingEventId()) return;
    this.retryingEventId.set(event.id);
    this.http.post<IntegrationEvent>(`/api/integrations/events/${event.id}/retry`, { reason: 'Manual retry from integration monitor' }).subscribe({
      next: () => {
        this.toast.success(this.t('integrations.events.retryDone'));
        this.retryingEventId.set('');
        this.load();
      },
      error: (err) => { this.toast.errorFrom(err, this.t('integrations.error'));
        this.retryingEventId.set('');
      },
    });
  }

  protected onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.csvFileName.set('');
    this.preview.set(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.toast.error(this.t('integrations.file.invalid'));
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.csvText.set(String(reader.result ?? ''));
      this.csvFileName.set(file.name);
    };
    reader.onerror = () => this.toast.error(this.t('integrations.file.readError'));
    reader.readAsText(file);
  }

  protected clearCsv(input?: HTMLInputElement): void {
    this.csvText.set('');
    this.csvFileName.set('');
    this.preview.set(null);
    if (input) input.value = '';
  }

  protected setAdapter(value: 'catalog_csv' | 'mock_rest'): void {
    this.adapterType.set(value);
    this.preview.set(null);
  }

  protected setCsv(value: string): void {
    this.csvText.set(value);
    this.csvFileName.set('');
    this.preview.set(null);
  }

  private syncBody() {
    return {
      connectorId: this.selectedConnector()?.id ?? null,
      adapterType: this.adapterType(),
      csv: this.adapterType() === 'catalog_csv' ? this.csvText() : null,
      sourceName: this.csvFileName() || null,
    };
  }

  protected canPreviewOrRun(): boolean {
    return this.adapterType() === 'mock_rest' || !!this.csvText().trim();
  }

  protected name(item?: { nameEn?: string; nameAr?: string; code?: string } | null): string {
    if (!item) return '-';
    return this.i18n.lang() === 'ar'
      ? item.nameAr ?? item.nameEn ?? item.code ?? '-'
      : item.nameEn ?? item.nameAr ?? item.code ?? '-';
  }

  protected date(value?: string | null): string {
    return value ? new Date(value).toLocaleString() : '-';
  }

  protected connectorKind(status: string): StatusKind {
    if (status === 'healthy') return 'success';
    if (status === 'warning') return 'warning';
    if (status === 'failed') return 'danger';
    return 'muted';
  }

  protected batchKind(status: string): StatusKind {
    if (status === 'completed') return 'success';
    if (status === 'completed_with_errors') return 'warning';
    if (status === 'failed') return 'danger';
    return 'info';
  }

  protected eventKind(status: string): StatusKind {
    if (status === 'succeeded') return 'success';
    if (status === 'dead_letter' || status === 'failed') return 'danger';
    if (status === 'retry_scheduled') return 'warning';
    return 'info';
  }

  protected reportKind(status: string): StatusKind {
    if (status === 'healthy') return 'success';
    if (status === 'failed') return 'danger';
    return 'warning';
  }

  protected mappingKind(status: string, required: boolean): StatusKind {
    if (status === 'mapped') return 'success';
    return required ? 'danger' : 'muted';
  }

  protected assetStatusKind(status?: string | null): StatusKind {
    if (status === 'synced' || status === 'writeback_simulated') return 'success';
    if (status === 'stale') return 'warning';
    if (status === 'error') return 'danger';
    return 'muted';
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
