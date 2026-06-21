import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { Pager } from '../../../shared/pager';
import {
  EVIDENCE_STATUS_KIND,
  EvidenceStatus,
  MATURITY_LEVELS,
  NdiDomainCount,
  NdiEvidence,
  NdiSpec,
  PersonRef,
  SPEC_TYPE_KIND,
  SPEC_TYPES,
} from './ndi.types';

interface Filters {
  search: string;
  domainId: string;
  type: string;
  maturityLevel: string;
  status: string;
}

interface Draft {
  code: string;
  domainId: string;
  nameEn: string;
  nameAr: string;
  criterion: string;
  type: string;
  maturityLevel: string;
  descriptionEn: string;
  descriptionAr: string;
  acceptanceCriteria: string;
  reference: string;
  ownerPersonId: string;
  isActive: boolean;
}

interface UploadDraft {
  title: string;
  expiryDate: string;
  submitNow: boolean;
  file: File | null;
}

const SAMPLE_CSV = `code,domainCode,criterion,type,maturityLevel,nameEn,nameAr,descriptionEn,acceptanceCriteria,reference
DG.3.1,data_strategy,Strategy,standard,level_2,Sample specification,مواصفة عينة,Sample description,Sample acceptance criteria,NDI DG-99`;

@Component({
  selector: 'app-ndi-registry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Modal, StatusChip, Pager, DatePipe],
  templateUrl: './ndi-registry.html',
  styleUrl: './ndi.scss',
})
export class NdiRegistryPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly specs = signal<NdiSpec[]>([]);
  protected readonly domains = signal<NdiDomainCount[]>([]);
  protected readonly view = signal<'list' | 'detail'>('list');
  protected readonly detail = signal<NdiSpec | null>(null);
  protected readonly people = signal<PersonRef[]>([]);

  protected readonly types = SPEC_TYPES;
  protected readonly levels = MATURITY_LEVELS;

  // evidence (shown on the spec detail)
  protected readonly evidence = signal<NdiEvidence[]>([]);
  protected readonly evidenceState = signal<'idle' | 'loading' | 'ok' | 'error'>('idle');
  protected readonly upload = signal<UploadDraft>(this.emptyUpload());
  protected readonly uploading = signal(false);
  protected readonly busyEvidenceId = signal<string | null>(null);

  // pagination
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);

  protected readonly filters = signal<Filters>({
    search: '',
    domainId: '',
    type: '',
    maturityLevel: '',
    status: 'active',
  });

  // create / edit modal
  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<Draft>(this.emptyDraft());
  protected readonly saving = signal(false);

  // import modal
  protected readonly importOpen = signal(false);
  protected readonly importCsv = signal('');
  protected readonly importing = signal(false);
  protected readonly importResult = signal<{
    processed: number;
    created: number;
    updated: number;
    errors: { row: number; message: string }[];
  } | null>(null);

  ngOnInit(): void {
    const domainId = this.route.snapshot.queryParamMap.get('domainId');
    if (domainId) this.filters.update((f) => ({ ...f, domainId }));
    this.http.get<NdiDomainCount[]>('/api/ndi/domains').subscribe((d) => this.domains.set(d));
    // People power the spec "owner" dropdown; tolerate missing permission.
    if (this.auth.hasPermission('people.view')) {
      this.http
        .get<PersonRef[] | { data: PersonRef[] }>('/api/people')
        .subscribe((r) => this.people.set(Array.isArray(r) ? r : r.data));
    }
    // Deep-link: /governance/ndi/specifications/:id opens that spec directly.
    const specId = this.route.snapshot.paramMap.get('id');
    if (specId) this.openDetail(specId);
    this.load();
  }

  // ---------- permissions ----------
  protected get canCreate(): boolean { return this.auth.hasPermission('ndi_specifications.create'); }
  protected get canEdit(): boolean { return this.auth.hasPermission('ndi_specifications.edit'); }
  protected get canDelete(): boolean { return this.auth.hasPermission('ndi_specifications.delete'); }
  protected get canImport(): boolean { return this.auth.hasPermission('ndi_specifications.import'); }
  protected get canEvidenceView(): boolean { return this.auth.hasPermission('evidence.view'); }
  protected get canEvidenceCreate(): boolean { return this.auth.hasPermission('evidence.create'); }
  protected get canEvidenceReview(): boolean { return this.auth.hasPermission('evidence.review'); }
  protected get canEvidenceDelete(): boolean { return this.auth.hasPermission('evidence.delete'); }

  // ---------- loading ----------
  protected load(): void {
    this.state.set('loading');
    const f = this.filters();
    let params = new HttpParams()
      .set('page', String(this.page()))
      .set('pageSize', String(this.pageSize()));
    if (f.search) params = params.set('search', f.search);
    if (f.domainId) params = params.set('domainId', f.domainId);
    if (f.type) params = params.set('type', f.type);
    if (f.maturityLevel) params = params.set('maturityLevel', f.maturityLevel);
    if (f.status) params = params.set('status', f.status);
    this.http
      .get<{ data: NdiSpec[]; total: number; page: number; totalPages: number }>(
        '/api/ndi/specifications',
        { params },
      )
      .subscribe({
        next: (res) => {
          this.specs.set(res.data);
          this.total.set(res.total);
          this.totalPages.set(res.totalPages);
          this.page.set(res.page);
          this.state.set('ok');
        },
        error: () => this.state.set('error'),
      });
  }

  protected goToPage(p: number): void {
    this.page.set(p);
    this.load();
  }

  protected setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    this.filters.update((f) => ({ ...f, [key]: value }));
    this.page.set(1);
    this.load();
  }

  protected resetFilters(): void {
    this.filters.set({ search: '', domainId: '', type: '', maturityLevel: '', status: 'active' });
    this.page.set(1);
    this.load();
  }

  // ---------- helpers ----------
  protected t(key: string): string { return this.i18n.t(key); }
  protected name(o?: { nameEn: string; nameAr: string } | null): string {
    if (!o) return '-';
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected specName(s: NdiSpec): string {
    return this.i18n.lang() === 'ar' ? s.nameAr : s.nameEn;
  }
  protected specDescription(s: NdiSpec): string {
    const v = this.i18n.lang() === 'ar' ? s.descriptionAr : s.descriptionEn;
    return v || '';
  }
  protected typeKind(t: string): StatusKind { return SPEC_TYPE_KIND[t] ?? 'muted'; }

  // ---------- detail ----------
  protected openDetail(id: string): void {
    this.http.get<NdiSpec>('/api/ndi/specifications/' + id).subscribe({
      next: (s) => {
        this.detail.set(s);
        this.view.set('detail');
        this.upload.set(this.emptyUpload());
        this.loadEvidence(s.id);
      },
      error: () => this.toast.error(this.t('ndi.loadError')),
    });
  }
  protected backToList(): void {
    this.view.set('list');
    this.detail.set(null);
    this.evidence.set([]);
    this.evidenceState.set('idle');
    // Drop the deep-link :id from the URL so a refresh returns to the list.
    if (this.route.snapshot.paramMap.get('id')) {
      void this.router.navigate(['/governance/ndi/specifications']);
    }
  }

  // ---------- create / edit ----------
  private emptyDraft(): Draft {
    return {
      code: '', domainId: '', nameEn: '', nameAr: '', criterion: '',
      type: 'standard', maturityLevel: 'level_1',
      descriptionEn: '', descriptionAr: '', acceptanceCriteria: '', reference: '',
      ownerPersonId: '', isActive: true,
    };
  }

  private emptyUpload(): UploadDraft {
    return { title: '', expiryDate: '', submitNow: true, file: null };
  }

  protected openCreate(): void {
    this.editingId.set(null);
    this.draft.set({ ...this.emptyDraft(), domainId: this.filters().domainId || '' });
    this.modalOpen.set(true);
  }

  protected openEdit(s: NdiSpec): void {
    this.editingId.set(s.id);
    this.draft.set({
      code: s.code,
      domainId: s.domainId,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      criterion: s.criterion ?? '',
      type: s.type,
      maturityLevel: s.maturityLevel,
      descriptionEn: s.descriptionEn ?? '',
      descriptionAr: s.descriptionAr ?? '',
      acceptanceCriteria: s.acceptanceCriteria ?? '',
      reference: s.reference ?? '',
      ownerPersonId: s.ownerPersonId ?? '',
      isActive: s.isActive,
    });
    this.modalOpen.set(true);
  }

  protected closeModal(): void { this.modalOpen.set(false); }

  protected setDraft<K extends keyof Draft>(key: K, value: Draft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected get draftValid(): boolean {
    const d = this.draft();
    return !!(d.code.trim() && d.domainId && d.nameEn.trim() && d.nameAr.trim());
  }

  protected save(): void {
    if (!this.draftValid || this.saving()) return;
    this.saving.set(true);
    const d = this.draft();
    const payload = {
      code: d.code.trim(),
      domainId: d.domainId,
      nameEn: d.nameEn.trim(),
      nameAr: d.nameAr.trim(),
      criterion: d.criterion.trim() || null,
      type: d.type,
      maturityLevel: d.maturityLevel,
      descriptionEn: d.descriptionEn.trim() || null,
      descriptionAr: d.descriptionAr.trim() || null,
      acceptanceCriteria: d.acceptanceCriteria.trim() || null,
      reference: d.reference.trim() || null,
      ownerPersonId: d.ownerPersonId || null,
      isActive: d.isActive,
    };
    const id = this.editingId();
    const req = id
      ? this.http.patch(`/api/ndi/specifications/${id}`, payload)
      : this.http.post('/api/ndi/specifications', payload);
    req.subscribe({
      next: () => {
        this.toast.success(this.t('ndi.saved'));
        this.saving.set(false);
        this.modalOpen.set(false);
        const openId = this.detail()?.id;
        if (this.view() === 'detail' && id && id === openId) {
          // Refresh the open detail so an owner change is reflected immediately.
          this.http.get<NdiSpec>('/api/ndi/specifications/' + id).subscribe((s) => this.detail.set(s));
        }
        this.load();
      },
      error: (e) => {
        this.toast.error(e?.error?.message || this.t('ndi.saveError'));
        this.saving.set(false);
      },
    });
  }

  protected async remove(s: NdiSpec): Promise<void> {
    const ok = await this.confirm.ask('crud.confirmDelete');
    if (!ok) return;
    this.http.delete(`/api/ndi/specifications/${s.id}`).subscribe({
      next: () => {
        this.toast.success(this.t('ndi.deleted'));
        if (this.view() === 'detail') this.backToList();
        this.load();
      },
      error: () => this.toast.error(this.t('ndi.saveError')),
    });
  }

  // ---------- import ----------
  protected openImport(): void {
    this.importCsv.set('');
    this.importResult.set(null);
    this.importOpen.set(true);
  }
  protected insertSample(): void { this.importCsv.set(SAMPLE_CSV); }

  protected runImport(): void {
    if (!this.importCsv().trim() || this.importing()) return;
    this.importing.set(true);
    this.http
      .post<{
        processed: number;
        created: number;
        updated: number;
        errors: { row: number; message: string }[];
      }>('/api/ndi/specifications/import', { csv: this.importCsv() })
      .subscribe({
        next: (r) => {
          this.importResult.set(r);
          this.importing.set(false);
          this.toast.success(this.t('ndi.importDone'));
          this.load();
        },
        error: (e) => {
          this.toast.error(e?.error?.message || this.t('ndi.saveError'));
          this.importing.set(false);
        },
      });
  }

  // ---------- evidence ----------
  protected ownerName(s: NdiSpec | null): string {
    if (!s?.owner) return this.t('evidence.noOwner');
    return this.i18n.lang() === 'ar' ? s.owner.fullNameAr : s.owner.fullNameEn;
  }

  protected evidenceKind(e: NdiEvidence): StatusKind {
    return EVIDENCE_STATUS_KIND[e.effectiveStatus] ?? 'muted';
  }
  protected evidenceStatusLabel(s: EvidenceStatus): string {
    return this.t('evidence.status.' + s);
  }
  protected formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  protected loadEvidence(specId: string): void {
    if (!this.canEvidenceView) return;
    this.evidenceState.set('loading');
    this.http.get<NdiEvidence[]>(`/api/ndi/specifications/${specId}/evidence`).subscribe({
      next: (rows) => { this.evidence.set(rows); this.evidenceState.set('ok'); },
      error: () => this.evidenceState.set('error'),
    });
  }

  protected setUpload<K extends keyof UploadDraft>(key: K, value: UploadDraft[K]): void {
    this.upload.update((u) => ({ ...u, [key]: value }));
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.upload.update((u) => ({ ...u, file, title: u.title || (file?.name ?? '') }));
  }

  protected get uploadValid(): boolean {
    const u = this.upload();
    return !!(u.file && u.title.trim());
  }

  protected uploadEvidence(): void {
    const spec = this.detail();
    const u = this.upload();
    if (!spec || !this.uploadValid || !u.file || this.uploading()) return;
    this.uploading.set(true);
    const form = new FormData();
    form.append('file', u.file);
    form.append('specId', spec.id);
    form.append('title', u.title.trim());
    if (u.expiryDate) form.append('expiryDate', u.expiryDate);
    form.append('submit', String(u.submitNow));
    this.http.post('/api/evidence', form).subscribe({
      next: () => {
        this.toast.success(this.t('evidence.uploaded'));
        this.uploading.set(false);
        this.upload.set(this.emptyUpload());
        this.loadEvidence(spec.id);
      },
      error: (e) => {
        this.toast.error(e?.error?.message || this.t('evidence.uploadError'));
        this.uploading.set(false);
      },
    });
  }

  private evidenceAction(id: string, url: string, body: unknown, successKey: string): void {
    const spec = this.detail();
    if (!spec || this.busyEvidenceId()) return;
    this.busyEvidenceId.set(id);
    this.http.post(url, body).subscribe({
      next: () => {
        this.toast.success(this.t(successKey));
        this.busyEvidenceId.set(null);
        this.loadEvidence(spec.id);
      },
      error: (e) => {
        this.toast.error(e?.error?.message || this.t('evidence.actionError'));
        this.busyEvidenceId.set(null);
      },
    });
  }

  protected submitEvidence(e: NdiEvidence): void {
    this.evidenceAction(e.id, `/api/evidence/${e.id}/submit`, {}, 'evidence.submitted');
  }

  protected async reviewEvidence(e: NdiEvidence, decision: 'approve' | 'reject'): Promise<void> {
    const comment = window.prompt(this.t('evidence.reviewCommentPrompt')) ?? '';
    this.evidenceAction(
      e.id,
      `/api/evidence/${e.id}/review`,
      { decision, comment: comment || null },
      decision === 'approve' ? 'evidence.approved' : 'evidence.rejected',
    );
  }

  protected async revokeEvidence(e: NdiEvidence): Promise<void> {
    const ok = await this.confirm.ask('evidence.confirmRevoke');
    if (!ok) return;
    this.evidenceAction(e.id, `/api/evidence/${e.id}/revoke`, {}, 'evidence.revoked');
  }

  protected async deleteEvidence(e: NdiEvidence): Promise<void> {
    const spec = this.detail();
    const ok = await this.confirm.ask('crud.confirmDelete');
    if (!ok || !spec) return;
    this.busyEvidenceId.set(e.id);
    this.http.delete(`/api/evidence/${e.id}`).subscribe({
      next: () => {
        this.toast.success(this.t('evidence.deleted'));
        this.busyEvidenceId.set(null);
        this.loadEvidence(spec.id);
      },
      error: () => {
        this.toast.error(this.t('evidence.actionError'));
        this.busyEvidenceId.set(null);
      },
    });
  }

  protected downloadEvidence(e: NdiEvidence): void {
    this.http.get(`/api/evidence/${e.id}/file`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = e.originalName;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toast.error(this.t('evidence.downloadError')),
    });
  }
}
