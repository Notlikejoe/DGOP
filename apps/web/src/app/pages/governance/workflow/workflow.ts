import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { AppIcon } from '../../../shared/app-icon';
import {
  SLA_KIND,
  CASE_STATUS_KIND,
  CaseRow,
  Paged,
  Ref,
  Task,
  WorkflowGraph,
  WorkflowConfiguration,
  WorkflowDashboard,
  WorkflowDesignerResponse,
  WorkflowDesignerSimulation,
  WorkflowMigrationPreview,
  WorkflowRoutePreview,
  WorkflowTemplateVersionsResponse,
  WorkflowVersionDiff,
  WorkflowTemplate,
  WorkflowTemplateStage,
} from './workflow.types';

@Component({
  selector: 'app-workflow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Modal, StatusChip, AppIcon],
  templateUrl: './workflow.html',
  styleUrls: ['./workflow.scss', './workflow-designer.scss'],
})
export class WorkflowPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('bpmnCanvas') private bpmnCanvas?: ElementRef<HTMLElement>;

  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly inactiveCaseStatuses = new Set(['closed', 'rejected']);
  private readonly inactiveTaskStatuses = new Set(['completed', 'cancelled']);
  private bpmnModeler: any | null = null;
  private bpmnStylesLoaded = false;
  private dashboardTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly tab = signal<'map' | 'tasks' | 'cases' | 'designer'>('map');
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly tasks = signal<Task[]>([]);
  protected readonly taskTotal = signal(0);
  protected readonly cases = signal<CaseRow[]>([]);
  protected readonly caseTotal = signal(0);
  protected readonly assets = signal<Ref[]>([]);
  protected readonly templates = signal<WorkflowTemplate[]>([]);
  protected readonly graph = signal<WorkflowGraph | null>(null);
  protected readonly configuration = signal<WorkflowConfiguration | null>(null);
  protected readonly workflowDashboard = signal<WorkflowDashboard | null>(null);
  protected readonly selectedTemplateId = signal<string>('');
  protected readonly designer = signal<WorkflowDesignerResponse | null>(null);
  protected readonly designerTemplateId = signal<string>('');
  protected readonly designerState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly designerSaving = signal(false);
  protected readonly designerPreviewing = signal(false);
  protected readonly designerSummary = signal('');
  protected readonly designerViewMode = signal<'business' | 'technical'>('business');
  protected readonly acknowledgeMigrationRisk = signal(false);
  protected readonly designerSimulation = signal<WorkflowDesignerSimulation | null>(null);
  protected readonly designerMigration = signal<WorkflowMigrationPreview | null>(null);
  protected readonly designerVersions = signal<WorkflowTemplateVersionsResponse['versions']>([]);
  protected readonly designerDiff = signal<WorkflowVersionDiff | null>(null);
  protected readonly importModalOpen = signal(false);
  protected readonly routeModalOpen = signal(false);
  protected readonly bpmnImportText = signal('');
  protected readonly routeName = signal('');
  protected readonly routeCode = signal('');
  protected readonly routeCaseType = signal('general');

  protected readonly designerChecklist = computed(() => {
    const designer = this.designer();
    return designer?.enterprise?.checklist ?? designer?.validation.checklist ?? [];
  });

  protected readonly designerRulePacks = computed(() => this.designer()?.enterprise?.rulePacks ?? []);

  protected readonly designerReadiness = computed(() =>
    this.designer()?.enterprise?.readinessScore ?? this.designer()?.validation.readinessScore ?? 0,
  );

  protected readonly designerRouteStages = computed(() =>
    [...(this.designer()?.template.stages ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
  );

  protected readonly designerActiveCases = computed(() => {
    const template = this.designer()?.template;
    if (!template) return [];
    return this.cases().filter(
      (row) => this.caseMatchesTemplate(row, template) && !this.inactiveCaseStatuses.has(row.status),
    );
  });

  protected readonly caseTypes = computed(() => {
    const types = [...new Set(this.templates().map((template) => template.caseType).filter(Boolean))];
    return types.length ? types : ['general'];
  });

  // decision modal
  protected readonly decideTask = signal<Task | null>(null);
  protected readonly decision = signal<'approved' | 'rejected'>('approved');
  protected readonly comment = signal('');
  protected readonly saving = signal(false);

  // new case modal
  protected readonly caseModalOpen = signal(false);
  protected readonly newTitle = signal('');
  protected readonly newDescription = signal('');
  protected readonly newAssetId = signal('');
  protected readonly newType = signal('general');
  protected readonly newTemplateId = signal('');
  protected readonly routePreview = signal<WorkflowRoutePreview | null>(null);

  protected readonly filteredTemplates = computed(() => {
    const type = this.newType();
    return this.templates().filter((template) => template.caseType === type);
  });

  protected readonly routeSummaries = computed(() => {
    const cases = this.cases();
    return this.templates().map((template) => {
      const activeCases = cases.filter(
        (row) => this.caseMatchesTemplate(row, template) && !this.inactiveCaseStatuses.has(row.status),
      );
      const openTasks = activeCases.reduce((total, row) => total + this.openTaskCount(row), 0);
      const overdueTasks = activeCases.reduce((total, row) => total + this.overdueTaskCount(row), 0);
      const status = overdueTasks > 0 ? 'critical' : openTasks > 0 || activeCases.length > 0 ? 'review' : 'healthy';
      return { template, activeCases, openTasks, overdueTasks, status };
    });
  });

  protected readonly selectedRoute = computed(() => {
    const routes = this.routeSummaries();
    return routes.find((route) => route.template.id === this.selectedTemplateId()) ?? routes[0] ?? null;
  });

  protected readonly selectedRouteStages = computed(() =>
    [...(this.selectedRoute()?.template.stages ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
  );

  protected readonly selectedRouteCases = computed(() => this.selectedRoute()?.activeCases ?? []);

  protected readonly caseTreeBranches = computed(() => {
    const stages = this.selectedRouteStages();
    const cases = this.selectedRouteCases();
    return stages.map((stage) => {
      const branchCases = cases.filter((row) => this.currentStageId(row, stages) === stage.id);
      const openTasks = branchCases.reduce((total, row) => total + this.openTaskCount(row), 0);
      const overdueTasks = branchCases.reduce((total, row) => total + this.overdueTaskCount(row), 0);
      const status = overdueTasks > 0 ? 'critical' : branchCases.length > 0 ? 'review' : 'healthy';
      return { stage, cases: branchCases, openTasks, overdueTasks, status };
    });
  });

  ngOnInit(): void {
    this.loadAll();
    this.dashboardTimer = setInterval(() => this.loadWorkflowDashboard(), 60_000);
    if (this.auth.hasPermission('data_assets.view')) {
      this.http.get<Ref[]>('/api/assets').subscribe({
        next: (a) => this.assets.set(a),
        error: () => this.assets.set([]),
      });
    }
  }

  ngAfterViewInit(): void {
    if (this.tab() === 'designer') this.ensureDesignerLoaded();
  }

  ngOnDestroy(): void {
    if (this.dashboardTimer) clearInterval(this.dashboardTimer);
    this.bpmnModeler?.destroy();
    this.bpmnModeler = null;
  }

  protected get canViewCases(): boolean { return this.auth.hasPermission('workflow_cases.view'); }
  protected get canCreateCase(): boolean { return this.auth.hasPermission('workflow_cases.create'); }
  protected get canEditDesigner(): boolean { return this.auth.hasPermission('workflow_cases.edit'); }

  protected loadAll(): void {
    this.state.set('loading');
    this.loadPaged<Task>(
      '/api/workflow/tasks/mine',
      { status: 'open' },
      (tasks, total) => {
        this.tasks.set(tasks);
        this.taskTotal.set(total);
        this.state.set('ok');
      },
      (error) => this.handleLoadError(error),
    );
    if (this.canViewCases) {
      this.loadPaged<CaseRow>(
        '/api/workflow/cases',
        {},
        (cases, total) => {
          this.cases.set(cases);
          this.caseTotal.set(total);
          this.ensureSelectedTemplate();
        },
        (error) => this.handleLoadError(error),
      );
      this.http.get<WorkflowTemplate[]>('/api/workflow/templates').subscribe({
        next: (templates) => {
          this.templates.set(templates);
          this.ensureNewCaseType();
          this.ensureSelectedTemplate(templates);
          if (this.tab() === 'designer') this.ensureDesignerLoaded();
        },
        error: (error) => this.handleLoadError(error),
      });
      this.http.get<WorkflowGraph>('/api/workflow/graph').subscribe({
        next: (graph) => this.graph.set(graph),
        error: (error) => this.handleLoadError(error),
      });
      this.http.get<WorkflowConfiguration>('/api/workflow/configuration').subscribe({
        next: (configuration) => this.configuration.set(configuration),
        error: (error) => this.handleLoadError(error),
      });
      this.loadWorkflowDashboard();
    } else {
      this.cases.set([]);
      this.caseTotal.set(0);
      this.configuration.set(null);
      this.workflowDashboard.set(null);
    }
  }

  private loadWorkflowDashboard(): void {
    if (!this.canViewCases) return;
    this.http.get<WorkflowDashboard>('/api/workflow/dashboard').subscribe({
      next: (dashboard) => this.workflowDashboard.set(dashboard),
      error: () => this.workflowDashboard.set(null),
    });
  }

  // ---------- helpers ----------
  protected t(key: string): string { return this.i18n.t(key); }
  protected name(o?: { nameEn: string; nameAr: string } | null): string {
    if (!o) return '-';
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected slaKind(s: string): StatusKind { return SLA_KIND[s] ?? 'muted'; }
  protected caseKind(s: string): StatusKind { return CASE_STATUS_KIND[s] ?? 'muted'; }
  protected graphKind(s?: string | null): StatusKind {
    if (s === 'healthy' || s === 'ready') return 'success';
    if (s === 'review' || s === 'watch') return 'warning';
    if (s === 'critical' || s === 'blocked') return 'danger';
    return 'muted';
  }
  protected typeLabel(t: string): string { return this.t('wf.type.' + t); }
  protected fmtDate(d?: string | null): string {
    return d ? new Date(d).toISOString().slice(0, 10) : '-';
  }
  protected templateName(template?: WorkflowTemplate | null): string {
    if (!template) return '-';
    return this.i18n.lang() === 'ar' ? template.nameAr : template.nameEn;
  }
  protected stageName(stage: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? stage.nameAr : stage.nameEn;
  }
  protected selectTemplate(template: WorkflowTemplate): void {
    this.selectedTemplateId.set(template.id);
  }
  protected setTab(next: 'map' | 'tasks' | 'cases' | 'designer'): void {
    this.tab.set(next);
    if (next === 'designer') this.ensureDesignerLoaded();
  }

  protected setDesignerViewMode(mode: 'business' | 'technical'): void {
    this.designerViewMode.set(mode);
    if (mode === 'technical') {
      setTimeout(() => this.renderBpmn(this.designer()?.bpmnXml ?? ''), 0);
    }
  }
  protected roleLabel(code?: string | null): string {
    if (!code) return this.t('wf.graph.noDefaultRole');
    const acronyms = new Set(['dlp', 'dmo', 'dq', 'dsi', 'dsr', 'foi', 'ndi']);
    return code
      .split('_')
      .filter(Boolean)
      .map((part) => (acronyms.has(part.toLowerCase()) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
      .join(' ');
  }
  protected caseAssetLabel(row: CaseRow): string {
    return row.asset ? this.name(row.asset) : this.t('wf.noAsset');
  }
  protected openTaskCount(row: CaseRow): number {
    if (typeof row.openTasks === 'number') return row.openTasks;
    return (row.tasks ?? []).filter((task) => !this.inactiveTaskStatuses.has(task.status)).length;
  }
  protected overdueTaskCount(row: CaseRow): number {
    return (row.tasks ?? []).filter(
      (task) => task.slaStatus === 'overdue' && !this.inactiveTaskStatuses.has(task.status),
    ).length;
  }

  // ---------- decision ----------
  protected openDecision(task: Task, decision: 'approved' | 'rejected'): void {
    this.decideTask.set(task);
    this.decision.set(decision);
    this.comment.set('');
  }
  protected closeDecision(): void { this.decideTask.set(null); }

  protected submitDecision(): void {
    const task = this.decideTask();
    if (!task || this.saving()) return;
    this.saving.set(true);
    this.http
      .post(`/api/workflow/tasks/${task.id}/decision`, {
        decision: this.decision(),
        comment: this.comment() || null,
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('wf.decisionRecorded'));
          this.saving.set(false);
          this.decideTask.set(null);
          this.loadAll();
        },
        error: (err) => { this.toast.errorFrom(err, this.t('wf.saveError')); this.saving.set(false); },
      });
  }

  // ---------- new case ----------
  protected openNewCase(): void {
    this.openNewCaseForRoute(null);
  }
  protected openNewCaseForRoute(template: WorkflowTemplate | null): void {
    const fallbackType = this.caseTypes()[0] ?? 'general';
    this.newTitle.set('');
    this.newDescription.set('');
    this.newAssetId.set('');
    this.newType.set(template?.caseType ?? fallbackType);
    this.newTemplateId.set(template?.id ?? '');
    this.routePreview.set(null);
    this.refreshRoutePreview();
    this.caseModalOpen.set(true);
  }
  protected closeNewCase(): void { this.caseModalOpen.set(false); }

  protected setNewType(value: string): void {
    const nextType = this.caseTypes().includes(value) ? value : this.caseTypes()[0] ?? 'general';
    this.newType.set(nextType);
    const matching = this.templates().find((template) => template.caseType === nextType);
    this.newTemplateId.set(matching?.id ?? '');
    this.refreshRoutePreview();
  }

  protected setNewAsset(value: string): void {
    this.newAssetId.set(value);
    this.refreshRoutePreview();
  }

  protected setNewTemplate(value: string): void {
    this.newTemplateId.set(value);
    const template = this.templates().find((row) => row.id === value);
    if (template) this.newType.set(template.caseType);
    this.refreshRoutePreview();
  }

  protected refreshRoutePreview(): void {
    if (!this.canViewCases) return;
    this.http
      .post<WorkflowRoutePreview>('/api/workflow/route-preview', {
        caseType: this.newType(),
        assetId: this.newAssetId() || null,
        templateId: this.newTemplateId() || null,
      })
      .subscribe({
        next: (preview) => {
          this.routePreview.set(preview);
          if (!this.newTemplateId()) this.newTemplateId.set(preview.template.id);
        },
        error: () => this.routePreview.set(null),
      });
  }

  protected createCase(): void {
    if (!this.newTitle().trim() || this.saving()) return;
    this.saving.set(true);
    this.http
      .post<CaseRow>('/api/workflow/cases', {
        title: this.newTitle().trim(),
        description: this.newDescription() || null,
        type: this.newType(),
        templateId: this.newTemplateId() || null,
        assetId: this.newAssetId() || null,
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('wf.caseCreated'));
          this.saving.set(false);
          this.caseModalOpen.set(false);
          this.tab.set('cases');
          this.loadAll();
        },
        error: (err) => { this.toast.errorFrom(err, this.t('wf.saveError')); this.saving.set(false); },
      });
  }

  // ---------- BPMN designer ----------
  protected selectDesignerTemplate(templateId: string): void {
    if (!templateId || templateId === this.designerTemplateId()) return;
    this.designerTemplateId.set(templateId);
    this.loadDesigner(templateId);
  }

  protected openRouteModal(): void {
    this.routeName.set('');
    this.routeCode.set('');
    this.routeCaseType.set(this.caseTypes()[0] ?? 'general');
    this.routeModalOpen.set(true);
  }

  protected closeRouteModal(): void {
    this.routeModalOpen.set(false);
  }

  protected createDesignerRoute(): void {
    if (!this.routeName().trim() || this.designerSaving()) return;
    this.designerSaving.set(true);
    this.http.post<WorkflowDesignerResponse>('/api/workflow/templates', {
      code: this.routeCode() || null,
      caseType: this.routeCaseType(),
      nameEn: this.routeName().trim(),
      nameAr: this.routeName().trim(),
      trigger: 'manual',
      defaultSlaDays: 5,
    }).subscribe({
      next: (res) => {
        this.toast.success(this.t('wf.designer.routeCreated'));
        this.designerSaving.set(false);
        this.routeModalOpen.set(false);
        this.designer.set(res);
        this.designerTemplateId.set(res.template.id);
        this.loadDesignerVersions(res.template.id);
        this.renderBpmn(res.bpmnXml);
        setTimeout(() => this.refreshDesignerPreviews(), 0);
        this.loadAll();
      },
      error: (err) => {
        this.toast.errorFrom(err, this.t('wf.saveError'));
        this.designerSaving.set(false);
      },
    });
  }

  protected openImport(): void {
    this.bpmnImportText.set(this.designer()?.bpmnXml ?? '');
    this.importModalOpen.set(true);
  }

  protected closeImport(): void {
    this.importModalOpen.set(false);
  }

  protected applyImport(): void {
    if (!this.bpmnImportText().trim()) return;
    this.renderBpmn(this.bpmnImportText());
    this.importModalOpen.set(false);
  }

  protected exportDesignerBpmn(): void {
    this.currentBpmnXml().then((xml) => {
      const template = this.designer()?.template;
      const fileName = `${template?.code ?? 'workflow-route'}.bpmn`;
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    }).catch(() => this.toast.error(this.t('wf.designer.exportError')));
  }

  protected resetDesignerCanvas(): void {
    const xml = this.designer()?.bpmnXml;
    if (!xml) return;
    this.renderBpmn(xml);
  }

  protected saveDesignerDraft(): void {
    this.persistDesigner('save');
  }

  protected publishDesigner(): void {
    this.persistDesigner('publish');
  }

  protected validationKind(status?: string): StatusKind {
    if (status === 'ready') return 'success';
    if (status === 'warning') return 'warning';
    if (status === 'blocked') return 'danger';
    return 'muted';
  }

  protected checklistKind(status?: string): StatusKind {
    if (status === 'pass') return 'success';
    if (status === 'warning') return 'warning';
    if (status === 'fail') return 'danger';
    return 'muted';
  }

  protected migrationKind(risk?: string): StatusKind {
    if (risk === 'safe') return 'success';
    if (risk === 'caution') return 'warning';
    if (risk === 'blocked') return 'danger';
    return 'muted';
  }

  protected requirementLabel(value: boolean): string {
    return value ? this.t('wf.designer.configured') : this.t('wf.designer.missing');
  }

  protected signatureShort(value?: string | null): string {
    return value ? value.slice(0, 12) : '-';
  }

  protected hasManualMigrationReview(): boolean {
    return (this.designerMigration()?.summary.manualReviewCases ?? 0) > 0;
  }

  protected nodeTypeLabel(value?: string | null): string {
    return (value ?? 'user_task')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  protected stageRulePack(code: string) {
    return this.designerRulePacks().find((pack) => pack.code === code) ?? null;
  }

  protected stageReadinessKind(code: string): StatusKind {
    const pack = this.stageRulePack(code);
    if (!pack) return 'muted';
    if (pack.hasForm && pack.hasEvidence && pack.hasNotifications) return 'success';
    if (pack.hasEvidence || pack.hasNotifications || pack.hasForm) return 'warning';
    return 'danger';
  }

  protected stageReadinessLabel(code: string): string {
    const pack = this.stageRulePack(code);
    if (!pack) return this.t('wf.designer.stageMapped');
    if (pack.hasForm && pack.hasEvidence && pack.hasNotifications) return this.t('wf.designer.stageReady');
    if (pack.hasEvidence || pack.hasNotifications || pack.hasForm) return this.t('wf.designer.stagePartial');
    return this.t('wf.designer.stageNeedsRules');
  }

  protected transitionLabelsFor(stageId: string): string[] {
    const template = this.designer()?.template;
    if (!template) return [];
    return template.transitions
      .filter((transition) => transition.fromStageId === stageId)
      .map((transition) => this.i18n.lang() === 'ar' ? transition.labelAr : transition.labelEn)
      .filter(Boolean);
  }

  protected async refreshDesignerPreviews(): Promise<void> {
    const template = this.designer()?.template;
    if (!template || this.designerPreviewing()) return;
    this.designerPreviewing.set(true);
    try {
      const xml = await this.currentBpmnXml();
      this.http.post<WorkflowDesignerSimulation>(
        `/api/workflow/templates/${template.id}/designer/simulate`,
        { bpmnXml: xml },
      ).subscribe({
        next: (res) => this.designerSimulation.set(res),
        error: () => this.designerSimulation.set(null),
      });
      this.http.post<WorkflowMigrationPreview>(
        `/api/workflow/templates/${template.id}/designer/migration-preview`,
        { bpmnXml: xml },
      ).subscribe({
        next: (res) => {
          this.designerMigration.set(res);
          this.designerPreviewing.set(false);
        },
        error: () => {
          this.designerMigration.set(null);
          this.designerPreviewing.set(false);
        },
      });
    } catch (err) {
      this.designerPreviewing.set(false);
      this.toast.errorFrom(err, this.t('wf.designer.exportError'));
    }
  }

  protected loadDesignerDiff(version: number): void {
    const template = this.designer()?.template;
    if (!template) return;
    this.http.get<WorkflowVersionDiff>(`/api/workflow/templates/${template.id}/designer/versions/${version}/diff`).subscribe({
      next: (diff) => this.designerDiff.set(diff),
      error: (err) => this.toast.errorFrom(err, this.t('wf.saveError')),
    });
  }

  protected rollbackDesignerVersion(version: number): void {
    const template = this.designer()?.template;
    if (!template || this.designerSaving()) return;
    this.designerSaving.set(true);
    this.http.post<WorkflowDesignerResponse>(`/api/workflow/templates/${template.id}/designer/rollback`, {
      version,
      changeSummary: this.designerSummary() || null,
    }).subscribe({
      next: (res) => {
        this.designer.set(res);
        this.bpmnImportText.set(res.bpmnXml);
        this.designerDiff.set(null);
        this.designerSaving.set(false);
        this.toast.success(this.t('wf.designer.rollbackDone'));
        this.loadDesignerVersions(res.template.id);
        this.refreshDesignerPreviews();
        this.loadAll();
      },
      error: (err) => {
        this.toast.errorFrom(err, this.t('wf.saveError'));
        this.designerSaving.set(false);
      },
    });
  }

  protected migrateDesignerCases(): void {
    const template = this.designer()?.template;
    if (!template || this.designerSaving()) return;
    this.designerSaving.set(true);
    this.http.post(`/api/workflow/templates/${template.id}/designer/migrate-active-cases`, {}).subscribe({
      next: () => {
        this.designerSaving.set(false);
        this.toast.success(this.t('wf.designer.migrationDone'));
        this.refreshDesignerPreviews();
        this.loadAll();
      },
      error: (err) => {
        this.toast.errorFrom(err, this.t('wf.saveError'));
        this.designerSaving.set(false);
      },
    });
  }

  protected ensureDesignerLoaded(): void {
    if (!this.canViewCases) return;
    const templates = this.templates();
    if (!templates.length) return;
    const selected = this.designerTemplateId() || this.selectedTemplateId() || templates[0].id;
    this.designerTemplateId.set(selected);
    if (this.designer()?.template.id === selected && this.designerState() === 'ready') {
      setTimeout(() => this.renderBpmn(this.designer()?.bpmnXml ?? ''), 0);
      return;
    }
    this.loadDesigner(selected);
  }

  private loadDesigner(templateId: string): void {
    this.designerState.set('loading');
    this.http.get<WorkflowDesignerResponse>(`/api/workflow/templates/${templateId}/designer`).subscribe({
      next: (res) => {
        this.designer.set(res);
        this.bpmnImportText.set(res.bpmnXml);
        this.designerSimulation.set(null);
        this.designerMigration.set(null);
        this.designerDiff.set(null);
        this.acknowledgeMigrationRisk.set(false);
        this.designerState.set('ready');
        this.loadDesignerVersions(templateId);
        setTimeout(() => {
          this.renderBpmn(res.bpmnXml);
          this.refreshDesignerPreviews();
        }, 0);
      },
      error: (err) => {
        this.designerState.set('error');
        this.toast.errorFrom(err, this.t('crud.loadError'));
      },
    });
  }

  private loadDesignerVersions(templateId: string): void {
    this.http.get<WorkflowTemplateVersionsResponse>(`/api/workflow/templates/${templateId}/designer/versions`).subscribe({
      next: (res) => this.designerVersions.set(res.versions),
      error: () => this.designerVersions.set([]),
    });
  }

  private async ensureModeler(): Promise<any | null> {
    const container = this.bpmnCanvas?.nativeElement;
    if (!container) return null;
    this.ensureBpmnStyles();
    if (!this.bpmnModeler) {
      const module = await import('bpmn-js/lib/Modeler');
      this.bpmnModeler = new module.default({
        container,
      });
    }
    return this.bpmnModeler;
  }

  private ensureBpmnStyles(): void {
    if (this.bpmnStylesLoaded || typeof document === 'undefined') return;
    this.bpmnStylesLoaded = true;
    for (const href of ['/bpmn-assets/diagram-js.css', '/bpmn-assets/bpmn-font/css/bpmn.css']) {
      if (document.querySelector(`link[data-dgop-bpmn-style="${href}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset['dgopBpmnStyle'] = href;
      document.head.appendChild(link);
    }
  }

  private async renderBpmn(xml: string): Promise<void> {
    if (!xml.trim()) return;
    try {
      const modeler = await this.ensureModeler();
      if (!modeler) return;
      const result = await modeler.importXML(xml);
      const canvas = modeler.get?.('canvas');
      canvas?.zoom?.('fit-viewport', 'auto');
      const warnings = result?.warnings?.length ?? 0;
      if (warnings > 0) this.toast.show(this.t('wf.designer.importWarnings'), 'info');
    } catch {
      this.toast.error(this.t('wf.designer.invalidXml'));
    }
  }

  private async currentBpmnXml(): Promise<string> {
    const modeler = await this.ensureModeler();
    if (!modeler) return this.designer()?.bpmnXml ?? '';
    const result = await modeler.saveXML({ format: true });
    return result.xml;
  }

  private async persistDesigner(mode: 'save' | 'publish'): Promise<void> {
    const template = this.designer()?.template;
    if (!template || this.designerSaving()) return;
    this.designerSaving.set(true);
    try {
      const xml = await this.currentBpmnXml();
      this.http.post<WorkflowDesignerResponse>(
        `/api/workflow/templates/${template.id}/designer/${mode}`,
        {
          bpmnXml: xml,
          changeSummary: this.designerSummary() || null,
          acknowledgeMigrationRisk: this.acknowledgeMigrationRisk(),
        },
      ).subscribe({
        next: (res) => {
          this.designer.set(res);
          this.bpmnImportText.set(res.bpmnXml);
          this.designerSimulation.set(null);
          this.designerMigration.set(null);
          this.designerDiff.set(null);
          this.acknowledgeMigrationRisk.set(false);
          this.designerSummary.set('');
          this.designerSaving.set(false);
          this.toast.success(mode === 'publish' ? this.t('wf.designer.published') : this.t('wf.designer.saved'));
          this.loadDesignerVersions(template.id);
          this.refreshDesignerPreviews();
          if (mode === 'publish') this.loadAll();
        },
        error: (err) => {
          this.toast.errorFrom(err, this.t('wf.saveError'));
          this.designerSaving.set(false);
        },
      });
    } catch (err) {
      this.toast.errorFrom(err, this.t('wf.designer.exportError'));
      this.designerSaving.set(false);
    }
  }

  private caseMatchesTemplate(row: CaseRow, template: WorkflowTemplate): boolean {
    return row.templateId === template.id || row.template?.id === template.id || (!row.templateId && row.type === template.caseType);
  }

  private currentStageId(row: CaseRow, stages: WorkflowTemplateStage[]): string | null {
    if (!stages.length) return null;
    const openTasks = (row.tasks ?? []).filter((task) => !this.inactiveTaskStatuses.has(task.status));
    for (const task of openTasks) {
      if (task.templateStageId && stages.some((stage) => stage.id === task.templateStageId)) {
        return task.templateStageId;
      }
      if (task.templateStage?.id && stages.some((stage) => stage.id === task.templateStage?.id)) {
        return task.templateStage.id;
      }
      const match = stages.find((stage) => stage.taskType === task.type);
      if (match) return match.id;
    }
    if (row.status === 'implemented' || row.status === 'approved') {
      return stages.find((stage) => stage.isFinal)?.id ?? stages[stages.length - 1].id;
    }
    if (row.status === 'decision_made') {
      return stages.find((stage) => stage.isDecision)?.id ?? stages[Math.max(stages.length - 2, 0)].id;
    }
    if (row.status === 'draft') {
      return stages.find((stage) => stage.isStart)?.id ?? stages[0].id;
    }
    return stages.find((stage) => !stage.isStart && !stage.isFinal)?.id ?? stages[0].id;
  }

  private ensureSelectedTemplate(templates = this.templates()): void {
    if (!templates.length) {
      this.selectedTemplateId.set('');
      return;
    }
    const current = this.selectedTemplateId();
    if (current && templates.some((template) => template.id === current)) return;
    const routeWithCases = templates.find((template) =>
      this.cases().some((row) => this.caseMatchesTemplate(row, template) && !this.inactiveCaseStatuses.has(row.status)),
    );
    this.selectedTemplateId.set((routeWithCases ?? templates[0]).id);
  }

  private ensureNewCaseType(): void {
    const types = this.caseTypes();
    const fallbackType = types[0] ?? 'general';
    if (!types.includes(this.newType())) {
      this.newType.set(fallbackType);
    }
    if (this.newTemplateId() && this.templates().some((template) => template.id === this.newTemplateId())) {
      return;
    }
    const matching = this.templates().find((template) => template.caseType === this.newType());
    this.newTemplateId.set(matching?.id ?? '');
  }

  private loadPaged<T>(
    url: string,
    params: Record<string, string>,
    onDone: (rows: T[], total: number) => void,
    onError: (error: unknown) => void,
  ): void {
    const pageSize = 200;
    const rows: T[] = [];
    const loadPage = (page: number) => {
      this.http
        .get<Paged<T>>(url, { params: { ...params, page: String(page), pageSize: String(pageSize) } })
        .subscribe({
          next: (res) => {
            rows.push(...res.data);
            if (res.page < res.totalPages) {
              loadPage(res.page + 1);
              return;
            }
            onDone(rows, res.total);
          },
          error: onError,
        });
    };
    loadPage(1);
  }

  private handleLoadError(error: unknown): void {
    this.state.set('error');
    this.toast.errorFrom(error, this.t('crud.loadError'));
  }
}
