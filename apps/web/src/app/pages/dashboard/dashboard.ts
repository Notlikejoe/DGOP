import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { ApiService, HealthResponse } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { StatusChip } from '../../shared/status-chip';
import { KpiCard, KpiTone } from '../../shared/kpi-card';
import { ProgressBar, BarKind } from '../../shared/progress-bar';
import { MiniBarChart, MiniBarItem } from '../../shared/mini-bar-chart';

type State = 'loading' | 'ok' | 'error';
type GapType = 'missing' | 'expired' | 'rejected' | 'unassigned' | 'stuck';

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
  reference: { people: number } | null;
}

const GAP_KINDS: Record<GapType, BarKind> = {
  missing: 'danger',
  expired: 'danger',
  rejected: 'warning',
  stuck: 'warning',
  unassigned: 'info',
};

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusChip, RouterLink, KpiCard, ProgressBar, MiniBarChart],
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

  /** True when every persona section is empty (e.g. a minimal read-only role). */
  protected readonly hasNoSections = computed(() => {
    const s = this.summary();
    return !!s && !s.governance && !s.ndi && !s.workflow && !s.myWork && !s.reference;
  });

  protected readonly gapItems = computed<MiniBarItem[]>(() => {
    const ndi = this.summary()?.ndi;
    if (!ndi) return [];
    return (Object.keys(ndi.gaps) as GapType[])
      .map((type) => ({
        label: this.t(`scoring.gap.${type}`),
        value: ndi.gaps[type],
        kind: GAP_KINDS[type],
        link: '/governance/ndi/gaps',
      }))
      .filter((i) => i.value > 0)
      .sort((a, b) => b.value - a.value);
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

  /** Coverage tone: green when strong, amber mid, red when weak. */
  protected coverageTone(pct: number): KpiTone {
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
