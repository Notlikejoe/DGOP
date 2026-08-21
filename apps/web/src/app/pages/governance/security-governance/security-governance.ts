import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../core/auth.service';
import { I18nService } from '../../../core/i18n.service';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { AppIcon } from '../../../shared/app-icon';
import { Modal } from '../../../shared/modal';
import { ToastService } from '../../../shared/toast.service';

interface Ref { id: string; code: string; nameEn: string; nameAr: string; }
interface ClassificationRef extends Ref { rank: number; color: string; }
interface RoleRef extends Ref { maxClassificationRank?: number | null; }
interface UserRef { id: string; email: string; displayName?: string | null; }
interface AssetRef extends Ref { domain?: Ref | null; classification?: ClassificationRef | null; }

interface MaskingPolicy {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  technique: string;
  description?: string | null;
  previewBefore?: string | null;
  previewAfter?: string | null;
  isActive: boolean;
  domain?: Ref | null;
  classification?: ClassificationRef | null;
}

interface AccessMapRow {
  id: string;
  role: RoleRef;
  domain?: Ref | null;
  classification?: ClassificationRef | null;
  maskingPolicy?: MaskingPolicy | null;
  personalDataAllowed: boolean;
  approvalRequired: boolean;
  businessJustification?: string | null;
  nextReviewAt?: string | null;
}

interface AccessReviewItem {
  id: string;
  decision: string;
  justification?: string | null;
  reviewedAt?: string | null;
  user: UserRef;
  role: RoleRef;
  asset?: (Ref & { domain?: Ref | null; classification?: ClassificationRef | null }) | null;
  domain?: Ref | null;
  classification?: ClassificationRef | null;
}

type AccessReviewDecision = 'certified' | 'modify' | 'shorten_expiry' | 'suspend' | 'request_clarification' | 'revoke' | 'exception' | 'escalated';

interface AccessReview {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  status: string;
  dueDate?: string | null;
  ownerUser?: UserRef | null;
  items: AccessReviewItem[];
}

interface DlpIncident {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  detectedAt: string;
  asset?: (Ref & { domain?: Ref | null; classification?: ClassificationRef | null }) | null;
  classification?: ClassificationRef | null;
  assignedPerson?: { id: string; fullNameEn: string; fullNameAr: string; email?: string | null } | null;
  workflowCase?: { id: string; code: string; title: string; status: string } | null;
}

interface ClassificationRequest {
  id: string;
  reason: string;
  status: string;
  requestedBy: string;
  createdAt: string;
  asset: Ref & { domain?: Ref | null };
  fromClassification?: ClassificationRef | null;
  toClassification: ClassificationRef;
  workflowCase?: { id: string; code: string; title: string; status: string } | null;
}

interface DecisionLog {
  id: string;
  requestedAction: string;
  decision: string;
  reason: string;
  createdAt: string;
  role?: RoleRef | null;
  asset?: Ref | null;
  maskingPolicy?: MaskingPolicy | null;
}

interface SimulatedDecision extends DecisionLog {
  classification?: ClassificationRef | null;
  abac: {
    risk: string;
    purpose: string;
    networkZone: string;
    obligations: string[];
    violations: string[];
    ruleTrace: string[];
  };
}

interface AssetPage {
  data: AssetRef[];
}

interface SecuritySummary {
  mappings: number;
  maskingPolicies: number;
  pendingAccessReviews: number;
  openDlpIncidents: number;
  pendingClassificationRequests: number;
  riskLevel: string;
  recentDecisions: DecisionLog[];
}

interface SecurityQueueItem {
  id: string;
  type: 'access_review' | 'dlp' | 'classification';
  refId: string;
  title: string;
  subtitle: string;
  status: string;
  risk?: string;
  description?: string | null;
  asset?: string;
  dueDate?: string | null;
  createdAt?: string | null;
  workflowCase?: { id: string; code: string; title: string; status: string } | null;
}

@Component({
  selector: 'app-security-governance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, StatusChip, AppIcon, Modal],
  templateUrl: './security-governance.html',
  styleUrl: './security-governance.scss',
})
export class SecurityGovernancePage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly summary = signal<SecuritySummary | null>(null);
  protected readonly accessMap = signal<AccessMapRow[]>([]);
  protected readonly maskingPolicies = signal<MaskingPolicy[]>([]);
  protected readonly accessReviews = signal<AccessReview[]>([]);
  protected readonly dlpIncidents = signal<DlpIncident[]>([]);
  protected readonly classificationRequests = signal<ClassificationRequest[]>([]);
  protected readonly decisions = signal<DecisionLog[]>([]);
  protected readonly selectedQueueId = signal<string | null>(null);
  protected readonly expandedPanel = signal<string | null>(null);
  protected readonly campaignOpen = signal(false);
  protected readonly reviewDecisionOpen = signal(false);
  protected readonly simulatorOpen = signal(false);
  protected readonly simulatorLoading = signal(false);
  protected readonly busy = signal(false);
  protected readonly canCreate = this.auth.hasPermission('security_governance.create');
  protected readonly canDecide = this.auth.hasPermission('security_governance.edit');
  protected readonly canSimulate =
    this.auth.hasPermission('security_governance.create') &&
    this.auth.hasPermission('roles.view') &&
    this.auth.hasPermission('data_assets.view');
  protected readonly simulatorRoles = signal<RoleRef[]>([]);
  protected readonly simulatorAssets = signal<AssetRef[]>([]);
  protected readonly simulatorResult = signal<SimulatedDecision | null>(null);
  protected campaignForm = {
    title: '',
    description: '',
    dueDate: '',
    includeUserGrants: true,
    includeRoleGrants: true,
  };
  protected reviewDecisionForm: { itemId: string; decision: AccessReviewDecision; justification: string; newExpiresAt: string } = {
    itemId: '',
    decision: 'certified',
    justification: '',
    newExpiresAt: '',
  };
  protected simulatorForm = {
    roleId: '',
    assetId: '',
    requestedAction: 'read',
    purpose: 'governance',
    networkZone: 'internal',
    personalDataRequested: false,
    legalBasisConfirmed: false,
    emergencyAccess: false,
    approvalTicketId: '',
    businessJustification: '',
  };
  protected readonly accessActions = ['read', 'export', 'share', 'write', 'delete'] as const;
  protected readonly accessPurposes = ['governance', 'privacy', 'compliance', 'audit', 'operations', 'break_glass'] as const;
  protected readonly networkZones = ['internal', 'trusted', 'public'] as const;

  protected readonly activeReview = computed(() => this.accessReviews()[0] ?? null);
  protected readonly pendingItems = computed(() =>
    this.accessReviews().flatMap((review) =>
      review.items
        .filter((item) => item.decision === 'pending')
        .map((item) => ({ ...item, reviewCode: review.code, reviewTitle: review.title, dueDate: review.dueDate })),
    ),
  );
  protected readonly criticalIncidents = computed(() =>
    this.dlpIncidents().filter((incident) => ['high', 'critical'].includes(incident.severity)),
  );
  protected readonly securityQueue = computed<SecurityQueueItem[]>(() => [
    ...this.pendingItems().map((item) => ({
      id: `access_review:${item.id}`,
      refId: item.id,
      type: 'access_review' as const,
      title: this.name(item.user),
      subtitle: `${this.name(item.role)} - ${this.targetName(item)}`,
      status: item.decision,
      description: item.justification,
      asset: this.targetName(item),
      dueDate: item.dueDate,
    })),
    ...this.dlpIncidents()
      .filter((incident) => !['closed', 'false_positive'].includes(incident.status))
      .map((incident) => ({
        id: `dlp:${incident.id}`,
        refId: incident.id,
        type: 'dlp' as const,
        title: incident.title,
        subtitle: `${this.name(incident.asset)} - ${this.date(incident.detectedAt)}`,
        status: incident.status,
        risk: incident.severity,
        description: incident.description,
        asset: this.name(incident.asset),
        createdAt: incident.detectedAt,
        workflowCase: incident.workflowCase,
      })),
    ...this.classificationRequests()
      .filter((request) => request.status === 'pending')
      .map((request) => ({
        id: `classification:${request.id}`,
        refId: request.id,
        type: 'classification' as const,
        title: this.name(request.asset),
        subtitle: `${this.name(request.fromClassification)} to ${this.name(request.toClassification)}`,
        status: request.status,
        risk: request.toClassification.rank >= 4 ? 'high' : 'medium',
        description: request.reason,
        asset: this.name(request.asset),
        createdAt: request.createdAt,
        workflowCase: request.workflowCase,
      })),
  ]);
  protected readonly selectedQueueItem = computed(() => {
    const rows = this.securityQueue();
    const id = this.selectedQueueId();
    return rows.find((row) => row.id === id) ?? rows[0] ?? null;
  });
  protected readonly selectedReviewItem = computed(() => {
    const row = this.selectedQueueItem();
    if (!row || row.type !== 'access_review') return null;
    return this.pendingItems().find((item) => item.id === row.refId) ?? null;
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    forkJoin({
      summary: this.http.get<SecuritySummary>('/api/security-governance/summary'),
      accessMap: this.http.get<AccessMapRow[]>('/api/security-governance/access-map'),
      maskingPolicies: this.http.get<MaskingPolicy[]>('/api/security-governance/masking-policies'),
      accessReviews: this.http.get<AccessReview[]>('/api/security-governance/access-reviews'),
      dlpIncidents: this.http.get<DlpIncident[]>('/api/security-governance/dlp-incidents'),
      classificationRequests: this.http.get<ClassificationRequest[]>('/api/security-governance/classification-requests'),
      decisions: this.http.get<DecisionLog[]>('/api/security-governance/decision-log'),
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary);
        this.accessMap.set(result.accessMap);
        this.maskingPolicies.set(result.maskingPolicies);
        this.accessReviews.set(result.accessReviews);
        this.dlpIncidents.set(result.dlpIncidents);
        this.classificationRequests.set(result.classificationRequests);
        this.decisions.set(result.decisions);
        this.ensureQueueSelection();
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  private ensureQueueSelection(): void {
    const rows = this.securityQueue();
    const selected = this.selectedQueueId();
    if (!selected || !rows.some((row) => row.id === selected)) {
      this.selectedQueueId.set(rows[0]?.id ?? null);
    }
  }

  protected selectQueueItem(id: string): void {
    this.selectedQueueId.set(id);
  }

  protected isExpandedPanel(panel: string): boolean {
    return this.expandedPanel() === panel;
  }

  protected toggleExpandedPanel(panel: string): void {
    this.expandedPanel.set(this.isExpandedPanel(panel) ? null : panel);
  }

  protected closeExpandedPanel(): void {
    this.expandedPanel.set(null);
  }

  protected openCampaign(): void {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    this.campaignForm = {
      title: `Periodic access certification - ${new Date().toISOString().slice(0, 10)}`,
      description: '',
      dueDate: date.toISOString().slice(0, 10),
      includeUserGrants: true,
      includeRoleGrants: true,
    };
    this.campaignOpen.set(true);
  }

  protected createCampaign(): void {
    if (!this.canCreate || this.busy()) return;
    if (!this.campaignForm.title.trim()) {
      this.toast.error(this.t('sec.campaign.titleRequired'));
      return;
    }
    if (!this.campaignForm.includeUserGrants && !this.campaignForm.includeRoleGrants) {
      this.toast.error(this.t('sec.campaign.typeRequired'));
      return;
    }
    this.busy.set(true);
    this.http.post<AccessReview>('/api/security-governance/access-reviews/campaigns', {
      title: this.campaignForm.title.trim(),
      description: this.campaignForm.description.trim() || null,
      dueDate: this.campaignForm.dueDate || null,
      includeUserGrants: this.campaignForm.includeUserGrants,
      includeRoleGrants: this.campaignForm.includeRoleGrants,
    }).subscribe({
      next: (review) => {
        this.busy.set(false);
        this.campaignOpen.set(false);
        this.toast.success(`${this.t('sec.campaign.created')} ${review.code}`);
        this.load();
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('sec.campaign.error'));
      },
    });
  }

  protected openSimulator(): void {
    if (!this.canSimulate || this.busy()) return;
    this.simulatorResult.set(null);
    this.simulatorOpen.set(true);
    if (this.simulatorRoles().length && this.simulatorAssets().length) {
      this.ensureSimulatorDefaults();
      return;
    }
    this.simulatorLoading.set(true);
    forkJoin({
      roles: this.http.get<RoleRef[]>('/api/roles'),
      assets: this.http.get<AssetRef[] | AssetPage>('/api/assets?page=1&pageSize=100'),
    }).subscribe({
      next: (result) => {
        this.simulatorRoles.set(result.roles.filter((role) => role.code !== 'system_admin'));
        this.simulatorAssets.set(Array.isArray(result.assets) ? result.assets : result.assets.data);
        this.simulatorLoading.set(false);
        this.ensureSimulatorDefaults();
      },
      error: (error) => {
        this.simulatorLoading.set(false);
        this.toast.errorFrom(error, this.t('sec.sim.error'));
      },
    });
  }

  protected closeSimulator(): void {
    if (this.busy()) return;
    this.simulatorOpen.set(false);
  }

  protected ensureSimulatorDefaults(): void {
    const roles = this.simulatorRoles();
    const assets = this.simulatorAssets();
    this.simulatorForm = {
      ...this.simulatorForm,
      roleId: this.simulatorForm.roleId || roles[0]?.id || '',
      assetId: this.simulatorForm.assetId || assets[0]?.id || '',
    };
  }

  protected submitSimulator(): void {
    if (!this.canSimulate || this.busy()) return;
    if (!this.simulatorForm.roleId || !this.simulatorForm.assetId) {
      this.toast.error(this.t('sec.sim.required'));
      return;
    }
    this.busy.set(true);
    this.http.post<SimulatedDecision>('/api/security-governance/decision-log/simulate', {
      roleId: this.simulatorForm.roleId,
      assetId: this.simulatorForm.assetId,
      requestedAction: this.simulatorForm.requestedAction,
      purpose: this.simulatorForm.purpose,
      networkZone: this.simulatorForm.networkZone,
      personalDataRequested: this.simulatorForm.personalDataRequested,
      legalBasisConfirmed: this.simulatorForm.legalBasisConfirmed,
      emergencyAccess: this.simulatorForm.emergencyAccess,
      approvalTicketId: this.simulatorForm.approvalTicketId.trim() || null,
      businessJustification: this.simulatorForm.businessJustification.trim() || null,
    }).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.simulatorResult.set(result);
        this.toast.success(this.t('sec.sim.done'));
        this.load();
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('sec.sim.error'));
      },
    });
  }

  protected openReviewDecision(decision: AccessReviewDecision): void {
    const item = this.selectedReviewItem();
    if (!this.canDecide || !item || this.busy()) return;
    this.reviewDecisionForm = {
      itemId: item.id,
      decision,
      justification: '',
      newExpiresAt: '',
    };
    this.reviewDecisionOpen.set(true);
  }

  protected closeReviewDecision(): void {
    if (this.busy()) return;
    this.reviewDecisionOpen.set(false);
  }

  protected reviewDecisionTitle(): string {
    return `${this.t('sec.review.decisionTitle')} - ${this.t('sec.decision.' + this.reviewDecisionForm.decision)}`;
  }

  protected submitReviewDecision(): void {
    if (!this.canDecide || this.busy()) return;
    const justification = this.reviewDecisionForm.justification.trim();
    if (this.reviewDecisionForm.decision !== 'certified' && !justification) {
      this.toast.error(this.t('sec.review.justificationRequired'));
      return;
    }
    if (this.reviewDecisionForm.decision === 'shorten_expiry' && !this.reviewDecisionForm.newExpiresAt) {
      this.toast.error(this.t('sec.review.expiryRequired'));
      return;
    }
    this.busy.set(true);
    this.http.patch<AccessReviewItem>(`/api/security-governance/access-review-items/${this.reviewDecisionForm.itemId}`, {
      decision: this.reviewDecisionForm.decision,
      justification: justification || null,
      newExpiresAt: this.reviewDecisionForm.newExpiresAt
        ? new Date(this.reviewDecisionForm.newExpiresAt).toISOString()
        : null,
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.reviewDecisionOpen.set(false);
        this.toast.success(this.t('sec.review.decisionSaved'));
        this.load();
      },
      error: (error) => {
        this.busy.set(false);
        this.toast.errorFrom(error, this.t('sec.review.decisionError'));
      },
    });
  }

  protected name(o?: { nameEn?: string; nameAr?: string; fullNameEn?: string; fullNameAr?: string; displayName?: string | null; email?: string } | null): string {
    if (!o) return '-';
    if (this.i18n.lang() === 'ar') return o.nameAr ?? o.fullNameAr ?? o.nameEn ?? o.fullNameEn ?? o.displayName ?? o.email ?? '-';
    return o.nameEn ?? o.fullNameEn ?? o.displayName ?? o.nameAr ?? o.fullNameAr ?? o.email ?? '-';
  }

  protected targetName(item: AccessReviewItem): string {
    return this.name(item.asset) !== '-' ? this.name(item.asset) : this.name(item.domain);
  }

  protected date(value?: string | null): string {
    return value ? new Date(value).toLocaleDateString() : '-';
  }

  protected riskKind(value: string): StatusKind {
    if (value === 'critical' || value === 'high') return 'danger';
    if (value === 'medium') return 'warning';
    return 'success';
  }

  protected decisionKind(value: string): StatusKind {
    if (value === 'allow' || value === 'certified') return 'success';
    if (value === 'masked' || value === 'review_required' || value === 'pending' || value === 'exception') return 'warning';
    if (value === 'deny' || value === 'revoke' || value === 'escalated') return 'danger';
    return 'info';
  }

  protected queueKind(row: SecurityQueueItem): StatusKind {
    if (row.risk) return this.riskKind(row.risk);
    return this.decisionKind(row.status);
  }

  protected queueStatusLabel(row: SecurityQueueItem): string {
    if (row.type === 'dlp') return this.t(`sec.dlp.status.${row.status}`);
    if (row.type === 'classification') return this.t(`sec.classification.status.${row.status}`);
    return this.t(`sec.decision.${row.status}`);
  }

  protected statusKind(value: string): StatusKind {
    if (['closed', 'completed', 'implemented', 'false_positive'].includes(value)) return 'success';
    if (['contained', 'approved', 'under_review', 'active'].includes(value)) return 'info';
    if (['new', 'triaged', 'pending'].includes(value)) return 'warning';
    if (['rejected', 'cancelled'].includes(value)) return 'danger';
    return 'muted';
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
