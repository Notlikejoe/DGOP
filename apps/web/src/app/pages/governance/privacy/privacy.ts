import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../core/auth.service';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { Modal } from '../../../shared/modal';
import { Pager } from '../../../shared/pager';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface Ref { id: string; code: string; nameEn: string; nameAr: string; }
interface ClassificationRef extends Ref { rank: number; color: string; }
interface PersonRef { id: string; fullNameEn: string; fullNameAr: string; email?: string | null; jobTitle?: string | null; }
interface AssetRef extends Ref { domain?: Ref | null; classification?: ClassificationRef | null; }
interface WorkflowRef { id: string; code: string; title?: string; status: string; }
interface LegalBasis { id: string; code: string; nameEn: string; nameAr: string; category: string; authority?: string | null; }

interface PrivacyGate {
  id: string;
  phase: string;
  status: string;
  note?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  reviewerPerson?: PersonRef | null;
}

interface PrivacyDpia {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  status: string;
  riskLevel: string;
  inherentRiskScore: number;
  residualRiskScore: number;
  crossBorderTransfer: boolean;
  dueAt?: string | null;
  completedAt?: string | null;
  decisionSummary?: string | null;
  slaStatus?: string;
  gateSummary?: { total: number; approved: number; pending: number; blocked: number };
  asset?: AssetRef | null;
  domain?: Ref | null;
  legalBasis?: LegalBasis | null;
  classification?: ClassificationRef | null;
  reviewerPerson?: PersonRef | null;
  workflowCase?: WorkflowRef | null;
  gates: PrivacyGate[];
}

interface PrivacyDsr {
  id: string;
  requestNumber: string;
  requesterName: string;
  requesterEmail?: string | null;
  requestType: string;
  description: string;
  status: string;
  identityValidated: boolean;
  dueAt?: string | null;
  fulfilledAt?: string | null;
  decisionSummary?: string | null;
  slaStatus?: string;
  asset?: AssetRef | null;
  domain?: Ref | null;
  assignedPerson?: PersonRef | null;
  workflowCase?: WorkflowRef | null;
}

interface PrivacyBreach {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  detectedAt: string;
  notificationDueAt: string;
  containedAt?: string | null;
  notifiedAt?: string | null;
  regulatorNotified: boolean;
  subjectNotified: boolean;
  notificationStatus?: string;
  asset?: AssetRef | null;
  domain?: Ref | null;
  assignedPerson?: PersonRef | null;
  workflowCase?: WorkflowRef | null;
}

interface RopaRecord {
  id: string;
  code: string;
  processName: string;
  purpose: string;
  status: string;
  reviewDueAt?: string | null;
  asset?: AssetRef | null;
  domain?: Ref | null;
  legalBasis?: LegalBasis | null;
  ownerPerson?: PersonRef | null;
}

interface PrivacySummary {
  dpias: number;
  dpiaUnderReview: number;
  highRiskDpias: number;
  dsrOpen: number;
  dsrOverdue: number;
  breachesOpen: number;
  breachNotificationRisk: number;
  ropaDue: number;
  activeConsents: number;
  retentionDue: number;
}

interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type WorkTab = 'dpia' | 'dsr' | 'breach';
type CreateMode = WorkTab | null;

const DPIA_STATUSES = ['draft', 'submitted', 'under_review', 'action_required', 'approved', 'rejected', 'closed'];
const DSR_STATUSES = ['received', 'identity_validation', 'in_progress', 'awaiting_data_owner', 'fulfilled', 'rejected', 'closed'];
const BREACH_STATUSES = ['detected', 'triage', 'contained', 'notified', 'closed', 'false_positive'];
const REQUEST_TYPES = ['access', 'correction', 'erasure', 'restriction', 'portability', 'objection', 'withdraw_consent'];
const BREACH_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const GATE_PHASES = ['requirements', 'design', 'development', 'testing', 'deployment'];
const GATE_STATUSES = ['pending', 'approved', 'blocked', 'not_required'];

@Component({
  selector: 'app-privacy-operations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, AppIcon, Modal, Pager, StatusChip],
  templateUrl: './privacy.html',
  styleUrl: './privacy.scss',
})
export class PrivacyOperationsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly summary = signal<PrivacySummary | null>(null);
  protected readonly dpias = signal<PrivacyDpia[]>([]);
  protected readonly dsrs = signal<PrivacyDsr[]>([]);
  protected readonly breaches = signal<PrivacyBreach[]>([]);
  protected readonly ropa = signal<RopaRecord[]>([]);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly people = signal<PersonRef[]>([]);
  protected readonly legalBases = signal<LegalBasis[]>([]);
  protected readonly activeTab = signal<WorkTab>('dpia');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);
  protected readonly saving = signal(false);
  protected readonly createMode = signal<CreateMode>(null);

  protected readonly gateDraft = signal({ phase: 'requirements', status: 'approved', reviewerPersonId: '', note: '' });
  protected readonly dsrDraftUpdate = signal({ status: 'in_progress', assignedPersonId: '', decisionSummary: '', identityValidated: false });
  protected readonly breachDraftUpdate = signal({ status: 'contained', severity: 'medium', containedAt: '', notifiedAt: '', regulatorNotified: false, subjectNotified: false });
  protected readonly dpiaDraft = signal({
    title: '',
    description: '',
    assetId: '',
    legalBasisId: '',
    reviewerPersonId: '',
    crossBorderTransfer: false,
    dueAt: '',
  });
  protected readonly dsrDraft = signal({
    requesterName: '',
    requesterEmail: '',
    requestType: 'access',
    description: '',
    assetId: '',
    assignedPersonId: '',
    identityValidated: false,
    dueAt: '',
  });
  protected readonly breachDraft = signal({
    title: '',
    description: '',
    assetId: '',
    severity: 'medium',
    detectedAt: '',
    assignedPersonId: '',
  });

  protected readonly tabs = signal<WorkTab[]>(['dpia', 'dsr', 'breach']);
  protected readonly dpiaStatuses = signal(DPIA_STATUSES);
  protected readonly dsrStatuses = signal(DSR_STATUSES);
  protected readonly breachStatuses = signal(BREACH_STATUSES);
  protected readonly requestTypes = signal(REQUEST_TYPES);
  protected readonly breachSeverities = signal(BREACH_SEVERITIES);
  protected readonly gatePhases = signal(GATE_PHASES);
  protected readonly gateStatuses = signal(GATE_STATUSES);

  protected readonly selectedDpia = computed(() => this.dpias().find((row) => row.id === this.selectedId()) ?? this.dpias()[0] ?? null);
  protected readonly selectedDsr = computed(() => this.dsrs().find((row) => row.id === this.selectedId()) ?? this.dsrs()[0] ?? null);
  protected readonly selectedBreach = computed(() => this.breaches().find((row) => row.id === this.selectedId()) ?? this.breaches()[0] ?? null);
  protected readonly activeRows = computed(() => {
    if (this.activeTab() === 'dpia') return this.dpias();
    if (this.activeTab() === 'dsr') return this.dsrs();
    return this.breaches();
  });
  protected readonly urgentRopa = computed(() => this.ropa().slice(0, 4));

  protected get canCreate(): boolean { return this.auth.hasPermission('privacy_operations.create'); }
  protected get canEdit(): boolean { return this.auth.hasPermission('privacy_operations.edit'); }

  ngOnInit(): void {
    this.loadLookups();
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    const params = this.params();
    forkJoin({
      summary: this.http.get<PrivacySummary>('/api/privacy/summary'),
      dpias: this.http.get<Paged<PrivacyDpia>>('/api/privacy/dpia', { params: this.activeTab() === 'dpia' ? params : this.baseParams() }),
      dsrs: this.http.get<Paged<PrivacyDsr>>('/api/privacy/dsr', { params: this.activeTab() === 'dsr' ? params : this.baseParams() }),
      breaches: this.http.get<Paged<PrivacyBreach>>('/api/privacy/breaches', { params: this.activeTab() === 'breach' ? params : this.baseParams() }),
      ropa: this.http.get<Paged<RopaRecord>>('/api/privacy/ropa', { params: this.baseParams() }),
    }).subscribe({
      next: ({ summary, dpias, dsrs, breaches, ropa }) => {
        this.summary.set(summary);
        this.dpias.set(dpias.data);
        this.dsrs.set(dsrs.data);
        this.breaches.set(breaches.data);
        this.ropa.set(ropa.data);
        const active = this.activePage(dpias, dsrs, breaches);
        this.total.set(active.total);
        this.totalPages.set(active.totalPages);
        this.page.set(active.page);
        this.ensureSelection();
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  private loadLookups(): void {
    this.http.get<AssetRef[]>('/api/assets').subscribe({ next: (rows) => this.assets.set(rows), error: () => this.assets.set([]) });
    this.http.get<PersonRef[]>('/api/people').subscribe({ next: (rows) => this.people.set(rows), error: () => this.people.set([]) });
    this.http.get<LegalBasis[]>('/api/privacy/legal-bases').subscribe({ next: (rows) => this.legalBases.set(rows), error: () => this.legalBases.set([]) });
  }

  private params(): HttpParams {
    let params = this.baseParams();
    if (this.search()) params = params.set('search', this.search());
    if (this.status()) params = params.set('status', this.status());
    return params;
  }

  private baseParams(): HttpParams {
    return new HttpParams().set('page', String(this.page())).set('pageSize', String(this.pageSize()));
  }

  private activePage(dpias: Paged<PrivacyDpia>, dsrs: Paged<PrivacyDsr>, breaches: Paged<PrivacyBreach>): Paged<unknown> {
    if (this.activeTab() === 'dpia') return dpias;
    if (this.activeTab() === 'dsr') return dsrs;
    return breaches;
  }

  private ensureSelection(): void {
    const rows = this.activeRows();
    if (!this.selectedId() || !rows.some((row) => row.id === this.selectedId())) {
      this.selectedId.set(rows[0]?.id ?? null);
    }
  }

  protected setTab(tab: WorkTab): void {
    this.activeTab.set(tab);
    this.status.set('');
    this.page.set(1);
    this.selectedId.set(null);
    this.load();
  }

  protected setFilter(kind: 'search' | 'status', value: string): void {
    if (kind === 'search') this.search.set(value);
    if (kind === 'status') this.status.set(value);
    this.page.set(1);
    this.load();
  }

  protected statusOptions(): string[] {
    if (this.activeTab() === 'dpia') return this.dpiaStatuses();
    if (this.activeTab() === 'dsr') return this.dsrStatuses();
    return this.breachStatuses();
  }

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected openCreate(mode: WorkTab): void {
    this.createMode.set(mode);
  }

  protected patchDpia(key: string, value: unknown): void {
    this.dpiaDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchDsr(key: string, value: unknown): void {
    this.dsrDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchBreach(key: string, value: unknown): void {
    this.breachDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchGate(key: string, value: unknown): void {
    this.gateDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchDsrUpdate(key: string, value: unknown): void {
    this.dsrDraftUpdate.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchBreachUpdate(key: string, value: unknown): void {
    this.breachDraftUpdate.update((draft) => ({ ...draft, [key]: value }));
  }

  protected createDpia(): void {
    const draft = this.dpiaDraft();
    if (!draft.title.trim()) {
      this.toast.error(this.t('privacy.error.required'));
      return;
    }
    this.saveCreate('/api/privacy/dpia', this.clean(draft), 'privacy.saved.dpia');
  }

  protected createDsr(): void {
    const draft = this.dsrDraft();
    if (!draft.requesterName.trim() || !draft.description.trim()) {
      this.toast.error(this.t('privacy.error.required'));
      return;
    }
    this.saveCreate('/api/privacy/dsr', this.clean(draft), 'privacy.saved.dsr');
  }

  protected createBreach(): void {
    const draft = this.breachDraft();
    if (!draft.title.trim()) {
      this.toast.error(this.t('privacy.error.required'));
      return;
    }
    this.saveCreate('/api/privacy/breaches', this.clean(draft), 'privacy.saved.breach');
  }

  private saveCreate(url: string, body: Record<string, unknown>, messageKey: string): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.http.post<{ id: string }>(url, body).subscribe({
      next: (row) => {
        this.toast.success(this.t(messageKey));
        this.selectedId.set(row.id);
        this.createMode.set(null);
        this.load();
      },
      error: (err) => this.toast.errorFrom(err, this.t('privacy.error.save')),
      complete: () => this.saving.set(false),
    });
  }

  protected saveGate(dpia: PrivacyDpia): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.http.post<PrivacyDpia>(`/api/privacy/dpia/${dpia.id}/gates`, this.clean(this.gateDraft())).subscribe({
      next: (updated) => {
        this.toast.success(this.t('privacy.saved.gate'));
        this.dpias.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      },
      error: (err) => this.toast.errorFrom(err, this.t('privacy.error.save')),
      complete: () => this.saving.set(false),
    });
  }

  protected updateDsr(dsr: PrivacyDsr): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.http.patch<PrivacyDsr>(`/api/privacy/dsr/${dsr.id}`, this.clean(this.dsrDraftUpdate())).subscribe({
      next: (updated) => {
        this.toast.success(this.t('privacy.saved.dsrUpdate'));
        this.dsrs.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      },
      error: (err) => this.toast.errorFrom(err, this.t('privacy.error.save')),
      complete: () => this.saving.set(false),
    });
  }

  protected updateBreach(breach: PrivacyBreach): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.http.patch<PrivacyBreach>(`/api/privacy/breaches/${breach.id}`, this.clean(this.breachDraftUpdate())).subscribe({
      next: (updated) => {
        this.toast.success(this.t('privacy.saved.breachUpdate'));
        this.breaches.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      },
      error: (err) => this.toast.errorFrom(err, this.t('privacy.error.save')),
      complete: () => this.saving.set(false),
    });
  }

  protected closeModal(): void {
    this.createMode.set(null);
  }

  protected name(item?: { nameEn?: string; nameAr?: string; fullNameEn?: string; fullNameAr?: string } | null): string {
    if (!item) return '-';
    if (this.i18n.lang() === 'ar') return item.nameAr ?? item.fullNameAr ?? item.nameEn ?? item.fullNameEn ?? '-';
    return item.nameEn ?? item.fullNameEn ?? item.nameAr ?? item.fullNameAr ?? '-';
  }

  protected selectedTitle(): string {
    if (this.activeTab() === 'dpia') return this.selectedDpia()?.title ?? '-';
    if (this.activeTab() === 'dsr') return this.selectedDsr()?.requestNumber ?? '-';
    return this.selectedBreach()?.code ?? '-';
  }

  protected daysUntil(value?: string | null): number | null {
    if (!value) return null;
    return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  }

  protected riskKind(value?: string | null): StatusKind {
    if (value === 'critical' || value === 'high' || value === 'overdue') return 'danger';
    if (value === 'medium' || value === 'urgent' || value === 'due_soon') return 'warning';
    if (value === 'low' || value === 'closed' || value === 'not_required') return 'success';
    return 'info';
  }

  protected statusKind(value?: string | null): StatusKind {
    if (!value) return 'muted';
    if (['approved', 'fulfilled', 'closed', 'contained', 'notified', 'not_required'].includes(value)) return 'success';
    if (['rejected', 'false_positive', 'blocked', 'critical', 'overdue', 'action_required'].includes(value)) return 'danger';
    if (['submitted', 'under_review', 'identity_validation', 'in_progress', 'awaiting_data_owner', 'triage', 'pending', 'due_soon', 'detected'].includes(value)) return 'warning';
    return 'info';
  }

  protected statusLabel(prefix: string, value?: string | null): string {
    if (!value) return '-';
    const key = `${prefix}.${value}`;
    const translated = this.t(key);
    return translated === key ? value.replaceAll('_', ' ') : translated;
  }

  private clean<T extends Record<string, unknown>>(draft: T): Record<string, unknown> {
    return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value === '' ? null : value]));
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
