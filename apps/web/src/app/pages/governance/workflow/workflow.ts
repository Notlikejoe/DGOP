import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { finalize, Subscription, timeout } from 'rxjs';
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
  WorkflowDesignerTestRun,
  WorkflowMigrationPreview,
  WorkflowNodeDefinition,
  WorkflowOperationsReport,
  WorkflowRoutePreview,
  WorkflowTemplateVersionsResponse,
  WorkflowVersionDiff,
  WorkflowTemplate,
  WorkflowTemplateStage,
  WorkflowTemplateTransition,
  WorkflowVariableDefinition,
  WorkflowDecisionValue,
} from './workflow.types';

interface DesignerRouteGroup {
  key: string;
  labelKey: string;
  templates: WorkflowTemplate[];
}

interface RouteFamilyMeta {
  key: string;
  labelKey: string;
  order: number;
}

interface DesignerFlowInsight {
  decisions: number;
  branchingStages: number;
  parallelSplits: number;
  mergeJoins: number;
  branchLabels: string;
}

interface DesignerBranchCard {
  id: string;
  stage: WorkflowTemplateStage;
  kind: 'decision' | 'parallel' | 'merge' | 'branch';
  titleKey: string;
  helpKey: string;
  transitions: WorkflowTemplateTransition[];
}

interface DesignerElementSelection {
  id: string;
  kind: 'stage' | 'connector';
  bpmnType: string;
  name: string;
  nodeType: string;
  taskType: string;
  assignmentStrategy: string;
  assigneeRoleCode: string;
  dueDays: number;
  connectorType: string;
  conditionExpression: string;
  ruleVariable: string;
  ruleOperator: string;
  ruleValue: string;
  ruleOutcome: string;
  ruleJoin: string;
  ruleVariable2: string;
  ruleOperator2: string;
  ruleValue2: string;
  isDefaultPath: boolean;
  json: Record<StageJsonKey, string>;
  formFields: DesignerFormField[];
}

interface DesignerFormField {
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string;
}

interface WorkflowInboxField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'boolean' | 'select';
  required: boolean;
  options: string[];
}

interface WorkflowVariableDraft {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  variableType: string;
  scope: string;
  source: string;
  isRequired: boolean;
  description: string;
  allowedValues: string;
}

interface DesignerLayoutResponse {
  bpmnXml: string;
  validation: WorkflowDesignerResponse['validation'];
  designerJson: Record<string, unknown>;
}

type StageJsonKey =
  | 'assignmentConfigJson'
  | 'automationConfigJson'
  | 'evidenceRequirementsJson'
  | 'formSchemaJson'
  | 'gatewayConfigJson'
  | 'notificationRulesJson'
  | 'slaConfigJson';

const WORKFLOW_ROUTE_TYPE_PRIORITY = [
  'owner_assignment_approval',
  'steward_assignment_approval',
  'data_quality_issue',
  'metadata_certification',
  'asset_lifecycle_decision',
  'business_impact_assessment',
  'compliance_calendar',
  'privacy_dpia',
  'privacy_dsr',
  'privacy_breach',
  'foi_request',
  'foi_appeal',
  'data_sharing_request',
  'open_data_publication_approval',
  'dlp_incident',
  'classification_change_request',
  'architecture_review',
  'business_glossary_term',
  'general',
] as const;

const WORKFLOW_ROUTE_TYPE_RANK = new Map<string, number>(
  WORKFLOW_ROUTE_TYPE_PRIORITY.map((type, index) => [type, index]),
);

const ROUTE_FAMILY_CORE: RouteFamilyMeta = {
  key: 'core_governance',
  labelKey: 'wf.designer.family.coreGovernance',
  order: 1,
};
const ROUTE_FAMILY_PRIVACY: RouteFamilyMeta = {
  key: 'privacy_transparency',
  labelKey: 'wf.designer.family.privacyTransparency',
  order: 2,
};
const ROUTE_FAMILY_SECURITY: RouteFamilyMeta = {
  key: 'security_architecture',
  labelKey: 'wf.designer.family.securityArchitecture',
  order: 3,
};
const ROUTE_FAMILY_CATALOG: RouteFamilyMeta = {
  key: 'catalog_standards',
  labelKey: 'wf.designer.family.catalogStandards',
  order: 4,
};
const ROUTE_FAMILY_OTHER: RouteFamilyMeta = {
  key: 'other_routes',
  labelKey: 'wf.designer.family.otherRoutes',
  order: 99,
};

const WORKFLOW_ROUTE_FAMILY_BY_TYPE = new Map<string, RouteFamilyMeta>([
  ['owner_assignment_approval', ROUTE_FAMILY_CORE],
  ['steward_assignment_approval', ROUTE_FAMILY_CORE],
  ['data_quality_issue', ROUTE_FAMILY_CORE],
  ['metadata_certification', ROUTE_FAMILY_CORE],
  ['asset_lifecycle_decision', ROUTE_FAMILY_CORE],
  ['business_impact_assessment', ROUTE_FAMILY_CORE],
  ['compliance_calendar', ROUTE_FAMILY_CORE],
  ['general', ROUTE_FAMILY_CORE],
  ['privacy_dpia', ROUTE_FAMILY_PRIVACY],
  ['privacy_dsr', ROUTE_FAMILY_PRIVACY],
  ['privacy_breach', ROUTE_FAMILY_PRIVACY],
  ['foi_request', ROUTE_FAMILY_PRIVACY],
  ['foi_appeal', ROUTE_FAMILY_PRIVACY],
  ['data_sharing_request', ROUTE_FAMILY_PRIVACY],
  ['open_data_publication_approval', ROUTE_FAMILY_PRIVACY],
  ['dlp_incident', ROUTE_FAMILY_SECURITY],
  ['classification_change_request', ROUTE_FAMILY_SECURITY],
  ['architecture_review', ROUTE_FAMILY_SECURITY],
  ['business_glossary_term', ROUTE_FAMILY_CATALOG],
]);

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
  private readonly activatedRoute = inject(ActivatedRoute);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly inactiveCaseStatuses = new Set(['closed', 'rejected', 'cancelled', 'failed']);
  private readonly inactiveTaskStatuses = new Set(['completed', 'cancelled']);
  private readonly clarificationDecision = 'return_for_clarification' as const;
  private bpmnModeler: any | null = null;
  private bpmnModelerContainer: HTMLElement | null = null;
  private bpmnStylesLoaded = false;
  private bpmnRenderGeneration = 0;
  private bpmnImporting: Promise<boolean> | null = null;
  private bpmnResizeObserver: ResizeObserver | null = null;
  private bpmnDirectionObserver: MutationObserver | null = null;
  private bpmnFitFrame: number | null = null;
  private bpmnFitRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private designerLoadRequestId = 0;
  private designerPreviewRequestId = 0;
  private designerTestRequestId = 0;
  private designerTestSubscription: Subscription | null = null;
  private designerTestElapsedTimer: ReturnType<typeof setInterval> | null = null;
  private dashboardTimer: ReturnType<typeof setInterval> | null = null;
  private lastDesignerFocusRefreshAt = 0;
  private readonly refreshDesignerOnFocus = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (
      this.tab() !== 'designer' ||
      this.designerSaving() ||
      this.designerTestRunning() ||
      this.designerPreviewing() ||
      this.designerAutoLayoutRunning()
    ) return;
    const now = Date.now();
    if (now - this.lastDesignerFocusRefreshAt < 10_000) return;
    this.lastDesignerFocusRefreshAt = now;
    this.loadAll();
  };

  protected readonly tab = signal<'map' | 'tasks' | 'cases' | 'designer'>(
    this.activatedRoute.snapshot.data['initialTab'] === 'designer' ? 'designer' : 'map',
  );
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
  protected readonly workflowOperationsReport = signal<WorkflowOperationsReport | null>(null);
  protected readonly selectedTemplateId = signal<string>('');
  protected readonly designer = signal<WorkflowDesignerResponse | null>(null);
  protected readonly designerTemplateId = signal<string>('');
  protected readonly designerState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly bpmnCanvasState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly designerSaving = signal(false);
  protected readonly designerPreviewing = signal(false);
  protected readonly designerTestRunning = signal(false);
  protected readonly designerTestElapsedSeconds = signal(0);
  protected readonly designerSummary = signal('');
  // The BPMN canvas is the primary designer surface; the business map remains an optional simplified view.
  protected readonly designerViewMode = signal<'business' | 'technical'>('technical');
  protected readonly designerCanvasExpanded = signal(false);
  protected readonly designerInspectorTab = signal<'build' | 'properties' | 'variables' | 'validate'>('build');
  protected readonly acknowledgeMigrationRisk = signal(false);
  protected readonly designerSimulation = signal<WorkflowDesignerSimulation | null>(null);
  protected readonly designerMigration = signal<WorkflowMigrationPreview | null>(null);
  protected readonly designerVersions = signal<WorkflowTemplateVersionsResponse['versions']>([]);
  protected readonly designerDiff = signal<WorkflowVersionDiff | null>(null);
  protected readonly designerTestRuns = signal<WorkflowDesignerTestRun[]>([]);
  protected readonly designerTestRunsTotal = signal(0);
  protected readonly selectedDesignerTestRunId = signal('');
  protected readonly selectedDesignerStageId = signal('');
  protected readonly selectedDesignerElement = signal<DesignerElementSelection | null>(null);
  protected readonly designerCanUndo = signal(false);
  protected readonly designerCanRedo = signal(false);
  protected readonly designerClipboardReady = signal(false);
  protected readonly designerAutoLayoutRunning = signal(false);
  protected readonly designerVariables = signal<WorkflowVariableDefinition[]>([]);
  protected readonly designerVariableSaving = signal(false);
  protected readonly designerVariableDraft = signal<WorkflowVariableDraft>(this.emptyWorkflowVariableDraft());
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

  protected readonly workflowNodePalette = computed(() =>
    this.designer()?.enterprise?.nodePalette ?? this.configuration()?.nodePalette ?? [],
  );

  protected readonly coreWorkflowNodes = computed(() =>
    this.workflowNodePalette().filter((node) => node.priority === 'core'),
  );

  protected readonly advancedWorkflowNodes = computed(() =>
    this.workflowNodePalette().filter((node) => node.priority === 'advanced'),
  );

  protected readonly workflowConnectorTypes = computed(() =>
    this.designer()?.enterprise?.connectorTypes ?? this.configuration()?.connectorTypes ?? [],
  );

  protected readonly workflowMvpGate = computed(() => this.configuration()?.workflowCanvasMvp ?? null);

  protected readonly designerVariableOptions = computed(() => {
    const globalVariables = this.configuration()?.variableRegistry ?? [];
    const rows = [...globalVariables, ...this.designerVariables()];
    return [...new Map(rows.map((variable) => [variable.code, variable])).values()].sort((a, b) => a.code.localeCompare(b.code));
  });

  protected readonly designerReadiness = computed(() =>
    this.designer()?.enterprise?.readinessScore ?? this.designer()?.validation.readinessScore ?? 0,
  );

  protected readonly selectedDesignerTestRun = computed(() => {
    const runs = this.designerTestRuns();
    return runs.find((run) => run.id === this.selectedDesignerTestRunId()) ?? runs[0] ?? null;
  });

  protected readonly designerRouteStages = computed(() =>
    [...(this.designer()?.template.stages ?? [])].filter((stage) => stage.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder),
  );

  protected readonly selectedDesignerStage = computed(() => {
    const stages = this.designerRouteStages();
    return stages.find((stage) => stage.id === this.selectedDesignerStageId()) ?? stages[0] ?? null;
  });

  protected readonly designerRoleOptions = computed(() => {
    const common = ['dmo_admin', 'data_owner', 'data_steward', 'dq_steward', 'privacy_officer', 'security_reviewer', 'technical_steward', 'foi_officer', 'open_data_reviewer', 'auditor'];
    const fromRoute = this.designerRouteStages().map((stage) => stage.assigneeRoleCode).filter((role): role is string => Boolean(role));
    return [...new Set([...fromRoute, ...common])];
  });

  protected readonly designerFlowInsight = computed<DesignerFlowInsight>(() => {
    const template = this.designer()?.template;
    if (!template) return { decisions: 0, branchingStages: 0, parallelSplits: 0, mergeJoins: 0, branchLabels: '-' };
    const outgoing = this.transitionMapBySource(template.transitions);
    const decisions = template.stages.filter((stage) => this.isDecisionStage(stage)).length;
    const branchingStages = template.stages.filter((stage) => (outgoing.get(stage.id)?.length ?? 0) > 1).length;
    const parallelSplits = template.stages.filter((stage) => this.isParallelStage(stage)).length;
    const mergeJoins = template.stages.filter((stage) => this.isMergeStage(stage)).length;
    const labels = template.transitions
      .filter((transition) => transition.decision || transition.connectorType === 'parallel_split')
      .slice(0, 4)
      .map((transition) => this.transitionLabel(transition));
    return {
      decisions,
      branchingStages,
      parallelSplits,
      mergeJoins,
      branchLabels: labels.length ? labels.join(' / ') : this.t('wf.designer.noBranches'),
    };
  });

  protected readonly designerBranchCards = computed<DesignerBranchCard[]>(() => {
    const template = this.designer()?.template;
    if (!template) return [];
    const outgoing = this.transitionMapBySource(template.transitions);
    return this.designerRouteStages()
      .map((stage) => {
        const transitions = outgoing.get(stage.id) ?? [];
        const kind = this.isParallelStage(stage)
          ? 'parallel'
          : this.isMergeStage(stage)
            ? 'merge'
            : this.isDecisionStage(stage)
              ? 'decision'
              : transitions.length > 1
                ? 'branch'
                : null;
        if (!kind) return null;
        return {
          id: stage.id,
          stage,
          kind,
          titleKey: `wf.designer.branch.${kind}`,
          helpKey: `wf.designer.branch.${kind}Help`,
          transitions,
        } satisfies DesignerBranchCard;
      })
      .filter((card): card is DesignerBranchCard => Boolean(card))
      .slice(0, 6);
  });

  protected readonly designerActiveCases = computed(() => {
    const template = this.designer()?.template;
    if (!template) return [];
    return this.cases().filter(
      (row) => this.caseMatchesTemplate(row, template) && !this.inactiveCaseStatuses.has(row.status),
    );
  });

  protected readonly designerLifecycle = computed<Record<string, unknown>>(() => {
    const securityJson = this.designer()?.security?.securityJson;
    const lifecycle = securityJson?.['workflowLifecycle'];
    return lifecycle && typeof lifecycle === 'object' && !Array.isArray(lifecycle)
      ? lifecycle as Record<string, unknown>
      : {};
  });

  protected readonly designerLifecycleState = computed(() => {
    const template = this.designer()?.template;
    return String(this.designerLifecycle()['state'] ?? (template?.isActive ? 'active' : template?.lastPublishedAt ? 'suspended' : 'draft'));
  });
  protected readonly designerReviewStatus = computed(() => String(this.designerLifecycle()['reviewStatus'] ?? 'published'));
  protected readonly designerReviewRequestedBy = computed(() => String(this.designerLifecycle()['reviewRequestedBy'] ?? '-'));
  protected readonly designerReviewedBy = computed(() => String(this.designerLifecycle()['reviewedBy'] ?? '-'));
  protected readonly designerReviewStatusKind = computed<StatusKind>(() => {
    const status = this.designerReviewStatus();
    if (status === 'approved' || status === 'published') return 'success';
    if (status === 'pending') return 'info';
    if (status === 'not_submitted') return 'warning';
    return 'muted';
  });
  protected readonly canSubmitWorkflowReview = computed(() =>
    this.auth.hasAnyRole(['system_admin', 'dmo_admin', 'workflow_designer']),
  );
  protected readonly canApproveWorkflowReview = computed(() =>
    this.auth.hasAnyRole(['system_admin', 'dmo_admin', 'workflow_reviewer']),
  );
  protected readonly canPublishWorkflowRoute = computed(() =>
    this.auth.hasAnyRole(['system_admin', 'dmo_admin', 'workflow_publisher']),
  );
  protected readonly designerPublishGateKind = computed<StatusKind>(() => {
    if (this.designerSaving()) return 'info';
    if (!this.canPublishWorkflowRoute()) return 'muted';
    const status = this.designerReviewStatus();
    if (status === 'approved') return 'success';
    if (status === 'pending') return 'info';
    if (status === 'not_submitted') return 'warning';
    return status === 'published' ? 'success' : 'warning';
  });
  protected readonly designerPublishGateLabel = computed(() => {
    if (this.designerSaving()) return this.t('wf.designer.publishGate.saving');
    if (!this.canPublishWorkflowRoute()) return this.t('wf.designer.publishGate.restricted');
    const status = this.designerReviewStatus();
    if (status === 'approved') return this.t('wf.designer.publishGate.ready');
    if (status === 'pending') return this.t('wf.designer.publishGate.pending');
    if (status === 'not_submitted') return this.t('wf.designer.publishGate.notSubmitted');
    if (status === 'published') return this.t('wf.designer.publishGate.published');
    return this.t('wf.designer.publishGate.blocked');
  });
  protected readonly designerPublishGateHelp = computed(() => {
    if (this.designerSaving()) return this.t('wf.designer.publishGate.savingHelp');
    if (!this.canPublishWorkflowRoute()) return this.t('wf.designer.publishGate.restrictedHelp');
    const status = this.designerReviewStatus();
    if (status === 'approved') return this.t('wf.designer.publishGate.readyHelp');
    if (status === 'pending') return this.t('wf.designer.publishGate.pendingHelp');
    if (status === 'not_submitted') return this.t('wf.designer.publishGate.notSubmittedHelp');
    if (status === 'published') return this.t('wf.designer.publishGate.publishedHelp');
    return this.t('wf.designer.publishGate.blockedHelp');
  });

  protected readonly caseTypes = computed(() => {
    const types = [...new Set(this.templates().map((template) => template.caseType).filter(Boolean))];
    return types.length ? types : ['general'];
  });

  // decision modal
  protected readonly decideTask = signal<Task | null>(null);
  protected readonly decision = signal<WorkflowDecisionValue>('approved');
  protected readonly comment = signal('');
  protected readonly saving = signal(false);
  protected readonly controlCase = signal<CaseRow | null>(null);
  protected readonly controlAction = signal<'suspend' | 'resume' | 'cancel'>('suspend');
  protected readonly controlReason = signal('');
  protected readonly workTask = signal<Task | null>(null);
  protected readonly workFormData = signal<Record<string, unknown>>({});
  protected readonly workSaving = signal<'draft' | 'submit' | null>(null);
  protected readonly workFormFields = computed<WorkflowInboxField[]>(() => this.inboxFormFields(this.workTask()));

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
    return this.sortedWorkflowTemplates(this.templates()).map((template) => {
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

  protected readonly routeSummaryByTemplateId = computed(() =>
    new Map(this.routeSummaries().map((route) => [route.template.id, route])),
  );

  protected readonly designerRouteGroups = computed<DesignerRouteGroup[]>(() => {
    const groups = new Map<string, DesignerRouteGroup & { order: number }>();
    for (const template of this.templates()) {
      const family = this.routeFamily(template.caseType);
      const group = groups.get(family.key) ?? {
        key: family.key,
        labelKey: family.labelKey,
        order: family.order,
        templates: [],
      };
      group.templates.push(template);
      groups.set(family.key, group);
    }
    return [...groups.values()]
      .sort((a, b) => a.order - b.order)
      .map((group) => ({
        key: group.key,
        labelKey: group.labelKey,
        templates: this.sortedWorkflowTemplates(group.templates),
      }));
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
    if (typeof window !== 'undefined') window.addEventListener('focus', this.refreshDesignerOnFocus);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.refreshDesignerOnFocus);
    this.dashboardTimer = setInterval(() => {
      this.loadWorkflowDashboard();
      this.loadWorkflowOperationsReport();
    }, 60_000);
    if (this.auth.hasPermission('data_assets.view')) {
      this.http.get<Ref[]>('/api/assets').subscribe({
        next: (a) => this.assets.set(a),
        error: () => this.assets.set([]),
      });
    }
  }

  ngAfterViewInit(): void {
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      this.bpmnDirectionObserver = new MutationObserver(() => {
        const canvas = this.bpmnModeler?.get?.('canvas');
        if (canvas) this.fitDesignerCanvas(canvas);
      });
      this.bpmnDirectionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
    }
    if (this.tab() === 'designer') this.ensureDesignerLoaded();
  }

  ngOnDestroy(): void {
    if (this.dashboardTimer) clearInterval(this.dashboardTimer);
    this.finishDesignerTestActivity();
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.refreshDesignerOnFocus);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.refreshDesignerOnFocus);
    this.bpmnDirectionObserver?.disconnect();
    this.bpmnDirectionObserver = null;
    this.destroyBpmnModeler();
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
      this.http.get<WorkflowTemplate[]>('/api/workflow/templates', {
        params: { routeRevision: String(Date.now()) },
        headers: { 'Cache-Control': 'no-cache' },
      }).subscribe({
        next: (templates) => {
          const orderedTemplates = this.sortedWorkflowTemplates(templates);
          this.templates.set(orderedTemplates);
          this.ensureNewCaseType();
          this.ensureSelectedTemplate(orderedTemplates);
          if (this.tab() === 'designer') {
            const selectedId = this.designerTemplateId() || this.selectedTemplateId() || orderedTemplates[0]?.id;
            const listed = orderedTemplates.find((template) => template.id === selectedId);
            const loaded = this.designer();
            const routeRevisionChanged = Boolean(
              listed && loaded?.template.id === listed.id && (
                (listed.designerVersion ?? 0) > loaded.version.current ||
                listed.stages.filter((stage) => stage.isActive !== false).length !==
                  loaded.template.stages.filter((stage) => stage.isActive !== false).length ||
                listed.transitions.length !== loaded.template.transitions.length
              ),
            );
            if (routeRevisionChanged && selectedId) this.loadDesigner(selectedId);
            else this.ensureDesignerLoaded();
          }
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
      this.loadWorkflowOperationsReport();
    } else {
      this.cases.set([]);
      this.caseTotal.set(0);
      this.configuration.set(null);
      this.workflowDashboard.set(null);
      this.workflowOperationsReport.set(null);
    }
  }

  private loadWorkflowDashboard(): void {
    if (!this.canViewCases) return;
    this.http.get<WorkflowDashboard>('/api/workflow/dashboard').subscribe({
      next: (dashboard) => this.workflowDashboard.set(dashboard),
      error: () => this.workflowDashboard.set(null),
    });
  }

  private loadWorkflowOperationsReport(): void {
    if (!this.canViewCases) return;
    this.http.get<WorkflowOperationsReport>('/api/workflow/reports/operations', {
      params: { periodDays: '30' },
    }).subscribe({
      next: (report) => this.workflowOperationsReport.set(report),
      error: () => this.workflowOperationsReport.set(null),
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
  protected nodeCategoryLabel(category: string): string {
    return this.t('wf.node.category.' + category);
  }
  protected nodePriorityLabel(priority: WorkflowNodeDefinition['priority']): string {
    return this.t('wf.node.priority.' + priority);
  }
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
    if (mode === 'business') {
      this.destroyBpmnModeler();
      return;
    }
    if (mode === 'technical') {
      setTimeout(() => void this.renderBpmn(this.designer()?.bpmnXml ?? ''), 0);
    }
  }

  protected setDesignerInspectorTab(tab: 'build' | 'properties' | 'variables' | 'validate'): void {
    this.designerInspectorTab.set(tab);
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
  protected openTaskWork(task: Task): void {
    this.workTask.set(task);
    this.workFormData.set({ ...(task.formDataJson ?? {}) });
  }

  protected closeTaskWork(): void {
    if (this.workSaving()) return;
    this.workTask.set(null);
    this.workFormData.set({});
  }

  protected updateWorkField(field: WorkflowInboxField, value: unknown): void {
    const normalized = field.type === 'number' && value !== '' ? Number(value) : value;
    this.workFormData.update((current) => ({ ...current, [field.name]: normalized }));
  }

  protected workFieldValue(name: string): unknown {
    return this.workFormData()[name] ?? '';
  }

  protected workRequiredMissing(): boolean {
    const data = this.workFormData();
    return this.workFormFields().some((field) => {
      if (!field.required) return false;
      const value = data[field.name];
      return value === undefined || value === null || value === '';
    });
  }

  protected saveTaskWork(mode: 'draft' | 'submit'): void {
    const task = this.workTask();
    if (!task || this.workSaving()) return;
    if (mode === 'submit' && this.workRequiredMissing()) {
      this.toast.error(this.t('wf.inbox.requiredFields'));
      return;
    }
    this.workSaving.set(mode);
    const request = mode === 'draft'
      ? this.http.patch<Task>(`/api/workflow/tasks/${task.id}/form`, { data: this.workFormData() })
      : this.http.post<Task>(`/api/workflow/tasks/${task.id}/form`, { data: this.workFormData() });
    request.subscribe({
      next: (saved) => {
        this.tasks.update((rows) => rows.map((row) => row.id === saved.id ? { ...row, ...saved } : row));
        this.workTask.set(saved);
        this.workFormData.set({ ...(saved.formDataJson ?? {}) });
        this.workSaving.set(null);
        this.toast.success(this.t(mode === 'draft' ? 'wf.inbox.draftSaved' : 'wf.inbox.formSubmitted'));
        if (mode === 'submit') this.closeTaskWork();
      },
      error: (err) => {
        this.workSaving.set(null);
        this.toast.errorFrom(err, this.t('wf.inbox.formSaveError'));
      },
    });
  }

  protected openDecision(task: Task, decision: WorkflowDecisionValue): void {
    this.decideTask.set(task);
    this.decision.set(decision);
    this.comment.set('');
  }
  protected closeDecision(): void { this.decideTask.set(null); }

  protected decisionTitle(): string {
    if (this.decision() === 'approved') return this.t('wf.approveTitle');
    if (this.decision() === 'rejected') return this.t('wf.rejectTitle');
    return this.t('wf.returnTitle');
  }

  protected decisionSubmitLabel(): string {
    if (this.decision() === 'approved') return this.t('wf.approve');
    if (this.decision() === 'rejected') return this.t('wf.reject');
    return this.t('wf.returnForClarification');
  }

  protected decisionCommentRequired(): boolean {
    return this.decision() === this.clarificationDecision;
  }

  private inboxFormFields(task: Task | null): WorkflowInboxField[] {
    const schema = task?.templateStage?.formSchemaJson;
    const record = schema && typeof schema === 'object' && !Array.isArray(schema)
      ? schema as Record<string, unknown>
      : {};
    const requiredNames = new Set(Array.isArray(record['required']) ? record['required'].map(String) : []);
    const rawFields = Array.isArray(record['fields']) ? record['fields'] : [];
    const fields = rawFields.flatMap((raw, index): WorkflowInboxField[] => {
      if (typeof raw === 'string') {
        return [{ name: raw, label: this.humanizeFieldName(raw), type: 'text', required: requiredNames.has(raw), options: [] }];
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const field = raw as Record<string, unknown>;
      const name = String(field['name'] ?? field['code'] ?? field['key'] ?? `field_${index + 1}`).trim();
      if (!name) return [];
      const rawType = String(field['type'] ?? 'text').toLowerCase();
      const type: WorkflowInboxField['type'] = ['textarea', 'number', 'date', 'boolean', 'select'].includes(rawType)
        ? rawType as WorkflowInboxField['type']
        : 'text';
      const localizedLabel = this.i18n.lang() === 'ar' ? field['labelAr'] : field['labelEn'];
      const label = String(localizedLabel ?? field['label'] ?? this.humanizeFieldName(name));
      const options = Array.isArray(field['options']) ? field['options'].map(String) : [];
      return [{ name, label, type, required: Boolean(field['required']) || requiredNames.has(name), options }];
    });
    return fields.length ? fields : [{
      name: 'work_notes',
      label: this.t('wf.inbox.workNotes'),
      type: 'textarea',
      required: false,
      options: [],
    }];
  }

  private humanizeFieldName(value: string): string {
    return value.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  protected submitDecision(): void {
    const task = this.decideTask();
    if (!task || this.saving()) return;
    if (this.decisionCommentRequired() && !this.comment().trim()) {
      this.toast.error(this.t('wf.returnCommentRequired'));
      return;
    }
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

  protected canSuspendCase(row: CaseRow): boolean {
    return this.canEditDesigner && !this.inactiveCaseStatuses.has(row.status) && row.status !== 'suspended';
  }

  protected canResumeCase(row: CaseRow): boolean {
    return this.canEditDesigner && row.status === 'suspended';
  }

  protected canCancelCase(row: CaseRow): boolean {
    return this.canEditDesigner && !this.inactiveCaseStatuses.has(row.status);
  }

  protected openCaseControl(row: CaseRow, action: 'suspend' | 'resume' | 'cancel'): void {
    this.controlCase.set(row);
    this.controlAction.set(action);
    this.controlReason.set('');
  }

  protected closeCaseControl(): void {
    this.controlCase.set(null);
    this.controlReason.set('');
  }

  protected caseControlTitle(): string {
    return this.t(`wf.caseControl.${this.controlAction()}.title`);
  }

  protected caseControlSubmitLabel(): string {
    return this.t(`wf.caseControl.${this.controlAction()}.submit`);
  }

  protected caseControlReasonRequired(): boolean {
    return this.controlAction() !== 'resume';
  }

  protected submitCaseControl(): void {
    const row = this.controlCase();
    if (!row || this.saving()) return;
    if (this.caseControlReasonRequired() && !this.controlReason().trim()) {
      this.toast.error(this.t('wf.caseControl.reasonRequired'));
      return;
    }
    const action = this.controlAction();
    this.saving.set(true);
    this.http.post<CaseRow>(`/api/workflow/cases/${row.id}/${action}`, {
      reason: this.controlReason().trim() || null,
    }).subscribe({
      next: () => {
        this.toast.success(this.t(`wf.caseControl.${action}.success`));
        this.saving.set(false);
        this.closeCaseControl();
        this.loadAll();
      },
      error: (err) => {
        this.toast.errorFrom(err, this.t('wf.saveError'));
        this.saving.set(false);
      },
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
    if (!templateId) return;
    if (templateId === this.designerTemplateId()) {
      this.loadDesigner(templateId);
      return;
    }
    this.designerTemplateId.set(templateId);
    this.loadDesigner(templateId);
  }

  protected designerRouteMeta(template: WorkflowTemplate): string {
    return `${template.code} - ${template.stages.length} ${this.t('wf.graph.stages')} - ${template.defaultSlaDays} ${this.t('wf.graph.days')}`;
  }

  protected designerRouteCaseCount(template: WorkflowTemplate): number {
    return this.routeSummaryByTemplateId().get(template.id)?.activeCases.length ?? 0;
  }

  protected designerRouteStatus(template: WorkflowTemplate): StatusKind {
    return this.graphKind(this.routeSummaryByTemplateId().get(template.id)?.status);
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
    this.designerLoadRequestId++;
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
        void this.renderBpmn(res.bpmnXml).then((rendered) => {
          if (rendered) void this.refreshDesignerPreviews();
        });
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
    void this.renderBpmn(xml);
  }

  protected retryBpmnCanvas(): void {
    const xml = this.bpmnImportText().trim() || this.designer()?.bpmnXml || '';
    if (!xml) return;
    this.destroyBpmnModeler();
    void this.renderBpmn(xml);
  }

  protected undoDesigner(): void {
    const commandStack = this.bpmnModeler?.get?.('commandStack');
    if (commandStack?.canUndo?.()) commandStack.undo();
    this.syncDesignerHistory();
  }

  protected redoDesigner(): void {
    const commandStack = this.bpmnModeler?.get?.('commandStack');
    if (commandStack?.canRedo?.()) commandStack.redo();
    this.syncDesignerHistory();
  }

  protected zoomDesigner(delta: number): void {
    const canvas = this.bpmnModeler?.get?.('canvas');
    const container = this.bpmnCanvas?.nativeElement;
    if (!canvas || !this.isBpmnCanvasMeasurable(container)) return;
    try {
      const current = Number(canvas.zoom?.() ?? 1);
      const baseline = Number.isFinite(current) && current > 0 ? current : 1;
      canvas.zoom(Math.min(2.5, Math.max(0.25, baseline + delta)));
    } catch {
      this.fitDesignerCanvas(canvas);
    }
  }

  protected fitDesigner(): void {
    const canvas = this.bpmnModeler?.get?.('canvas');
    if (canvas) this.fitDesignerCanvas(canvas);
  }

  protected toggleDesignerCanvas(): void {
    this.designerCanvasExpanded.update((expanded) => !expanded);
    queueMicrotask(() => {
      const canvas = this.bpmnModeler?.get?.('canvas');
      canvas?.resized?.();
      if (canvas) this.fitDesignerCanvas(canvas);
    });
  }

  @HostListener('document:keydown.escape')
  protected closeExpandedDesignerCanvas(): void {
    if (!this.designerCanvasExpanded()) return;
    this.designerCanvasExpanded.set(false);
    queueMicrotask(() => this.bpmnModeler?.get?.('canvas')?.resized?.());
  }

  protected copyDesignerSelection(): void {
    const selection = this.bpmnModeler?.get?.('selection')?.get?.() ?? [];
    if (!selection.length) return;
    this.bpmnModeler?.get?.('copyPaste')?.copy?.(selection);
    this.designerClipboardReady.set(true);
  }

  protected pasteDesignerSelection(): void {
    if (!this.designerClipboardReady()) return;
    const canvas = this.bpmnModeler?.get?.('canvas');
    const copyPaste = this.bpmnModeler?.get?.('copyPaste');
    if (!canvas || !copyPaste) return;
    const viewbox = canvas.viewbox();
    copyPaste.paste({
      element: canvas.getRootElement(),
      point: { x: viewbox.x + viewbox.width / 2, y: viewbox.y + viewbox.height / 2 },
    });
  }

  protected deleteDesignerSelection(): void {
    const selection = this.bpmnModeler?.get?.('selection')?.get?.() ?? [];
    if (!selection.length) return;
    this.bpmnModeler?.get?.('modeling')?.removeElements?.(selection);
    this.selectedDesignerElement.set(null);
  }

  protected async autoLayoutDesigner(): Promise<void> {
    const template = this.designer()?.template;
    if (!template || this.designerAutoLayoutRunning()) return;
    this.designerAutoLayoutRunning.set(true);
    try {
      const bpmnXml = await this.currentBpmnXml();
      this.http.post<DesignerLayoutResponse>(
        `/api/workflow/templates/${template.id}/designer/layout`,
        { bpmnXml },
      ).subscribe({
        next: (res) => {
          const current = this.designer();
          if (current?.template.id === template.id) {
            this.designer.set({ ...current, bpmnXml: res.bpmnXml, validation: res.validation, designerJson: res.designerJson });
            this.bpmnImportText.set(res.bpmnXml);
          }
          this.designerAutoLayoutRunning.set(false);
          void this.renderBpmn(res.bpmnXml);
        },
        error: (err) => {
          this.designerAutoLayoutRunning.set(false);
          this.toast.errorFrom(err, this.t('wf.saveError'));
        },
      });
    } catch (err) {
      this.designerAutoLayoutRunning.set(false);
      this.toast.errorFrom(err, this.t('wf.designer.exportError'));
    }
  }

  protected addDesignerNode(node: WorkflowNodeDefinition): void {
    void this.ensureModeler().then((modeler) => {
      if (!modeler) return;
      const elementFactory = modeler.get?.('elementFactory');
      const modeling = modeler.get?.('modeling');
      const canvas = modeler.get?.('canvas');
      const selection = modeler.get?.('selection');
      if (!elementFactory || !modeling || !canvas) return;
      const shape = elementFactory.createShape({ type: this.bpmnTypeForNode(node.code) });
      const viewbox = canvas.viewbox();
      const existing = modeler.get?.('elementRegistry')?.filter?.((element: any) => !element.labelTarget) ?? [];
      const offset = (existing.length % 5) * 28;
      const created = modeling.createShape(
        shape,
        { x: viewbox.x + viewbox.width / 2 + offset, y: viewbox.y + viewbox.height / 2 + offset },
        canvas.getRootElement(),
      );
      const defaults = this.nodeDefaults(node.code);
      const properties: Record<string, unknown> = {
        name: node.label,
        'dgop:code': this.uniqueDesignerCode(node.code),
        'dgop:kind': defaults.kind,
        'dgop:nodeType': node.code,
        'dgop:taskType': defaults.taskType,
        'dgop:assignmentStrategy': defaults.assignmentStrategy,
        'dgop:dueDays': defaults.dueDays,
        'dgop:isStart': node.code === 'start_event' ? 'true' : 'false',
        'dgop:isDecision': node.code === 'decision_gateway' ? 'true' : 'false',
        'dgop:isFinal': node.code === 'end_event' ? 'true' : 'false',
      };
      if (node.code === 'timer_event' || node.code === 'error_event') {
        const eventDefinitionType = node.code === 'timer_event' ? 'bpmn:TimerEventDefinition' : 'bpmn:ErrorEventDefinition';
        properties['eventDefinitions'] = [modeler.get?.('bpmnFactory')?.create?.(eventDefinitionType)];
        if (node.code === 'timer_event') properties['dgop:slaConfig'] = JSON.stringify({ durationMinutes: 5 });
      }
      modeling.updateProperties(created, properties);
      selection?.select?.(created);
      canvas.scrollToElement?.(created);
    }).catch((err) => this.toast.errorFrom(err, this.t('wf.saveError')));
  }

  protected createParallelSplit(): void {
    void this.ensureModeler().then((modeler) => {
      if (!modeler) return;
      const selected = this.selectedDesignerShapes(modeler);
      if (selected.length !== 1 || selected[0].type === 'bpmn:EndEvent') {
        this.toast.error(this.t('wf.designer.toolbar.selectOneForSplit'));
        return;
      }

      const source = selected[0];
      const modeling = modeler.get?.('modeling');
      const elementFactory = modeler.get?.('elementFactory');
      const selection = modeler.get?.('selection');
      const canvas = modeler.get?.('canvas');
      if (!modeling || !elementFactory || !source.parent) return;
      const outgoing = (source.outgoing ?? []).filter((connection: any) => connection.type === 'bpmn:SequenceFlow');
      if (outgoing.length > 1) {
        this.toast.error(this.t('wf.designer.toolbar.selectOneForSplit'));
        return;
      }

      const previousFlow = outgoing[0] ?? null;
      const previousTarget = previousFlow?.target ?? null;
      const sourceCenterY = source.y + source.height / 2;
      const splitCenter = { x: source.x + source.width + 120, y: sourceCenterY };
      const taskX = splitCenter.x + 190;
      const branchOffset = 105;
      const mergeCenter = { x: taskX + 210, y: sourceCenterY };
      const parent = source.parent;

      try {
        const split = modeling.createShape(
          elementFactory.createShape({ type: 'bpmn:ParallelGateway' }),
          splitCenter,
          parent,
        );
        const branchA = modeling.createShape(
          elementFactory.createShape({ type: 'bpmn:UserTask' }),
          { x: taskX, y: Math.max(80, sourceCenterY - branchOffset) },
          parent,
        );
        const branchB = modeling.createShape(
          elementFactory.createShape({ type: 'bpmn:UserTask' }),
          { x: taskX, y: sourceCenterY + branchOffset },
          parent,
        );
        const merge = modeling.createShape(
          elementFactory.createShape({ type: 'bpmn:ParallelGateway' }),
          mergeCenter,
          parent,
        );

        this.configureDesignerNode(modeling, split, 'parallel_gateway', this.t('wf.designer.branch.parallel'));
        this.configureDesignerNode(modeling, branchA, 'user_task', `${this.t('wf.designer.branch.parallel')} A`);
        this.configureDesignerNode(modeling, branchB, 'user_task', `${this.t('wf.designer.branch.parallel')} B`);
        this.configureDesignerNode(modeling, merge, 'merge_gateway', this.t('wf.designer.branch.merge'));

        const previousName = String(previousFlow?.businessObject?.name ?? '');
        if (previousFlow) modeling.removeConnection(previousFlow);
        this.connectDesignerElements(modeling, source, split, 'sequence');
        this.connectDesignerElements(modeling, split, branchA, 'parallel_split', 'Path A');
        this.connectDesignerElements(modeling, split, branchB, 'parallel_split', 'Path B');
        this.connectDesignerElements(modeling, branchA, merge, 'parallel_join');
        this.connectDesignerElements(modeling, branchB, merge, 'parallel_join');
        if (previousTarget) this.connectDesignerElements(modeling, merge, previousTarget, 'sequence', previousName);

        selection?.select?.(split);
        canvas?.scrollToElement?.(split);
        this.toast.success(this.t('wf.designer.toolbar.parallelCreated'));
      } catch (err) {
        this.toast.errorFrom(err, this.t('wf.saveError'));
      }
    }).catch((err) => this.toast.errorFrom(err, this.t('wf.saveError')));
  }

  protected createParallelMerge(): void {
    void this.ensureModeler().then((modeler) => {
      if (!modeler) return;
      const branches = this.selectedDesignerShapes(modeler);
      if (branches.length < 2 || new Set(branches.map((branch: any) => branch.parent?.id)).size !== 1) {
        this.toast.error(this.t('wf.designer.toolbar.selectBranchesForMerge'));
        return;
      }
      if (branches.some((branch: any) => (branch.outgoing ?? []).some((connection: any) => connection.type === 'bpmn:SequenceFlow'))) {
        this.toast.error(this.t('wf.designer.toolbar.branchHasContinuation'));
        return;
      }

      const modeling = modeler.get?.('modeling');
      const elementFactory = modeler.get?.('elementFactory');
      const selection = modeler.get?.('selection');
      const canvas = modeler.get?.('canvas');
      if (!modeling || !elementFactory) return;
      const rightEdge = Math.max(...branches.map((branch: any) => branch.x + branch.width));
      const centerY = branches.reduce((sum: number, branch: any) => sum + branch.y + branch.height / 2, 0) / branches.length;
      try {
        const merge = modeling.createShape(
          elementFactory.createShape({ type: 'bpmn:ParallelGateway' }),
          { x: rightEdge + 130, y: centerY },
          branches[0].parent,
        );
        this.configureDesignerNode(modeling, merge, 'merge_gateway', this.t('wf.designer.branch.merge'));
        for (const branch of branches) this.connectDesignerElements(modeling, branch, merge, 'parallel_join');
        selection?.select?.(merge);
        canvas?.scrollToElement?.(merge);
        this.toast.success(this.t('wf.designer.toolbar.mergeCreated'));
      } catch (err) {
        this.toast.errorFrom(err, this.t('wf.saveError'));
      }
    }).catch((err) => this.toast.errorFrom(err, this.t('wf.saveError')));
  }

  private selectedDesignerShapes(modeler: any): any[] {
    return (modeler.get?.('selection')?.get?.() ?? []).filter((element: any) =>
      element?.businessObject && !element.labelTarget && element.type !== 'bpmn:SequenceFlow',
    );
  }

  private configureDesignerNode(modeling: any, element: any, code: string, name: string): void {
    const defaults = this.nodeDefaults(code);
    modeling.updateProperties(element, {
      name,
      'dgop:code': this.uniqueDesignerCode(code),
      'dgop:kind': defaults.kind,
      'dgop:nodeType': code,
      'dgop:taskType': defaults.taskType,
      'dgop:assignmentStrategy': defaults.assignmentStrategy,
      'dgop:dueDays': defaults.dueDays,
      'dgop:isStart': 'false',
      'dgop:isDecision': 'false',
      'dgop:isFinal': 'false',
    });
  }

  private connectDesignerElements(
    modeling: any,
    source: any,
    target: any,
    connectorType: string,
    name = '',
  ): any {
    const connection = modeling.connect(source, target, { type: 'bpmn:SequenceFlow' });
    modeling.updateProperties(connection, {
      ...(name ? { name } : {}),
      'dgop:connectorType': connectorType,
    });
    return connection;
  }

  protected updateSelectedDesignerProperty(field: keyof DesignerElementSelection, value: string | number | boolean): void {
    const selected = this.selectedDesignerElement();
    const modeler = this.bpmnModeler;
    if (!selected || !modeler) return;
    const element = modeler.get?.('elementRegistry')?.get?.(selected.id);
    const modeling = modeler.get?.('modeling');
    if (!element || !modeling) return;
    const property = this.designerPropertyName(field);
    if (!property) return;
    try {
      modeling.updateProperties(element, { [property]: value });
      this.captureDesignerSelection(element);
    } catch (err) {
      this.toast.errorFrom(err, this.t('wf.saveError'));
    }
  }

  protected updateSelectedDesignerJson(key: StageJsonKey, value: string): void {
    const trimmed = value.trim();
    if (trimmed) {
      try {
        JSON.parse(trimmed);
      } catch {
        this.toast.error(this.t('wf.designer.properties.invalidJson'));
        return;
      }
    }
    const selected = this.selectedDesignerElement();
    const element = selected ? this.bpmnModeler?.get?.('elementRegistry')?.get?.(selected.id) : null;
    const modeling = this.bpmnModeler?.get?.('modeling');
    if (!selected || !element || !modeling) return;
    try {
      modeling.updateProperties(element, { [`dgop:${key.replace(/Json$/, '')}`]: trimmed });
      this.captureDesignerSelection(element);
    } catch (err) {
      this.toast.errorFrom(err, this.t('wf.saveError'));
    }
  }

  protected saveDesignerDraft(): void {
    this.persistDesigner('save');
  }

  protected publishDesigner(): void {
    this.persistDesigner('publish');
  }

  protected submitDesignerReview(): void {
    this.reviewDesigner('submit-review');
  }

  protected approveDesignerReview(): void {
    this.reviewDesigner('approve-review');
  }

  protected cloneDesignerTemplate(): void {
    const template = this.designer()?.template;
    if (!template || this.designerSaving()) return;
    this.designerSaving.set(true);
    this.http.post<WorkflowDesignerResponse>(`/api/workflow/templates/${template.id}/clone`, {}).subscribe({
      next: (created) => {
        this.designerSaving.set(false);
        this.loadAll();
        this.designerTemplateId.set(created.template.id);
        this.loadDesigner(created.template.id);
        this.toast.success(this.t('wf.designer.lifecycle.cloneDone'));
      },
      error: (err) => {
        this.designerSaving.set(false);
        this.toast.errorFrom(err, this.t('wf.saveError'));
      },
    });
  }

  protected controlDesignerLifecycle(action: 'activate' | 'suspend' | 'retire' | 'archive' | 'delete_draft'): void {
    const template = this.designer()?.template;
    if (!template || this.designerSaving()) return;
    this.designerSaving.set(true);
    this.http.patch<WorkflowDesignerResponse | { id: string; deleted: true }>(`/api/workflow/templates/${template.id}/lifecycle`, {
      action,
      reason: action === 'activate' ? null : this.designerSummary().trim(),
    }).subscribe({
      next: (response) => {
        this.designerSaving.set(false);
        this.designerSummary.set('');
        this.loadAll();
        if ('deleted' in response) {
          this.designer.set(null);
          this.designerTemplateId.set('');
        } else {
          this.designer.set(response);
          this.loadDesigner(template.id);
        }
        this.toast.success(this.t(`wf.designer.lifecycle.${action}Done`));
      },
      error: (err) => {
        this.designerSaving.set(false);
        this.toast.errorFrom(err, this.t('wf.saveError'));
      },
    });
  }

  protected async executeDesignerTestRun(): Promise<void> {
    const template = this.designer()?.template;
    if (!template || this.designerTestRunning()) return;
    const requestId = ++this.designerTestRequestId;
    this.beginDesignerTestActivity();
    try {
      const xml = await this.currentBpmnXml();
      if (requestId !== this.designerTestRequestId || this.designerTemplateId() !== template.id) return;
      this.designerTestSubscription = this.http.post<WorkflowDesignerTestRun>(
        `/api/workflow/templates/${template.id}/designer/test-runs`,
        { bpmnXml: xml, environment: 'test' },
      ).pipe(
        timeout(15_000),
        finalize(() => {
          if (requestId === this.designerTestRequestId) {
            this.designerTestSubscription = null;
            this.finishDesignerTestActivity();
          }
        }),
      ).subscribe({
        next: (run) => {
          if (requestId !== this.designerTestRequestId || this.designerTemplateId() !== template.id) return;
          this.designerSimulation.set(run.simulation as WorkflowDesignerSimulation);
          this.selectedDesignerTestRunId.set(run.id);
          this.designerTestRuns.update((runs) => [run, ...runs.filter((item) => item.id !== run.id)].slice(0, 5));
          this.designerTestRunsTotal.update((total) => total + 1);
          this.loadDesignerTestRuns(template.id);
          this.toast.success(this.t('wf.designer.testRunDone'));
        },
        error: (err) => {
          if (requestId !== this.designerTestRequestId) return;
          if (err?.name === 'TimeoutError') this.toast.errorFrom(err, this.t('wf.designer.testTimeout'));
          else this.toast.errorFrom(err, this.t('wf.saveError'));
        },
      });
    } catch (err) {
      if (requestId !== this.designerTestRequestId) return;
      this.finishDesignerTestActivity();
      const message = err instanceof Error ? err.message : '';
      if (message.includes('timed out')) this.toast.error(this.t('wf.designer.testTimeout'));
      else this.toast.errorFrom(err, this.t('wf.designer.exportError'));
    }
  }

  protected cancelDesignerTestRun(): void {
    if (!this.designerTestRunning()) return;
    this.designerTestRequestId++;
    this.finishDesignerTestActivity();
    this.toast.show(this.t('wf.designer.testCancelled'), 'info');
  }

  protected resetDesignerTestRun(run: WorkflowDesignerTestRun): void {
    const template = this.designer()?.template;
    if (!template || run.status === 'reset') return;
    this.http.post<WorkflowDesignerTestRun>(
      `/api/workflow/templates/${template.id}/designer/test-runs/${run.id}/reset`,
      {},
    ).subscribe({
      next: () => {
        this.loadDesignerTestRuns(template.id);
        this.toast.success(this.t('wf.designer.testRunReset'));
      },
      error: (err) => this.toast.errorFrom(err, this.t('wf.saveError')),
    });
  }

  protected validationKind(status?: string): StatusKind {
    if (status === 'ready') return 'success';
    if (status === 'warning' || status === 'watch') return 'warning';
    if (status === 'blocked') return 'danger';
    return 'muted';
  }

  protected testRunKind(status?: string): StatusKind {
    if (status === 'reset') return 'muted';
    return this.validationKind(status);
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

  protected testRunPathLength(run: WorkflowDesignerTestRun): number {
    return this.testRunSteps(run).length;
  }

  protected testRunSteps(run: WorkflowDesignerTestRun): WorkflowDesignerSimulation['path'] {
    const executedPath = run.executedPath as { path?: unknown[] };
    const simulation = run.simulation as { path?: unknown[] };
    if (Array.isArray(executedPath.path)) return executedPath.path as WorkflowDesignerSimulation['path'];
    if (Array.isArray(simulation.path)) return simulation.path as WorkflowDesignerSimulation['path'];
    return [];
  }

  protected testRunMessages(run: WorkflowDesignerTestRun, type: 'blockers' | 'warnings'): string[] {
    const executedPath = run.executedPath as { blockers?: unknown[]; warnings?: unknown[] };
    const simulation = run.simulation as { blockers?: unknown[]; warnings?: unknown[] };
    const values = executedPath[type] ?? simulation[type] ?? [];
    return Array.isArray(values) ? values.map(String).filter(Boolean) : [];
  }

  protected inspectDesignerTestRun(run: WorkflowDesignerTestRun): void {
    this.selectedDesignerTestRunId.set(run.id);
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
      .map((transition) => this.transitionLabel(transition))
      .filter(Boolean);
  }

  protected transitionTargetLabel(transition: WorkflowTemplateTransition): string {
    const stage = this.designerRouteStages().find((item) => item.id === transition.toStageId);
    return stage ? this.stageName(stage) : transition.toStageId.slice(0, 8);
  }

  protected branchCardKind(card: DesignerBranchCard): StatusKind {
    if (card.kind === 'parallel') return 'info';
    if (card.kind === 'merge') return 'success';
    if (card.kind === 'decision') return 'warning';
    return 'muted';
  }

  protected isDecisionStage(stage: WorkflowTemplateStage): boolean {
    return stage.isDecision || this.normalizedNodeType(stage) === 'decision_gateway';
  }

  protected isParallelStage(stage: WorkflowTemplateStage): boolean {
    return this.normalizedNodeType(stage) === 'parallel_gateway';
  }

  protected isMergeStage(stage: WorkflowTemplateStage): boolean {
    return ['merge_gateway', 'inclusive_gateway'].includes(this.normalizedNodeType(stage));
  }

  private transitionMapBySource(transitions: WorkflowTemplateTransition[]): Map<string, WorkflowTemplateTransition[]> {
    const map = new Map<string, WorkflowTemplateTransition[]>();
    for (const transition of transitions) {
      const rows = map.get(transition.fromStageId) ?? [];
      rows.push(transition);
      map.set(transition.fromStageId, rows);
    }
    return map;
  }

  protected transitionLabel(transition: WorkflowTemplateTransition): string {
    return (this.i18n.lang() === 'ar' ? transition.labelAr : transition.labelEn) || transition.decision || transition.connectorType || '';
  }

  private normalizedNodeType(stage: WorkflowTemplateStage): string {
    return String(stage.nodeType ?? '').trim().toLowerCase();
  }

  protected async refreshDesignerPreviews(): Promise<void> {
    const template = this.designer()?.template;
    if (!template || this.designerPreviewing()) return;
    const requestId = ++this.designerPreviewRequestId;
    const templateId = template.id;
    this.designerPreviewing.set(true);
    try {
      const xml = await this.currentBpmnXml();
      if (requestId !== this.designerPreviewRequestId || this.designer()?.template.id !== templateId) return;
      this.http.post<WorkflowDesignerSimulation>(
        `/api/workflow/templates/${templateId}/designer/simulate`,
        { bpmnXml: xml },
      ).subscribe({
        next: (res) => {
          if (requestId === this.designerPreviewRequestId && this.designer()?.template.id === templateId) {
            this.designerSimulation.set(res);
          }
        },
        error: () => {
          if (requestId === this.designerPreviewRequestId && this.designer()?.template.id === templateId) {
            this.designerSimulation.set(null);
          }
        },
      });
      this.http.post<WorkflowMigrationPreview>(
        `/api/workflow/templates/${templateId}/designer/migration-preview`,
        { bpmnXml: xml },
      ).subscribe({
        next: (res) => {
          if (requestId === this.designerPreviewRequestId && this.designer()?.template.id === templateId) {
            this.designerMigration.set(res);
            this.designerPreviewing.set(false);
          }
        },
        error: () => {
          if (requestId === this.designerPreviewRequestId && this.designer()?.template.id === templateId) {
            this.designerMigration.set(null);
            this.designerPreviewing.set(false);
          }
        },
      });
    } catch (err) {
      if (requestId === this.designerPreviewRequestId) {
        this.designerPreviewing.set(false);
        this.toast.errorFrom(err, this.t('wf.designer.exportError'));
      }
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
      if (
        this.designerViewMode() === 'technical' &&
        (!this.bpmnModeler || this.bpmnCanvasState() === 'idle' || this.bpmnCanvasState() === 'error')
      ) {
        setTimeout(() => void this.renderBpmn(this.designer()?.bpmnXml ?? ''), 0);
      }
      return;
    }
    this.loadDesigner(selected);
  }

  private loadDesigner(templateId: string): void {
    const requestId = ++this.designerLoadRequestId;
    this.designerPreviewRequestId++;
    this.designerTestRequestId++;
    this.finishDesignerTestActivity();
    this.designerState.set('loading');
    this.designerPreviewing.set(false);
    this.designerSimulation.set(null);
    this.designerMigration.set(null);
    this.designerDiff.set(null);
    this.designerTestRuns.set([]);
    this.designerTestRunsTotal.set(0);
    this.selectedDesignerTestRunId.set('');
    if (this.designerViewMode() === 'technical') this.destroyBpmnModeler();
    this.http.get<WorkflowDesignerResponse>(`/api/workflow/templates/${templateId}/designer`, {
      params: { routeRevision: String(Date.now()) },
      headers: { 'Cache-Control': 'no-cache' },
    }).subscribe({
      next: (res) => {
        if (requestId !== this.designerLoadRequestId || this.designerTemplateId() !== templateId) return;
        this.designer.set(res);
        this.templates.update((templates) => this.sortedWorkflowTemplates(templates.map((template) =>
          template.id === res.template.id
            ? { ...res.template, _count: res.template._count ?? template._count }
            : template,
        )));
        this.bpmnImportText.set(res.bpmnXml);
        this.designerSimulation.set(null);
        this.designerMigration.set(null);
        this.designerDiff.set(null);
        this.acknowledgeMigrationRisk.set(false);
        this.designerState.set('ready');
        this.loadDesignerVersions(templateId);
        this.loadDesignerTestRuns(templateId);
        this.loadDesignerVariables(templateId);
        setTimeout(async () => {
          if (requestId !== this.designerLoadRequestId || this.designerTemplateId() !== templateId) return;
          const rendered = await this.renderBpmn(res.bpmnXml);
          if (!rendered || requestId !== this.designerLoadRequestId || this.designerTemplateId() !== templateId) return;
          await this.refreshDesignerPreviews();
        }, 0);
      },
      error: (err) => {
        if (requestId !== this.designerLoadRequestId || this.designerTemplateId() !== templateId) return;
        this.designerState.set('error');
        this.toast.errorFrom(err, this.t('crud.loadError'));
      },
    });
  }

  private loadDesignerVersions(templateId: string): void {
    this.http.get<WorkflowTemplateVersionsResponse>(`/api/workflow/templates/${templateId}/designer/versions`).subscribe({
      next: (res) => {
        if (this.designerTemplateId() === templateId) this.designerVersions.set(res.versions);
      },
      error: () => {
        if (this.designerTemplateId() === templateId) this.designerVersions.set([]);
      },
    });
  }

  private loadDesignerTestRuns(templateId: string): void {
    this.http.get<Paged<WorkflowDesignerTestRun>>(
      `/api/workflow/templates/${templateId}/designer/test-runs`,
      { params: { page: '1', pageSize: '5' } },
    ).subscribe({
      next: (res) => {
        if (this.designerTemplateId() !== templateId) return;
        this.designerTestRuns.set(res.data);
        this.designerTestRunsTotal.set(res.total);
        if (!res.data.some((run) => run.id === this.selectedDesignerTestRunId())) {
          this.selectedDesignerTestRunId.set(res.data[0]?.id ?? '');
        }
      },
      error: () => {
        if (this.designerTemplateId() !== templateId) return;
        this.designerTestRuns.set([]);
        this.designerTestRunsTotal.set(0);
        this.selectedDesignerTestRunId.set('');
      },
    });
  }

  private loadDesignerVariables(templateId: string): void {
    this.http.get<WorkflowVariableDefinition[]>(`/api/workflow/templates/${templateId}/variables`).subscribe({
      next: (rows) => {
        if (this.designerTemplateId() === templateId) this.designerVariables.set(rows);
      },
      error: () => {
        if (this.designerTemplateId() === templateId) this.designerVariables.set([]);
      },
    });
  }

  protected newDesignerVariable(): void {
    this.designerVariableDraft.set(this.emptyWorkflowVariableDraft());
  }

  protected editDesignerVariable(variable: WorkflowVariableDefinition): void {
    this.designerVariableDraft.set({
      id: variable.id ?? '',
      code: variable.code,
      nameEn: variable.nameEn,
      nameAr: variable.nameAr ?? '',
      variableType: variable.variableType,
      scope: variable.scope || 'case',
      source: variable.source || 'designer',
      isRequired: variable.isRequired ?? variable.required ?? false,
      description: variable.description ?? '',
      allowedValues: Array.isArray(variable.allowedValuesJson) ? variable.allowedValuesJson.map(String).join(', ') : '',
    });
  }

  protected updateDesignerVariableDraft(field: keyof WorkflowVariableDraft, value: string | boolean): void {
    this.designerVariableDraft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected saveDesignerVariable(): void {
    const templateId = this.designerTemplateId();
    const draft = this.designerVariableDraft();
    if (!templateId || !draft.code.trim() || !draft.nameEn.trim() || this.designerVariableSaving()) return;
    this.designerVariableSaving.set(true);
    this.http.post<WorkflowVariableDefinition>(`/api/workflow/templates/${templateId}/variables`, {
      code: draft.code.trim(),
      nameEn: draft.nameEn.trim(),
      nameAr: draft.nameAr.trim() || null,
      description: draft.description.trim() || null,
      variableType: draft.variableType,
      scope: draft.scope,
      source: draft.source,
      isRequired: draft.isRequired,
      allowedValues: draft.allowedValues.split(',').map((item) => item.trim()).filter(Boolean),
    }).subscribe({
      next: () => {
        this.designerVariableSaving.set(false);
        this.newDesignerVariable();
        this.loadDesignerVariables(templateId);
        this.loadDesigner(templateId);
        this.toast.success(this.t('wf.designer.variables.saved'));
      },
      error: (err) => {
        this.designerVariableSaving.set(false);
        this.toast.errorFrom(err, this.t('wf.saveError'));
      },
    });
  }

  protected archiveDesignerVariable(variable: WorkflowVariableDefinition): void {
    const templateId = this.designerTemplateId();
    if (!templateId || !variable.id || this.designerVariableSaving()) return;
    this.designerVariableSaving.set(true);
    this.http.patch(`/api/workflow/templates/${templateId}/variables/${variable.id}/archive`, {}).subscribe({
      next: () => {
        this.designerVariableSaving.set(false);
        this.newDesignerVariable();
        this.loadDesignerVariables(templateId);
        this.loadDesigner(templateId);
        this.toast.success(this.t('wf.designer.variables.archived'));
      },
      error: (err) => {
        this.designerVariableSaving.set(false);
        this.toast.errorFrom(err, this.t('wf.saveError'));
      },
    });
  }

  private emptyWorkflowVariableDraft(): WorkflowVariableDraft {
    return {
      id: '',
      code: '',
      nameEn: '',
      nameAr: '',
      variableType: 'text',
      scope: 'case',
      source: 'designer',
      isRequired: false,
      description: '',
      allowedValues: '',
    };
  }

  private async ensureModeler(expectedGeneration?: number): Promise<any | null> {
    const container = this.bpmnCanvas?.nativeElement;
    if (!container) return null;
    if (typeof document !== 'undefined' && !document.body.contains(container)) return null;
    this.ensureBpmnStyles();
    if (this.bpmnModeler && this.bpmnModelerContainer !== container) {
      this.destroyBpmnModeler();
    }
    if (!this.bpmnModeler) {
      const module = await import('bpmn-js/lib/Modeler');
      if (expectedGeneration != null && expectedGeneration !== this.bpmnRenderGeneration) return null;
      if (!container.isConnected || this.bpmnCanvas?.nativeElement !== container) return null;
      this.bpmnModeler = new module.default({
        container,
      });
      this.bpmnModelerContainer = container;
      this.bpmnResizeObserver?.disconnect();
      if (typeof ResizeObserver !== 'undefined') {
        this.bpmnResizeObserver = new ResizeObserver(() => {
          if (this.bpmnCanvasState() !== 'ready' || !this.bpmnModeler) return;
          const canvas = this.bpmnModeler.get?.('canvas');
          if (canvas) this.fitDesignerCanvas(canvas);
        });
        this.bpmnResizeObserver.observe(container);
      }
      const eventBus = this.bpmnModeler.get?.('eventBus');
      eventBus?.on?.('selection.changed', (event: { newSelection?: any[] }) => {
        this.captureDesignerSelection(event.newSelection?.[0] ?? null);
      });
      eventBus?.on?.('commandStack.changed', () => this.syncDesignerHistory());
    }
    return this.bpmnModeler;
  }

  private captureDesignerSelection(element: any | null): void {
    if (!element?.businessObject || element.labelTarget) {
      this.selectedDesignerElement.set(null);
      return;
    }
    const businessObject = element.businessObject;
    const bpmnType = String(businessObject.$type ?? element.type ?? '');
    const connector = bpmnType === 'bpmn:SequenceFlow';
    const json = {} as Record<StageJsonKey, string>;
    for (const key of ['assignmentConfigJson', 'automationConfigJson', 'evidenceRequirementsJson', 'formSchemaJson', 'gatewayConfigJson', 'notificationRulesJson', 'slaConfigJson'] as StageJsonKey[]) {
      json[key] = this.prettyDesignerJson(this.designerBpmnAttr(businessObject, key.replace(/Json$/, '')));
    }
    const selection: DesignerElementSelection = {
      id: String(element.id),
      kind: connector ? 'connector' : 'stage',
      bpmnType,
      name: String(businessObject.name ?? ''),
      nodeType: this.designerBpmnAttr(businessObject, 'nodeType') || this.nodeTypeFromBpmnType(bpmnType),
      taskType: this.designerBpmnAttr(businessObject, 'taskType') || (connector ? '' : 'review'),
      assignmentStrategy: this.designerBpmnAttr(businessObject, 'assignmentStrategy') || 'role',
      assigneeRoleCode: this.designerBpmnAttr(businessObject, 'assigneeRoleCode'),
      dueDays: Number(this.designerBpmnAttr(businessObject, 'dueDays') || 0),
      connectorType: this.designerBpmnAttr(businessObject, 'connectorType') || 'sequence',
      conditionExpression: this.designerBpmnAttr(businessObject, 'conditionExpression'),
      ...this.designerConnectorRule(this.designerBpmnAttr(businessObject, 'conditionJson')),
      isDefaultPath: this.designerBpmnAttr(businessObject, 'isDefaultPath') === 'true',
      json,
      formFields: this.designerFormFields(json.formSchemaJson),
    };
    this.selectedDesignerElement.set(selection);
    this.designerInspectorTab.set('properties');
    if (!connector) {
      const code = this.designerBpmnAttr(businessObject, 'code');
      const stage = this.designerRouteStages().find((candidate) => candidate.code === code);
      this.selectedDesignerStageId.set(stage?.id ?? '');
    }
  }

  private designerBpmnAttr(businessObject: any, key: string): string {
    const value = businessObject?.get?.(`dgop:${key}`) ?? businessObject?.$attrs?.[`dgop:${key}`];
    return value === undefined || value === null ? '' : String(value);
  }

  private prettyDesignerJson(value: string): string {
    if (!value) return '';
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  protected addDesignerFormField(): void {
    const selected = this.selectedDesignerElement();
    if (!selected || selected.kind !== 'stage') return;
    const nextNumber = selected.formFields.length + 1;
    this.applyDesignerFormFields([
      ...selected.formFields,
      { id: `field-${Date.now()}`, name: `field_${nextNumber}`, label: `Field ${nextNumber}`, type: 'text', required: false, options: '' },
    ]);
  }

  protected updateDesignerFormField(id: string, field: keyof Omit<DesignerFormField, 'id'>, value: string | boolean): void {
    const selected = this.selectedDesignerElement();
    if (!selected || selected.kind !== 'stage') return;
    this.applyDesignerFormFields(selected.formFields.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  protected removeDesignerFormField(id: string): void {
    const selected = this.selectedDesignerElement();
    if (!selected || selected.kind !== 'stage') return;
    this.applyDesignerFormFields(selected.formFields.filter((item) => item.id !== id));
  }

  private designerFormFields(value: string): DesignerFormField[] {
    if (!value) return [];
    try {
      const schema = JSON.parse(value) as Record<string, any>;
      const required = new Set((Array.isArray(schema['required']) ? schema['required'] : []).map(String));
      return (Array.isArray(schema['fields']) ? schema['fields'] : []).flatMap((raw: unknown, index: number) => {
        const row = typeof raw === 'string' ? { name: raw, label: raw } : raw as Record<string, unknown>;
        const name = String(row?.['name'] ?? row?.['code'] ?? row?.['field'] ?? '').trim();
        if (!name) return [];
        const options = Array.isArray(row?.['options'])
          ? row['options'].map(String).join(', ')
          : Array.isArray(row?.['allowedValues'])
            ? row['allowedValues'].map(String).join(', ')
            : '';
        return [{
          id: `form-${index}-${name}`,
          name,
          label: String(row?.['label'] ?? row?.['title'] ?? name),
          type: String(row?.['type'] ?? row?.['fieldType'] ?? 'text'),
          required: row?.['required'] === true || required.has(name),
          options,
        }];
      });
    } catch {
      return [];
    }
  }

  private applyDesignerFormFields(fields: DesignerFormField[]): void {
    const selected = this.selectedDesignerElement();
    const element = selected ? this.bpmnModeler?.get?.('elementRegistry')?.get?.(selected.id) : null;
    const modeling = this.bpmnModeler?.get?.('modeling');
    if (!selected || selected.kind !== 'stage' || !element || !modeling) return;
    const normalized = fields.map((field, index) => ({
      name: field.name.trim() || `field_${index + 1}`,
      label: field.label.trim() || field.name.trim() || `Field ${index + 1}`,
      type: field.type || 'text',
      required: field.required,
      ...(field.options.trim() ? { options: field.options.split(',').map((option) => option.trim()).filter(Boolean) } : {}),
    }));
    const formSchema = normalized.length
      ? JSON.stringify({ fields: normalized, required: normalized.filter((field) => field.required).map((field) => field.name) })
      : '';
    modeling.updateProperties(element, { 'dgop:formSchema': formSchema });
    this.captureDesignerSelection(element);
  }

  private designerConnectorRule(value: string): Pick<DesignerElementSelection, 'ruleVariable' | 'ruleOperator' | 'ruleValue' | 'ruleOutcome' | 'ruleJoin' | 'ruleVariable2' | 'ruleOperator2' | 'ruleValue2'> {
    const empty = { ruleVariable: '', ruleOperator: 'eq', ruleValue: '', ruleOutcome: '', ruleJoin: 'AND', ruleVariable2: '', ruleOperator2: 'eq', ruleValue2: '' };
    if (!value) return empty;
    try {
      const root = JSON.parse(value) as Record<string, any>;
      const table = root['dmnTable'] ?? root['decisionTable'] ?? root;
      const rule = Array.isArray(table?.rules) ? table.rules[0] ?? {} : table;
      const condition = Array.isArray(rule?.conditions) ? rule.conditions[0] ?? {} : rule;
      const condition2 = Array.isArray(rule?.conditions) ? rule.conditions[1] ?? {} : {};
      const result = rule?.result ?? rule?.then ?? rule;
      const rawValue = condition?.value ?? condition?.equals ?? '';
      return {
        ruleVariable: String(condition?.path ?? condition?.variable ?? condition?.field ?? ''),
        ruleOperator: String(condition?.operator ?? condition?.op ?? 'eq'),
        ruleValue: typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue),
        ruleOutcome: String(result?.decision ?? rule?.outcome ?? ''),
        ruleJoin: String(rule?.logicalOperator ?? rule?.match ?? 'AND').toUpperCase(),
        ruleVariable2: String(condition2?.path ?? condition2?.variable ?? condition2?.field ?? ''),
        ruleOperator2: String(condition2?.operator ?? condition2?.op ?? 'eq'),
        ruleValue2: typeof (condition2?.value ?? condition2?.equals ?? '') === 'string'
          ? String(condition2?.value ?? condition2?.equals ?? '')
          : JSON.stringify(condition2?.value ?? condition2?.equals ?? ''),
      };
    } catch {
      return empty;
    }
  }

  protected updateSelectedDesignerRule(
    field: 'ruleVariable' | 'ruleOperator' | 'ruleValue' | 'ruleOutcome' | 'ruleJoin' | 'ruleVariable2' | 'ruleOperator2' | 'ruleValue2',
    value: string,
  ): void {
    const selected = this.selectedDesignerElement();
    const element = selected ? this.bpmnModeler?.get?.('elementRegistry')?.get?.(selected.id) : null;
    const modeling = this.bpmnModeler?.get?.('modeling');
    if (!selected || selected.kind !== 'connector' || !element || !modeling) return;
    const next = { ...selected, [field]: value };
    const conditions = [
      next.ruleVariable.trim() ? { path: next.ruleVariable.trim(), operator: next.ruleOperator || 'eq', value: this.designerRuleLiteral(next.ruleValue) } : null,
      next.ruleVariable2.trim() ? { path: next.ruleVariable2.trim(), operator: next.ruleOperator2 || 'eq', value: this.designerRuleLiteral(next.ruleValue2) } : null,
    ].filter(Boolean);
    const conditionJson = conditions.length
      ? JSON.stringify({
          dmnTable: {
            hitPolicy: 'FIRST',
            rules: [{
              id: `rule-${selected.id}`,
              logicalOperator: next.ruleJoin === 'OR' ? 'OR' : 'AND',
              conditions,
              result: next.ruleOutcome.trim() ? { decision: next.ruleOutcome.trim() } : {},
            }],
          },
        })
      : '';
    try {
      modeling.updateProperties(element, { 'dgop:conditionJson': conditionJson });
      this.captureDesignerSelection(element);
    } catch (err) {
      this.toast.errorFrom(err, this.t('wf.saveError'));
    }
  }

  private designerRuleLiteral(value: string): unknown {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  private designerPropertyName(field: keyof DesignerElementSelection): string | null {
    if (field === 'name') return 'name';
    if (['taskType', 'assignmentStrategy', 'assigneeRoleCode', 'dueDays', 'connectorType', 'conditionExpression', 'isDefaultPath'].includes(field)) {
      return `dgop:${field}`;
    }
    return null;
  }

  private syncDesignerHistory(): void {
    const commandStack = this.bpmnModeler?.get?.('commandStack');
    this.designerCanUndo.set(Boolean(commandStack?.canUndo?.()));
    this.designerCanRedo.set(Boolean(commandStack?.canRedo?.()));
  }

  private bpmnTypeForNode(code: string): string {
    const types: Record<string, string> = {
      start_event: 'bpmn:StartEvent',
      end_event: 'bpmn:EndEvent',
      user_task: 'bpmn:UserTask',
      approval_task: 'bpmn:UserTask',
      decision_gateway: 'bpmn:ExclusiveGateway',
      parallel_gateway: 'bpmn:ParallelGateway',
      merge_gateway: 'bpmn:ParallelGateway',
      automated_task: 'bpmn:ServiceTask',
      timer_event: 'bpmn:IntermediateCatchEvent',
      notification_task: 'bpmn:SendTask',
      sub_workflow: 'bpmn:CallActivity',
      error_event: 'bpmn:IntermediateCatchEvent',
    };
    return types[code] ?? 'bpmn:UserTask';
  }

  private nodeTypeFromBpmnType(type: string): string {
    const types: Record<string, string> = {
      'bpmn:StartEvent': 'start_event',
      'bpmn:EndEvent': 'end_event',
      'bpmn:UserTask': 'user_task',
      'bpmn:ManualTask': 'manual_task',
      'bpmn:ServiceTask': 'automated_task',
      'bpmn:BusinessRuleTask': 'automated_task',
      'bpmn:SendTask': 'notification_task',
      'bpmn:CallActivity': 'sub_workflow',
      'bpmn:ExclusiveGateway': 'decision_gateway',
      'bpmn:ParallelGateway': 'parallel_gateway',
      'bpmn:InclusiveGateway': 'merge_gateway',
      'bpmn:IntermediateCatchEvent': 'timer_event',
    };
    return types[type] ?? 'user_task';
  }

  private nodeDefaults(code: string): { kind: string; taskType: string; assignmentStrategy: string; dueDays: string } {
    const routing = ['start_event', 'end_event', 'decision_gateway', 'parallel_gateway', 'merge_gateway', 'timer_event', 'error_event'].includes(code);
    const automated = ['automated_task', 'notification_task', 'sub_workflow'].includes(code);
    return {
      kind: code.replace(/_(event|gateway|task)$/, '') || 'review',
      taskType: code === 'approval_task' ? 'approval' : automated ? 'automation' : routing ? 'routing' : 'information',
      assignmentStrategy: automated || routing ? 'automation' : 'role',
      dueDays: automated || routing ? '0' : '2',
    };
  }

  private uniqueDesignerCode(prefix: string): string {
    const registry = this.bpmnModeler?.get?.('elementRegistry');
    const existing = new Set<string>();
    for (const element of registry?.getAll?.() ?? []) {
      const code = this.designerBpmnAttr(element.businessObject, 'code');
      if (code) existing.add(code);
    }
    let index = 1;
    let candidate = `${prefix.replace(/_(event|gateway|task)$/, '')}-${index}`;
    while (existing.has(candidate)) candidate = `${prefix.replace(/_(event|gateway|task)$/, '')}-${++index}`;
    return candidate;
  }

  private destroyBpmnModeler(): void {
    this.bpmnRenderGeneration++;
    this.bpmnImporting = null;
    this.bpmnResizeObserver?.disconnect();
    this.bpmnResizeObserver = null;
    if (this.bpmnFitFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.bpmnFitFrame);
      this.bpmnFitFrame = null;
    }
    if (this.bpmnFitRetryTimer) {
      clearTimeout(this.bpmnFitRetryTimer);
      this.bpmnFitRetryTimer = null;
    }
    this.bpmnCanvasState.set('idle');
    if (!this.bpmnModeler) {
      this.bpmnModelerContainer = null;
      return;
    }
    try {
      this.bpmnModeler.destroy();
    } catch {
      // Best effort cleanup only; a stale modeler should never block route switching.
    }
    this.bpmnModeler = null;
    this.bpmnModelerContainer = null;
    this.selectedDesignerElement.set(null);
    this.designerCanUndo.set(false);
    this.designerCanRedo.set(false);
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

  private async renderBpmn(xml: string): Promise<boolean> {
    if (!xml.trim()) {
      this.bpmnCanvasState.set('error');
      return false;
    }
    if (this.designerViewMode() !== 'technical') return true;
    const generation = ++this.bpmnRenderGeneration;
    this.bpmnCanvasState.set('loading');
    const importTask = (async (): Promise<boolean> => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        const container = await this.waitForBpmnCanvasContainer(generation);
        if (generation !== this.bpmnRenderGeneration) return false;
        if (!container) throw new Error('BPMN canvas layout timed out');
        const modeler = await this.withDeadline(
          this.ensureModeler(generation),
          8_000,
          'BPMN modeler load timed out',
        );
        if (generation !== this.bpmnRenderGeneration) return false;
        if (!modeler) throw new Error('BPMN canvas is unavailable');
        const result = await Promise.race([
          modeler.importXML(xml),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('BPMN import timed out')), 12_000);
          }),
        ]);
        if (generation !== this.bpmnRenderGeneration || modeler !== this.bpmnModeler) return false;
        this.bpmnCanvasState.set('ready');
        const canvas = modeler.get?.('canvas');
        if (canvas) this.fitDesignerCanvas(canvas);
        this.selectedDesignerElement.set(null);
        this.syncDesignerHistory();
        const warnings = result?.warnings?.length ?? 0;
        if (warnings > 0) this.toast.show(this.t('wf.designer.importWarnings'), 'info');
        return true;
      } catch (error) {
        if (generation === this.bpmnRenderGeneration) {
          this.destroyBpmnModeler();
          this.bpmnCanvasState.set('error');
          const message = error instanceof Error ? error.message : '';
          this.toast.error(this.t(
            message.includes('canvas') || message.includes('timed out')
              ? 'wf.designer.canvasError'
              : 'wf.designer.invalidXml',
          ));
        }
        return false;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    })();
    this.bpmnImporting = importTask;
    try {
      return await importTask;
    } finally {
      if (this.bpmnImporting === importTask) this.bpmnImporting = null;
    }
  }

  private async currentBpmnXml(): Promise<string> {
    if (this.designerViewMode() !== 'technical') return this.designer()?.bpmnXml ?? '';
    const importInFlight = this.bpmnImporting;
    if (importInFlight) await importInFlight;
    if (this.bpmnCanvasState() !== 'ready') return this.designer()?.bpmnXml ?? '';
    const modeler = await this.withDeadline(
      this.ensureModeler(),
      8_000,
      'BPMN modeler load timed out',
    );
    if (!modeler) return this.designer()?.bpmnXml ?? '';
    const result = await this.withDeadline<{ xml: string }>(
      modeler.saveXML({ format: true }) as Promise<{ xml: string }>,
      8_000,
      'BPMN export timed out',
    );
    return this.normalizeDesignerExtensionAttributes(result.xml);
  }

  private async waitForBpmnCanvasContainer(generation: number, timeoutMs = 3_000): Promise<HTMLElement | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (generation !== this.bpmnRenderGeneration || this.designerViewMode() !== 'technical') return null;
      const container = this.bpmnCanvas?.nativeElement;
      if (this.isBpmnCanvasMeasurable(container)) return container;
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    }
    return null;
  }

  private isBpmnCanvasMeasurable(container?: HTMLElement | null): container is HTMLElement {
    if (!container?.isConnected) return false;
    const rect = container.getBoundingClientRect();
    return Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width >= 120 && rect.height >= 240;
  }

  private async withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private normalizeDesignerExtensionAttributes(xml: string): string {
    return xml.replace(/(\sdgop:[\w.-]+=")([^"]*)(")/gi, (_match, prefix: string, value: string, suffix: string) => {
      // bpmn-js preserves unknown extension attributes, but escapes their existing
      // XML entities once more when exporting. Remove only that added layer.
      const normalized = value.replace(
        /&amp;((?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);)/gi,
        '&$1',
      );
      return `${prefix}${normalized}${suffix}`;
    });
  }

  private fitDesignerCanvas(canvas: any, attempt = 0): void {
    const fit = (): void => {
      this.bpmnFitFrame = null;
      const container = this.bpmnCanvas?.nativeElement;
      if (!this.isBpmnCanvasMeasurable(container) || canvas !== this.bpmnModeler?.get?.('canvas')) {
        this.retryDesignerFit(canvas, attempt);
        return;
      }
      try {
        canvas.resized?.();
        const viewbox = canvas.viewbox?.();
        const innerWidth = Number(viewbox?.inner?.width ?? 0);
        const innerHeight = Number(viewbox?.inner?.height ?? 0);
        const outerWidth = Number(viewbox?.outer?.width ?? container.clientWidth);
        const outerHeight = Number(viewbox?.outer?.height ?? container.clientHeight);
        if (
          !Number.isFinite(innerWidth) || !Number.isFinite(innerHeight) ||
          !Number.isFinite(outerWidth) || !Number.isFinite(outerHeight) ||
          innerWidth <= 0 || innerHeight <= 0 || outerWidth <= 0 || outerHeight <= 0
        ) {
          this.retryDesignerFit(canvas, attempt);
          return;
        }
        const clearanceFactor = container.clientWidth < 1200 ? 0.8 : 0.88;
        const fittedZoom = Math.min(outerWidth / innerWidth, outerHeight / innerHeight) * clearanceFactor;
        if (!Number.isFinite(fittedZoom) || fittedZoom <= 0) {
          this.retryDesignerFit(canvas, attempt);
          return;
        }
        canvas.zoom?.(Math.min(2.5, Math.max(0.2, fittedZoom)), 'auto');
        if (container.clientWidth > 760) {
          const direction = typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? -1 : 1;
          canvas.scroll?.({ dx: 36 * direction, dy: 0 });
        }
      } catch {
        this.retryDesignerFit(canvas, attempt);
      }
    };
    if (typeof requestAnimationFrame === 'undefined') {
      fit();
      return;
    }
    if (this.bpmnFitFrame !== null) cancelAnimationFrame(this.bpmnFitFrame);
    this.bpmnFitFrame = requestAnimationFrame(fit);
  }

  private retryDesignerFit(canvas: any, attempt: number): void {
    if (attempt >= 12 || this.designerViewMode() !== 'technical' || canvas !== this.bpmnModeler?.get?.('canvas')) return;
    if (this.bpmnFitRetryTimer) clearTimeout(this.bpmnFitRetryTimer);
    this.bpmnFitRetryTimer = setTimeout(() => {
      this.bpmnFitRetryTimer = null;
      this.fitDesignerCanvas(canvas, attempt + 1);
    }, Math.min(240, 40 + attempt * 20));
  }

  private beginDesignerTestActivity(): void {
    this.finishDesignerTestActivity();
    this.designerTestRunning.set(true);
    this.designerTestElapsedSeconds.set(0);
    const startedAt = Date.now();
    this.designerTestElapsedTimer = setInterval(() => {
      this.designerTestElapsedSeconds.set(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
  }

  private finishDesignerTestActivity(): void {
    this.designerTestSubscription?.unsubscribe();
    this.designerTestSubscription = null;
    if (this.designerTestElapsedTimer) {
      clearInterval(this.designerTestElapsedTimer);
      this.designerTestElapsedTimer = null;
    }
    this.designerTestRunning.set(false);
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

  private async reviewDesigner(mode: 'submit-review' | 'approve-review'): Promise<void> {
    const template = this.designer()?.template;
    if (!template || this.designerSaving()) return;
    this.designerSaving.set(true);
    try {
      const body: Record<string, unknown> = {
        comment: this.designerSummary() || null,
      };
      if (mode === 'submit-review') body['bpmnXml'] = await this.currentBpmnXml();
      this.http.post<WorkflowDesignerResponse>(
        `/api/workflow/templates/${template.id}/designer/${mode}`,
        body,
      ).subscribe({
        next: (res) => {
          this.designer.set(res);
          this.bpmnImportText.set(res.bpmnXml);
          this.designerSimulation.set(null);
          this.designerMigration.set(null);
          this.designerDiff.set(null);
          this.designerSummary.set('');
          this.designerSaving.set(false);
          this.toast.success(
            mode === 'submit-review'
              ? this.t('wf.designer.reviewSubmitted')
              : this.t('wf.designer.reviewApproved'),
          );
          this.loadDesignerVersions(template.id);
          this.refreshDesignerPreviews();
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
    templates = this.sortedWorkflowTemplates(templates);
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

  private sortedWorkflowTemplates(templates: WorkflowTemplate[]): WorkflowTemplate[] {
    return [...templates].sort((a, b) => {
      const familyDelta = this.routeFamily(a.caseType).order - this.routeFamily(b.caseType).order;
      if (familyDelta !== 0) return familyDelta;
      const typeDelta = this.routeTypeRank(a.caseType) - this.routeTypeRank(b.caseType);
      if (typeDelta !== 0) return typeDelta;
      const systemDelta = Number(Boolean(b.isSystem)) - Number(Boolean(a.isSystem));
      if (systemDelta !== 0) return systemDelta;
      return this.templateName(a).localeCompare(this.templateName(b), this.i18n.lang());
    });
  }

  private routeFamily(caseType: string): RouteFamilyMeta {
    return WORKFLOW_ROUTE_FAMILY_BY_TYPE.get(caseType) ?? ROUTE_FAMILY_OTHER;
  }

  private routeTypeRank(caseType: string): number {
    return WORKFLOW_ROUTE_TYPE_RANK.get(caseType) ?? 999;
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
