import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface Ref { id: string; code: string; nameEn: string; nameAr: string; }
interface AssetRef extends Ref {
  domain?: Ref | null;
  classification?: (Ref & { color: string }) | null;
}

interface DqSummary {
  total: number;
  open: number;
  critical: number;
  overdue: number;
  closed: number;
  closureRate: number;
}

interface DqEvidence {
  id: string;
  action: string;
  note?: string | null;
  actor: string;
  createdAt: string;
}

interface DqIssue {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  severity: string;
  dimension: string;
  status: string;
  dueDate?: string | null;
  resolutionSummary?: string | null;
  asset?: AssetRef | null;
  responsiblePerson?: { id: string; fullNameEn: string; fullNameAr: string; email?: string | null } | null;
  workflowCase?: { id: string; code: string; title: string; status: string } | null;
  evidence: DqEvidence[];
}

interface IssueDraft {
  title: string;
  description: string;
  assetId: string;
  severity: string;
  dimension: string;
  dueDate: string;
}

const STATUSES = ['open', 'triaged', 'in_progress', 'resolved', 'closed', 'cancelled'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const DIMENSIONS = ['completeness', 'accuracy', 'validity', 'consistency', 'timeliness', 'uniqueness'];

const SAMPLE_CSV = `title,description,severity,dimension,assetCode,dueDate
Missing supplier tax number,Required tax number is empty for a subset of supplier invoices,high,completeness,AST-FIN-INVOICES,`;

@Component({
  selector: 'app-data-quality',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip, RouterLink],
  templateUrl: './data-quality.html',
  styleUrl: './data-quality.scss',
})
export class DataQualityPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly summary = signal<DqSummary | null>(null);
  protected readonly issues = signal<DqIssue[]>([]);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly selectedId = signal<string | null>(null);

  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly severity = signal('');
  protected readonly dimension = signal('');

  protected readonly createOpen = signal(false);
  protected readonly importOpen = signal(false);
  protected readonly closeTarget = signal<DqIssue | null>(null);
  protected readonly saving = signal(false);
  protected readonly importing = signal(false);
  protected readonly importCsv = signal('');
  protected readonly importResult = signal<{ processed: number; created: number; errors: { row: number; message: string }[] } | null>(null);
  protected readonly resolutionSummary = signal('');
  protected readonly draft = signal<IssueDraft>(this.emptyDraft());

  protected readonly statuses = STATUSES;
  protected readonly severities = SEVERITIES;
  protected readonly dimensions = DIMENSIONS;

  protected readonly selected = computed(() => {
    const id = this.selectedId();
    return this.issues().find((i) => i.id === id) ?? this.issues()[0] ?? null;
  });

  ngOnInit(): void {
    this.load();
    this.loadAssets();
  }

  protected get canCreate(): boolean { return this.auth.hasPermission('data_quality_issues.create'); }
  protected get canEdit(): boolean { return this.auth.hasPermission('data_quality_issues.edit'); }
  protected get canImport(): boolean { return this.auth.hasPermission('data_quality_issues.import'); }

  protected load(): void {
    this.state.set('loading');
    this.http.get<DqSummary>('/api/data-quality/summary').subscribe({
      next: (s) => this.summary.set(s),
      error: () => this.summary.set(null),
    });
    let params = new HttpParams();
    if (this.search()) params = params.set('search', this.search());
    if (this.status()) params = params.set('status', this.status());
    if (this.severity()) params = params.set('severity', this.severity());
    if (this.dimension()) params = params.set('dimension', this.dimension());
    this.http.get<DqIssue[]>('/api/data-quality/issues', { params }).subscribe({
      next: (rows) => {
        this.issues.set(rows);
        if (!this.selectedId() && rows.length) this.selectedId.set(rows[0].id);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  private loadAssets(): void {
    this.http.get<AssetRef[]>('/api/assets').subscribe({
      next: (rows) => this.assets.set(rows),
      error: () => this.assets.set([]),
    });
  }

  protected setFilter(kind: 'search' | 'status' | 'severity' | 'dimension', value: string): void {
    if (kind === 'search') this.search.set(value);
    if (kind === 'status') this.status.set(value);
    if (kind === 'severity') this.severity.set(value);
    if (kind === 'dimension') this.dimension.set(value);
    this.load();
  }

  private emptyDraft(): IssueDraft {
    return {
      title: '',
      description: '',
      assetId: '',
      severity: 'medium',
      dimension: 'completeness',
      dueDate: '',
    };
  }

  protected setDraft<K extends keyof IssueDraft>(key: K, value: IssueDraft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected openCreate(): void {
    this.draft.set(this.emptyDraft());
    this.createOpen.set(true);
  }

  protected saveIssue(): void {
    const d = this.draft();
    if (!d.title || this.saving()) return;
    this.saving.set(true);
    this.http.post<DqIssue>('/api/data-quality/issues', {
      title: d.title,
      description: d.description || null,
      assetId: d.assetId || null,
      severity: d.severity,
      dimension: d.dimension,
      dueDate: d.dueDate || null,
    }).subscribe({
      next: (issue) => {
        this.toast.success(this.t('dq.created'));
        this.selectedId.set(issue.id);
        this.saving.set(false);
        this.createOpen.set(false);
        this.load();
      },
      error: () => { this.toast.error(this.t('dq.error')); this.saving.set(false); },
    });
  }

  protected openImport(): void {
    this.importCsv.set('');
    this.importResult.set(null);
    this.importOpen.set(true);
  }

  protected insertSample(): void {
    this.importCsv.set(SAMPLE_CSV);
  }

  protected runImport(): void {
    if (!this.importCsv().trim() || this.importing()) return;
    this.importing.set(true);
    this.http.post<{ processed: number; created: number; errors: { row: number; message: string }[] }>(
      '/api/data-quality/issues/import',
      { csv: this.importCsv() },
    ).subscribe({
      next: (res) => {
        this.importResult.set(res);
        this.toast.success(this.t('dq.imported'));
        this.importing.set(false);
        this.load();
      },
      error: () => { this.toast.error(this.t('dq.error')); this.importing.set(false); },
    });
  }

  protected openClose(issue: DqIssue): void {
    this.closeTarget.set(issue);
    this.resolutionSummary.set(issue.resolutionSummary ?? '');
  }

  protected closeIssue(): void {
    const issue = this.closeTarget();
    if (!issue || !this.resolutionSummary().trim() || this.saving()) return;
    this.saving.set(true);
    this.http.post(`/api/data-quality/issues/${issue.id}/close`, {
      resolutionSummary: this.resolutionSummary(),
    }).subscribe({
      next: () => {
        this.toast.success(this.t('dq.closed'));
        this.saving.set(false);
        this.closeTarget.set(null);
        this.load();
      },
      error: () => { this.toast.error(this.t('dq.error')); this.saving.set(false); },
    });
  }

  protected closeModals(): void {
    this.createOpen.set(false);
    this.importOpen.set(false);
    this.closeTarget.set(null);
  }

  protected name(o?: { nameEn?: string; nameAr?: string; fullNameEn?: string; fullNameAr?: string } | null): string {
    if (!o) return '-';
    if (this.i18n.lang() === 'ar') return o.nameAr ?? o.fullNameAr ?? o.nameEn ?? o.fullNameEn ?? '-';
    return o.nameEn ?? o.fullNameEn ?? o.nameAr ?? o.fullNameAr ?? '-';
  }

  protected statusKind(status: string): StatusKind {
    if (status === 'closed' || status === 'resolved') return 'success';
    if (status === 'in_progress') return 'info';
    if (status === 'cancelled') return 'muted';
    if (status === 'open') return 'warning';
    return 'info';
  }

  protected severityKind(severity: string): StatusKind {
    if (severity === 'critical' || severity === 'high') return 'danger';
    if (severity === 'medium') return 'warning';
    return 'info';
  }

  protected date(value?: string | null): string {
    return value ? new Date(value).toLocaleDateString() : '-';
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
