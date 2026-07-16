import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../core/i18n.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface Readiness {
  score: number;
  status: string;
  blockers: string[];
}

interface WorkloadSection {
  [key: string]: unknown;
  risks?: RiskSignal[];
}

interface TrendBucket {
  label: string;
  openDataCreated: number;
  openDataPublished: number;
  foiReceived: number;
  foiDisclosed: number;
}

interface RiskSignal {
  id: string;
  source: string;
  title: string;
  detail: string;
  severity: string;
  route: string;
  dueAt?: string | null;
  metric?: number | null;
}

interface Scenario {
  id: string;
  title: string;
  status: string;
  evidence: string;
}

interface CockpitResponse {
  generatedAt: string;
  readiness: Readiness;
  openData: WorkloadSection | null;
  foi: WorkloadSection | null;
  privacy: WorkloadSection | null;
  sharing: WorkloadSection | null;
  workflow: WorkloadSection | null;
  trends: TrendBucket[];
  risks: RiskSignal[];
  scenarios: Scenario[];
}

@Component({
  selector: 'app-transparency-cockpit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, AppIcon, StatusChip],
  templateUrl: './transparency-cockpit.html',
  styleUrl: './transparency-cockpit.scss',
})
export class TransparencyCockpitPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly cockpit = signal<CockpitResponse | null>(null);

  protected readonly kpis = computed(() => {
    const data = this.cockpit();
    if (!data) return [];
    return [
      {
        label: this.t('transparency.kpi.readiness'),
        value: `${data.readiness.score}%`,
        hint: this.t(`transparency.readiness.${data.readiness.status}`),
        kind: this.statusKind(data.readiness.status),
      },
      {
        label: this.t('transparency.kpi.openData'),
        value: this.num(data.openData, 'total'),
        hint: `${this.num(data.openData, 'published')} ${this.t('transparency.kpi.published')}`,
        kind: 'info' as StatusKind,
      },
      {
        label: this.t('transparency.kpi.foi'),
        value: this.num(data.foi, 'open'),
        hint: `${this.num(data.foi, 'overdue')} ${this.t('transparency.kpi.overdue')}`,
        kind: this.num(data.foi, 'overdue') ? 'danger' as StatusKind : 'success' as StatusKind,
      },
      {
        label: this.t('transparency.kpi.privacy'),
        value: this.num(data.privacy, 'highRiskDpias') + this.num(data.privacy, 'breachNotificationRisk'),
        hint: this.t('transparency.kpi.privacyHint'),
        kind: this.num(data.privacy, 'highRiskDpias') ? 'warning' as StatusKind : 'success' as StatusKind,
      },
      {
        label: this.t('transparency.kpi.sharing'),
        value: this.num(data.sharing, 'pendingReviews'),
        hint: `${this.num(data.sharing, 'renewalDue')} ${this.t('transparency.kpi.renewals')}`,
        kind: this.num(data.sharing, 'pendingReviews') ? 'warning' as StatusKind : 'success' as StatusKind,
      },
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<CockpitResponse>('/api/transparency/cockpit').subscribe({
      next: (data) => {
        this.cockpit.set(data);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected num(section: WorkloadSection | null, key: string): number {
    const value = section?.[key];
    return typeof value === 'number' ? value : 0;
  }

  protected statusKind(status?: string | null): StatusKind {
    if (status === 'ready' || status === 'published' || status === 'closed') return 'success';
    if (status === 'watch' || status === 'due_soon' || status === 'medium') return 'warning';
    if (status === 'blocked' || status === 'critical' || status === 'high' || status === 'overdue') return 'danger';
    return 'info';
  }

  protected trendMax(data: CockpitResponse): number {
    return Math.max(
      1,
      ...data.trends.flatMap((bucket) => [
        bucket.openDataCreated,
        bucket.openDataPublished,
        bucket.foiReceived,
        bucket.foiDisclosed,
      ]),
    );
  }

  protected bar(value: number, data: CockpitResponse): number {
    return Math.round((value / this.trendMax(data)) * 100);
  }

  protected sourceLabel(source: string): string {
    return this.t(`transparency.source.${source}`);
  }
}
