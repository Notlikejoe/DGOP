import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { AppIcon } from '../../../shared/app-icon';
import { Pager } from '../../../shared/pager';

interface Ref { id: string; code: string; nameEn: string; nameAr: string; }
interface ClassificationRef extends Ref { rank: number; color: string; }
interface PersonRef { id: string; fullNameEn: string; fullNameAr: string; email?: string | null; jobTitle?: string | null; }
interface AssetRef extends Ref {
  ownerStatus?: string;
  ownerName?: string | null;
  domain?: Ref | null;
  classification?: ClassificationRef | null;
  subjects?: { dataSubject: Ref }[];
}

interface DqScoreRef { id: string; score: number; measuredAt: string; source: string; }

interface OpenDataCandidate {
  id: string;
  code: string;
  assetId: string;
  titleEn: string;
  titleAr: string;
  description?: string | null;
  publicationFrequency: string;
  publicationFormat: string;
  portalUrl?: string | null;
  status: string;
  ownerPersonId?: string | null;
  stewardPersonId?: string | null;
  odiaoReviewerPersonId?: string | null;
  personalDataAssessment: string;
  classificationSignal: string;
  dataQualitySignal: string;
  personalDataSignal: string;
  ownershipSignal: string;
  publicationValueSignal: string;
  publicationValueScore: number;
  eligibilityScore: number;
  decisionNote?: string | null;
  publishedAt?: string | null;
  nextReviewAt?: string | null;
  updatedAt: string;
  asset: AssetRef;
  classification?: ClassificationRef | null;
  dqScore?: DqScoreRef | null;
  ownerPerson?: PersonRef | null;
  stewardPerson?: PersonRef | null;
  odiaoReviewerPerson?: PersonRef | null;
}

interface OpenDataSummary {
  total: number;
  assessment: number;
  underReview: number;
  approved: number;
  published: number;
  rejected: number;
  overdueReview: number;
  avgEligibility: number;
}

interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface CandidateDraft {
  assetId: string;
  titleEn: string;
  titleAr: string;
  description: string;
  publicationFrequency: string;
  publicationFormat: string;
  portalUrl: string;
  ownerPersonId: string;
  stewardPersonId: string;
  odiaoReviewerPersonId: string;
  personalDataAssessment: string;
  publicationValueScore: number;
  decisionNote: string;
  nextReviewAt: string;
}

const STATUSES = ['draft', 'assessment', 'under_review', 'approved', 'published', 'rejected', 'retired'];
const FREQUENCIES = ['one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'on_demand'];
const FORMATS = ['csv', 'json', 'xlsx', 'api', 'geojson', 'pdf', 'other'];
const PERSONAL_ASSESSMENTS = ['none', 'aggregated', 'personal_data', 'sensitive_personal_data', 'unknown'];

@Component({
  selector: 'app-open-data',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Modal, StatusChip, AppIcon, Pager],
  templateUrl: './open-data.html',
  styleUrl: './open-data.scss',
})
export class OpenDataPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly summary = signal<OpenDataSummary | null>(null);
  protected readonly candidates = signal<OpenDataCandidate[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly filters = signal({ search: '', status: '', assetId: '' });
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly people = signal<PersonRef[]>([]);
  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly draft = signal<CandidateDraft>(this.emptyDraft());

  protected readonly statuses = STATUSES;
  protected readonly frequencies = FREQUENCIES;
  protected readonly formats = FORMATS;
  protected readonly personalAssessments = PERSONAL_ASSESSMENTS;

  protected readonly selected = computed(() =>
    this.candidates().find((candidate) => candidate.id === this.selectedId()) ?? this.candidates()[0] ?? null,
  );

  protected readonly reviewQueue = computed(() =>
    this.candidates().filter((candidate) =>
      ['assessment', 'under_review', 'approved'].includes(candidate.status),
    ),
  );

  protected readonly publishedCandidates = computed(() =>
    this.candidates().filter((candidate) => candidate.status === 'published'),
  );

  ngOnInit(): void {
    const routeId = this.route.snapshot.paramMap.get('id');
    const assetId = this.route.snapshot.queryParamMap.get('assetId') ?? '';
    if (routeId) this.selectedId.set(routeId);
    if (assetId) this.filters.update((f) => ({ ...f, assetId }));
    this.loadLookups();
    this.load();
  }

  protected get canCreate(): boolean {
    return this.auth.hasPermission('open_data_candidates.create');
  }

  protected get canEdit(): boolean {
    return this.auth.hasPermission('open_data_candidates.edit');
  }

  protected get canDelete(): boolean {
    return this.auth.hasPermission('open_data_candidates.delete');
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected name(item?: Ref | PersonRef | null): string {
    if (!item) return '-';
    if ('fullNameEn' in item) {
      return this.i18n.lang() === 'ar' ? item.fullNameAr : item.fullNameEn;
    }
    return this.i18n.lang() === 'ar' ? item.nameAr : item.nameEn;
  }

  protected date(value?: string | null): string {
    return value ? new Date(value).toLocaleDateString() : '-';
  }

  protected statusKind(status: string): StatusKind {
    if (status === 'published' || status === 'approved') return 'success';
    if (status === 'under_review' || status === 'assessment') return 'warning';
    if (status === 'rejected') return 'danger';
    return 'muted';
  }

  protected signalKind(signal: string): StatusKind {
    if (signal === 'ready') return 'success';
    if (signal === 'blocked') return 'danger';
    return 'warning';
  }

  protected eligibilityKind(score: number): StatusKind {
    if (score >= 80) return 'success';
    if (score >= 60) return 'warning';
    return 'danger';
  }

  protected setFilter(key: 'search' | 'status' | 'assetId', value: string): void {
    this.filters.update((f) => ({ ...f, [key]: value }));
    this.page.set(1);
    this.load();
  }

  protected clearFilters(): void {
    this.filters.set({ search: '', status: '', assetId: '' });
    this.page.set(1);
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    const f = this.filters();
    let params = new HttpParams();
    for (const [key, value] of Object.entries(f)) {
      if (value) params = params.set(key, value);
    }
    params = params
      .set('page', String(this.page()))
      .set('pageSize', String(this.pageSize()));
    forkJoin({
      summary: this.http.get<OpenDataSummary>('/api/open-data-candidates/summary'),
      candidates: this.http.get<Paged<OpenDataCandidate>>('/api/open-data-candidates', { params }),
    }).subscribe({
      next: ({ summary, candidates }) => {
        if (!candidates.data.length && candidates.total > 0 && candidates.page > candidates.totalPages) {
          this.page.set(candidates.totalPages);
          this.load();
          return;
        }
        this.summary.set(summary);
        this.candidates.set(candidates.data);
        this.total.set(candidates.total);
        this.totalPages.set(candidates.totalPages);
        this.page.set(candidates.page);
        const selectedId = this.selectedId();
        if (!selectedId || !candidates.data.some((candidate) => candidate.id === selectedId)) {
          this.selectedId.set(candidates.data[0]?.id ?? null);
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
    }).subscribe({
      next: ({ assets, people }) => {
        this.assets.set(assets);
        this.people.set(people);
      },
      error: () => {
        this.assets.set([]);
        this.people.set([]);
      },
    });
  }

  protected select(candidate: OpenDataCandidate): void {
    this.selectedId.set(candidate.id);
    void this.router.navigate(['/governance/open-data', candidate.id], { replaceUrl: true });
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected openCreate(assetId = ''): void {
    const asset = this.assets().find((a) => a.id === assetId);
    this.editingId.set(null);
    this.draft.set({
      ...this.emptyDraft(),
      assetId,
      titleEn: asset?.nameEn ?? '',
      titleAr: asset?.nameAr ?? '',
      description: '',
    });
    this.modalOpen.set(true);
  }

  protected openEdit(candidate: OpenDataCandidate): void {
    this.editingId.set(candidate.id);
    this.draft.set({
      assetId: candidate.assetId,
      titleEn: candidate.titleEn,
      titleAr: candidate.titleAr,
      description: candidate.description ?? '',
      publicationFrequency: candidate.publicationFrequency,
      publicationFormat: candidate.publicationFormat,
      portalUrl: candidate.portalUrl ?? '',
      ownerPersonId: candidate.ownerPersonId ?? '',
      stewardPersonId: candidate.stewardPersonId ?? '',
      odiaoReviewerPersonId: candidate.odiaoReviewerPersonId ?? '',
      personalDataAssessment: candidate.personalDataAssessment,
      publicationValueScore: candidate.publicationValueScore,
      decisionNote: candidate.decisionNote ?? '',
      nextReviewAt: candidate.nextReviewAt ? candidate.nextReviewAt.slice(0, 10) : '',
    });
    this.modalOpen.set(true);
  }

  protected closeModal(): void {
    this.modalOpen.set(false);
    this.saving.set(false);
  }

  protected save(): void {
    const d = this.draft();
    if (!d.assetId || !d.titleEn.trim() || !d.titleAr.trim()) {
      this.toast.error(this.t('openData.form.required'));
      return;
    }
    this.saving.set(true);
    const body = {
      assetId: d.assetId,
      titleEn: d.titleEn.trim(),
      titleAr: d.titleAr.trim(),
      description: d.description.trim() || null,
      publicationFrequency: d.publicationFrequency,
      publicationFormat: d.publicationFormat,
      portalUrl: d.portalUrl.trim() || null,
      ownerPersonId: d.ownerPersonId || null,
      stewardPersonId: d.stewardPersonId || null,
      odiaoReviewerPersonId: d.odiaoReviewerPersonId || null,
      personalDataAssessment: d.personalDataAssessment,
      publicationValueScore: Number(d.publicationValueScore) || 0,
      decisionNote: d.decisionNote.trim() || null,
      nextReviewAt: d.nextReviewAt || null,
    };
    const id = this.editingId();
    const request = id
      ? this.http.patch<OpenDataCandidate>(`/api/open-data-candidates/${id}`, body)
      : this.http.post<OpenDataCandidate>('/api/open-data-candidates', body);
    request.subscribe({
      next: (candidate) => {
        this.toast.success(id ? this.t('openData.saved') : this.t('openData.created'));
        this.closeModal();
        this.selectedId.set(candidate.id);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || this.t('openData.error'));
      },
    });
  }

  protected transition(candidate: OpenDataCandidate, status: string): void {
    this.http.patch<OpenDataCandidate>(`/api/open-data-candidates/${candidate.id}/status`, { status }).subscribe({
      next: (updated) => {
        this.toast.success(this.t('openData.statusUpdated'));
        this.selectedId.set(updated.id);
        this.load();
      },
      error: (err) => this.toast.error(err?.error?.message || this.t('openData.error')),
    });
  }

  protected async remove(candidate: OpenDataCandidate): Promise<void> {
    const ok = await this.confirm.ask('openData.delete.message');
    if (!ok) return;
    this.http.delete(`/api/open-data-candidates/${candidate.id}`).subscribe({
      next: () => {
        this.toast.success(this.t('openData.deleted'));
        this.selectedId.set(null);
        this.load();
      },
      error: () => this.toast.error(this.t('openData.error')),
    });
  }

  protected allowedNextStatuses(candidate: OpenDataCandidate): string[] {
    const map: Record<string, string[]> = {
      draft: ['assessment', 'under_review', 'rejected'],
      assessment: ['under_review', 'rejected'],
      under_review: ['approved', 'rejected', 'assessment'],
      approved: ['published', 'under_review', 'retired'],
      published: ['under_review', 'retired'],
      rejected: ['draft', 'assessment'],
      retired: [],
    };
    return map[candidate.status] ?? [];
  }

  private emptyDraft(): CandidateDraft {
    return {
      assetId: '',
      titleEn: '',
      titleAr: '',
      description: '',
      publicationFrequency: 'quarterly',
      publicationFormat: 'csv',
      portalUrl: '',
      ownerPersonId: '',
      stewardPersonId: '',
      odiaoReviewerPersonId: '',
      personalDataAssessment: 'unknown',
      publicationValueScore: 50,
      decisionNote: '',
      nextReviewAt: '',
    };
  }
}
