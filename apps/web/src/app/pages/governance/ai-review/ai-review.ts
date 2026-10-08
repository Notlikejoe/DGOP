import { AiEvidencePanel } from '../../../shared/ai-evidence-panel';
import { formatDualDate } from '../../../shared/dual-date.format';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';
import { ToastService } from '../../../shared/toast.service';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { RippleModule } from 'primeng/ripple';
import { TabsModule } from 'primeng/tabs';

type ReviewTab = 'triage' | 'classification' | 'verification' | 'specialist' | 'decision' | 'registration';
type AssetLookup = { id: string; nameEn: string; nameAr: string };
type ReferenceValue = { code: string; labelEn: string; labelAr: string };
type DirectoryUser = { id: string; email: string; displayName: string; nameEn: string; nameAr: string };
type IntakeLookups = {
  lists: Record<string, { values: ReferenceValue[] }>;
  proposedOwners: DirectoryUser[];
  dataOwners: DirectoryUser[];
  executiveSponsors: DirectoryUser[];
};
interface ReviewQueue {
  data: AiReviewCase[]; total: number; page: number; pageSize: number; totalPages: number;
  summary: { total: number; pending: number; inProgress: number; overdue: number };
  denied?: boolean;
}
const REVIEW_TABS: ReviewTab[] = ['triage','classification','verification','specialist','decision','registration'];
const QUEUE_URLS: Record<ReviewTab,string> = {
  triage:'/api/ai/use-cases/triage', classification:'/api/ai/use-cases/classification/queue',
  verification:'/api/ai/use-cases/classification/verification/queue', specialist:'/api/ai/use-cases/classification/reviews/queue',
  decision:'/api/ai/use-cases/decisions/queue', registration:'/api/ai/use-cases/registration/queue',
};
function emptyQueue(page=1,denied=false):ReviewQueue {
  return {data:[],total:0,page,pageSize:25,totalPages:1,summary:{total:0,pending:0,inProgress:0,overdue:0},denied};
}

type CriterionCode = 'individual_impact' | 'affected_scope' | 'harm_likelihood' | 'decision_autonomy'
  | 'data_fairness_transparency' | 'technical_resilience';

interface AiReviewCase {
  id: string;
  useCaseRef?: string | null;
  name: string;
  description?: string | null;
  version: number;
  updatedAt: string;
  approvedTier?: TierOption | null;
  allowedDecisions?: string[];
  obligations?: Array<{ id: string; description: string }>;
  workflowCase: {
    id: string;
    code: string;
    status: string;
    tasks?: Array<{
      id: string;
      title: string;
      assigneeRoleCode?: string | null;
      assigneeUserId?: string | null;
      dueDate?: string | null;
      approvalGroupId?: string | null;
      formDataJson?: Record<string, unknown> | null;
      templateStage?: { code: string; nameEn: string; nameAr: string } | null;
    }>;
  };
  intakeRevisions: Array<{ payload: Record<string, unknown>; revision: number }>;
  assessments: Array<{
    id: string;
    round: number;
    engineVersion: string;
    inputs: Record<string, unknown>;
    result: Record<string, unknown>;
    createdBy: string;
    createdAt: string;
  }>;
}

interface ScoreOption {
  code: string;
  labelEn: string;
  labelAr: string;
  score?: number;
  anchors?: Record<string, { labelEn?: string; labelAr?: string; descriptionEn?: string; descriptionAr?: string }>;
}

interface TierOption {
  code: string;
  labelEn: string;
  labelAr: string;
  minScore?: number;
  maxScore?: number;
  automatic?: boolean;
}

interface ClassificationConfiguration {
  ready: boolean;
  issues: string[];
  criteria: CriterionCode[];
  scoreVersionId?: string | null;
  tierVersionId?: string | null;
  scores: ScoreOption[];
  tiers: TierOption[];
}

const CRITERIA: CriterionCode[] = [
  'individual_impact', 'affected_scope', 'harm_likelihood', 'decision_autonomy',
  'data_fairness_transparency', 'technical_resilience',
];

const INTAKE_FIELDS = [
  'request_date', 'requester', 'usecase_name', 'proposed_owner', 'strategic_streams', 'values_alignment',
  'program_platform', 'problem_desc', 'beneficiary_group', 'current_state', 'objective_value', 'success_kpi',
  'kpi_baseline', 'kpi_target', 'simpler_alternatives', 'existing_solutions_check', 'human_role', 'target_stage',
  'execution_model', 'data_source', 'data_owner', 'data_availability', 'personal_data_flag', 'data_classification',
  'budget_band', 'executive_sponsor', 'constraints_dependencies', 'attachments',
];

@Component({
  selector: 'app-ai-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports:[AiEvidencePanel,FormsModule, AppIcon, StatusChip, InputTextModule, ProgressBarModule, RippleModule, TabsModule],
  templateUrl: './ai-review.html',
  styleUrl: './ai-review.scss',
})
export class AiReviewPage implements OnInit, OnDestroy {
  protected readonly auth=inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);
  protected readonly criteria = CRITERIA;
  protected readonly intakeFields = INTAKE_FIELDS;
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly loadingQueues = signal(false);
  protected readonly tab = signal<ReviewTab>('triage');
  protected readonly queueSearch = signal('');
  protected readonly queues = signal<Record<ReviewTab,ReviewQueue>>(Object.fromEntries(REVIEW_TABS.map(tab=>[tab,emptyQueue()])) as Record<ReviewTab,ReviewQueue>);
  protected readonly activeQueue = computed(()=>this.queues()[this.tab()]);
  private readonly queuePages = signal<Partial<Record<ReviewTab,number>>>({});
  private requestGeneration = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  protected readonly triageCases = signal<AiReviewCase[]>([]);
  protected readonly classificationCases = signal<AiReviewCase[]>([]);
  protected readonly verificationCases = signal<AiReviewCase[]>([]);
  protected readonly specialistCases = signal<AiReviewCase[]>([]);
  protected readonly decisionCases = signal<AiReviewCase[]>([]);
  protected readonly registrationCases = signal<AiReviewCase[]>([]);
  protected readonly assetLookups = signal<{ domains: AssetLookup[]; classifications: AssetLookup[] }>({ domains: [], classifications: [] });
  protected readonly intakeLookups = signal<IntakeLookups | null>(null);
  protected readonly registrationMode = signal('create');
  protected readonly existingAssetId = signal('');
  protected readonly assetNameEn = signal('');
  protected readonly assetNameAr = signal('');
  protected readonly assetSubtype = signal('ai_powered_application');
  protected readonly assetDomainId = signal('');
  protected readonly assetClassificationId = signal('');
  protected readonly assetApprovalStage = computed(() => this.selectedReviewTask()?.templateStage?.code === 'aiuc-asset-approval');
  protected readonly registrationReady = computed(() => !!this.justification().trim() && !!this.assetDomainId() && !!this.assetClassificationId()
    && (this.registrationMode() === 'link' ? !!this.existingAssetId().trim() : !!this.assetNameEn().trim() && !!this.assetNameAr().trim()));
  protected readonly selected = signal<AiReviewCase | null>(null);
  protected readonly configuration = signal<ClassificationConfiguration | null>(null);
  protected readonly justification = signal('');
  protected readonly scores = signal<Record<string, { value: number | null; justification: string }>>({});
  protected readonly decisionTierCode = signal('');
  protected readonly decisionEvidenceIds = signal('');
  protected readonly authorityReference = signal('');
  protected readonly adoptionOutcome = signal('');
  protected readonly approvalConditions = signal('');
  protected readonly working = signal(false);
  protected readonly scoreMax = computed(() => {
    const values = CRITERIA.map(criterion => this.scores()[criterion]?.value).filter((value): value is number => typeof value === 'number');
    return values.length ? Math.max(...values) : null;
  });
  protected readonly calculatedTier = computed(() => {
    const max = this.scoreMax();
    if (max === null) return null;
    return this.configuration()?.tiers.find(tier => tier.automatic && tier.minScore !== undefined && tier.maxScore !== undefined
      && max >= tier.minScore && max <= tier.maxScore) ?? null;
  });
  protected readonly assessmentComplete = computed(() => CRITERIA.every(criterion => {
    const score = this.scores()[criterion];
    return typeof score?.value === 'number' && !!score.justification.trim();
  }));
  protected readonly latestAssessment = computed(() => this.selected()?.assessments?.[0] ?? null);
  protected readonly assessmentResult = computed(() => this.latestAssessment()?.result ?? {});
  protected readonly assessmentProposedTier = computed(() => {
    const code = this.assessmentResult()['proposedTierCode'];
    return typeof code === 'string' ? this.configuration()?.tiers.find(tier => tier.code === code) ?? null : null;
  });
  protected readonly decisionIsOverride = computed(() => !!this.decisionTierCode()
    && this.decisionTierCode() !== this.assessmentProposedTier()?.code);
  protected readonly decisionReady = computed(() => {
    if (!this.decisionTierCode() || !this.evidenceIdList().length) return false;
    if (!this.decisionIsOverride()) return true;
    return !!this.justification().trim() && !!this.authorityReference().trim() && this.evidenceIdList().length > 0;
  });
  protected readonly selectedReviewTask = computed(() => this.selected()?.workflowCase.tasks?.[0] ?? null);
  protected readonly canActOnStage=computed(()=>{
    const tab=this.tab(),task=this.selectedReviewTask(),roles=this.auth.currentUser()?.roles.map(r=>r.code)??[];
    const assigned=!task?.assigneeRoleCode||roles.includes(task.assigneeRoleCode);
    const permission=tab==='decision'?'case.approve.aiuc':tab==='registration'?(task?.templateStage?.code==='aiuc-asset-approval'?'aiuc.asset.approve':'aiuc.asset.register'):tab==='specialist'?'case.view.aiuc.org':'aiuc.classify.assess';
    return assigned&&(!task?.assigneeUserId||task.assigneeUserId===this.auth.currentUser()?.id)&&this.auth.hasAiPermission(permission);
  });
  protected readonly specialistDecisionReady = computed(() => !!this.justification().trim() && this.evidenceIdList().length > 0);
  protected readonly adoptionReady = computed(() => !!this.adoptionOutcome() && this.specialistDecisionReady()
    && (this.adoptionOutcome() !== 'approve_with_conditions' || this.conditionList().length > 0));
  protected readonly totalAssigned = computed(() => REVIEW_TABS.reduce((sum,tab)=>sum+this.queues()[tab].total,0));
  protected readonly assessmentCount = computed(() => ['classification','verification','specialist'].reduce((sum,tab)=>sum+this.queues()[tab as ReviewTab].total,0));
  protected readonly approvalCount = computed(() => this.queues().decision.total + this.queues().registration.total);
  protected readonly filteredActiveCases = computed(() => this.loadingQueues() ? [] : this.activeCases());

  ngOnDestroy():void { clearTimeout(this.searchTimer); this.requestGeneration++; }

  ngOnInit(): void { void this.load(); }

  protected t(key: string): string { return this.i18n.t(key); }
  protected fieldLabel(code: string): string { return this.t(`aiuc.field.${code}`); }
  protected criterionLabel(code: string): string { return this.t(`aiReview.criterion.${code}`); }

  protected async load(preferredId?: string): Promise<void> {
    clearTimeout(this.searchTimer);
    const generation=++this.requestGeneration, tab=this.tab(), search=this.queueSearch().trim();
    const pages={...this.queuePages()}, selectedId=preferredId??this.selected()?.id;
    if(this.state()!=='ok')this.state.set('loading');
    this.loadingQueues.set(true);
    this.selected.set(null);
    try {
      const [loaded, assetLookups, configuration, intakeLookups] = await Promise.all([
        Promise.all(REVIEW_TABS.map(stage=>this.loadQueue(QUEUE_URLS[stage],pages[stage]??1,search))),
        this.loadAssetLookups(), this.loadConfiguration(), this.loadIntakeLookups(),
      ]);
      if(generation!==this.requestGeneration)return;
      const queues=Object.fromEntries(REVIEW_TABS.map((stage,index)=>[stage,loaded[index]])) as Record<ReviewTab,ReviewQueue>;
      if(queues[tab].page>queues[tab].totalPages&&!queues[tab].denied){
        this.queuePages.update(value=>({...value,[tab]:queues[tab].totalPages}));
        await this.load(selectedId); return;
      }
      this.queues.set(queues);
      this.triageCases.set(queues.triage.data); this.classificationCases.set(queues.classification.data);
      this.verificationCases.set(queues.verification.data); this.specialistCases.set(queues.specialist.data);
      this.decisionCases.set(queues.decision.data); this.registrationCases.set(queues.registration.data);
      this.assetLookups.set(assetLookups); this.configuration.set(configuration); this.intakeLookups.set(intakeLookups);
      const rows=this.rowsFor(tab);
      this.select(rows.find(row=>row.id===selectedId)??rows[0]??null);
      this.loadingQueues.set(false);
      this.state.set('ok');
    } catch(error) {
      if(generation!==this.requestGeneration)return;
      this.loadingQueues.set(false); this.state.set('error'); this.toast.errorFrom(error,this.t('aiReview.error.load'));
    }
  }

  protected setTab(tab:ReviewTab):void {
    if(!REVIEW_TABS.includes(tab)||this.working()||tab===this.tab())return;
    this.tab.set(tab); void this.load();
  }
  protected changeQueuePage(page:number):void {
    if(this.working()||this.loadingQueues()||page<1||page>this.activeQueue().totalPages)return;
    this.queuePages.update(value=>({...value,[this.tab()]:page})); void this.load();
  }
  protected changeQueueSearch(value:string):void {
    if(this.working())return;
    this.queueSearch.set(value.slice(0,200)); this.queuePages.set({});
    clearTimeout(this.searchTimer); this.requestGeneration++; this.selected.set(null); this.loadingQueues.set(true);
    this.searchTimer=setTimeout(()=>void this.load(),250);
  }

  protected changeTab(value: string | number | undefined): void {
    if (typeof value === 'string') this.setTab(value as ReviewTab);
  }

  protected stageNumber(tab = this.tab()): number {
    return ({ triage: 1, classification: 2, verification: 3, specialist: 4, decision: 5, registration: 6 } as const)[tab];
  }

  protected stageProgress(tab = this.tab()): number { return Math.round(this.stageNumber(tab) / 6 * 100); }

  protected select(item: AiReviewCase | null): void {
    this.selected.set(item);
    this.justification.set('');
    this.scores.set(Object.fromEntries(CRITERIA.map(criterion => [criterion, { value: null, justification: '' }])));
    const proposed = item?.assessments?.[0]?.result?.['proposedTierCode'];
    this.decisionTierCode.set(typeof proposed === 'string' ? proposed : '');
    this.decisionEvidenceIds.set('');
    this.authorityReference.set('');
    this.adoptionOutcome.set('');
    this.approvalConditions.set('');
    this.registrationMode.set('create'); this.existingAssetId.set('');
    this.assetNameEn.set(item?.name.slice(0, 180) ?? ''); this.assetNameAr.set('');
    this.assetDomainId.set(''); this.assetClassificationId.set('');
  }

  protected activeCases(): AiReviewCase[] { return this.rowsFor(this.tab()); }

  protected tabLabel(tab = this.tab()): string { return this.t(`aiReview.tab.${tab}`); }

  private rowsFor(tab: ReviewTab, triage = this.triageCases(), classification = this.classificationCases(),
    verification = this.verificationCases(), specialist = this.specialistCases(), decision = this.decisionCases(), registration = this.registrationCases()): AiReviewCase[] {
    return tab === 'triage' ? triage : tab === 'classification' ? classification : tab === 'verification' ? verification
      : tab === 'specialist' ? specialist : tab === 'decision' ? decision : registration;
  }

  private async loadAssetLookups(): Promise<{ domains: AssetLookup[]; classifications: AssetLookup[] }> {
    try { return await firstValueFrom(this.http.get<{ domains: AssetLookup[]; classifications: AssetLookup[] }>('/api/ai/use-cases/registration/lookups')); }
    catch (error) { if (error instanceof HttpErrorResponse && error.status === 403) return { domains: [], classifications: [] }; throw error; }
  }

  protected assetLookupLabel(value: AssetLookup): string { return this.i18n.lang() === 'ar' ? value.nameAr : value.nameEn; }
  protected registrationProposal(): Record<string, unknown> { return this.selectedReviewTask()?.formDataJson?.['registrationProposal'] as Record<string, unknown> ?? {}; }
  protected proposalLookupLabel(field: 'domainId' | 'classificationId'): string {
    const values = field === 'domainId' ? this.assetLookups().domains : this.assetLookups().classifications;
    const value = values.find(value => value.id === this.registrationProposal()[field]);
    return value ? this.assetLookupLabel(value) : '—';
  }
  protected async saveRegistration(decision?: 'approve' | 'return'): Promise<void> {
    const item = this.selected(), task = this.selectedReviewTask();
    if (!item || !task || this.working() || (decision ? !this.specialistDecisionReady() : !this.registrationReady())) return;
    this.working.set(true);
    try {
      const result = await firstValueFrom(this.http.post<{ assetId?: string; airsCaseId?: string }>(`/api/ai/use-cases/registration/${item.id}/${task.id}/${decision ? 'decide' : 'propose'}`, {
        expectedVersion: item.version, justification: this.justification().trim(),
        ...(decision ? { decision, evidenceIds: this.evidenceIdList() } : {
          mode: this.registrationMode(), domainId: this.assetDomainId(), classificationId: this.assetClassificationId(),
          ...(this.registrationMode() === 'link' ? { existingAssetId: this.existingAssetId().trim() }
            : { nameEn: this.assetNameEn().trim(), nameAr: this.assetNameAr().trim(), assetSubtype: this.assetSubtype() }),
        }),
      }));
      this.toast.success(this.t(result.airsCaseId ? 'aiReview.registration.handedOff' : 'aiReview.registration.saved'));
      await this.load();
    } catch (error) { this.toast.errorFrom(error, this.t('aiReview.registration.error')); }
    finally { this.working.set(false); }
  }

  private async loadQueue(url:string,page:number,search:string):Promise<ReviewQueue> {
    if(url.includes('/reviews/queue')&&!this.auth.hasAiPermission('case.view.aiuc.org'))return emptyQueue(page,true);
    const broad=this.auth.hasAiPermission('case.view.aiuc.org')||this.auth.hasAiPermission('case.view.aiuc.all');
    const purpose=url.includes('registration')?['aiuc.asset.register','aiuc.asset.approve']:url.includes('decisions')?['case.approve.aiuc']:['aiuc.classify.assess'];
    if(!broad&&!purpose.some(permission=>this.auth.hasAiPermission(permission)))return emptyQueue(page,true);
    try {
      const queue=await firstValueFrom(this.http.get<ReviewQueue>(url,{params:{page,pageSize:25,search}}));
      if(!Array.isArray(queue.data)||!Number.isInteger(queue.total)||queue.total<0||queue.page!==page
        ||queue.pageSize!==25||queue.totalPages!==Math.max(1,Math.ceil(queue.total/25))||queue.summary?.total!==queue.total
        ||queue.summary.pending+queue.summary.inProgress!==queue.total||queue.data.length>25)throw new Error('Invalid review queue response');
      return queue;
    } catch(error) {
      if(error instanceof HttpErrorResponse&&error.status===403)return emptyQueue(page,true);
      throw error;
    }
  }

  private async loadConfiguration(): Promise<ClassificationConfiguration | null> {
    if(!['aiuc.classify.assess','case.view.aiuc.org','case.view.aiuc.all'].some(permission=>this.auth.hasAiPermission(permission)))return null;
    try {
      return await firstValueFrom(this.http.get<ClassificationConfiguration>('/api/ai/use-cases/classification/configuration'));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 403) return null;
      throw error;
    }
  }

  private async loadIntakeLookups(): Promise<IntakeLookups | null> {
    try { return await firstValueFrom(this.http.get<IntakeLookups>('/api/ai/use-cases/lookups')); }
    catch (error) { if (error instanceof HttpErrorResponse && error.status === 403) return null; throw error; }
  }

  protected payload(): Record<string, unknown> { return this.selected()?.intakeRevisions[0]?.payload ?? {}; }

  protected renderFieldValue(field: string, value: unknown): string {
    if (typeof value !== 'string') return this.renderValue(value);
    const lookups = this.intakeLookups();
    if (!lookups) return this.renderValue(value);
    if (['requester', 'proposed_owner', 'data_owner', 'executive_sponsor'].includes(field)) {
      const users = [...lookups.proposedOwners, ...lookups.dataOwners, ...lookups.executiveSponsors];
      const user = users.find(candidate => candidate.id === value);
      if (user) {
        const name = this.i18n.lang() === 'ar' ? user.nameAr : user.nameEn;
        return `${name || user.displayName} · ${user.email}`;
      }
    }
    const option = lookups.lists[field]?.values.find(candidate => candidate.code === value);
    return option ? this.optionLabel(option) : this.renderValue(value);
  }

  protected renderValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return this.t('aiReview.notProvided');
    if (Array.isArray(value)) return value.length ? value.join(', ') : this.t('aiReview.notProvided');
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record['answer'] === 'boolean') {
        const answer = record['answer'] ? this.t('aiuc.yes') : this.t('aiuc.no');
        return `${answer} · ${String(record['justification'] ?? record['details'] ?? '')}`;
      }
      if (record['none'] === true) return this.t('aiuc.none');
      return String(record['text'] ?? JSON.stringify(record));
    }
    return String(value);
  }

  protected async decide(decision: 'accept' | 'return' | 'reject'): Promise<void> {
    const item = this.selected();
    if (!item || this.working()) return;
    if (decision !== 'accept' && !this.justification().trim()) {
      this.toast.error(this.t('aiReview.justificationRequired'));
      return;
    }
    this.working.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/ai/use-cases/${item.id}/triage`, {
        expectedVersion: item.version,
        decision,
        justification: this.justification().trim() || undefined,
      }));
      this.toast.success(this.t(`aiReview.decision.${decision}.saved`));
      if (decision === 'accept') this.tab.set('classification');
      await this.load(decision === 'accept' ? item.id : undefined);
    } catch (error) {
      this.toast.errorFrom(error, this.t('aiReview.error.decision'));
    } finally {
      this.working.set(false);
    }
  }

  protected setScore(criterion: CriterionCode, value: string): void {
    this.scores.update(current => ({
      ...current,
      [criterion]: { ...current[criterion], value: value ? Number(value) : null },
    }));
  }

  protected setJustification(criterion: CriterionCode, justification: string): void {
    this.scores.update(current => ({
      ...current,
      [criterion]: { ...current[criterion], justification },
    }));
  }

  protected optionLabel(option: { labelEn: string; labelAr: string }): string {
    return this.i18n.lang() === 'ar' ? option.labelAr : option.labelEn;
  }

  protected selectedScore(criterion: CriterionCode): number | null { return this.scores()[criterion]?.value ?? null; }
  protected scoreJustification(criterion: CriterionCode): string { return this.scores()[criterion]?.justification ?? ''; }

  protected anchorText(criterion: CriterionCode): string {
    const value = this.selectedScore(criterion);
    const option = this.configuration()?.scores.find(score => score.score === value);
    const anchor = option?.anchors?.[criterion];
    if (!anchor) return '';
    return this.i18n.lang() === 'ar'
      ? anchor.descriptionAr ?? anchor.labelAr ?? ''
      : anchor.descriptionEn ?? anchor.labelEn ?? '';
  }

  protected assessedCriterion(criterion: CriterionCode): { score: number | null; justification: string } {
    const inputs = this.latestAssessment()?.inputs;
    const rows = Array.isArray(inputs?.['criteria']) ? inputs['criteria'] as Array<Record<string, unknown>> : [];
    const row = rows.find(value => value['criterion'] === criterion);
    return {
      score: typeof row?.['value'] === 'number' ? row['value'] : null,
      justification: typeof row?.['justification'] === 'string' ? row['justification'] : '',
    };
  }

  protected evidenceIdList(): string[] {
    return [...new Set(this.decisionEvidenceIds().split(/[\s,;]+/u).map(value => value.trim()).filter(Boolean))];
  }

  protected specialistStageLabel(): string {
    const task = this.selectedReviewTask();
    if (!task) return this.t('aiReview.tab.specialist');
    const stage = task.templateStage;
    return this.i18n.lang() === 'ar' ? stage?.nameAr ?? task.title : stage?.nameEn ?? task.title;
  }

  protected specialistTier(): string {
    const pinnedTier = this.selected()?.approvedTier;
    if (pinnedTier) return this.optionLabel(pinnedTier);
    const code = this.assessmentResult()['approvedTierCode'] ?? this.assessmentResult()['proposedTierCode'];
    if (typeof code !== 'string') return '—';
    const option = this.configuration()?.tiers.find(tier => tier.code === code);
    return option ? this.optionLabel(option) : code;
  }

  protected authorityLabel(): string {
    const role = this.selectedReviewTask()?.assigneeRoleCode;
    return role ? this.t(`aiReview.adoption.authority.${role}`) : '—';
  }

  protected conditionList(): string[] {
    return [...new Set(this.approvalConditions().split(/\r?\n/u).map(value => value.trim()).filter(Boolean))];
  }

  protected async recordAdoption(): Promise<void> {
    const item = this.selected();
    const task = this.selectedReviewTask();
    if (!item || !task || !this.adoptionReady() || this.working()) return;
    this.working.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/ai/use-cases/decisions/${item.id}/${task.id}`, {
        expectedVersion: item.version,
        decision: this.adoptionOutcome(),
        justification: this.justification().trim(),
        evidenceIds: this.evidenceIdList(),
        ...(this.adoptionOutcome() === 'approve_with_conditions' ? { conditions: this.conditionList() } : {}),
      }));
      this.toast.success(this.t('aiReview.adoption.saved'));
      await this.load();
    } catch (error) {
      this.toast.errorFrom(error, this.t('aiReview.error.adoption'));
    } finally {
      this.working.set(false);
    }
  }

  protected specialistDueDate(): string {
    const value = this.selectedReviewTask()?.dueDate;
    if (!value) return this.t('aiReview.notProvided');
    return formatDualDate(value, 'mediumDate', this.i18n.lang());
  }

  protected async assess(): Promise<void> {
    const item = this.selected();
    const configuration = this.configuration();
    if (!item || !configuration?.ready || !this.assessmentComplete() || this.working()) return;
    this.working.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/ai/use-cases/classification/${item.id}/assess`, {
        expectedVersion: item.version,
        input: {
          kind: 'classification',
          scores: CRITERIA.map(criterion => ({
            value: this.scores()[criterion].value,
            justification: this.scores()[criterion].justification.trim(),
          })),
        },
      }));
      this.toast.success(this.t('aiReview.assessment.saved'));
      await this.load();
    } catch (error) {
      this.toast.errorFrom(error, this.t('aiReview.error.assessment'));
    } finally {
      this.working.set(false);
    }
  }

  protected async recordVerification(): Promise<void> {
    const item = this.selected();
    const proposed = this.assessmentProposedTier()?.code;
    const target = this.decisionTierCode();
    if (!item || !proposed || !target || !this.decisionReady() || this.working()) return;
    const isSame = target === proposed;
    const isUnacceptable = target === 'UNACCEPTABLE';
    const operation = isSame ? 'verify' : isUnacceptable ? 'unacceptable' : 'override';
    const body: Record<string, unknown> = { expectedVersion: item.version, evidenceIds:this.evidenceIdList() };
    if (isSame) {
      if (this.justification().trim()) body['justification'] = this.justification().trim();
    } else {
      if (!isUnacceptable) body['approvedTierCode'] = target;
      body['justification'] = this.justification().trim();
      body['evidenceIds'] = this.evidenceIdList();
      body['authorityReference'] = this.authorityReference().trim();
    }
    this.working.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/ai/use-cases/classification/${item.id}/${operation}`, body));
      this.toast.success(this.t(`aiReview.verification.${operation}.saved`));
      await this.load();
    } catch (error) {
      this.toast.errorFrom(error, this.t('aiReview.error.verification'));
    } finally {
      this.working.set(false);
    }
  }

  protected async returnForReassessment(): Promise<void> {
    const item = this.selected();
    if (!item || !this.justification().trim() || this.working()) return;
    this.working.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/ai/use-cases/classification/${item.id}/return`, {
        expectedVersion: item.version,
        justification: this.justification().trim(),
      }));
      this.toast.success(this.t('aiReview.verification.return.saved'));
      this.tab.set('classification');
      await this.load(item.id);
    } catch (error) {
      this.toast.errorFrom(error, this.t('aiReview.error.verification'));
    } finally {
      this.working.set(false);
    }
  }

  protected async recordSpecialistReview(decision: 'approve' | 'return' | 'reject'): Promise<void> {
    const item = this.selected();
    const task = this.selectedReviewTask();
    if (!item || !task || !this.specialistDecisionReady() || this.working()) return;
    this.working.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/ai/use-cases/classification/${item.id}/reviews/${task.id}`, {
        expectedVersion: item.version,
        decision,
        justification: this.justification().trim(),
        evidenceIds: this.evidenceIdList(),
      }));
      this.toast.success(this.t(`aiReview.specialist.${decision}.saved`));
      await this.load();
    } catch (error) {
      this.toast.errorFrom(error, this.t('aiReview.error.specialist'));
    } finally {
      this.working.set(false);
    }
  }
}
