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
interface LegalBasis { id: string; code: string; nameEn: string; nameAr: string; category: string; }
interface MaskingPolicy { id: string; code: string; nameEn: string; nameAr: string; technique: string; }

interface DsiReview {
  id: string;
  step: string;
  decision: string;
  note?: string | null;
  decidedAt?: string | null;
  reviewerPerson?: PersonRef | null;
}

interface DsiRequest {
  id: string;
  requestNumber: string;
  requesterOrg: string;
  recipientOrg: string;
  purpose: string;
  status: string;
  riskScore: number;
  requiredControlsJson: string[];
  consentRequired: boolean;
  crossBorderTransfer: boolean;
  legalBasis?: LegalBasis | null;
  asset?: AssetRef | null;
  domain?: Ref | null;
  classification?: ClassificationRef | null;
  maskingPolicy?: MaskingPolicy | null;
  workflowCase?: WorkflowRef | null;
  reviews: DsiReview[];
  reviewSummary: { total: number; approved: number; pending: number; blocked: number };
  agreements: DsiAgreement[];
}

interface DsiUsageMetric {
  id: string;
  metricDate: string;
  recordsShared: number;
  apiCalls: number;
  incidents: number;
  status: string;
  note?: string | null;
}

interface DsiAgreement {
  id: string;
  agreementNumber: string;
  recipientOrg: string;
  purpose: string;
  status: string;
  agreementUrl?: string | null;
  startAt: string;
  endAt?: string | null;
  renewalDueAt?: string | null;
  renewalSignal?: string;
  request?: { id: string; requestNumber: string; status: string } | null;
  asset?: AssetRef | null;
  domain?: Ref | null;
  ownerPerson?: PersonRef | null;
  usageMetrics: DsiUsageMetric[];
}

interface DsiSummary {
  totalRequests: number;
  underReview: number;
  approved: number;
  highRisk: number;
  activeAgreements: number;
  renewalDue: number;
  pendingReviews: number;
  recordsShared: number;
  apiCalls: number;
  incidents: number;
}

interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type DsiTab = 'requests' | 'agreements';
type CreateMode = 'request' | 'agreement' | null;

const REQUEST_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'agreement_active', 'retired'];
const AGREEMENT_STATUSES = ['draft', 'active', 'renewal_due', 'expired', 'retired'];
const REVIEW_STEPS = ['owner', 'privacy', 'security', 'technical'];
const REVIEW_DECISIONS = ['pending', 'approved', 'rejected', 'needs_changes'];
const USAGE_STATUSES = ['normal', 'watch', 'escalated'];

@Component({
  selector: 'app-data-sharing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, AppIcon, Modal, Pager, StatusChip],
  templateUrl: './data-sharing.html',
  styleUrl: './data-sharing.scss',
})
export class DataSharingPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly summary = signal<DsiSummary | null>(null);
  protected readonly requests = signal<DsiRequest[]>([]);
  protected readonly agreements = signal<DsiAgreement[]>([]);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly people = signal<PersonRef[]>([]);
  protected readonly legalBases = signal<LegalBasis[]>([]);
  protected readonly maskingPolicies = signal<MaskingPolicy[]>([]);
  protected readonly activeTab = signal<DsiTab>('requests');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);
  protected readonly saving = signal(false);
  protected readonly createMode = signal<CreateMode>(null);

  protected readonly requestDraft = signal({
    requesterOrg: '',
    recipientOrg: '',
    purpose: '',
    legalBasisId: '',
    assetId: '',
    maskingPolicyId: '',
    consentRequired: false,
    crossBorderTransfer: false,
  });
  protected readonly reviewDraft = signal({ step: 'privacy', decision: 'approved', reviewerPersonId: '', note: '' });
  protected readonly agreementDraft = signal({
    requestId: '',
    recipientOrg: '',
    purpose: '',
    assetId: '',
    ownerPersonId: '',
    agreementUrl: '',
    startAt: '',
    renewalDueAt: '',
  });
  protected readonly usageDraft = signal({ recordsShared: 0, apiCalls: 0, incidents: 0, status: 'normal', note: '' });

  protected readonly tabs = signal<DsiTab[]>(['requests', 'agreements']);
  protected readonly requestStatuses = signal(REQUEST_STATUSES);
  protected readonly agreementStatuses = signal(AGREEMENT_STATUSES);
  protected readonly reviewSteps = signal(REVIEW_STEPS);
  protected readonly reviewDecisions = signal(REVIEW_DECISIONS);
  protected readonly usageStatuses = signal(USAGE_STATUSES);

  protected readonly selectedRequest = computed(() => this.requests().find((row) => row.id === this.selectedId()) ?? this.requests()[0] ?? null);
  protected readonly selectedAgreement = computed(() => this.agreements().find((row) => row.id === this.selectedId()) ?? this.agreements()[0] ?? null);
  protected readonly activeRows = computed(() => (this.activeTab() === 'requests' ? this.requests() : this.agreements()));
  protected readonly reviewQueue = computed(() => this.requests().filter((row) => ['submitted', 'under_review'].includes(row.status)).slice(0, 5));

  protected get canCreateRequest(): boolean { return this.auth.hasPermission('data_sharing_requests.create'); }
  protected get canEditRequest(): boolean { return this.auth.hasPermission('data_sharing_requests.edit'); }
  protected get canCreateAgreement(): boolean { return this.auth.hasPermission('data_sharing_agreements.create'); }
  protected get canEditAgreement(): boolean { return this.auth.hasPermission('data_sharing_agreements.edit'); }

  ngOnInit(): void {
    this.loadLookups();
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    const params = this.params();
    forkJoin({
      summary: this.http.get<DsiSummary>('/api/data-sharing/summary'),
      requests: this.http.get<Paged<DsiRequest>>('/api/data-sharing/requests', { params: this.activeTab() === 'requests' ? params : this.baseParams() }),
      agreements: this.http.get<Paged<DsiAgreement>>('/api/data-sharing/agreements', { params: this.activeTab() === 'agreements' ? params : this.baseParams() }),
    }).subscribe({
      next: ({ summary, requests, agreements }) => {
        this.summary.set(summary);
        this.requests.set(requests.data);
        this.agreements.set(agreements.data);
        const active = this.activeTab() === 'requests' ? requests : agreements;
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
    this.http.get<MaskingPolicy[]>('/api/security-governance/masking-policies').subscribe({ next: (rows) => this.maskingPolicies.set(rows), error: () => this.maskingPolicies.set([]) });
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

  private ensureSelection(): void {
    const rows = this.activeRows();
    if (!this.selectedId() || !rows.some((row) => row.id === this.selectedId())) {
      this.selectedId.set(rows[0]?.id ?? null);
    }
  }

  protected setTab(tab: DsiTab): void {
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

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected statusOptions(): string[] {
    return this.activeTab() === 'requests' ? this.requestStatuses() : this.agreementStatuses();
  }

  protected openCreate(mode: CreateMode, request?: DsiRequest): void {
    if (mode === 'agreement' && request) {
      this.agreementDraft.update((draft) => ({
        ...draft,
        requestId: request.id,
        recipientOrg: request.recipientOrg,
        purpose: request.purpose,
        assetId: request.asset?.id ?? '',
      }));
    }
    this.createMode.set(mode);
  }

  protected patchRequest(key: string, value: unknown): void {
    this.requestDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchReview(key: string, value: unknown): void {
    this.reviewDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchAgreement(key: string, value: unknown): void {
    this.agreementDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchUsage(key: string, value: unknown): void {
    this.usageDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected createRequest(): void {
    const draft = this.requestDraft();
    if (!draft.requesterOrg.trim() || !draft.recipientOrg.trim() || !draft.purpose.trim()) {
      this.toast.error(this.t('dsi.error.required'));
      return;
    }
    this.saveCreate('/api/data-sharing/requests', this.clean(draft), 'dsi.saved.request');
  }

  protected createAgreement(): void {
    const draft = this.agreementDraft();
    if (!draft.recipientOrg.trim() || !draft.purpose.trim()) {
      this.toast.error(this.t('dsi.error.required'));
      return;
    }
    this.saveCreate('/api/data-sharing/agreements', this.clean(draft), 'dsi.saved.agreement');
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
      error: () => this.toast.error(this.t('dsi.error.save')),
      complete: () => this.saving.set(false),
    });
  }

  protected saveReview(request: DsiRequest): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.http.post<DsiRequest>(`/api/data-sharing/requests/${request.id}/reviews`, this.clean(this.reviewDraft())).subscribe({
      next: (updated) => {
        this.toast.success(this.t('dsi.saved.review'));
        this.requests.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      },
      error: () => this.toast.error(this.t('dsi.error.save')),
      complete: () => this.saving.set(false),
    });
  }

  protected recordUsage(agreement: DsiAgreement): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.http.post(`/api/data-sharing/agreements/${agreement.id}/usage`, this.clean(this.usageDraft())).subscribe({
      next: () => {
        this.toast.success(this.t('dsi.saved.usage'));
        this.load();
      },
      error: () => this.toast.error(this.t('dsi.error.save')),
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
    return this.activeTab() === 'requests'
      ? this.selectedRequest()?.requestNumber ?? '-'
      : this.selectedAgreement()?.agreementNumber ?? '-';
  }

  protected riskKind(score: number): StatusKind {
    if (score >= 70) return 'danger';
    if (score >= 45) return 'warning';
    return 'success';
  }

  protected statusKind(value?: string | null): StatusKind {
    if (!value) return 'muted';
    if (['approved', 'agreement_active', 'active', 'normal'].includes(value)) return 'success';
    if (['rejected', 'retired', 'expired', 'escalated'].includes(value)) return 'danger';
    if (['submitted', 'under_review', 'needs_changes', 'renewal_due', 'pending', 'watch'].includes(value)) return 'warning';
    return 'info';
  }

  protected statusLabel(prefix: string, value?: string | null): string {
    if (!value) return '-';
    const key = `${prefix}.${value}`;
    const translated = this.t(key);
    return translated === key ? value.replaceAll('_', ' ') : translated;
  }

  protected daysUntil(value?: string | null): number | null {
    if (!value) return null;
    return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  }

  private clean<T extends Record<string, unknown>>(draft: T): Record<string, unknown> {
    return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value === '' ? null : value]));
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
