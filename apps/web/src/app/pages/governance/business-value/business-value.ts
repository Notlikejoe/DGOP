import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface Ref {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string;
}

interface AssetRef extends Ref {
  lifecycleStatus?: string;
  ownerName?: string | null;
  domain?: Ref | null;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  status: string;
  count: number;
}

interface Workspace {
  summary: {
    glossary: { total: number; approved: number; reviewDue: number; readinessScore: number; status: string };
    lineageMaps: number;
    verifiedLineage: number;
    lifecycleDecisions: number;
    lifecyclePending: number;
    impactAssessments: number;
    criticalImpact: number;
    valueKpis: number;
    realizedKpis: number;
    totalAnnualValue: number;
    averageSurveyScore: number;
  };
  graph: { nodes: GraphNode[]; edges: unknown[] };
  glossary: any[];
  lineage: any[];
  valuations: any[];
  lifecycle: any[];
  assessments: any[];
  kpis: any[];
  surveys: any[];
}

@Component({
  selector: 'app-business-value',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppIcon, StatusChip],
  templateUrl: './business-value.html',
  styleUrl: './business-value.scss',
})
export class BusinessValuePage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly saving = signal(false);
  protected readonly workspace = signal<Workspace | null>(null);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly domains = signal<Ref[]>([]);

  protected glossaryForm = { termEn: '', definition: '', assetId: '', domainId: '' };
  protected lineageForm = { processName: '', sourceAssetId: '', targetAssetId: '', domainId: '', impactScore: 65 };
  protected lifecycleForm = { assetId: '', proposedStatus: 'active', retentionDecision: 'review', retentionBasis: '' };
  protected biaForm = { processName: '', assetId: '', domainId: '', impactScore: 70, rtoHours: 24 };
  protected valueForm = { assetId: '', useCase: '', annualValue: 0, roiPercent: 0, ownerName: '' };
  protected kpiForm = { name: '', valueType: 'value', period: '2026-Q3', targetValue: 0, actualValue: 0, unit: '' };
  protected surveyForm = { valuationId: '', score: 80, feedback: '' };

  ngOnInit(): void {
    this.loadRefs();
    this.loadWorkspace();
  }

  protected loadWorkspace(): void {
    this.state.set('loading');
    this.http.get<Workspace>('/api/business-value/workspace').subscribe({
      next: (workspace) => {
        this.workspace.set(workspace);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected createGlossary(): void {
    if (!this.glossaryForm.termEn || !this.glossaryForm.definition) return;
    this.save('/api/business-value/glossary', this.clean(this.glossaryForm), () => {
      this.glossaryForm = { termEn: '', definition: '', assetId: '', domainId: '' };
    });
  }

  protected decideGlossary(row: any, status: string): void {
    this.patch(`/api/business-value/glossary/${row.id}`, { status });
  }

  protected createLineage(): void {
    if (!this.lineageForm.processName) return;
    this.save('/api/business-value/lineage', this.clean(this.lineageForm), () => {
      this.lineageForm = { processName: '', sourceAssetId: '', targetAssetId: '', domainId: '', impactScore: 65 };
    });
  }

  protected updateLineage(row: any, status: string): void {
    this.patch(`/api/business-value/lineage/${row.id}`, { status });
  }

  protected createLifecycle(): void {
    if (!this.lifecycleForm.assetId) return;
    this.save('/api/business-value/lifecycle', this.clean(this.lifecycleForm));
  }

  protected decideLifecycle(row: any, status: string): void {
    this.patch(`/api/business-value/lifecycle/${row.id}`, { status });
  }

  protected createBia(): void {
    if (!this.biaForm.processName || (!this.biaForm.assetId && !this.biaForm.domainId)) return;
    this.save('/api/business-value/bia', this.clean(this.biaForm), () => {
      this.biaForm = { processName: '', assetId: '', domainId: '', impactScore: 70, rtoHours: 24 };
    });
  }

  protected createValuation(): void {
    if (!this.valueForm.assetId || !this.valueForm.useCase) return;
    this.save('/api/business-value/valuations', this.clean(this.valueForm), () => {
      this.valueForm = { assetId: '', useCase: '', annualValue: 0, roiPercent: 0, ownerName: '' };
    });
  }

  protected createKpi(): void {
    if (!this.kpiForm.name || !this.kpiForm.period) return;
    this.save('/api/business-value/kpis', this.clean(this.kpiForm), () => {
      this.kpiForm = { name: '', valueType: 'value', period: '2026-Q3', targetValue: 0, actualValue: 0, unit: '' };
    });
  }

  protected createSurvey(): void {
    if (!this.surveyForm.valuationId) return;
    this.save('/api/business-value/surveys', this.clean(this.surveyForm), () => {
      this.surveyForm = { valuationId: '', score: 80, feedback: '' };
    });
  }

  protected statusKind(status: string): StatusKind {
    if (['approved', 'verified', 'realized', 'implemented', 'healthy'].includes(status)) return 'success';
    if (['critical', 'rejected', 'at_risk', 'expired'].includes(status)) return 'danger';
    if (['under_review', 'needs_revision', 'needs_update', 'proposed', 'measuring', 'watch'].includes(status)) return 'warning';
    return 'info';
  }

  protected money(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value ?? 0);
  }

  protected name(ref?: Ref | null): string {
    if (!ref) return '-';
    return this.i18n.lang() === 'ar' && ref.nameAr ? ref.nameAr : ref.nameEn;
  }

  protected assetLabel(asset?: AssetRef | null): string {
    if (!asset) return '-';
    return `${asset.code} - ${this.name(asset)}`;
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  private loadRefs(): void {
    this.http.get<AssetRef[]>('/api/assets').subscribe({ next: (assets) => this.assets.set(assets), error: () => this.assets.set([]) });
    this.http.get<Ref[]>('/api/data-domains').subscribe({ next: (domains) => this.domains.set(domains), error: () => this.domains.set([]) });
  }

  private clean<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === '' ? undefined : item])) as T;
  }

  private save(url: string, body: unknown, reset?: () => void): void {
    this.saving.set(true);
    this.http.post(url, body).subscribe({
      next: () => {
        reset?.();
        this.saving.set(false);
        this.loadWorkspace();
      },
      error: () => this.saving.set(false),
    });
  }

  private patch(url: string, body: unknown): void {
    this.saving.set(true);
    this.http.patch(url, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.loadWorkspace();
      },
      error: () => this.saving.set(false),
    });
  }
}
