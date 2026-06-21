import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { ProgressBar, BarKind } from '../../../shared/progress-bar';
import {
  DomainDetail,
  DomainReadiness,
  GAP_TYPES,
  GapType,
  MATURITY_KIND,
  ReadinessOverview,
  SpecScoreRow,
  scoreKind,
} from './scoring.types';

@Component({
  selector: 'app-ndi-readiness',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusChip, ProgressBar],
  templateUrl: './ndi-readiness.html',
  styleUrl: './ndi.scss',
})
export class NdiReadinessPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly data = signal<ReadinessOverview | null>(null);
  protected readonly gapTypes = GAP_TYPES;

  // inline domain drill-down
  protected readonly selectedDomainId = signal<string | null>(null);
  protected readonly detail = signal<DomainDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly showExplanation = signal(false);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<ReadinessOverview>('/api/ndi/scoring/readiness').subscribe({
      next: (d) => {
        this.data.set(d);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
  protected name(o: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected maturityKind(m: string): StatusKind {
    return MATURITY_KIND[m] ?? 'muted';
  }
  protected barKind(score: number): BarKind {
    const k = scoreKind(score);
    return k === 'muted' ? 'info' : k;
  }
  protected gapCount(g: GapType): number {
    return this.data()?.gapTotals[g] ?? 0;
  }
  protected specName(s: SpecScoreRow): string {
    return this.i18n.lang() === 'ar' ? s.nameAr : s.nameEn;
  }

  protected selectDomain(d: DomainReadiness): void {
    if (d.specCount === 0) return;
    if (this.selectedDomainId() === d.domainId) {
      this.selectedDomainId.set(null);
      this.detail.set(null);
      return;
    }
    this.selectedDomainId.set(d.domainId);
    this.detail.set(null);
    this.detailLoading.set(true);
    this.http.get<DomainDetail>(`/api/ndi/scoring/domains/${d.domainId}`).subscribe({
      next: (dd) => {
        this.detail.set(dd);
        this.detailLoading.set(false);
      },
      error: () => this.detailLoading.set(false),
    });
  }

  protected toggleExplanation(): void {
    this.showExplanation.update((v) => !v);
  }
}
