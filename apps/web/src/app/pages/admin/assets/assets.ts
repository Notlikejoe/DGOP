import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface Ref {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}
interface SystemRef extends Ref {
  ownerOrgUnitId?: string | null;
}
interface ClassRef extends Ref {
  rank: number;
  color: string;
}
interface SubjectLink {
  dataSubject: Ref;
}
interface AssetRel {
  id: string;
  type: string;
  description?: string | null;
  targetAsset?: Ref;
  sourceAsset?: Ref;
}
interface OpenDataCandidateMini {
  id: string;
  code: string;
  titleEn: string;
  titleAr: string;
  status: string;
  eligibilityScore: number;
  classificationSignal: string;
  dataQualitySignal: string;
  personalDataSignal: string;
  ownershipSignal: string;
  publicationValueSignal: string;
  nextReviewAt?: string | null;
  publishedAt?: string | null;
}
interface Asset {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  lifecycleStatus: string;
  ownerStatus: string;
  ownerName?: string | null;
  domainId?: string | null;
  orgUnitId?: string | null;
  systemId?: string | null;
  capabilityId?: string | null;
  classificationId?: string | null;
  domain?: Ref | null;
  orgUnit?: Ref | null;
  system?: Ref | null;
  capability?: Ref | null;
  classification?: ClassRef | null;
  subjects: SubjectLink[];
  outgoingRelations?: AssetRel[];
  incomingRelations?: AssetRel[];
  openDataCandidates?: OpenDataCandidateMini[];
  externalCatalogId?: string | null;
  catalogSource?: string | null;
  catalogSyncStatus?: string | null;
  catalogTrustLevel?: string | null;
  catalogLastSyncedAt?: string | null;
  catalogWritebackStatus?: string | null;
  isActive: boolean;
}

interface OwnerRec {
  roleType: { id: string; code: string; nameEn: string; nameAr: string };
  current: { id: string; person: { fullNameEn: string; fullNameAr: string }; source: string } | null;
  recommended: { scopeType: string; ruleId: string; person: { fullNameEn: string; fullNameAr: string } } | null;
  status: 'assigned' | 'recommended' | 'exception';
}

interface AssetAssignment {
  id: string;
  approvalStatus: string;
  isPrimary: boolean;
  roleType: { nameEn: string; nameAr: string };
  person: { fullNameEn: string; fullNameAr: string };
}

interface UserRef {
  id: string;
  email: string;
  displayName: string;
}

const APPROVAL_KIND: Record<string, StatusKind> = {
  draft: 'muted',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

interface Draft {
  code: string;
  nameEn: string;
  nameAr: string;
  description: string;
  lifecycleStatus: string;
  ownerName: string;
  domainId: string;
  orgUnitId: string;
  systemId: string;
  capabilityId: string;
  classificationId: string;
  subjectIds: string[];
}

interface Filters {
  search: string;
  domainId: string;
  subjectId: string;
  classificationId: string;
  systemId: string;
  lifecycleStatus: string;
  ownerStatus: string;
}

const SAMPLE_CSV = `code,nameEn,nameAr,description,lifecycleStatus,ownerName,domainCode,orgUnitCode,systemCode,capabilityCode,classificationCode,subjectCodes
AST-SAMPLE-1,Sample Claims Dataset,مجموعة مطالبات,Sample import row,active,Sample Owner,finance,,,revenue_cycle,internal,patient|supplier`;

const ASSET_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const ASSET_CODE_MAX = 48;
const ASSET_NAME_MAX = 180;
const ASSET_DESCRIPTION_MAX = 1000;
const ASSET_OWNER_MAX = 160;
const MIN_PERSONAL_DATA_CLASSIFICATION_RANK = 2;

@Component({
  selector: 'app-admin-assets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Modal, StatusChip],
  templateUrl: './assets.html',
  styleUrl: './assets.scss',
})
export class AssetsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly assets = signal<Asset[]>([]);
  protected readonly view = signal<'list' | 'detail'>('list');
  protected readonly detail = signal<Asset | null>(null);

  // Lookups
  protected readonly domains = signal<Ref[]>([]);
  protected readonly orgUnits = signal<Ref[]>([]);
  protected readonly systems = signal<SystemRef[]>([]);
  protected readonly capabilities = signal<Ref[]>([]);
  protected readonly classifications = signal<ClassRef[]>([]);
  protected readonly subjects = signal<Ref[]>([]);

  protected readonly filters = signal<Filters>({
    search: '',
    domainId: '',
    subjectId: '',
    classificationId: '',
    systemId: '',
    lifecycleStatus: '',
    ownerStatus: '',
  });

  // Create / edit modal
  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<Draft>(this.emptyDraft());
  protected readonly saving = signal(false);

  // CSV import modal
  protected readonly importOpen = signal(false);
  protected readonly importCsv = signal('');
  protected readonly importing = signal(false);
  protected readonly importResult = signal<{
    processed: number;
    created: number;
    updated: number;
    errors: { row: number; message: string }[];
  } | null>(null);

  // Relationship form (in Asset 360)
  protected readonly relType = signal('related_to');
  protected readonly relTargetId = signal('');
  protected readonly relSaving = signal(false);

  // Ownership recommendations (in Asset 360)
  protected readonly recommendations = signal<OwnerRec[]>([]);
  protected readonly applyingRole = signal<string | null>(null);

  // Approval surfacing (in Asset 360)
  protected readonly assetAssignments = signal<AssetAssignment[]>([]);
  protected readonly users = signal<UserRef[]>([]);
  protected readonly submitTarget = signal<AssetAssignment | null>(null);
  protected readonly approverId = signal('');
  protected readonly submitDue = signal('');
  protected readonly submitting = signal(false);
  protected readonly approvalKindMap = APPROVAL_KIND;

  protected readonly lifecycles = ['draft', 'active', 'deprecated', 'retired'];
  protected readonly relTypes = ['derived_from', 'feeds', 'replicates', 'related_to'];
  protected readonly assetCodeMax = ASSET_CODE_MAX;
  protected readonly assetCodePatternText = ASSET_CODE_PATTERN.source;
  protected readonly assetNameMax = ASSET_NAME_MAX;
  protected readonly assetDescriptionMax = ASSET_DESCRIPTION_MAX;
  protected readonly assetOwnerMax = ASSET_OWNER_MAX;
  private requestedAssetId: string | null = null;

  ngOnInit(): void {
    this.requestedAssetId = this.route.snapshot.queryParamMap.get('assetId');
    this.loadLookups();
    this.load();
  }

  // ---------- permissions ----------
  protected get canCreate(): boolean {
    return this.auth.hasPermission('data_assets.create');
  }
  protected get canEdit(): boolean {
    return this.auth.hasPermission('data_assets.edit');
  }
  protected get canDelete(): boolean {
    return this.auth.hasPermission('data_assets.delete');
  }
  protected get canImport(): boolean {
    return this.auth.hasPermission('data_assets.import');
  }
  protected get canViewOwnership(): boolean {
    return this.auth.hasPermission('assignments.view');
  }
  protected get canViewIntegrations(): boolean {
    return this.auth.hasPermission('integrations.view');
  }
  protected get canViewOpenData(): boolean {
    return this.auth.hasPermission('open_data_candidates.view');
  }
  protected get canCreateOpenData(): boolean {
    return this.auth.hasPermission('open_data_candidates.create');
  }
  protected get canApplyOwnership(): boolean {
    return this.auth.hasPermission('assignments.create');
  }

  // ---------- loading ----------
  protected load(): void {
    this.state.set('loading');
    const f = this.filters();
    let params = new HttpParams();
    for (const [k, v] of Object.entries(f)) {
      if (v) params = params.set(k, v);
    }
    this.http.get<Asset[]>('/api/assets', { params }).subscribe({
      next: (a) => {
        this.assets.set(a);
        this.state.set('ok');
        if (this.requestedAssetId) {
          const id = this.requestedAssetId;
          this.requestedAssetId = null;
          this.openDetail(id);
        }
      },
      error: () => this.state.set('error'),
    });
  }

  private loadLookups(): void {
    forkJoin({
      domains: this.http.get<Ref[]>('/api/data-domains'),
      orgUnits: this.http.get<Ref[]>('/api/org-units'),
      systems: this.http.get<SystemRef[]>('/api/systems'),
      capabilities: this.http.get<Ref[]>('/api/business-capabilities'),
      classifications: this.http.get<ClassRef[]>('/api/classifications'),
      subjects: this.http.get<Ref[]>('/api/data-subjects'),
    }).subscribe((r) => {
      this.domains.set(r.domains);
      this.orgUnits.set(r.orgUnits);
      this.systems.set(r.systems);
      this.capabilities.set(r.capabilities);
      this.classifications.set(r.classifications);
      this.subjects.set(r.subjects);
    });
    if (this.canSubmitForApproval) {
      this.http.get<UserRef[]>('/api/users').subscribe({
        next: (u) => this.users.set(u),
        error: () => this.users.set([]),
      });
    }
  }

  // ---------- filters ----------
  protected setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    this.filters.update((f) => ({ ...f, [key]: value }));
    this.load();
  }

  // ---------- helpers ----------
  protected name(o?: { nameEn: string; nameAr: string } | null): string {
    if (!o) return this.t('assets.none');
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }

  protected lifecycleKind(status: string): StatusKind {
    switch (status) {
      case 'active':
        return 'success';
      case 'deprecated':
        return 'warning';
      case 'retired':
        return 'danger';
      default:
        return 'muted';
    }
  }

  protected ownerKind(status: string): StatusKind {
    return status === 'assigned' ? 'success' : 'muted';
  }

  protected catalogKind(status?: string | null): StatusKind {
    if (status === 'synced' || status === 'writeback_simulated') return 'success';
    if (status === 'stale') return 'warning';
    if (status === 'error') return 'danger';
    return 'muted';
  }

  protected openDataKind(status: string): StatusKind {
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

  protected date(value?: string | null): string {
    return value ? new Date(value).toLocaleString() : '-';
  }

  protected subjectNames(a: Asset): string {
    if (!a.subjects?.length) return this.t('assets.none');
    return a.subjects.map((s) => this.name(s.dataSubject)).join(', ');
  }

  protected relTypeLabel(type: string): string {
    return this.t('assets.rel.' + type);
  }

  // ---------- create / edit ----------
  private emptyDraft(): Draft {
    return {
      code: '',
      nameEn: '',
      nameAr: '',
      description: '',
      lifecycleStatus: 'draft',
      ownerName: '',
      domainId: '',
      orgUnitId: '',
      systemId: '',
      capabilityId: '',
      classificationId: '',
      subjectIds: [],
    };
  }

  protected set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    const next = key === 'code' && typeof value === 'string' ? value.trim().toUpperCase() : value;
    this.draft.update((d) => ({ ...d, [key]: next as Draft[K] }));
  }

  protected toggleSubject(id: string): void {
    this.draft.update((d) => {
      const has = d.subjectIds.includes(id);
      return {
        ...d,
        subjectIds: has ? d.subjectIds.filter((x) => x !== id) : [...d.subjectIds, id],
      };
    });
  }

  protected isSubjectSelected(id: string): boolean {
    return this.draft().subjectIds.includes(id);
  }

  protected openCreate(): void {
    this.draft.set(this.emptyDraft());
    this.editingId.set(null);
    this.modalOpen.set(true);
  }

  protected openEdit(a: Asset): void {
    this.draft.set({
      code: a.code,
      nameEn: a.nameEn,
      nameAr: a.nameAr,
      description: a.description ?? '',
      lifecycleStatus: a.lifecycleStatus,
      ownerName: a.ownerName ?? '',
      domainId: a.domainId ?? '',
      orgUnitId: a.orgUnitId ?? '',
      systemId: a.systemId ?? '',
      capabilityId: a.capabilityId ?? '',
      classificationId: a.classificationId ?? '',
      subjectIds: a.subjects.map((s) => s.dataSubject.id),
    });
    this.editingId.set(a.id);
    this.modalOpen.set(true);
  }

  protected canSave(): boolean {
    const d = this.draft();
    return !!(d.code.trim() && d.nameEn.trim() && d.nameAr.trim()) && this.validationErrors().length === 0;
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const d = this.draft();
    const id = this.editingId();
    const body: Record<string, unknown> = {
      ...(id ? {} : { code: d.code.trim().toUpperCase() }),
      nameEn: d.nameEn.trim(),
      nameAr: d.nameAr.trim(),
      description: d.description.trim() || null,
      lifecycleStatus: d.lifecycleStatus,
      ownerName: d.ownerName.trim() || null,
      domainId: d.domainId || null,
      orgUnitId: d.orgUnitId || null,
      systemId: d.systemId || null,
      capabilityId: d.capabilityId || null,
      classificationId: d.classificationId || null,
      subjectIds: [...new Set(d.subjectIds)],
    };
    const req = id
      ? this.http.patch('/api/assets/' + id, body)
      : this.http.post('/api/assets', body);
    req.subscribe({
      next: () => {
        this.toast.success(this.t(id ? 'assets.updated' : 'assets.created'));
        this.saving.set(false);
        this.modalOpen.set(false);
        this.load();
        if (id && this.view() === 'detail') this.openDetail(id);
      },
      error: (err) => { this.toast.errorFrom(err, this.t('assets.saveError'));
        this.saving.set(false);
      },
    });
  }

  protected close(): void {
    this.modalOpen.set(false);
  }

  private selectedSystem(): SystemRef | undefined {
    const systemId = this.draft().systemId;
    return systemId ? this.systems().find((system) => system.id === systemId) : undefined;
  }

  private selectedClassification(): ClassRef | undefined {
    const classificationId = this.draft().classificationId;
    return classificationId
      ? this.classifications().find((classification) => classification.id === classificationId)
      : undefined;
  }

  protected validationErrors(): string[] {
    const d = this.draft();
    const errors: string[] = [];
    const code = d.code.trim().toUpperCase();
    const nameEn = d.nameEn.trim();
    const nameAr = d.nameAr.trim();
    const description = d.description.trim();
    const ownerName = d.ownerName.trim();
    const classification = this.selectedClassification();
    const system = this.selectedSystem();

    if (!this.editingId() && !code) errors.push(this.t('assets.validation.codeRequired'));
    if (code.length > ASSET_CODE_MAX) errors.push(this.t('assets.validation.codeLength'));
    if (code && !ASSET_CODE_PATTERN.test(code)) errors.push(this.t('assets.validation.codeFormat'));
    if (!nameEn) errors.push(this.t('assets.validation.nameEnRequired'));
    if (!nameAr) errors.push(this.t('assets.validation.nameArRequired'));
    if (nameEn.length > ASSET_NAME_MAX || nameAr.length > ASSET_NAME_MAX) {
      errors.push(this.t('assets.validation.nameLength'));
    }
    if (description.length > ASSET_DESCRIPTION_MAX) errors.push(this.t('assets.validation.descriptionLength'));
    if (ownerName.length > ASSET_OWNER_MAX) errors.push(this.t('assets.validation.ownerLength'));
    if (d.subjectIds.length > 0 && !classification) {
      errors.push(this.t('assets.validation.subjectNeedsClassification'));
    }
    if (d.subjectIds.length > 0 && classification && classification.rank < MIN_PERSONAL_DATA_CLASSIFICATION_RANK) {
      errors.push(this.t('assets.validation.subjectNotPublic'));
    }
    if (d.orgUnitId && system?.ownerOrgUnitId && system.ownerOrgUnitId !== d.orgUnitId) {
      errors.push(this.t('assets.validation.systemOrgMismatch'));
    }
    return errors;
  }

  protected async deleteAsset(a: Asset): Promise<void> {
    const ok = await this.confirm.ask('assets.confirmDelete');
    if (!ok) return;
    this.http.delete('/api/assets/' + a.id).subscribe({
      next: () => {
        this.toast.success(this.t('assets.deleted'));
        if (this.view() === 'detail') this.backToList();
        this.load();
      },
      error: (err) => this.toast.errorFrom(err, this.t('assets.saveError')),
    });
  }

  // ---------- Asset 360 ----------
  protected openDetail(id: string): void {
    this.http.get<Asset>('/api/assets/' + id).subscribe({
      next: (a) => {
        this.detail.set(a);
        this.view.set('detail');
        this.relType.set('related_to');
        this.relTargetId.set('');
        this.loadRecommendations(id);
        this.loadAssetAssignments(id);
      },
      error: (err) => this.toast.errorFrom(err, this.t('assets.error')),
    });
  }

  private loadRecommendations(id: string): void {
    this.recommendations.set([]);
    if (!this.canViewOwnership) return;
    this.http.get<OwnerRec[]>(`/api/assets/${id}/recommendations`).subscribe({
      next: (r) => this.recommendations.set(r),
      error: () => this.recommendations.set([]),
    });
  }

  private loadAssetAssignments(id: string): void {
    this.assetAssignments.set([]);
    if (!this.canViewOwnership) return;
    let params = new HttpParams().set('targetType', 'asset').set('targetId', id);
    this.http.get<AssetAssignment[]>('/api/assignments', { params }).subscribe({
      next: (a) => this.assetAssignments.set(a),
      error: () => this.assetAssignments.set([]),
    });
  }

  // ---------- approval ----------
  protected get canSubmitForApproval(): boolean {
    return this.auth.hasPermission('assignments.edit');
  }
  protected approvalKind(status: string): StatusKind {
    return this.approvalKindMap[status] ?? 'muted';
  }
  protected canSubmit(a: AssetAssignment): boolean {
    return this.canSubmitForApproval && (a.approvalStatus === 'draft' || a.approvalStatus === 'rejected');
  }
  protected openSubmit(a: AssetAssignment): void {
    this.submitTarget.set(a);
    this.approverId.set('');
    this.submitDue.set('');
  }
  protected closeSubmit(): void {
    this.submitTarget.set(null);
  }
  protected submitForApproval(): void {
    const a = this.submitTarget();
    if (!a || !this.approverId() || this.submitting()) return;
    this.submitting.set(true);
    this.http
      .post('/api/workflow/assignments/submit-for-approval', {
        assignmentId: a.id,
        approverUserId: this.approverId(),
        dueDate: this.submitDue() ? new Date(this.submitDue()).toISOString() : null,
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('assets.approval.submitted'));
          this.submitting.set(false);
          this.submitTarget.set(null);
          const d = this.detail();
          if (d) this.loadAssetAssignments(d.id);
        },
        error: (e) => {
          this.toast.errorFrom(e, this.t('assets.saveError'));
          this.submitting.set(false);
        },
      });
  }

  protected visibleRecommendations(): OwnerRec[] {
    // Show responsibilities that are assigned or recommended; hide pure exceptions to reduce noise.
    return this.recommendations().filter((r) => r.status !== 'exception');
  }

  protected personName(p?: { fullNameEn: string; fullNameAr: string } | null): string {
    if (!p) return '-';
    return this.i18n.lang() === 'ar' ? p.fullNameAr : p.fullNameEn;
  }

  protected ownStatusKind(status: string): StatusKind {
    switch (status) {
      case 'assigned':
        return 'success';
      case 'recommended':
        return 'info';
      default:
        return 'warning';
    }
  }

  protected scopeLabel(scope: string): string {
    return this.t('dim.' + scope);
  }

  protected applyRecommendation(rec: OwnerRec): void {
    const d = this.detail();
    if (!d || !rec.recommended || this.applyingRole()) return;
    this.applyingRole.set(rec.roleType.id);
    this.http
      .post('/api/assignments/apply-recommendation', { assetId: d.id, roleTypeId: rec.roleType.id })
      .subscribe({
        next: () => {
          this.toast.success(this.t('assets.own.applied'));
          this.applyingRole.set(null);
          this.openDetail(d.id);
          this.load();
        },
        error: (err) => { this.toast.errorFrom(err, this.t('assets.saveError'));
          this.applyingRole.set(null);
        },
      });
  }

  protected backToList(): void {
    this.view.set('list');
    this.detail.set(null);
  }

  protected otherAssets(): Asset[] {
    const current = this.detail()?.id;
    return this.assets().filter((a) => a.id !== current);
  }

  protected addRelationship(): void {
    const d = this.detail();
    const target = this.relTargetId();
    if (!d || !target || this.relSaving()) return;
    this.relSaving.set(true);
    this.http
      .post(`/api/assets/${d.id}/relationships`, {
        targetAssetId: target,
        type: this.relType(),
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('assets.relAdded'));
          this.relSaving.set(false);
          this.relTargetId.set('');
          this.openDetail(d.id);
        },
        error: (err) => { this.toast.errorFrom(err, this.t('assets.saveError'));
          this.relSaving.set(false);
        },
      });
  }

  protected registerOpenDataCandidate(asset: Asset): void {
    if (!this.canCreateOpenData) return;
    this.http.post<any>(`/api/open-data-candidates/from-asset/${asset.id}`, {}).subscribe({
      next: () => {
        this.toast.success(this.t('assets.openData.registered'));
        this.openDetail(asset.id);
        this.view.set('detail');
      },
      error: (err) => this.toast.errorFrom(err, this.t('openData.error')),
    });
  }

  protected async removeRelationship(rel: AssetRel): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const ok = await this.confirm.ask('crud.confirmDelete');
    if (!ok) return;
    this.http.delete(`/api/assets/${d.id}/relationships/${rel.id}`).subscribe({
      next: () => {
        this.toast.success(this.t('assets.relRemoved'));
        this.openDetail(d.id);
      },
      error: (err) => this.toast.errorFrom(err, this.t('assets.saveError')),
    });
  }

  // ---------- CSV import ----------
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
    this.http
      .post<{
        processed: number;
        created: number;
        updated: number;
        errors: { row: number; message: string }[];
      }>('/api/assets/import', { csv: this.importCsv() })
      .subscribe({
        next: (res) => {
          this.importResult.set(res);
          this.importing.set(false);
          this.load();
        },
        error: (err) => { this.toast.errorFrom(err, this.t('assets.saveError'));
          this.importing.set(false);
        },
      });
  }

  protected importSummary(): string {
    const r = this.importResult();
    if (!r) return '';
    return this.t('assets.import.result')
      .replace('{processed}', String(r.processed))
      .replace('{created}', String(r.created))
      .replace('{updated}', String(r.updated))
      .replace('{errors}', String(r.errors.length));
  }

  protected closeImport(): void {
    this.importOpen.set(false);
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
