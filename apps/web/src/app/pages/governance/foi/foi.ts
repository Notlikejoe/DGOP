import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { AppIcon } from '../../../shared/app-icon';
import { Pager } from '../../../shared/pager';

interface Ref { id: string; code: string; nameEn: string; nameAr: string; }
interface ClassificationRef extends Ref { rank: number; color: string; }
interface PersonRef { id: string; fullNameEn: string; fullNameAr: string; email?: string | null; jobTitle?: string | null; }
interface AssetRef extends Ref { domain?: Ref | null; classification?: ClassificationRef | null; }
interface WorkflowRef { id: string; code: string; title?: string; status: string; }

interface FoiReview {
  id: string;
  reviewType: string;
  status: string;
  note?: string | null;
  evidenceSummary?: string | null;
  completedAt?: string | null;
  reviewer?: PersonRef | null;
}

interface FoiDecision {
  id: string;
  outcome: string;
  summary: string;
  justification: string;
  decidedBy: string;
  decidedAt: string;
  extendedDueAt?: string | null;
}

interface FoiDisclosure {
  id: string;
  method: string;
  recipient: string;
  recordUrl?: string | null;
  summary?: string | null;
  releasedAt: string;
}

interface FoiAppeal {
  id: string;
  appealNumber: string;
  status: string;
  reason: string;
  submittedAt: string;
  dueAt: string;
  assignedOfficer?: PersonRef | null;
  workflowCase?: WorkflowRef | null;
}

interface FoiTemplate {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  outcome: string;
}

interface FoiRequest {
  id: string;
  requestNumber: string;
  requesterName: string;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  requesterType: string;
  channel: string;
  category: string;
  subject: string;
  description: string;
  receivedAt: string;
  dueAt: string;
  status: string;
  slaStatus: 'closed' | 'overdue' | 'due_soon' | 'on_track';
  identityValidated: boolean;
  contactValidated: boolean;
  assignedOfficerPersonId?: string | null;
  assetId?: string | null;
  dataDomainId?: string | null;
  classificationId?: string | null;
  decisionOutcome?: string | null;
  decisionSummary?: string | null;
  extendedDueAt?: string | null;
  asset?: AssetRef | null;
  dataDomain?: Ref | null;
  classification?: ClassificationRef | null;
  assignedOfficer?: PersonRef | null;
  workflowCase?: WorkflowRef | null;
  responseTemplate?: FoiTemplate | null;
  reviews: FoiReview[];
  exemptions: { id: string; basisCode: string; title: string; description?: string | null; classification?: ClassificationRef | null; createdAt: string }[];
  decisions: FoiDecision[];
  disclosures: FoiDisclosure[];
  appeals: FoiAppeal[];
}

interface FoiSummary {
  total: number;
  open: number;
  overdue: number;
  dueSoon: number;
  appeals: number;
  disclosures: number;
}

interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const STATUSES = ['registered', 'under_review', 'awaiting_clarification', 'decision_due', 'approved', 'partially_approved', 'rejected', 'extended', 'disclosed', 'appealed', 'closed', 'cancelled'];
const CHANNELS = ['web', 'email', 'crm', 'call_center', 'manual'];
const REQUESTER_TYPES = ['individual', 'business', 'government', 'media', 'nonprofit', 'other'];
const CATEGORIES = ['data_request', 'record_request', 'policy_request', 'statistics', 'other'];
const DECISIONS = ['approved', 'partially_approved', 'rejected', 'extended'];
const DISCLOSURE_METHODS = ['secure_link', 'email', 'pickup', 'portal', 'other'];
const REVIEW_TYPES = ['classification', 'privacy', 'legal', 'owner', 'disclosure'];

@Component({
  selector: 'app-foi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, Modal, StatusChip, AppIcon, Pager],
  templateUrl: './foi.html',
  styleUrl: './foi.scss',
})
export class FoiPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly summary = signal<FoiSummary | null>(null);
  protected readonly requests = signal<FoiRequest[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly filters = signal({ search: '', status: '', channel: '' });
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly people = signal<PersonRef[]>([]);
  protected readonly templates = signal<FoiTemplate[]>([]);
  protected readonly showCreate = signal(false);
  protected readonly saving = signal(false);

  protected readonly statuses = signal(STATUSES);
  protected readonly channels = signal(CHANNELS);
  protected readonly requesterTypes = signal(REQUESTER_TYPES);
  protected readonly categories = signal(CATEGORIES);
  protected readonly decisions = signal(DECISIONS);
  protected readonly disclosureMethods = signal(DISCLOSURE_METHODS);
  protected readonly reviewTypes = signal(REVIEW_TYPES);

  protected readonly canCreate = this.auth.hasPermission('foi_requests.create');
  protected readonly canEdit = this.auth.hasPermission('foi_requests.edit');

  protected readonly selected = computed(() => this.requests().find((row) => row.id === this.selectedId()) ?? this.requests()[0] ?? null);
  protected readonly activeTemplates = computed(() => this.templates().filter((template) => template.outcome === this.decisionDraft().outcome));

  protected readonly requestDraft = signal({
    requesterName: '',
    requesterEmail: '',
    requesterPhone: '',
    requesterType: 'individual',
    channel: 'manual',
    category: 'record_request',
    subject: '',
    description: '',
    assetId: '',
    assignedOfficerPersonId: '',
    identityValidated: false,
    contactValidated: false,
  });
  protected readonly reviewDraft = signal({ reviewType: 'classification', status: 'completed', reviewerPersonId: '', note: '', evidenceSummary: '' });
  protected readonly exemptionDraft = signal({ basisCode: '', title: '', description: '', classificationId: '' });
  protected readonly decisionDraft = signal({ outcome: 'approved', summary: '', justification: '', responseTemplateId: '', extendedDueAt: '' });
  protected readonly disclosureDraft = signal({ method: 'secure_link', recipient: '', recordUrl: '', summary: '' });
  protected readonly appealDraft = signal({ reason: '', assignedOfficerPersonId: '' });

  ngOnInit(): void {
    this.selectedId.set(this.route.snapshot.paramMap.get('id'));
    this.loadLookups();
    this.load();
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected name(item?: { nameEn?: string; nameAr?: string; fullNameEn?: string; fullNameAr?: string } | null): string {
    if (!item) return '';
    const lang = this.i18n.lang();
    return lang === 'ar' ? (item.nameAr || item.fullNameAr || item.nameEn || item.fullNameEn || '') : (item.nameEn || item.fullNameEn || item.nameAr || item.fullNameAr || '');
  }

  protected setFilter(key: 'search' | 'status' | 'channel', value: string): void {
    this.filters.update((filters) => ({ ...filters, [key]: value }));
    this.page.set(1);
    this.load();
  }

  protected clearFilters(): void {
    this.filters.set({ search: '', status: '', channel: '' });
    this.page.set(1);
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    let params = new HttpParams().set('page', String(this.page())).set('pageSize', String(this.pageSize()));
    for (const [key, value] of Object.entries(this.filters())) {
      if (value) params = params.set(key, value);
    }
    forkJoin({
      summary: this.http.get<FoiSummary>('/api/foi/summary'),
      requests: this.http.get<Paged<FoiRequest>>('/api/foi/requests', { params }),
    }).subscribe({
      next: ({ summary, requests }) => {
        this.summary.set(summary);
        this.requests.set(requests.data);
        this.total.set(requests.total);
        this.totalPages.set(requests.totalPages);
        this.page.set(requests.page);
        if (!this.selectedId() || !requests.data.some((row) => row.id === this.selectedId())) {
          this.selectedId.set(requests.data[0]?.id ?? null);
        }
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  private loadLookups(): void {
    forkJoin({
      assets: this.http.get<AssetRef[]>('/api/assets'),
      people: this.http.get<PersonRef[]>('/api/people'),
      templates: this.http.get<FoiTemplate[]>('/api/foi/templates'),
    }).subscribe({
      next: ({ assets, people, templates }) => {
        this.assets.set(assets);
        this.people.set(people);
        this.templates.set(templates);
      },
      error: () => {
        this.assets.set([]);
        this.people.set([]);
        this.templates.set([]);
      },
    });
  }

  protected select(request: FoiRequest): void {
    this.selectedId.set(request.id);
    void this.router.navigate(['/governance/foi', request.id], { replaceUrl: true });
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected patchRequestDraft(key: string, value: unknown): void {
    this.requestDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchReviewDraft(key: string, value: unknown): void {
    this.reviewDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchExemptionDraft(key: string, value: unknown): void {
    this.exemptionDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchDecisionDraft(key: string, value: unknown): void {
    this.decisionDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchDisclosureDraft(key: string, value: unknown): void {
    this.disclosureDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected patchAppealDraft(key: string, value: unknown): void {
    this.appealDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected openCreate(): void {
    this.requestDraft.set({
      requesterName: '',
      requesterEmail: '',
      requesterPhone: '',
      requesterType: 'individual',
      channel: 'manual',
      category: 'record_request',
      subject: '',
      description: '',
      assetId: '',
      assignedOfficerPersonId: '',
      identityValidated: false,
      contactValidated: false,
    });
    this.showCreate.set(true);
  }

  protected saveRequest(): void {
    const draft = this.requestDraft();
    if (!draft.requesterName.trim() || !draft.subject.trim() || !draft.description.trim()) {
      this.toast.error(this.t('foi.error.required'));
      return;
    }
    this.saving.set(true);
    this.http.post<FoiRequest>('/api/foi/requests', this.clean(draft)).subscribe({
      next: (request) => {
        this.toast.success(this.t('foi.saved'));
        this.showCreate.set(false);
        this.selectedId.set(request.id);
        this.load();
      },
      error: (err) => this.toast.errorFrom(err, this.t('foi.error.save')),
      complete: () => this.saving.set(false),
    });
  }

  protected saveReview(request: FoiRequest): void {
    this.postAction(request, 'reviews', this.clean(this.reviewDraft()), 'foi.review.saved');
  }

  protected saveExemption(request: FoiRequest): void {
    const draft = this.exemptionDraft();
    if (!draft.basisCode.trim() || !draft.title.trim()) {
      this.toast.error(this.t('foi.error.required'));
      return;
    }
    this.postAction(request, 'exemptions', this.clean(draft), 'foi.exemption.saved');
  }

  protected saveDecision(request: FoiRequest): void {
    const draft = this.decisionDraft();
    if (!draft.summary.trim() || !draft.justification.trim()) {
      this.toast.error(this.t('foi.error.required'));
      return;
    }
    this.postAction(request, 'decision', this.clean(draft), 'foi.decision.saved');
  }

  protected saveDisclosure(request: FoiRequest): void {
    const draft = this.disclosureDraft();
    if (!draft.recipient.trim()) {
      this.toast.error(this.t('foi.error.required'));
      return;
    }
    this.postAction(request, 'disclosures', this.clean(draft), 'foi.disclosure.saved');
  }

  protected saveAppeal(request: FoiRequest): void {
    const draft = this.appealDraft();
    if (!draft.reason.trim()) {
      this.toast.error(this.t('foi.error.required'));
      return;
    }
    this.postAction(request, 'appeals', this.clean(draft), 'foi.appeal.saved');
  }

  private postAction(request: FoiRequest, action: string, body: Record<string, unknown>, messageKey: string): void {
    this.saving.set(true);
    this.http.post<FoiRequest>(`/api/foi/requests/${request.id}/${action}`, body).subscribe({
      next: (updated) => {
        this.toast.success(this.t(messageKey));
        this.requests.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
        this.selectedId.set(updated.id);
      },
      error: (err) => this.toast.errorFrom(err, this.t('foi.error.save')),
      complete: () => this.saving.set(false),
    });
  }

  private clean<T extends Record<string, unknown>>(draft: T): Record<string, unknown> {
    return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value === '' ? null : value]));
  }

  protected statusKind(status: string): StatusKind {
    if (['approved', 'partially_approved', 'disclosed', 'closed', 'completed', 'overturned'].includes(status)) return 'success';
    if (['rejected', 'cancelled', 'blocked', 'overdue'].includes(status)) return 'danger';
    if (['awaiting_clarification', 'decision_due', 'extended', 'appealed', 'due_soon', 'under_review'].includes(status)) return 'warning';
    return 'info';
  }

  protected slaKind(status: string): StatusKind {
    if (status === 'closed') return 'success';
    if (status === 'overdue') return 'danger';
    if (status === 'due_soon') return 'warning';
    return 'info';
  }

  protected daysUntil(date: string): number {
    return Math.ceil((new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  }

  protected canDisclose(request: FoiRequest): boolean {
    return ['approved', 'partially_approved'].includes(request.status);
  }
}
