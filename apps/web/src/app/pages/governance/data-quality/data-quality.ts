import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
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
  breachedSla?: number;
  rules?: number;
  deployedRules?: number;
  profiles?: number;
  qualityScore?: number;
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
  priority?: string;
  status: string;
  dueDate?: string | null;
  triageDueAt?: string | null;
  remediationDueAt?: string | null;
  validationDueAt?: string | null;
  resolutionSummary?: string | null;
  asset?: AssetRef | null;
  responsiblePerson?: { id: string; fullNameEn: string; fullNameAr: string; email?: string | null } | null;
  workflowCase?: { id: string; code: string; title: string; status: string } | null;
  evidence: DqEvidence[];
  rcaRecords?: DqRcaRecord[];
  slaBreaches?: { id: string; stage: string; status: string; dueAt: string; breachedAt?: string | null }[];
}

interface DqRcaRecord {
  id: string;
  template: string;
  rootCause?: string | null;
  remediationPlan?: string | null;
  validationResult?: string | null;
  updatedAt: string;
}

interface DqRule {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  dimension: string;
  status: string;
  severity: string;
  checkFrequency: string;
  thresholdExpression?: string | null;
  impactSummary?: string | null;
  asset?: Ref | null;
  domain?: Ref | null;
  ownerPerson?: { id: string; fullNameEn: string; fullNameAr: string; email?: string | null } | null;
}

interface DqProfileColumn {
  id: string;
  columnName: string;
  dataType?: string | null;
  completenessPct: number;
  uniquenessPct: number;
  validityPct: number;
  anomalyCount: number;
  recommendation?: string | null;
  dimension?: string | null;
}

interface DqProfile {
  id: string;
  rowCount: number;
  columnCount: number;
  qualityScore: number;
  recommendedRules: number;
  anomalyCount: number;
  createdAt: string;
  asset?: Ref | null;
  domain?: Ref | null;
  columns: DqProfileColumn[];
}

interface DqScorecard {
  overallScore: number;
  dimensions: { dimension: string; score: number; openIssues: number; critical: number; rules: number }[];
  domains: { id: string; code: string; nameEn: string; nameAr: string; score: number; openIssues: number }[];
}

interface DqImportConfig {
  maxFileSizeBytes: number;
  maxFileSizeLabel: string;
  acceptedExtensions: string[];
  acceptedMimeTypes: string[];
  columns: string[];
  requiredColumns: string[];
  defaults: { source: string; severity: string; priority: string; dimension: string };
  sampleCsv: string;
}

interface DqPageConfig {
  statuses: string[];
  severities: string[];
  priorities: string[];
  dimensions: string[];
  defaults: { severity: string; priority: string; dimension: string };
  import: DqImportConfig;
}

interface DqImportRowError {
  row: number;
  code?: string;
  message?: string;
  params?: Record<string, string>;
}

interface DqImportResult {
  processed: number;
  created: number;
  errors: DqImportRowError[];
}

interface IssueDraft {
  title: string;
  description: string;
  assetId: string;
  severity: string;
  priority: string;
  dimension: string;
  dueDate: string;
}

interface RcaDraft {
  summary: string;
  rootCause: string;
  remediationPlan: string;
  validationResult: string;
}

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * 1024;

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
  protected readonly scorecard = signal<DqScorecard | null>(null);
  protected readonly config = signal<DqPageConfig | null>(null);
  protected readonly issues = signal<DqIssue[]>([]);
  protected readonly rules = signal<DqRule[]>([]);
  protected readonly profiles = signal<DqProfile[]>([]);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly selectedId = signal<string | null>(null);

  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly severity = signal('');
  protected readonly dimension = signal('');

  protected readonly createOpen = signal(false);
  protected readonly importOpen = signal(false);
  protected readonly rcaTarget = signal<DqIssue | null>(null);
  protected readonly closeTarget = signal<DqIssue | null>(null);
  protected readonly saving = signal(false);
  protected readonly importing = signal(false);
  protected readonly importFile = signal<File | null>(null);
  protected readonly importFileError = signal('');
  protected readonly importCsv = signal('');
  protected readonly importResult = signal<DqImportResult | null>(null);
  protected readonly resolutionSummary = signal('');
  protected readonly rcaDraft = signal<RcaDraft>(this.emptyRcaDraft());
  protected readonly draft = signal<IssueDraft>(this.emptyDraft());
  private filterReloadTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly selected = computed(() => {
    const id = this.selectedId();
    return this.issues().find((i) => i.id === id) ?? this.issues()[0] ?? null;
  });

  protected readonly statuses = computed(() => this.config()?.statuses ?? []);
  protected readonly severities = computed(() => this.config()?.severities ?? []);
  protected readonly priorities = computed(() => this.config()?.priorities ?? []);
  protected readonly dimensions = computed(() => this.config()?.dimensions ?? []);
  protected readonly importConfig = computed(() => this.config()?.import ?? null);
  protected readonly importReady = computed(() => !!this.importFile() || !!this.importCsv().trim());
  protected readonly importAccept = computed(() => {
    const config = this.importConfig();
    return config ? [...config.acceptedExtensions, ...config.acceptedMimeTypes].join(',') : '';
  });
  protected readonly importHelp = computed(() => {
    const size = this.importConfig()?.maxFileSizeLabel ?? '-';
    return this.t('dq.importFile.help').replace('{size}', size);
  });
  protected readonly importFileName = computed(() => this.importFile()?.name ?? '');
  protected readonly importFileSize = computed(() => {
    const file = this.importFile();
    if (!file) return '';
    if (file.size < BYTES_PER_KILOBYTE) return `${file.size} B`;
    if (file.size < BYTES_PER_MEGABYTE) return `${Math.round(file.size / BYTES_PER_KILOBYTE)} KB`;
    return `${(file.size / BYTES_PER_MEGABYTE).toFixed(1)} MB`;
  });
  protected readonly topProfiles = computed(() => this.profiles().slice(0, 3));
  protected readonly activeRules = computed(() => this.rules().filter((rule) => rule.status !== 'retired').slice(0, 6));
  protected readonly breachedIssues = computed(() => this.issues().filter((issue) => (issue.slaBreaches?.length ?? 0) > 0));

  ngOnInit(): void {
    this.loadConfig();
    this.load();
    this.loadAssets();
  }

  protected get canCreate(): boolean { return this.auth.hasPermission('data_quality_issues.create'); }
  protected get canEdit(): boolean { return this.auth.hasPermission('data_quality_issues.edit'); }
  protected get canImport(): boolean { return this.auth.hasPermission('data_quality_issues.import'); }
  protected get canEditRules(): boolean { return this.auth.hasPermission('data_quality_rules.edit'); }

  protected load(): void {
    this.state.set('loading');
    forkJoin({
      summary: this.http.get<DqSummary>('/api/data-quality/summary'),
      scorecard: this.http.get<DqScorecard>('/api/data-quality/scorecard'),
      issues: this.http.get<DqIssue[]>('/api/data-quality/issues', { params: this.issueParams() }),
      rules: this.http.get<DqRule[]>('/api/data-quality/rules'),
      profiles: this.http.get<DqProfile[]>('/api/data-quality/profiles'),
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary);
        this.scorecard.set(result.scorecard);
        this.applyIssues(result.issues);
        this.rules.set(result.rules);
        this.profiles.set(result.profiles);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  private issueParams(): HttpParams {
    let params = new HttpParams();
    if (this.search()) params = params.set('search', this.search());
    if (this.status()) params = params.set('status', this.status());
    if (this.severity()) params = params.set('severity', this.severity());
    if (this.dimension()) params = params.set('dimension', this.dimension());
    return params;
  }

  private applyIssues(rows: DqIssue[]): void {
    this.issues.set(rows);
    if (!this.selectedId() && rows.length) this.selectedId.set(rows[0].id);
    if (this.selectedId() && !rows.some((issue) => issue.id === this.selectedId())) {
      this.selectedId.set(rows[0]?.id ?? null);
    }
  }

  private loadIssuesOnly(): void {
    this.http.get<DqIssue[]>('/api/data-quality/issues', { params: this.issueParams() }).subscribe({
      next: (rows) => this.applyIssues(rows),
      error: () => this.toast.error(this.t('dq.error')),
    });
  }

  private scheduleIssueReload(): void {
    if (this.filterReloadTimer) clearTimeout(this.filterReloadTimer);
    this.filterReloadTimer = setTimeout(() => {
      this.filterReloadTimer = null;
      this.loadIssuesOnly();
    }, 250);
  }

  private loadAssets(): void {
    this.http.get<AssetRef[]>('/api/assets').subscribe({
      next: (rows) => this.assets.set(rows),
      error: () => this.assets.set([]),
    });
  }

  private loadConfig(): void {
    this.http.get<DqPageConfig>('/api/data-quality/config').subscribe({
      next: (config) => this.config.set(config),
      error: () => this.toast.error(this.t('dq.config.error')),
    });
  }

  protected setFilter(kind: 'search' | 'status' | 'severity' | 'dimension', value: string): void {
    if (kind === 'search') this.search.set(value);
    if (kind === 'status') this.status.set(value);
    if (kind === 'severity') this.severity.set(value);
    if (kind === 'dimension') this.dimension.set(value);
    this.scheduleIssueReload();
  }

  private emptyDraft(): IssueDraft {
    const defaults = this.config()?.defaults;
    return {
      title: '',
      description: '',
      assetId: '',
      severity: defaults?.severity ?? '',
      priority: defaults?.priority ?? '',
      dimension: defaults?.dimension ?? '',
      dueDate: '',
    };
  }

  private emptyRcaDraft(): RcaDraft {
    return { summary: '', rootCause: '', remediationPlan: '', validationResult: '' };
  }

  protected setDraft<K extends keyof IssueDraft>(key: K, value: IssueDraft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected setRca<K extends keyof RcaDraft>(key: K, value: RcaDraft[K]): void {
    this.rcaDraft.update((d) => ({ ...d, [key]: value }));
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
      priority: d.priority,
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

  protected transitionActions(rule: DqRule): string[] {
    if (rule.status === 'draft') return ['submit'];
    if (rule.status === 'in_review') return ['approve'];
    if (rule.status === 'approved') return ['deploy'];
    if (rule.status === 'deployed') return ['retire'];
    return [];
  }

  protected transitionRule(rule: DqRule, action: string): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.http.post(`/api/data-quality/rules/${rule.id}/${action}`, {}).subscribe({
      next: () => {
        this.toast.success(this.t('dq.rule.updated'));
        this.saving.set(false);
        this.load();
      },
      error: () => { this.toast.error(this.t('dq.error')); this.saving.set(false); },
    });
  }

  protected openImport(): void {
    this.clearImportFile();
    this.importCsv.set('');
    this.importResult.set(null);
    this.importOpen.set(true);
  }

  protected insertSample(input?: HTMLInputElement): void {
    this.clearImportFile(input);
    this.importCsv.set(this.importConfig()?.sampleCsv ?? '');
  }

  protected setImportCsv(value: string): void {
    this.clearImportFile();
    this.importCsv.set(value);
  }

  protected onImportFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.importFileError.set('');
    this.importResult.set(null);
    if (!file) {
      this.clearImportFile();
      return;
    }
    const config = this.importConfig();
    if (!config) {
      this.importFileError.set(this.t('dq.config.error'));
      this.clearImportFile();
      input.value = '';
      return;
    }
    const isCsv =
      config.acceptedExtensions.some((extension) => file.name.toLowerCase().endsWith(extension.toLowerCase())) ||
      config.acceptedMimeTypes.includes(file.type);
    if (!isCsv) {
      this.importFileError.set(this.t('dq.importFile.invalid'));
      this.clearImportFile();
      input.value = '';
      return;
    }
    if (file.size > config.maxFileSizeBytes) {
      this.importFileError.set(this.t('dq.importFile.tooLarge').replace('{size}', config.maxFileSizeLabel));
      this.clearImportFile();
      input.value = '';
      return;
    }
    this.importFile.set(file);
    this.importCsv.set('');
  }

  protected clearImportFile(input?: HTMLInputElement): void {
    this.importFile.set(null);
    this.importFileError.set('');
    if (input) input.value = '';
  }

  protected runImport(): void {
    if (!this.importReady() || this.importing()) return;
    this.importing.set(true);
    const file = this.importFile();
    const request = file
      ? this.http.post<DqImportResult>(
          '/api/data-quality/issues/import-file',
          this.importFormData(file),
        )
      : this.http.post<DqImportResult>(
          '/api/data-quality/issues/import',
          { csv: this.importCsv() },
        );
    request.subscribe({
      next: (res) => {
        this.importResult.set(res);
        this.toast.success(this.t('dq.imported'));
        this.importing.set(false);
        this.load();
      },
      error: () => { this.toast.error(this.t('dq.error')); this.importing.set(false); },
    });
  }

  private importFormData(file: File): FormData {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return formData;
  }

  protected importErrorText(error: DqImportRowError): string {
    const key = error.code ? `dq.importError.${error.code}` : '';
    const translated = key ? this.t(key) : '';
    const template = translated && translated !== key ? translated : error.message || this.t('dq.importError.row_rejected');
    return Object.entries(error.params ?? {}).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      template,
    );
  }

  protected openRca(issue: DqIssue): void {
    const latest = issue.rcaRecords?.[0];
    this.rcaDraft.set({
      summary: latest?.rootCause ?? '',
      rootCause: latest?.rootCause ?? '',
      remediationPlan: latest?.remediationPlan ?? '',
      validationResult: latest?.validationResult ?? '',
    });
    this.rcaTarget.set(issue);
  }

  protected saveRca(): void {
    const issue = this.rcaTarget();
    const draft = this.rcaDraft();
    if (!issue || this.saving()) return;
    if (!draft.rootCause.trim() && !draft.remediationPlan.trim()) return;
    this.saving.set(true);
    this.http.post(`/api/data-quality/issues/${issue.id}/rca`, {
      template: 'five_whys',
      summary: draft.summary || null,
      rootCause: draft.rootCause || null,
      remediationPlan: draft.remediationPlan || null,
      validationResult: draft.validationResult || null,
    }).subscribe({
      next: () => {
        this.toast.success(this.t('dq.rca.saved'));
        this.saving.set(false);
        this.rcaTarget.set(null);
        this.load();
      },
      error: () => { this.toast.error(this.t('dq.error')); this.saving.set(false); },
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
    this.clearImportFile();
    this.closeTarget.set(null);
    this.rcaTarget.set(null);
  }

  protected name(o?: { nameEn?: string; nameAr?: string; fullNameEn?: string; fullNameAr?: string } | null): string {
    if (!o) return '-';
    if (this.i18n.lang() === 'ar') return o.nameAr ?? o.fullNameAr ?? o.nameEn ?? o.fullNameEn ?? '-';
    return o.nameEn ?? o.fullNameEn ?? o.nameAr ?? o.fullNameAr ?? '-';
  }

  protected statusKind(status: string): StatusKind {
    if (status === 'closed' || status === 'resolved' || status === 'deployed' || status === 'approved') return 'success';
    if (status === 'in_progress' || status === 'in_review') return 'info';
    if (status === 'cancelled' || status === 'retired') return 'muted';
    if (status === 'open' || status === 'draft') return 'warning';
    return 'info';
  }

  protected severityKind(severity: string): StatusKind {
    if (severity === 'critical' || severity === 'high') return 'danger';
    if (severity === 'medium') return 'warning';
    return 'info';
  }

  protected priorityKind(priority?: string): StatusKind {
    if (priority === 'P1' || priority === 'P2') return 'danger';
    if (priority === 'P3') return 'warning';
    return 'info';
  }

  protected scoreKind(score: number): StatusKind {
    if (score >= 85) return 'success';
    if (score >= 65) return 'warning';
    return 'danger';
  }

  protected date(value?: string | null): string {
    return value ? new Date(value).toLocaleDateString() : '-';
  }

  protected evidenceLabel(action: string): string {
    const key = `dq.evidenceAction.${action.replaceAll('.', '_')}`;
    const translated = this.t(key);
    return translated === key ? action.replaceAll('.', ' ') : translated;
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
