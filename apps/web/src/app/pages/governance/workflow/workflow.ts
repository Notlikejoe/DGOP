import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
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
  WorkflowRoutePreview,
  WorkflowTemplate,
  WorkflowTemplateStage,
} from './workflow.types';

@Component({
  selector: 'app-workflow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Modal, StatusChip, AppIcon],
  templateUrl: './workflow.html',
  styleUrl: './workflow.scss',
})
export class WorkflowPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly inactiveCaseStatuses = new Set(['closed', 'rejected']);
  private readonly inactiveTaskStatuses = new Set(['completed', 'cancelled']);

  protected readonly tab = signal<'map' | 'tasks' | 'cases'>('map');
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly tasks = signal<Task[]>([]);
  protected readonly taskTotal = signal(0);
  protected readonly cases = signal<CaseRow[]>([]);
  protected readonly caseTotal = signal(0);
  protected readonly assets = signal<Ref[]>([]);
  protected readonly templates = signal<WorkflowTemplate[]>([]);
  protected readonly graph = signal<WorkflowGraph | null>(null);
  protected readonly configuration = signal<WorkflowConfiguration | null>(null);
  protected readonly selectedTemplateId = signal<string>('');

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
    this.http.get<Ref[]>('/api/assets').subscribe((a) => this.assets.set(a));
  }

  protected get canViewCases(): boolean { return this.auth.hasPermission('workflow_cases.view'); }
  protected get canCreateCase(): boolean { return this.auth.hasPermission('workflow_cases.create'); }

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
      () => this.state.set('error'),
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
        () => this.handleLoadError(),
      );
      this.http.get<WorkflowTemplate[]>('/api/workflow/templates').subscribe({
        next: (templates) => {
          this.templates.set(templates);
          this.ensureNewCaseType();
          this.ensureSelectedTemplate(templates);
        },
        error: () => this.handleLoadError(),
      });
      this.http.get<WorkflowGraph>('/api/workflow/graph').subscribe({
        next: (graph) => this.graph.set(graph),
        error: () => this.handleLoadError(),
      });
      this.http.get<WorkflowConfiguration>('/api/workflow/configuration').subscribe({
        next: (configuration) => this.configuration.set(configuration),
        error: () => this.handleLoadError(),
      });
    } else {
      this.cases.set([]);
      this.caseTotal.set(0);
      this.configuration.set(null);
    }
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
        error: () => { this.toast.error(this.t('wf.saveError')); this.saving.set(false); },
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
        error: () => { this.toast.error(this.t('wf.saveError')); this.saving.set(false); },
      });
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
    onError: () => void,
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

  private handleLoadError(): void {
    this.state.set('error');
    this.toast.error(this.t('crud.loadError'));
  }
}
