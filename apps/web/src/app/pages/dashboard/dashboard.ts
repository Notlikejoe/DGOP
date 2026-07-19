import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { ApiService, HealthResponse } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { StatusChip } from '../../shared/status-chip';
import { ProgressBar, BarKind } from '../../shared/progress-bar';

type State = 'loading' | 'ok' | 'error';
type GapType = 'missing' | 'expired' | 'rejected' | 'unassigned' | 'stuck';
type Severity = 'success' | 'warning' | 'danger' | 'info' | 'muted';

interface DashboardSummary {
  governance: {
    assets: { total: number; withOwner: number; unassigned: number };
    ownershipCoveragePct: number;
    stewardshipCoveragePct: number;
    pendingApprovals: number;
  } | null;
  ndi: {
    readinessPct: number;
    maturity: string;
    satisfied: number;
    specifications: number;
    gaps: Record<GapType, number>;
  } | null;
  workflow: { myOpenTasks: number; myOverdueTasks: number } | null;
  myWork: { ownedAssets: number; ownedSpecs: number; evidenceToReview: number | null } | null;
  training: {
    assignments: number;
    completed: number;
    expired: number;
    overdue: number;
    completionRate: number;
    certificationTracks: number;
    activeCertifications: number;
    ceHours: number;
    communityArticles: number;
    mentorships: number;
    awarenessReadiness: number;
  } | null;
  dataQuality: { open: number; critical: number; overdue: number; closureRate: number } | null;
  reference: { people: number } | null;
}

interface ActionItem {
  label: string;
  detail: string;
  value: number | string;
  kind: Severity;
  link: string;
}

interface JourneyNode {
  label: string;
  value: string;
  detail: string;
  kind: Severity;
}

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusChip, RouterLink, ProgressBar],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<State>('loading');
  protected readonly health = signal<HealthResponse | null>(null);

  protected readonly summary = signal<DashboardSummary | null>(null);
  protected readonly summaryError = signal(false);

  protected readonly platformSignalKind = computed<Severity>(() => {
    if (this.state() === 'loading') return 'info';
    if (this.state() === 'error') return 'danger';
    const h = this.health();
    return h?.status === 'ok' && h.database?.status === 'up' ? 'success' : 'danger';
  });

  protected readonly platformSignalLabel = computed(() => {
    const kind = this.platformSignalKind();
    if (kind === 'success') return this.t('cmd.online');
    if (kind === 'danger') return this.t('cmd.offline');
    return this.t('cmd.checking');
  });

  protected readonly databaseStatusLabel = computed(() => this.health()?.database?.status ?? this.t('cmd.notDisclosed'));
  protected readonly environmentLabel = computed(() => this.health()?.environment ?? this.t('cmd.notDisclosed'));

  /** True when every persona section is empty (e.g. a minimal read-only role). */
  protected readonly hasNoSections = computed(() => {
    const s = this.summary();
    return !!s && !s.governance && !s.ndi && !s.workflow && !s.myWork && !s.training && !s.dataQuality && !s.reference;
  });

  protected readonly riskTotal = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    return (
      (s.governance?.assets.unassigned ?? 0) +
      (s.governance?.pendingApprovals ?? 0) +
      (s.workflow?.myOverdueTasks ?? 0) +
      (s.training?.overdue ?? 0) +
      (s.training?.expired ?? 0) +
      (s.dataQuality?.critical ?? 0) +
      (s.dataQuality?.overdue ?? 0) +
      this.gapTotal(s.ndi)
    );
  });

  protected readonly healthKind = computed<Severity>(() => {
    if (this.platformSignalKind() === 'danger') return 'danger';
    const s = this.summary();
    if (!s) return 'info';
    if ((s.workflow?.myOverdueTasks ?? 0) > 0) return 'danger';
    if ((s.ndi?.readinessPct ?? 100) < 40) return 'danger';
    if (this.riskTotal() > 0) return 'warning';
    return 'success';
  });

  protected readonly healthLabel = computed(() => {
    const kind = this.healthKind();
    if (kind === 'success') return this.t('cmd.health.healthy');
    if (kind === 'danger') return this.t('cmd.health.critical');
    if (kind === 'warning') return this.t('cmd.health.review');
    return this.t('cmd.health.checking');
  });

  protected readonly primaryAction = computed<ActionItem | null>(() => {
    const s = this.summary();
    if (!s) return null;
    if ((s.workflow?.myOverdueTasks ?? 0) > 0) {
      return {
        label: this.t('cmd.action.overdue'),
        detail: this.t('cmd.action.overdueDetail'),
        value: s.workflow?.myOverdueTasks ?? 0,
        kind: 'danger',
        link: '/governance/workflow',
      };
    }
    if ((s.governance?.assets.unassigned ?? 0) > 0) {
      return {
        label: this.t('cmd.action.assignOwners'),
        detail: this.t('cmd.action.assignOwnersDetail'),
        value: s.governance?.assets.unassigned ?? 0,
        kind: 'warning',
        link: '/governance/exception-queue',
      };
    }
    if ((s.dataQuality?.critical ?? 0) > 0 || (s.dataQuality?.overdue ?? 0) > 0) {
      return {
        label: this.t('cmd.action.dataQuality'),
        detail: this.t('cmd.action.dataQualityDetail'),
        value: (s.dataQuality?.critical ?? 0) + (s.dataQuality?.overdue ?? 0),
        kind: 'danger',
        link: '/governance/data-quality',
      };
    }
    if ((s.training?.overdue ?? 0) > 0 || (s.training?.expired ?? 0) > 0) {
      return {
        label: this.t('cmd.action.training'),
        detail: this.t('cmd.action.trainingDetail'),
        value: (s.training?.overdue ?? 0) + (s.training?.expired ?? 0),
        kind: 'warning',
        link: '/governance/training',
      };
    }
    if (this.gapTotal(s.ndi) > 0) {
      return {
        label: this.t('cmd.action.closeGaps'),
        detail: this.t('cmd.action.closeGapsDetail'),
        value: this.gapTotal(s.ndi),
        kind: 'warning',
        link: '/governance/ndi/gaps',
      };
    }
    return {
      label: this.t('cmd.action.readinessReport'),
      detail: this.t('cmd.action.readinessReportDetail'),
      value: s.ndi ? `${s.ndi.readinessPct}%` : this.t('cmd.ready'),
      kind: 'success',
      link: '/governance/ndi/readiness',
    };
  });

  protected readonly actionItems = computed<ActionItem[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const items: ActionItem[] = [];
    if (s.workflow) {
      items.push({
        label: this.t('cmd.queue.workflow'),
        detail: s.workflow.myOverdueTasks
          ? this.t('cmd.queue.workflowOverdue')
          : this.t('cmd.queue.workflowOpen'),
        value: s.workflow.myOverdueTasks || s.workflow.myOpenTasks,
        kind: s.workflow.myOverdueTasks ? 'danger' : s.workflow.myOpenTasks ? 'info' : 'muted',
        link: '/governance/workflow',
      });
    }
    if (s.governance) {
      items.push({
        label: this.t('cmd.queue.ownership'),
        detail: this.t('cmd.queue.ownershipDetail'),
        value: s.governance.assets.unassigned,
        kind: s.governance.assets.unassigned ? 'warning' : 'success',
        link: '/governance/exception-queue',
      });
      items.push({
        label: this.t('cmd.queue.approvals'),
        detail: this.t('cmd.queue.approvalsDetail'),
        value: s.governance.pendingApprovals,
        kind: s.governance.pendingApprovals ? 'info' : 'muted',
        link: '/governance/ownership',
      });
    }
    if (s.ndi) {
      items.push({
        label: this.t('cmd.queue.ndiGaps'),
        detail: this.t('cmd.queue.ndiGapsDetail'),
        value: this.gapTotal(s.ndi),
        kind: this.gapTotal(s.ndi) ? 'warning' : 'success',
        link: '/governance/ndi/gaps',
      });
    }
    if (s.dataQuality) {
      items.push({
        label: this.t('cmd.queue.dataQuality'),
        detail: this.t('cmd.queue.dataQualityDetail'),
        value: s.dataQuality.critical || s.dataQuality.open,
        kind: s.dataQuality.critical ? 'danger' : s.dataQuality.open ? 'warning' : 'success',
        link: '/governance/data-quality',
      });
    }
    if (s.training) {
      items.push({
        label: this.t('cmd.queue.training'),
        detail: this.t('cmd.queue.trainingDetail'),
        value: s.training.overdue || s.training.expired || `${s.training.awarenessReadiness}%`,
        kind: s.training.overdue || s.training.expired ? 'warning' : 'success',
        link: '/governance/training',
      });
    }
    if (s.myWork?.evidenceToReview !== null && s.myWork?.evidenceToReview !== undefined) {
      items.push({
        label: this.t('cmd.queue.evidence'),
        detail: this.t('cmd.queue.evidenceDetail'),
        value: s.myWork.evidenceToReview,
        kind: s.myWork.evidenceToReview ? 'warning' : 'muted',
        link: '/governance/ndi',
      });
    }
    return items;
  });

  protected readonly journeyNodes = computed<JourneyNode[]>(() => {
    const s = this.summary();
    if (!s) return [];
    return [
      {
        label: this.t('cmd.journey.catalog'),
        value: `${s.governance?.assets.total ?? 0}`,
        detail: this.t('cmd.journey.catalogDetail'),
        kind: 'info',
      },
      {
        label: this.t('cmd.journey.ownership'),
        value: `${s.governance?.ownershipCoveragePct ?? 0}%`,
        detail: this.t('cmd.journey.ownershipDetail'),
        kind: this.coverageTone(s.governance?.ownershipCoveragePct ?? 0),
      },
      {
        label: this.t('cmd.journey.stewardship'),
        value: `${s.governance?.stewardshipCoveragePct ?? 0}%`,
        detail: this.t('cmd.journey.stewardshipDetail'),
        kind: this.coverageTone(s.governance?.stewardshipCoveragePct ?? 0),
      },
      {
        label: this.t('cmd.journey.evidence'),
        value: s.ndi ? `${s.ndi.satisfied}/${s.ndi.specifications}` : '0',
        detail: this.t('cmd.journey.evidenceDetail'),
        kind: this.readinessTone(s.ndi?.readinessPct ?? 0),
      },
      {
        label: this.t('cmd.journey.audit'),
        value: s.ndi ? `${s.ndi.readinessPct}%` : '0%',
        detail: this.t('cmd.journey.auditDetail'),
        kind: this.readinessTone(s.ndi?.readinessPct ?? 0),
      },
    ];
  });

  ngOnInit(): void {
    this.load();
    this.loadSummary();
  }

  protected load(): void {
    this.state.set('loading');
    this.api.health().subscribe({
      next: (res) => {
        this.health.set(res);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected loadSummary(): void {
    this.summaryError.set(false);
    this.http.get<DashboardSummary>('/api/dashboard/summary').subscribe({
      next: (s) => this.summary.set(s),
      error: () => this.summaryError.set(true),
    });
  }

  protected coverageTone(pct: number): Severity {
    if (pct >= 80) return 'success';
    if (pct >= 50) return 'warning';
    return 'danger';
  }

  protected coverageBar(pct: number): BarKind {
    if (pct >= 80) return 'success';
    if (pct >= 50) return 'warning';
    return 'danger';
  }

  protected readinessBar(pct: number): BarKind {
    if (pct >= 80) return 'success';
    if (pct >= 40) return 'info';
    if (pct >= 20) return 'warning';
    return 'danger';
  }

  protected readinessTone(pct: number): Severity {
    if (pct >= 80) return 'success';
    if (pct >= 40) return 'info';
    if (pct >= 20) return 'warning';
    return 'danger';
  }

  protected gapTotal(ndi: DashboardSummary['ndi']): number {
    if (!ndi) return 0;
    return (Object.keys(ndi.gaps) as GapType[]).reduce((sum, type) => sum + ndi.gaps[type], 0);
  }

  protected gapRows(ndi: DashboardSummary['ndi']): Array<{ label: string; value: number; kind: Severity }> {
    if (!ndi) return [];
    return (Object.keys(ndi.gaps) as GapType[])
      .map((type) => {
        const kind: Severity =
          type === 'missing' || type === 'expired' ? 'danger' : type === 'unassigned' ? 'info' : 'warning';
        return {
          label: this.t(`scoring.gap.${type}`),
          value: ndi.gaps[type],
          kind,
        };
      })
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  protected maturityChipKind(maturity: string): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
    const map: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'muted'> = {
      initial: 'danger',
      defined: 'warning',
      activated: 'info',
      enabled: 'info',
      leading: 'success',
    };
    return map[maturity] ?? 'muted';
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
