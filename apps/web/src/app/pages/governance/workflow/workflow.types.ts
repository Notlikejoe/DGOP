import { StatusKind } from '../../../shared/status-chip';

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Ref { id: string; code?: string; nameEn: string; nameAr: string; }
export interface UserRef { id: string; email: string; displayName: string; }
export interface TaskCaseRef { id: string; code: string; title: string; type: string; status: string; }
export type WorkflowDecisionValue = 'approved' | 'rejected' | 'return_for_clarification';

export interface Task {
  id: string;
  caseId: string;
  title: string;
  type: string;
  status: string;
  templateStageId?: string | null;
  assigneeUserId?: string | null;
  assigneeRoleCode?: string | null;
  dueDate?: string | null;
  decision?: string | null;
  decisionComment?: string | null;
  formDataJson?: Record<string, unknown> | null;
  formSubmittedAt?: string | null;
  formSubmittedBy?: string | null;
  completedAt?: string | null;
  slaStatus: string;
  assignee?: UserRef | null;
  case?: TaskCaseRef | null;
  templateStage?: WorkflowTemplateStage | null;
}

export interface CaseEvent {
  id: string;
  action: string;
  actor: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  comment?: string | null;
  createdAt: string;
}

export interface CaseRow {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  type: string;
  status: string;
  templateId?: string | null;
  template?: { id: string; code: string; caseType: string; nameEn: string; nameAr: string } | null;
  assetId?: string | null;
  asset?: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    domain?: Ref | null;
  } | null;
  assignment?: {
    id: string;
    approvalStatus: string;
    roleType: { nameEn: string; nameAr: string };
    person: { fullNameEn: string; fullNameAr: string };
  } | null;
  openTasks?: number;
  tasks: Task[];
  events?: CaseEvent[];
}

export interface WorkflowTemplateStage {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  kind: string;
  nodeType?: string | null;
  taskType: string;
  assignmentStrategy?: string | null;
  assignmentConfigJson?: unknown | null;
  assigneeRoleCode?: string | null;
  dueDays: number;
  formSchemaJson?: unknown | null;
  slaConfigJson?: unknown | null;
  notificationRulesJson?: unknown | null;
  evidenceRequirementsJson?: unknown | null;
  automationConfigJson?: unknown | null;
  gatewayConfigJson?: unknown | null;
  parallelGroup?: string | null;
  sortOrder: number;
  isStart: boolean;
  isDecision: boolean;
  isFinal: boolean;
  isActive: boolean;
}

export interface WorkflowTemplateTransition {
  id: string;
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string;
  connectorType?: string | null;
  decision?: string | null;
  conditionExpression?: string | null;
  conditionJson?: unknown | null;
  isHappyPath: boolean;
}

export interface WorkflowTemplate {
  id: string;
  code: string;
  caseType: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  trigger: string;
  domain?: Ref | null;
  defaultSlaDays: number;
  designerVersion?: number;
  designerJson?: Record<string, unknown> | null;
  lastPublishedAt?: string | null;
  lastPublishedBy?: string | null;
  isSystem?: boolean;
  isActive?: boolean;
  stages: WorkflowTemplateStage[];
  transitions: WorkflowTemplateTransition[];
  _count?: { cases: number; stages: number };
}

export interface WorkflowGraphNode {
  id: string;
  type: 'template' | 'stage' | 'domain' | 'case';
  refId?: string | null;
  labelEn: string;
  labelAr: string;
  sublabelEn?: string | null;
  sublabelAr?: string | null;
  status?: string | null;
  count?: number | null;
  x: number;
  y: number;
}

export interface WorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  labelEn: string;
  labelAr: string;
  tone?: string | null;
}

export interface WorkflowGraph {
  summary: {
    templates: number;
    stages: number;
    activeCases: number;
    overdueTasks: number;
    domainsCovered: number;
  };
  templates: WorkflowTemplate[];
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowNodeDefinition {
  code: string;
  label: string;
  category: string;
  priority: 'core' | 'advanced';
  description: string;
  configuration: string[];
  aliases?: string[];
}

export interface WorkflowConnectorType {
  code: string;
  label: string;
  priority: 'core' | 'advanced';
  outcomes: string[];
  description?: string;
  allowedOutcomes?: string[];
}

export interface WorkflowVariableDefinition {
  id?: string;
  templateId?: string | null;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  description?: string | null;
  variableType: 'text' | 'number' | 'boolean' | 'date' | 'user' | 'role' | 'list';
  scope: string;
  source: string;
  required?: boolean;
  isRequired?: boolean;
  defaultValueJson?: unknown;
  allowedValuesJson?: unknown;
}

export interface WorkflowAuditEventDefinition {
  action: string;
  entityType: string;
  metadata: string[];
}

export interface WorkflowCanvasMvpGate {
  status: 'ready' | 'watch' | 'blocked';
  summary: {
    templatesChecked: number;
    ready: number;
    watch: number;
    blocked: number;
    coreNodesRegistered: number;
    requiredCoreNodes: number;
    publishEvidenceReady: boolean;
  };
  criteria: Array<{
    code: string;
    label: string;
    trace: string;
    priority: 'core' | 'advanced';
    status: 'pass' | 'warning' | 'fail';
  }>;
  nodePalette: WorkflowNodeDefinition[];
  connectorTypes: WorkflowConnectorType[];
}

export interface WorkflowConfiguration {
  status: string;
  generatedAt: string;
  summary: {
    templates: number;
    caseTypes: number;
    activeRoutes: number;
    totalCases: number;
    activeCases: number;
    activeTasks: number;
    overdueTasks: number;
    unassignedTasks: number;
    notificationRules: number;
    escalationTemplates: number;
    designerTestRuns?: number;
    automatedExecutionEvents?: number;
    workflowMvpReady?: boolean;
    workflowMvpBlocked?: number;
  };
  caseTypeRegistry: Array<{
    caseType: string;
    templateCount: number;
    routeCodes: string[];
    stageCount: number;
    defaultSlaDays: number | null;
    hasDecisionPoint: boolean;
    hasClosurePoint: boolean;
    hasActiveRoute: boolean;
    status: string;
  }>;
  universalCaseManagement: {
    controls: Array<{ code: string; status: string; evidence: string }>;
    pageContracts: Array<{ route: string; api: string; roleAction: string }>;
  };
  workflowCanvasMvp?: WorkflowCanvasMvpGate;
  nodePalette?: WorkflowNodeDefinition[];
  connectorTypes?: WorkflowConnectorType[];
  variableRegistry?: WorkflowVariableDefinition[];
  auditEventCatalog?: WorkflowAuditEventDefinition[];
  acceptanceCriteria?: Array<{ code: string; label: string; trace: string; priority: 'core' | 'advanced' }>;
  designerLifecycle?: Record<string, unknown>;
  productionPilotGuardrails?: Record<string, unknown>;
  testIsolation?: {
    status: string;
    testRuns: number;
    productionTablesTouched: boolean;
    evidence: string;
  };
}

export interface WorkflowTokenTrace {
  caseId: string;
  tokens: Array<{
    id: string;
    instanceKey: string;
    state: string;
    tokenType: string;
    parentTokenId?: string | null;
    rootTokenId?: string | null;
    branchKey?: string | null;
    branchIndex?: number | null;
    joinKey?: string | null;
    sourceTransitionId?: string | null;
    parallelGroup?: string | null;
    stage?: {
      id: string;
      code: string;
      nameEn: string;
      nodeType?: string | null;
      isDecision: boolean;
      isFinal: boolean;
    } | null;
    task?: {
      id: string;
      title: string;
      status: string;
      decision?: string | null;
      completedAt?: string | null;
    } | null;
    dataJson?: Record<string, unknown> | null;
    activatedAt: string;
    completedAt?: string | null;
    parentStageCode?: string | null;
  }>;
  lineage: Array<{
    id: string;
    parentTokenId?: string | null;
    rootTokenId: string;
    branchKey?: string | null;
    joinKey?: string | null;
    state: string;
  }>;
  executions?: Array<{
    id: string;
    taskId: string;
    executionKind: string;
    status: string;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt?: string | null;
    outcome?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
  }>;
}

export interface WorkflowDashboard {
  generatedAt: string;
  refreshSeconds: number;
  summary: {
    activeCases: number;
    openTasks: number;
    overdueTasks: number;
    routesSampled: number;
    avgCompletionHours: number;
    slaComplianceRate: number;
  };
  bottlenecks: Array<{
    stage: string;
    route: string;
    open: number;
    overdue: number;
    avgOverdueHours: number;
  }>;
  workload: Array<{
    assignee: string;
    roleCode?: string | null;
    open: number;
    overdue: number;
  }>;
  trend: Array<{ date: string; created: number; completed: number }>;
}

export interface WorkflowRoutePreview {
  caseType: string;
  domainId?: string | null;
  template: WorkflowTemplate;
  stages: WorkflowTemplateStage[];
  transitions: WorkflowTemplateTransition[];
  warnings: string[];
}

export interface WorkflowBpmnValidation {
  status: 'ready' | 'warning' | 'blocked';
  errors: string[];
  warnings: string[];
  stageCount: number;
  transitionCount: number;
  readinessScore: number;
  checklist: Array<{
    code: string;
    label: string;
    status: 'pass' | 'warning' | 'fail';
    detail: string;
  }>;
}

export interface WorkflowDesignerEnterprise {
  readinessScore: number;
  checklist: WorkflowBpmnValidation['checklist'];
  coverage: {
    forms: number;
    evidence: number;
    notifications: number;
    automation: number;
    roleAssignments: number;
  };
  rulePacks: Array<{
    code: string;
    nameEn: string;
    nodeType: string;
    assignmentStrategy: string;
    assigneeRoleCode?: string | null;
    hasForm: boolean;
    hasEvidence: boolean;
    hasNotifications: boolean;
    hasAutomation: boolean;
    dueDays: number;
    isDecision: boolean;
    isFinal: boolean;
  }>;
  nodePalette?: WorkflowNodeDefinition[];
  connectorTypes?: WorkflowConnectorType[];
  endOutcomes?: string[];
  designerLifecycle?: Record<string, unknown>;
}

export interface WorkflowTemplateVersionsResponse {
  templateId: string;
  versions: Array<{
    id: string;
    version: number;
    source: string;
    changeSummary?: string | null;
    modelSignature?: string | null;
    signatureAlgorithm?: string | null;
    securityJson?: Record<string, unknown> | null;
    signatureVerified: boolean;
    createdBy: string;
    createdAt: string;
  }>;
}

export interface WorkflowVersionDiff {
  templateId: string;
  fromVersion: number;
  toVersion: number;
  diff: {
    summary: {
      addedStages: number;
      removedStages: number;
      changedStages: number;
      addedTransitions: number;
      removedTransitions: number;
    };
    stages: { added: string[]; removed: string[]; changed: string[] };
    transitions: { added: string[]; removed: string[] };
  };
  security: {
    modelSignature?: string | null;
    signatureAlgorithm?: string | null;
    signedAt: string;
  };
}

export interface WorkflowDesignerResponse {
  template: WorkflowTemplate;
  bpmnXml: string;
  validation: WorkflowBpmnValidation;
  designerJson?: Record<string, unknown> | null;
  version: {
    current: number;
    lastPublishedAt?: string | null;
    lastPublishedBy?: string | null;
  };
  security?: {
    modelSignature?: string | null;
    signatureAlgorithm?: string | null;
    securityJson?: Record<string, unknown> | null;
  };
  enterprise?: WorkflowDesignerEnterprise;
}

export interface WorkflowDesignerSimulation {
  status: 'ready' | 'warning' | 'blocked';
  summary: {
    taskCount: number;
    decisionPoints: number;
    estimatedSlaDays: number;
    evidenceItems: number;
    notificationRules: number;
    automationSteps: number;
  };
  path: Array<{
    code: string;
    nameEn: string;
    taskType: string;
    nodeType: string;
    assigneeRoleCode?: string | null;
    dueDays: number;
    isDecision: boolean;
    isFinal: boolean;
    chosenDecision?: string | null;
    branchOptions: string[];
  }>;
  blockers: string[];
  warnings: string[];
}

export interface WorkflowDesignerTestRun {
  id: string;
  templateId: string;
  runNumber: number;
  environment: string;
  status: 'ready' | 'warning' | 'blocked' | 'reset';
  validation: WorkflowBpmnValidation | Record<string, unknown>;
  input: Record<string, unknown>;
  simulation: WorkflowDesignerSimulation | Record<string, unknown>;
  executedPath: {
    path?: WorkflowDesignerSimulation['path'];
    blockers?: string[];
    warnings?: string[];
    summary?: WorkflowDesignerSimulation['summary'];
  } | Record<string, unknown>;
  isolation: {
    mode: string;
    productionCasesCreated: number;
    productionTasksCreated: number;
    productionRuntimeTokensCreated: number;
  };
  resetAt?: string | null;
  resetBy?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowOperationsReport {
  generatedAt: string;
  period: { days: number; start: string; end: string };
  filters: Record<string, string | null>;
  sample: { limit: number; returnedCases: number; truncated: boolean };
  summary: {
    initiatedWorkflows: number;
    completedWorkflows: number;
    activeWorkflows: number;
    failedWorkflows: number;
    openTasks: number;
    overdueTasks: number;
    averageWorkflowCompletionHours: number;
    averageTaskCompletionHours: number;
    slaCompliancePercentage: number;
  };
  volumeByStatus: Array<{ key: string; count: number }>;
  volumeByType: Array<{ key: string; count: number }>;
  volumeByWorkflow: Array<{ key: string; count: number }>;
  volumeByOrgUnit: Array<{ key: string; count: number }>;
  stagePerformance: Array<{
    stage: string;
    workflow: string;
    open: number;
    overdue: number;
    completed: number;
    averageCompletionHours: number;
    slaCompliancePercentage: number;
  }>;
  acceptanceEvidence: {
    criterion: string;
    trace: string;
    filtersSupported: string[];
    scoped: boolean;
  };
}

export interface WorkflowMigrationPreview {
  risk: 'safe' | 'caution' | 'blocked';
  validation: WorkflowBpmnValidation;
  summary: {
    activeCases: number;
    manualReviewCases: number;
    addedStages: number;
    retiredStages: number;
    addedTransitions: number;
    retiredTransitions: number;
  };
  stageChanges: { added: string[]; retired: string[] };
  transitionChanges: { added: string[]; retired: string[] };
  caseActions: Array<{
    id: string;
    code: string;
    title: string;
    status: string;
    openTasks: number;
    activeStageCodes: string[];
    action: 'continue' | 'manual_review';
    reason: string;
  }>;
}

export const SLA_KIND: Record<string, StatusKind> = {
  on_track: 'success',
  at_risk: 'warning',
  overdue: 'danger',
  done: 'muted',
  none: 'muted',
};

export const CASE_STATUS_KIND: Record<string, StatusKind> = {
  draft: 'muted',
  submitted: 'info',
  under_review: 'info',
  awaiting_information: 'warning',
  decision_made: 'info',
  approved: 'success',
  implemented: 'success',
  suspended: 'warning',
  cancelled: 'muted',
  failed: 'danger',
  rejected: 'danger',
  closed: 'muted',
};

export const APPROVAL_KIND: Record<string, StatusKind> = {
  draft: 'muted',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};
