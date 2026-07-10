import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { AppIcon } from '../../../shared/app-icon';

interface Ref { id: string; code: string; nameEn: string; nameAr: string; }
interface ClassificationRef extends Ref { rank: number; color: string; }
interface RoleRef extends Ref { maxClassificationRank?: number | null; }
interface UserRef { id: string; email: string; displayName?: string | null; }

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
  imports: [RouterLink, StatusChip, AppIcon],
  templateUrl: './security-governance.html',
  styleUrl: './security-governance.scss',
})
export class SecurityGovernancePage implements OnInit {
  private readonly http = inject(HttpClient);
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
