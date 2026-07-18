import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { NdiDomainCount } from './ndi.types';

interface DomainTraceabilityModel {
  code: string;
  name: string;
  purpose: string;
  status: 'ready' | 'watch' | 'blocked';
  evidenceQualityScore: number;
  openGapCount: number;
  lifecycle: string[];
  route: string;
  nextAction: string;
  metrics: {
    specCount: number;
    approvedEvidenceCount: number;
    evidenceCount: number;
    operationalRecordCount: number;
    workflowCaseCount: number;
  };
}

interface DomainTraceability {
  summary: {
    ready: number;
    watch: number;
    blocked: number;
    openGaps: number;
  };
  models: DomainTraceabilityModel[];
}

@Component({
  selector: 'app-ndi-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusChip],
  templateUrl: './ndi-hub.html',
  styleUrl: './ndi.scss',
})
export class NdiHubPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected get canScore(): boolean { return this.auth.hasPermission('ndi_scoring.view'); }

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly domains = signal<NdiDomainCount[]>([]);
  protected readonly traceability = signal<DomainTraceability | null>(null);

  protected readonly totalSpecs = computed(() =>
    this.domains().reduce((sum, d) => sum + d.specCount, 0),
  );
  protected readonly coveredDomains = computed(() =>
    this.domains().filter((d) => d.specCount > 0).length,
  );

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.traceability.set(null);
    this.http.get<NdiDomainCount[]>('/api/ndi/domains').subscribe({
      next: (d) => {
        this.domains.set(d);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
    this.http.get<DomainTraceability>('/api/ndi/domain-traceability').subscribe({
      next: (d) => this.traceability.set(d),
      error: () => this.traceability.set(null),
    });
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
  protected name(o: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected statusKind(status: string): StatusKind {
    if (status === 'ready') return 'success';
    if (status === 'blocked') return 'danger';
    return 'warning';
  }
}
