import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { I18nService } from '../../../core/i18n.service';

interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface AssetRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  assetType: string;
  assetSubtype?: string | null;
  lifecycleStatus?: string;
  ownerStatus?: string;
  ownerName?: string | null;
  domain?: { id: string; code: string; nameEn: string; nameAr?: string | null } | null;
  classification?: { id: string; code: string; nameEn: string; nameAr?: string | null } | null;
  system?: { id: string; code: string; nameEn: string; nameAr?: string | null } | null;
}

interface PermissionRef {
  id: string;
  code: string;
  assetType: string;
  action: string;
  nameEn: string;
  nameAr?: string | null;
  description?: string | null;
  riskLevel?: string | null;
}

interface PrincipalRef {
  type: 'role' | 'group';
  id: string;
  label: string;
  nameAr?: string | null;
  source: string;
  active: boolean;
}

interface ProfileRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  assetType: string;
  version: number;
  permissionCodesJson: unknown;
}

interface EnforcementAttempt {
  id: string;
  operation: string;
  connectorCode: string;
  status: string;
  attemptCount: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  responseJson?: { evidenceReference?: string; comment?: string } | null;
  completedAt?: string | null;
  createdAt: string;
}

interface AccessGrant {
  id: string;
  code: string;
  status: string;
  ownerDecision: string;
  ownerDecisionBy?: string | null;
  ownerDecisionAt?: string | null;
  enforcementStatus: string;
  principalType: string;
  principalId: string;
  permissionCode: string;
  permissions?: Array<{
    permissionCode: string;
    source: string;
    permission?: { nameEn: string; nameAr?: string | null; riskLevel: string; action: string };
  }>;
  justification: string;
  version: number;
  startsAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  revocationReason?: string | null;
  asset: AssetRef;
  profile?: ProfileRef | null;
  enforcementAttempts?: EnforcementAttempt[];
  versions?: Array<{ id: string; version: number; changeReason?: string | null; changedBy: string; createdAt: string }>;
}

interface CsvValidation {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: Array<{ row: number; action?: string; code?: string | null; valid: boolean; errors: string[] }>;
}

interface CsvCommitResult {
  committed: boolean;
  rowCount: number;
  creates: number;
  updates: number;
  revokes: number;
}

interface AccessMatrix {
  assets: AssetRef[];
  principals: Array<{ type: string; id: string; label: string; nameAr?: string | null; source?: string }>;
  permissions: PermissionRef[];
  cells: Array<{
    assetId: string;
    principalType: string;
    principalId: string;
    grantCount: number;
    enforcedCount: number;
    displayValue: string;
    accessState: string;
    profileNames: string[];
    permissions: string[];
    privilegeClasses: string[];
    riskLevel: string;
    highRiskPermissions: string[];
    statuses: string[];
    ownerDecisions: string[];
    enforcementStatuses: string[];
    reviewStatus: string;
    lastReviewedAt?: string | null;
    lastModifiedAt?: string | null;
    attention: boolean;
    grants: Array<{
      id: string;
      code: string;
      permissionCode: string;
      permissionCodes: string[];
      profile?: { id: string; code: string; nameEn: string; nameAr?: string | null; version: number } | null;
      status: string;
      ownerDecision: string;
      enforcementStatus: string;
      startsAt: string;
      expiresAt?: string | null;
      updatedAt: string;
    }>;
  }>;
  summary: {
    assetCount: number;
    totalAssets: number;
    assetPage: number;
    assetPageCount: number;
    principalCount: number;
    grantedCells: number;
    attentionCells: number;
    highRiskCells: number;
    readCells: number;
    writeCells: number;
  };
  constraints: { assetLimit: number; principalLimit: number; maximumAssets: number; maximumPrincipals: number; note: string };
}

type AccessMatrixCell = AccessMatrix['cells'][number];
type AccessMatrixPrincipal = AccessMatrix['principals'][number];

interface MatrixCellContext {
  asset: AssetRef;
  principal: AccessMatrixPrincipal;
  cell: AccessMatrixCell;
}

interface MatrixSelection {
  assetId: string;
  principalType: 'role' | 'group';
  principalId: string;
}

interface EffectiveAccessRow {
  grantId: string;
  grantCode: string;
  asset: AssetRef;
  principalType: string;
  principalId: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  permissionCode: string;
  lifecycleState: string;
  enforcementStatus: string;
  expansionStatus: string;
  source: string;
  startsAt: string;
  expiresAt?: string | null;
  enforcementGap: boolean;
}

interface EffectiveAccessResult extends Paged<EffectiveAccessRow> {
  summary: {
    totalEffectiveRows: number;
    current: number;
    scheduled: number;
    expired: number;
    revoked: number;
    enforcementGaps: number;
    externalUnverified: number;
  };
}

interface AccessReport {
  generatedAt: string;
  truncated: boolean;
  summary: {
    totalGrants: number;
    activeGrants: number;
    pendingOwnerDecision: number;
    pendingEnforcement: number;
    enforcementFailures: number;
    expiringWithin30Days: number;
    highRiskGrants: number;
    grantsWithoutExpiry: number;
    reviewedGrants: number;
    connectorAttempts: number;
  };
  byAssetType: Array<{ code: string; count: number }>;
  byStatus: Array<{ code: string; count: number }>;
  byPrincipalType: Array<{ code: string; count: number }>;
  byEnforcementStatus: Array<{ code: string; count: number }>;
  attention: Record<string, number>;
}

@Component({
  selector: 'app-access-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AppIcon, Modal, StatusChip],
  templateUrl: './access-management.html',
  styleUrl: './access-management.scss',
})
export class AccessManagementPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly grants = signal<AccessGrant[]>([]);
  protected readonly total = signal(0);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly permissions = signal<PermissionRef[]>([]);
  protected readonly profiles = signal<ProfileRef[]>([]);
  protected readonly principals = signal<PrincipalRef[]>([]);
  protected readonly selected = signal<AccessGrant | null>(null);
  protected readonly statusFilter = signal('');
  protected readonly createOpen = signal(false);
  protected readonly editing = signal<AccessGrant | null>(null);
  protected readonly revokeOpen = signal(false);
  protected readonly revokeReason = signal('');
  protected readonly csvOpen = signal(false);
  protected readonly manualOpen = signal(false);
  protected readonly bulkOpen = signal(false);
  protected readonly connectorOpen = signal(false);
  protected readonly connectorAttempt = signal<EnforcementAttempt | null>(null);
  protected readonly connectorStatus = signal<'succeeded' | 'failed'>('succeeded');
  protected readonly connectorReference = signal('');
  protected readonly connectorMessage = signal('');
  protected readonly selectedMatrixCells = signal<MatrixSelection[]>([]);
  protected readonly busy = signal(false);
  protected readonly csvText = signal('');
  protected readonly csvResult = signal<CsvValidation | null>(null);
  protected readonly manualEvidence = signal('');
  protected readonly manualStatus = signal('enforced');
  protected readonly matrix = signal<AccessMatrix | null>(null);
  protected readonly matrixState = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly selectedMatrixCell = signal<MatrixCellContext | null>(null);
  protected readonly matrixAssetPage = signal(1);
  protected readonly matrixDensity = signal<'compact' | 'detailed'>('compact');
  protected readonly mobileMatrixPrincipalKey = signal('');
  protected readonly catalogueOpen = signal(false);
  protected readonly effectiveAccess = signal<EffectiveAccessResult | null>(null);
  protected readonly report = signal<AccessReport | null>(null);
  protected readonly viewMode = signal<'register' | 'matrix' | 'effective' | 'reports'>(
    this.accessView(this.route.snapshot.queryParamMap.get('view')),
  );
  protected readonly lifecycleResult = signal<{ scheduled: number; activated: number; expired: number; totalChanged: number } | null>(null);
  protected readonly csvCommitReason = signal('');
  protected readonly assetTypes = ['dataset', 'file', 'document_record', 'api_data_feed', 'bi_report_dashboard', 'ai_data_product'];
  protected readonly privilegeGroups = [
    { key: 'read', labelKey: 'access.privilege.read', descriptionKey: 'access.privilege.readHelp' },
    { key: 'write', labelKey: 'access.privilege.write', descriptionKey: 'access.privilege.writeHelp' },
    { key: 'execute', labelKey: 'access.privilege.execute', descriptionKey: 'access.privilege.executeHelp' },
    { key: 'share_export', labelKey: 'access.privilege.share', descriptionKey: 'access.privilege.shareHelp' },
    { key: 'administer', labelKey: 'access.privilege.admin', descriptionKey: 'access.privilege.adminHelp' },
  ] as const;
  protected readonly matrixStatusOptions = ['requested', 'scheduled', 'active', 'expired', 'suspended', 'pending_revocation', 'revoked'];
  protected readonly matrixEnforcementOptions = ['pending', 'enforced', 'failed', 'not_enforced', 'revoked'];
  protected matrixFilters = {
    assetSearch: '',
    assetType: '',
    principalType: '',
    principalSearch: '',
    profileId: '',
    permissionCode: '',
    status: '',
    enforcementStatus: '',
  };

  protected bulkForm = {
    profileId: '',
    permissionCodes: [] as string[],
    startsAt: '',
    expiresAt: '',
    justification: '',
    changeReason: '',
  };

  protected grantForm = {
    assetId: '',
    principalType: 'role' as 'role' | 'group',
    principalId: '',
    permissionCodes: [] as string[],
    profileId: '',
    startsAt: '',
    expiresAt: '',
    justification: '',
    changeReason: '',
  };

  protected readonly canCreate = this.auth.hasPermission('access_grants.create');
  protected readonly canEdit = this.auth.hasPermission('access_grants.edit');
  protected readonly statusOptions = ['requested', 'scheduled', 'active', 'expired', 'rejected', 'revoked'];

  protected readonly selectedAsset = computed(() =>
    this.assets().find((asset) => asset.id === this.grantForm.assetId) ?? null,
  );

  protected readonly availablePermissions = computed(() => {
    const assetType = this.selectedAsset()?.assetType;
    return assetType ? this.permissions().filter((permission) => permission.assetType === assetType) : [];
  });

  protected readonly availableProfiles = computed(() => {
    const assetType = this.selectedAsset()?.assetType;
    return assetType ? this.profiles().filter((profile) => profile.assetType === assetType) : [];
  });

  protected readonly availablePrincipals = computed(() =>
    this.principals().filter((principal) => principal.type === this.grantForm.principalType),
  );

  protected matrixFilterProfiles(): ProfileRef[] {
    return this.matrixFilters.assetType
      ? this.profiles().filter((profile) => profile.assetType === this.matrixFilters.assetType)
      : this.profiles();
  }

  protected matrixFilterPermissions(): PermissionRef[] {
    return this.matrixFilters.assetType
      ? this.permissions().filter((permission) => permission.assetType === this.matrixFilters.assetType)
      : this.permissions();
  }

  protected readonly selectedProfile = computed(() =>
    this.profiles().find((profile) => profile.id === this.grantForm.profileId) ?? null,
  );

  protected readonly selectedPermissionCodes = computed(() => {
    const profile = this.selectedProfile();
    if (!profile) return this.grantForm.permissionCodes;
    return this.profilePermissionCodes(profile);
  });

  protected readonly selectedHighRiskCount = computed(() =>
    this.selectedPermissionCodes().filter((code) => this.permissionIsHighRisk(code)).length,
  );

  protected readonly bulkAssetTypes = computed(() => {
    const selectedAssetIds = new Set(this.selectedMatrixCells().map((cell) => cell.assetId));
    const matrixAssets = this.matrix()?.assets ?? this.assets();
    return [...new Set(matrixAssets.filter((asset) => selectedAssetIds.has(asset.id)).map((asset) => asset.assetType))];
  });

  protected readonly bulkAvailablePermissions = computed(() => {
    const types = this.bulkAssetTypes();
    return types.length === 1 ? this.permissions().filter((permission) => permission.assetType === types[0]) : [];
  });

  protected readonly bulkAvailableProfiles = computed(() => {
    const types = this.bulkAssetTypes();
    return types.length === 1 ? this.profiles().filter((profile) => profile.assetType === types[0]) : [];
  });

  protected readonly bulkSelectedProfile = computed(() =>
    this.profiles().find((profile) => profile.id === this.bulkForm.profileId) ?? null,
  );

  protected readonly bulkSelectedPermissionCodes = computed(() => {
    const profile = this.bulkSelectedProfile();
    return profile ? this.profilePermissionCodes(profile) : this.bulkForm.permissionCodes;
  });

  protected readonly bulkSelectedHighRiskCount = computed(() =>
    this.bulkSelectedPermissionCodes().filter((code) => this.permissionIsHighRisk(code)).length,
  );

  protected readonly metrics = computed(() => {
    const rows = this.grants();
    return {
      total: this.total(),
      active: rows.filter((grant) => grant.status === 'active').length,
      ownerReview: rows.filter((grant) => grant.ownerDecision === 'pending').length,
      attention: rows.filter((grant) => ['pending', 'failed'].includes(grant.enforcementStatus)).length,
    };
  });

  ngOnInit(): void {
    this.load();
    this.loadReferences();
    this.loadMatrix();
    this.loadEffectiveAccess();
    this.loadReport();
  }

  protected load(): void {
    this.state.set('loading');
    const params: Record<string, string> = { page: '1', pageSize: '100' };
    if (this.statusFilter()) params['status'] = this.statusFilter();
    this.http.get<Paged<AccessGrant>>('/api/access/grants', { params }).subscribe({
      next: (result) => {
        this.grants.set(result.data);
        this.total.set(result.total);
        this.state.set('ready');
        const selectedId = this.selected()?.id;
        if (selectedId) {
          const row = result.data.find((grant) => grant.id === selectedId);
          if (row) this.select(row);
        }
      },
      error: (error) => {
        this.state.set('error');
        this.toast.errorFrom(error, this.t('access.toast.loadGrantsError'));
      },
    });
  }

  protected setStatus(value: string): void {
    this.statusFilter.set(value);
    this.selected.set(null);
    this.load();
  }

  protected setMode(mode: 'register' | 'matrix' | 'effective' | 'reports'): void {
    this.viewMode.set(mode);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: mode },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    if (mode === 'matrix' && !this.matrix()) this.loadMatrix();
    if (mode === 'effective' && !this.effectiveAccess()) this.loadEffectiveAccess();
    if (mode === 'reports' && !this.report()) this.loadReport();
  }

  protected loadMatrix(page = this.matrixAssetPage()): void {
    this.selectedMatrixCells.set([]);
    this.selectedMatrixCell.set(null);
    this.matrixState.set('loading');
    const params: Record<string, string> = {
      assetPage: String(page),
      assetLimit: '500',
      principalLimit: '100',
      sortBy: 'code',
      sortDirection: 'asc',
    };
    for (const [key, value] of Object.entries(this.matrixFilters)) {
      if (value.trim()) params[key] = value.trim();
    }
    this.http.get<AccessMatrix>('/api/access/grants/matrix', { params }).subscribe({
      next: (result) => {
        this.matrix.set(result);
        const principalKeys = result.principals.map((principal) => `${principal.type}:${principal.id}`);
        if (!principalKeys.includes(this.mobileMatrixPrincipalKey())) {
          this.mobileMatrixPrincipalKey.set(principalKeys[0] ?? '');
        }
        this.matrixAssetPage.set(result.summary.assetPage);
        this.matrixState.set('ready');
      },
      error: (error) => {
        this.matrixState.set('error');
        this.toast.errorFrom(error, this.t('access.toast.loadMatrixError'));
      },
    });
  }

  protected applyMatrixFilters(): void {
    this.matrixAssetPage.set(1);
    this.loadMatrix(1);
  }

  protected clearMatrixFilters(): void {
    this.matrixFilters = { assetSearch: '', assetType: '', principalType: '', principalSearch: '', profileId: '', permissionCode: '', status: '', enforcementStatus: '' };
    this.applyMatrixFilters();
  }

  protected changeMatrixPage(delta: number): void {
    const matrix = this.matrix();
    if (!matrix) return;
    const next = Math.min(Math.max(matrix.summary.assetPage + delta, 1), matrix.summary.assetPageCount);
    if (next !== matrix.summary.assetPage) this.loadMatrix(next);
  }

  protected loadEffectiveAccess(): void {
    this.http.get<EffectiveAccessResult>('/api/access/effective-access', { params: { page: '1', pageSize: '100' } }).subscribe({
      next: (result) => this.effectiveAccess.set(result),
      error: (error) => this.toast.errorFrom(error, this.t('access.toast.loadEffectiveError')),
    });
  }

  protected loadReport(): void {
    this.http.get<AccessReport>('/api/access/reports/summary').subscribe({
      next: (result) => this.report.set(result),
      error: (error) => this.toast.errorFrom(error, this.t('access.toast.loadReportsError')),
    });
  }

  private accessView(value: string | null): 'register' | 'matrix' | 'effective' | 'reports' {
    return value === 'matrix' || value === 'effective' || value === 'reports' ? value : 'register';
  }

  protected select(grant: Pick<AccessGrant, 'id'>): void {
    this.http.get<AccessGrant>(`/api/access/grants/${grant.id}`).subscribe({
      next: (detail) => this.selected.set(detail),
      error: (error) => this.toast.errorFrom(error, this.t('access.toast.loadDetailsError')),
    });
  }

  protected openMatrixCell(asset: AssetRef, principal: AccessMatrixPrincipal, cell: AccessMatrixCell): void {
    this.selectedMatrixCell.set({ asset, principal, cell });
    const grant = cell.grants[0];
    if (grant) this.select(grant);
    else this.selected.set(null);
  }

  protected createFromMatrixCell(context: MatrixCellContext): void {
    this.openCreate();
    this.grantForm.assetId = context.asset.id;
    this.grantForm.principalType = context.principal.type === 'group' ? 'group' : 'role';
    this.grantForm.principalId = context.principal.id;
    this.grantForm.permissionCodes = [];
    this.grantForm.profileId = '';
  }

  protected openCreate(): void {
    this.editing.set(null);
    const asset = this.assets()[0] ?? null;
    this.grantForm = {
      assetId: asset?.id ?? '',
      principalType: 'role',
      principalId: this.principals().find((principal) => principal.type === 'role')?.id ?? '',
      permissionCodes: [],
      profileId: '',
      startsAt: this.localDateTimeValue(new Date()),
      expiresAt: '',
      justification: '',
      changeReason: '',
    };
    this.createOpen.set(true);
  }

  protected createGrant(): void {
    if (!this.canCreate || this.busy()) return;
    if (!this.grantForm.assetId || !this.grantForm.principalId.trim() || !this.selectedPermissionCodes().length || !this.grantForm.justification.trim()) {
      this.toast.error(this.t('access.toast.requiredGrantFields'));
      return;
    }
    const editing = this.editing();
    if (editing && !this.grantForm.changeReason.trim()) {
      this.toast.error(this.t('access.toast.changeReasonRequired'));
      return;
    }
    this.busy.set(true);
    const payload = {
      ...this.grantForm,
      principalId: this.grantForm.principalId.trim(),
      permissionCodes: this.grantForm.profileId ? undefined : this.grantForm.permissionCodes,
      profileId: this.grantForm.profileId || null,
      startsAt: this.grantForm.startsAt ? new Date(this.grantForm.startsAt).toISOString() : undefined,
      expiresAt: this.grantForm.expiresAt ? new Date(this.grantForm.expiresAt).toISOString() : null,
      justification: this.grantForm.justification.trim(),
      changeReason: this.grantForm.changeReason.trim(),
      ...(editing ? { expectedVersion: editing.version } : {}),
    };
    const request = editing
      ? this.http.patch<AccessGrant>(`/api/access/grants/${editing.id}`, payload)
      : this.http.post<AccessGrant>('/api/access/grants', payload);
    request.subscribe({
      next: (grant) => {
        this.busy.set(false);
        this.createOpen.set(false);
        this.editing.set(null);
        this.toast.success(this.format(editing ? 'access.toast.grantRevised' : 'access.toast.grantReady', { code: grant.code }));
        this.load();
        this.select(grant);
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('access.toast.createError'));
      },
    });
  }

  protected openEdit(grant: AccessGrant): void {
    this.editing.set(grant);
    this.grantForm = {
      assetId: grant.asset.id,
      principalType: grant.principalType === 'group' ? 'group' : 'role',
      principalId: grant.principalId,
      permissionCodes: grant.permissions?.map((permission) => permission.permissionCode) ?? [grant.permissionCode],
      profileId: grant.profile?.id ?? '',
      startsAt: this.localDateTimeValue(new Date(grant.startsAt)),
      expiresAt: grant.expiresAt ? this.localDateTimeValue(new Date(grant.expiresAt)) : '',
      justification: grant.justification,
      changeReason: '',
    };
    this.createOpen.set(true);
  }

  protected openRevoke(grant: AccessGrant): void {
    this.selected.set(grant);
    this.revokeReason.set('');
    this.revokeOpen.set(true);
  }

  protected revokeGrant(): void {
    const grant = this.selected();
    if (!grant || this.busy() || !this.revokeReason().trim()) {
      if (!this.revokeReason().trim()) this.toast.error(this.t('access.toast.revokeReasonRequired'));
      return;
    }
    this.mutate(
      `/api/access/grants/${grant.id}/revoke`,
      { expectedVersion: grant.version, reason: this.revokeReason().trim() },
      this.format('access.toast.grantRevoked', { code: grant.code }),
      () => this.revokeOpen.set(false),
    );
  }

  protected decide(decision: 'approved' | 'rejected'): void {
    const grant = this.selected();
    if (!grant || this.busy()) return;
    this.mutate(`/api/access/grants/${grant.id}/decision`, { expectedVersion: grant.version, decision }, this.format('access.toast.decisionRecorded', { decision: this.label(decision) }));
  }

  protected dispatch(operation: 'grant' | 'verify' | 'revoke'): void {
    const grant = this.selected();
    if (!grant || this.busy()) return;
    this.mutate(`/api/access/grants/${grant.id}/enforcement/dispatch`, { expectedVersion: grant.version, operation }, this.format('access.toast.handoffAdded', { operation: this.label(operation) }));
  }

  protected applyGrantRules(): void {
    const grant = this.selected();
    if (!grant || this.busy()) return;
    this.mutate(
      `/api/access/grants/${grant.id}/enforcement/apply-rules`,
      { expectedVersion: grant.version },
      this.format('access.toast.rulesApplied', { count: grant.permissions?.length ?? 1 }),
    );
  }

  protected openManualCompletion(): void {
    const grant = this.selected();
    if (!grant) return;
    this.manualEvidence.set('');
    this.manualStatus.set('enforced');
    this.manualOpen.set(true);
  }

  protected completeManualProvisioning(): void {
    const grant = this.selected();
    if (!grant || this.busy()) return;
    if (!this.manualEvidence().trim()) {
      this.toast.error(this.t('access.toast.manualEvidenceRequired'));
      return;
    }
    this.mutate(
      `/api/access/grants/${grant.id}/enforcement/manual-complete`,
      { expectedVersion: grant.version, enforcementStatus: this.manualStatus(), evidenceReference: this.manualEvidence().trim() },
      this.t('access.toast.manualEvidenceAdded'),
      () => this.manualOpen.set(false),
    );
  }

  protected openConnectorResult(attempt: EnforcementAttempt, status: 'succeeded' | 'failed'): void {
    this.connectorAttempt.set(attempt);
    this.connectorStatus.set(status);
    this.connectorReference.set('');
    this.connectorMessage.set('');
    this.connectorOpen.set(true);
  }

  protected completeConnectorAttempt(): void {
    const attempt = this.connectorAttempt();
    const grant = this.selected();
    if (!attempt || !grant || this.busy()) return;
    if (!this.connectorReference().trim()) {
      this.toast.error(this.t('access.toast.providerReferenceRequired'));
      return;
    }
    this.busy.set(true);
    this.http.post(`/api/access/enforcement/attempts/${attempt.id}/complete`, {
      expectedVersion: grant.version,
      status: this.connectorStatus(),
      providerReference: this.connectorReference().trim(),
      message: this.connectorMessage().trim() || null,
      errorCode: this.connectorStatus() === 'failed' ? 'provider_failed' : null,
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.connectorOpen.set(false);
        this.toast.success(this.t('access.toast.connectorRecorded'));
        this.load();
        this.select(grant);
        this.loadMatrix();
        this.loadEffectiveAccess();
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('access.toast.connectorError'));
      },
    });
  }

  protected openCsv(): void {
    this.csvResult.set(null);
    this.csvCommitReason.set('');
    this.csvOpen.set(true);
  }

  protected loadCsvTemplate(): void {
    this.http.get<{ csv: string }>('/api/access/grants/csv/template').subscribe({
      next: (result) => this.csvText.set(result.csv),
      error: (error) => this.toast.errorFrom(error, this.t('access.toast.csvTemplateError')),
    });
  }

  protected validateCsv(): void {
    if (!this.csvText().trim() || this.busy()) return;
    this.busy.set(true);
    this.http.post<CsvValidation>('/api/access/grants/csv/validate', { csv: this.csvText() }).subscribe({
      next: (result) => {
        this.csvResult.set(result);
        this.busy.set(false);
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('access.toast.csvValidationError'));
      },
    });
  }

  protected commitCsv(): void {
    const validation = this.csvResult();
    if (!this.csvText().trim() || this.busy()) return;
    if (!validation || validation.invalidRows > 0) {
      this.toast.error(this.t('access.toast.csvValidateFirst'));
      return;
    }
    this.busy.set(true);
    this.http.post<CsvCommitResult>('/api/access/grants/csv/commit', {
      csv: this.csvText(),
      changeReason: this.csvCommitReason().trim() || null,
    }).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.csvOpen.set(false);
        this.toast.success(this.format('access.toast.csvCommitted', { count: result.rowCount }));
        this.load();
        this.loadMatrix();
        this.loadEffectiveAccess();
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('access.toast.csvCommitError'));
      },
    });
  }

  protected reconcileLifecycle(): void {
    if (!this.canEdit || this.busy()) return;
    this.busy.set(true);
    this.http.post<{ scheduled: number; activated: number; expired: number; totalChanged: number }>('/api/access/grants/lifecycle/reconcile', {}).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.lifecycleResult.set(result);
        this.toast.success(this.format('access.toast.lifecycleReconciled', { count: result.totalChanged }));
        this.load();
        this.loadMatrix();
        this.loadEffectiveAccess();
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('access.toast.lifecycleError'));
      },
    });
  }

  protected exportCsv(): void {
    this.http.get<{ fileName: string; csv: string }>('/api/access/grants/csv/export').subscribe({
      next: (result) => {
        const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = result.fileName;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error) => this.toast.errorFrom(error, this.t('access.toast.exportError')),
    });
  }

  protected kind(status?: string | null): StatusKind {
    if (['active', 'current', 'approved', 'enforced', 'succeeded', 'resolved'].includes(status ?? '')) return 'success';
    if (['requested', 'scheduled', 'pending', 'queued', 'running', 'retrying', 'external_unverified', 'no_active_members', 'missing_user'].includes(status ?? '')) return 'warning';
    if (['failed', 'rejected', 'revoked', 'expired', 'declined'].includes(status ?? '')) return 'danger';
    return 'muted';
  }

  protected label(value?: string | null): string {
    const normalized = value ?? 'not_recorded';
    const key = `access.value.${normalized}`;
    const translated = this.t(key);
    return translated === key ? normalized.replace(/_/g, ' ') : translated;
  }

  protected date(value?: string | null): string {
    if (!value) return '-';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '-' : new Intl.DateTimeFormat(this.i18n.lang() === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
  }

  protected invalidCsvRows(): Array<{ row: number; action?: string; code?: string | null; valid: boolean; errors: string[] }> {
    return this.csvResult()?.rows.filter((row) => !row.valid).slice(0, 8) ?? [];
  }

  protected matrixCell(assetId: string, principalType: string, principalId: string) {
    return this.matrix()?.cells.find((cell) => cell.assetId === assetId && cell.principalType === principalType && cell.principalId === principalId) ?? null;
  }

  protected mobileMatrixPrincipal(matrix: AccessMatrix): AccessMatrixPrincipal | null {
    const key = this.mobileMatrixPrincipalKey();
    return matrix.principals.find((principal) => `${principal.type}:${principal.id}` === key)
      ?? matrix.principals[0]
      ?? null;
  }

  protected cellLabel(assetId: string, principalType: string, principalId: string): string {
    const cell = this.matrixCell(assetId, principalType, principalId);
    if (!cell || cell.grantCount === 0) return 'No Access';
    return cell.displayValue;
  }

  protected matrixCellFocused(assetId: string, principalType: string, principalId: string): boolean {
    const context = this.selectedMatrixCell();
    return context?.asset.id === assetId && context.principal.type === principalType && context.principal.id === principalId;
  }

  protected permissionAction(code: string): string {
    return this.permissions().find((permission) => permission.code === code)?.action?.replace(/_/g, ' ').toUpperCase()
      ?? code.split('.').at(-1)?.replace(/_/g, ' ').toUpperCase()
      ?? code;
  }

  protected profilePermissionCodes(profile: ProfileRef): string[] {
    return Array.isArray(profile.permissionCodesJson)
      ? [...new Set(profile.permissionCodesJson.map(String).filter(Boolean))]
      : [];
  }

  protected profileOptionLabel(profile: ProfileRef): string {
    const actions = this.profilePermissionCodes(profile).map((code) => this.permissionAction(code));
    const visible = actions.slice(0, 4).join(' / ');
    const remainder = actions.length > 4 ? ` +${actions.length - 4} ${this.t('access.more')}` : '';
    return `${this.profileName(profile)} | ${visible}${remainder}`;
  }

  protected permissionIsHighRisk(code: string): boolean {
    return this.permissions().some((permission) => permission.code === code && permission.riskLevel === 'high');
  }

  protected permissionsInGroup(permissions: PermissionRef[], group: string): PermissionRef[] {
    return permissions.filter((permission) => this.permissionClass(permission.action) === group);
  }

  protected privilegeClassLabel(value: string): string {
    const keys: Record<string, string> = {
      read: 'access.legend.read',
      write: 'access.legend.write',
      execute: 'access.legend.execute',
      share_export: 'access.legend.share',
      administer: 'access.legend.admin',
    };
    return keys[value] ? this.t(keys[value]) : this.label(value);
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected format(key: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
      (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
      this.t(key),
    );
  }

  protected localizedName(value?: { nameEn: string; nameAr?: string | null } | null): string {
    if (!value) return '-';
    return this.i18n.lang() === 'ar' && value.nameAr ? value.nameAr : value.nameEn;
  }

  protected assetName(asset: AssetRef): string {
    return this.localizedName(asset);
  }

  protected principalName(principal: { label: string; nameAr?: string | null }): string {
    return this.i18n.lang() === 'ar' && principal.nameAr ? principal.nameAr : principal.label;
  }

  protected permissionName(permission: PermissionRef): string {
    return this.i18n.lang() === 'ar' && permission.nameAr ? permission.nameAr : permission.nameEn;
  }

  protected profileName(profile: ProfileRef): string {
    return this.i18n.lang() === 'ar' && profile.nameAr ? profile.nameAr : profile.nameEn;
  }

  protected matrixCellValue(cell: AccessMatrixCell): string {
    return cell.grantCount ? cell.displayValue : this.t('access.matrix.noAccess');
  }

  protected permissionsForAssetType(assetType: string): PermissionRef[] {
    return this.permissions().filter((permission) => permission.assetType === assetType);
  }

  protected profilesForAssetType(assetType: string): ProfileRef[] {
    return this.profiles().filter((profile) => profile.assetType === assetType);
  }

  private permissionClass(action: string): 'read' | 'write' | 'execute' | 'share_export' | 'administer' {
    const normalized = action.toLowerCase();
    if (/(share|reshare|export|download_payload|bulk_consume)/.test(normalized)) return 'share_export';
    if (/(delete|manage_|configure_|operate_)/.test(normalized)) return 'administer';
    if (/(execute|invoke|consume|subscribe)/.test(normalized)) return 'execute';
    if (/(insert|update|edit|upload|create_|submit|publish|build|contribute)/.test(normalized)) return 'write';
    return 'read';
  }

  protected matrixCellSelected(assetId: string, principalType: string, principalId: string): boolean {
    return this.selectedMatrixCells().some((cell) => cell.assetId === assetId && cell.principalType === principalType && cell.principalId === principalId);
  }

  protected toggleMatrixCell(assetId: string, principalType: string, principalId: string, selected: boolean): void {
    if (selected) {
      const selectedType = this.bulkAssetTypes()[0];
      const candidateType = this.assets().find((asset) => asset.id === assetId)?.assetType;
      if (selectedType && candidateType && selectedType !== candidateType) {
        this.toast.error(this.t('access.toast.singleAssetTypeRequired'));
        return;
      }
    }
    const key = `${assetId}:${principalType}:${principalId}`;
    const values = new Map(this.selectedMatrixCells().map((cell) => [`${cell.assetId}:${cell.principalType}:${cell.principalId}`, cell]));
    if (selected) values.set(key, { assetId, principalType: principalType as 'role' | 'group', principalId });
    else values.delete(key);
    this.selectedMatrixCells.set([...values.values()]);
  }

  protected selectAllEmptyMatrixCells(): void {
    const matrix = this.matrix();
    if (!matrix) return;
    const firstAssetType = matrix.assets[0]?.assetType;
    const sameTypeAssetIds = new Set(matrix.assets.filter((asset) => asset.assetType === firstAssetType).map((asset) => asset.id));
    this.selectedMatrixCells.set(matrix.cells
      .filter((cell) => cell.grantCount === 0 && sameTypeAssetIds.has(cell.assetId))
      .slice(0, 500)
      .map((cell) => ({ assetId: cell.assetId, principalType: cell.principalType as 'role' | 'group', principalId: cell.principalId })));
  }

  protected openBulkGrant(): void {
    if (!this.selectedMatrixCells().length) return;
    this.bulkForm = {
      profileId: '',
      permissionCodes: [],
      startsAt: this.localDateTimeValue(new Date()),
      expiresAt: '',
      justification: '',
      changeReason: '',
    };
    this.bulkOpen.set(true);
  }

  protected setBulkProfile(profileId: string): void {
    this.bulkForm.profileId = profileId;
    if (profileId) this.bulkForm.permissionCodes = [];
  }

  protected toggleBulkPermission(code: string, selected: boolean): void {
    const values = new Set(this.bulkForm.permissionCodes);
    if (selected) values.add(code);
    else values.delete(code);
    this.bulkForm.permissionCodes = [...values].sort();
  }

  protected bulkPermissionSelected(code: string): boolean {
    return this.bulkForm.permissionCodes.includes(code);
  }

  protected submitBulkGrant(): void {
    if (!this.canCreate || this.busy()) return;
    if (!this.bulkForm.profileId && !this.bulkForm.permissionCodes.length) {
      this.toast.error(this.t('access.toast.permissionsRequired'));
      return;
    }
    if (!this.bulkForm.justification.trim() || !this.bulkForm.changeReason.trim()) {
      this.toast.error(this.t('access.toast.bulkReasonsRequired'));
      return;
    }
    this.busy.set(true);
    this.http.post<{ grantCount: number }>('/api/access/grants/bulk', {
      cells: this.selectedMatrixCells(),
      profileId: this.bulkForm.profileId || null,
      permissionCodes: this.bulkForm.profileId ? undefined : this.bulkForm.permissionCodes,
      startsAt: this.bulkForm.startsAt ? new Date(this.bulkForm.startsAt).toISOString() : undefined,
      expiresAt: this.bulkForm.expiresAt ? new Date(this.bulkForm.expiresAt).toISOString() : null,
      justification: this.bulkForm.justification.trim(),
      changeReason: this.bulkForm.changeReason.trim(),
    }).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.bulkOpen.set(false);
        this.selectedMatrixCells.set([]);
        this.toast.success(this.format('access.toast.bulkCreated', { count: result.grantCount }));
        this.load();
        this.loadMatrix();
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('access.toast.matrixCommitError'));
      },
    });
  }

  protected setPrincipalType(type: 'role' | 'group'): void {
    this.grantForm.principalType = type;
    this.grantForm.principalId = this.principals().find((principal) => principal.type === type)?.id ?? '';
  }

  protected setProfile(profileId: string): void {
    this.grantForm.profileId = profileId;
    if (profileId) this.grantForm.permissionCodes = [];
  }

  protected togglePermission(code: string, selected: boolean): void {
    const values = new Set(this.grantForm.permissionCodes);
    if (selected) values.add(code);
    else values.delete(code);
    this.grantForm.permissionCodes = [...values].sort();
  }

  protected permissionSelected(code: string): boolean {
    return this.grantForm.permissionCodes.includes(code);
  }

  protected grantPermissionLabel(grant: AccessGrant): string {
    const codes = grant.permissions?.map((permission) => permission.permissionCode).filter(Boolean) ?? [];
    const values = codes.length ? codes : [grant.permissionCode];
    return values.slice(0, 2).join(', ') + (values.length > 2 ? ` +${values.length - 2}` : '');
  }

  private loadReferences(): void {
    this.http.get<Paged<AssetRef>>('/api/assets', { params: { page: '1', pageSize: '200' } }).subscribe({
      next: (result) => this.assets.set(result.data),
      error: () => this.assets.set([]),
    });
    this.http.get<PermissionRef[]>('/api/access/permission-catalog').subscribe({
      next: (result) => this.permissions.set(result),
      error: () => this.permissions.set([]),
    });
    this.http.get<ProfileRef[]>('/api/access/profiles').subscribe({
      next: (result) => this.profiles.set(result),
      error: () => this.profiles.set([]),
    });
    this.http.get<PrincipalRef[]>('/api/access/principals').subscribe({
      next: (result) => this.principals.set(result),
      error: () => this.principals.set([]),
    });
  }

  private localDateTimeValue(value: Date): string {
    const offset = value.getTimezoneOffset() * 60_000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 16);
  }

  private mutate(url: string, body: unknown, success: string, after?: () => void): void {
    this.busy.set(true);
    this.http.post(url, body).subscribe({
      next: () => {
        this.busy.set(false);
        after?.();
        this.toast.success(success);
        this.load();
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('access.toast.operationError'));
      },
    });
  }
}
