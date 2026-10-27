import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { RegisterControls } from '../../../shared/register-controls';
import { ApprovedEvidencePicker } from '../../../shared/approved-evidence-picker';
import { ToastService } from '../../../shared/toast.service';
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
  registerPages: Record<string,{data:any[];total:number;page:number;pageSize:number;totalPages:number}>;
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
  imports: [FormsModule, AppIcon, StatusChip,RegisterControls,ApprovedEvidencePicker],
  templateUrl: './business-value.html',
  styleUrl: './business-value.scss',
})
export class BusinessValuePage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroy=inject(DestroyRef);private readonly toast=inject(ToastService);
  private readonly requests:Record<string,Subscription>={};private readonly revisions:Record<string,number>={};private loadRevision=0;
  protected readonly registerBusy=signal<Record<string,boolean>>({});protected readonly measurementTarget=signal<any|null>(null);
  protected measurementDraft={actualAnnualValue:0,measuredAt:new Date().toISOString().slice(0,10),evidenceId:'',evidenceJustification:''};
  protected registerInfo(key:string){return this.workspace()?.registerPages[key]??{page:1,pageSize:25,total:0,totalPages:1};}
  protected loadRegister(key:string,query:{page:number;search:string}){
    this.requests[key]?.unsubscribe();const revision=(this.revisions[key]??0)+1;this.revisions[key]=revision;
    this.registerBusy.update(state=>({...state,[key]:true}));
    this.requests[key]=this.http.get<any>('/api/business-value/registers/'+key,{params:{page:query.page,pageSize:25,search:query.search}}).pipe(takeUntilDestroyed(this.destroy)).subscribe({next:page=>{if(this.revisions[key]!==revision)return;this.workspace.update(workspace=>workspace?({...workspace,[key]:page.data,registerPages:{...workspace.registerPages,[key]:page}}):null);this.registerBusy.update(state=>({...state,[key]:false}));},error:error=>{if(this.revisions[key]!==revision)return;this.registerBusy.update(state=>({...state,[key]:false}));this.toast.errorFrom(error);}});
  }
  protected openMeasurement(row:any){this.measurementTarget.set(row);this.measurementDraft={actualAnnualValue:row.actualAnnualValue??0,measuredAt:new Date().toISOString().slice(0,10),evidenceId:'',evidenceJustification:''};}
  protected recordMeasurement(){const row=this.measurementTarget();if(!row||this.saving()||!this.measurementDraft.evidenceId)return;this.patch('/api/business-value/valuations/'+row.id+'/measure',{...this.measurementDraft,expectedVersion:row.version},()=>this.measurementTarget.set(null));}

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
    this.state.set('loading');const revision=++this.loadRevision;for(const request of Object.values(this.requests))request.unsubscribe();this.registerBusy.set({});
    this.http.get<Workspace>('/api/business-value/workspace').pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (workspace) => {
        if(revision!==this.loadRevision)return;
        this.workspace.set(workspace);
        this.state.set('ready');
      },
      error: () => {if(revision===this.loadRevision)this.state.set('error');},
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
      error: (error) => {this.saving.set(false);this.toast.errorFrom(error);},
    });
  }

  private patch(url: string, body: unknown,onSuccess?:()=>void): void {
    this.saving.set(true);
    this.http.patch(url, body).subscribe({
      next: () => {
        onSuccess?.();
        this.saving.set(false);
        this.loadWorkspace();
      },
      error: (error) => {this.saving.set(false);this.toast.errorFrom(error);},
    });
  }
}
