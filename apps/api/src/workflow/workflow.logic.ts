export type WorkflowStageSeed = {
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string;
  kind: string;
  nodeType?: string;
  taskType: string;
  assignmentStrategy?: string;
  assignmentConfigJson?: unknown;
  assigneeRoleCode?: string;
  dueDays: number;
  formSchemaJson?: unknown;
  slaConfigJson?: unknown;
  notificationRulesJson?: unknown;
  evidenceRequirementsJson?: unknown;
  automationConfigJson?: unknown;
  gatewayConfigJson?: unknown;
  parallelGroup?: string;
  isStart?: boolean;
  isDecision?: boolean;
  isFinal?: boolean;
};

export type WorkflowTransitionSeed = {
  from: string;
  to: string;
  labelEn: string;
  labelAr: string;
  connectorType?: string;
  decision?: string;
  isDefaultPath?: boolean;
  isHappyPath?: boolean;
};

export type WorkflowTemplateSeed = {
  code: string;
  caseType: string;
  trigger: string;
  nameEn: string;
  nameAr: string;
  description: string;
  defaultSlaDays: number;
  stages: WorkflowStageSeed[];
  transitions: WorkflowTransitionSeed[];
};

export type WorkflowRouteInput = {
  caseType?: string | null;
  domainId?: string | null;
  templateId?: string | null;
};

export type WorkflowRouteCandidate = {
  id: string;
  code: string;
  caseType: string;
  domainId?: string | null;
  isActive: boolean;
};

export type WorkflowStageRouteNode = {
  id: string;
  sortOrder: number;
  dueDays: number;
  isStart: boolean;
  isFinal: boolean;
  isActive: boolean;
  nodeType?: string | null;
  taskType?: string | null;
  kind?: string | null;
  assignmentStrategy?: string | null;
  assignmentConfigJson?: unknown | null;
  assigneeRoleCode?: string | null;
};

export type WorkflowTransitionRouteEdge = {
  id?: string;
  fromStageId: string;
  toStageId: string;
  connectorType?: string | null;
  decision?: string | null;
  conditionExpression?: string | null;
  conditionJson?: unknown | null;
  isDefaultPath?: boolean | null;
  isHappyPath: boolean;
  sortOrder: number;
  toStage?: { id: string; code?: string | null } | null;
};

export type WorkflowConfigurationStatus = 'ready' | 'watch' | 'blocked';

export type WorkflowConfigurationTemplate = {
  id: string;
  code: string;
  caseType: string;
  nameEn: string;
  nameAr: string;
  trigger: string;
  defaultSlaDays: number;
  isSystem: boolean;
  isActive: boolean;
  domainId?: string | null;
  stages: Array<{
    id: string;
    code: string;
    kind: string;
    nodeType?: string | null;
    taskType: string;
    assigneeRoleCode?: string | null;
    dueDays: number;
    sortOrder: number;
    isStart: boolean;
    isDecision: boolean;
    isFinal: boolean;
    isActive: boolean;
  }>;
  transitions: Array<{
    id?: string;
    fromStageId: string;
    toStageId: string;
    decision?: string | null;
    isHappyPath: boolean;
  }>;
  _count?: { cases?: number; stages?: number };
};

export type WorkflowCaseTypeRegistryItem = {
  caseType: string;
  templateCount: number;
  routeCodes: string[];
  stageCount: number;
  defaultSlaDays: number | null;
  hasDecisionPoint: boolean;
  hasClosurePoint: boolean;
  hasActiveRoute: boolean;
  status: WorkflowConfigurationStatus;
};

export type WorkflowDmnDecisionResult = {
  matched: boolean;
  ruleId: string | null;
  decision: string | null;
  targetStageCode: string | null;
  trace: string[];
};

export type WorkflowFormValidationResult = {
  valid: boolean;
  missing: string[];
  errors: string[];
};

export const WORKFLOW_RETURN_FOR_CLARIFICATION = 'return_for_clarification' as const;
export type WorkflowDecisionValue = 'approved' | 'rejected' | typeof WORKFLOW_RETURN_FOR_CLARIFICATION;

export type WorkflowNodePriority = 'core' | 'advanced';
export type WorkflowNodeCategory = 'event' | 'human' | 'gateway' | 'automation' | 'resilience';

export type WorkflowNodeTypeDefinition = {
  code: string;
  volume2Name: string;
  category: WorkflowNodeCategory;
  priority: WorkflowNodePriority;
  defaultTaskType: string;
  defaultKind: string;
  runtimeBehavior: 'entry' | 'completion' | 'task' | 'approval' | 'route' | 'split' | 'merge' | 'automated' | 'timer' | 'notification' | 'sub_workflow' | 'error';
  acceptanceCriteria: string[];
  aliases: string[];
  requiresAssignee: boolean;
  requiresConfiguration: boolean;
};

export const WORKFLOW_NODE_TYPES: WorkflowNodeTypeDefinition[] = [
  {
    code: 'start_event',
    volume2Name: 'Start Node',
    category: 'event',
    priority: 'core',
    defaultTaskType: 'routing',
    defaultKind: 'start',
    runtimeBehavior: 'entry',
    acceptanceCriteria: ['AC-WF-01', 'AC-WF-02', 'AC-WF-09', 'AC-WF-12'],
    aliases: ['start', 'start_node', 'start_event'],
    requiresAssignee: false,
    requiresConfiguration: false,
  },
  {
    code: 'end_event',
    volume2Name: 'End Node',
    category: 'event',
    priority: 'core',
    defaultTaskType: 'routing',
    defaultKind: 'end',
    runtimeBehavior: 'completion',
    acceptanceCriteria: ['AC-WF-03', 'AC-WF-09', 'AC-WF-15', 'AC-WF-17'],
    aliases: ['end', 'end_node', 'end_event'],
    requiresAssignee: false,
    requiresConfiguration: true,
  },
  {
    code: 'user_task',
    volume2Name: 'User Task',
    category: 'human',
    priority: 'core',
    defaultTaskType: 'information',
    defaultKind: 'review',
    runtimeBehavior: 'task',
    acceptanceCriteria: ['AC-WF-04', 'AC-WF-05', 'AC-WF-13', 'AC-WF-16'],
    aliases: ['user', 'user_task', 'manual_task', 'manualtask', 'usertask'],
    requiresAssignee: true,
    requiresConfiguration: false,
  },
  {
    code: 'approval_task',
    volume2Name: 'Approval Task',
    category: 'human',
    priority: 'core',
    defaultTaskType: 'approval',
    defaultKind: 'approval',
    runtimeBehavior: 'approval',
    acceptanceCriteria: ['AC-WF-04', 'AC-WF-06', 'AC-WF-13', 'AC-WF-16'],
    aliases: ['approval', 'approval_task', 'approvaltask'],
    requiresAssignee: true,
    requiresConfiguration: true,
  },
  {
    code: 'decision_gateway',
    volume2Name: 'Decision Gateway',
    category: 'gateway',
    priority: 'core',
    defaultTaskType: 'routing',
    defaultKind: 'gateway',
    runtimeBehavior: 'route',
    acceptanceCriteria: ['AC-WF-03', 'AC-WF-06', 'AC-WF-09', 'AC-WF-15'],
    aliases: ['decision', 'decision_gateway', 'exclusive_gateway', 'exclusivegateway'],
    requiresAssignee: false,
    requiresConfiguration: true,
  },
  {
    code: 'parallel_gateway',
    volume2Name: 'Parallel Gateway',
    category: 'gateway',
    priority: 'core',
    defaultTaskType: 'routing',
    defaultKind: 'gateway',
    runtimeBehavior: 'split',
    acceptanceCriteria: ['AC-WF-03', 'AC-WF-07', 'AC-WF-09', 'AC-WF-15'],
    aliases: ['parallel', 'parallel_gateway', 'parallelgateway'],
    requiresAssignee: false,
    requiresConfiguration: true,
  },
  {
    code: 'merge_gateway',
    volume2Name: 'Merge Gateway',
    category: 'gateway',
    priority: 'core',
    defaultTaskType: 'routing',
    defaultKind: 'gateway',
    runtimeBehavior: 'merge',
    acceptanceCriteria: ['AC-WF-03', 'AC-WF-07', 'AC-WF-09', 'AC-WF-15'],
    aliases: ['merge', 'merge_gateway', 'inclusive_gateway', 'inclusivegateway'],
    requiresAssignee: false,
    requiresConfiguration: true,
  },
  {
    code: 'automated_task',
    volume2Name: 'Automated Task',
    category: 'automation',
    priority: 'advanced',
    defaultTaskType: 'automation',
    defaultKind: 'automation',
    runtimeBehavior: 'automated',
    acceptanceCriteria: ['AC-WF-14', 'AC-WF-16'],
    aliases: ['automated', 'automated_task', 'service_task', 'servicetask', 'business_rule_task', 'script_task'],
    requiresAssignee: false,
    requiresConfiguration: true,
  },
  {
    code: 'timer_event',
    volume2Name: 'Timer Node',
    category: 'automation',
    priority: 'advanced',
    defaultTaskType: 'routing',
    defaultKind: 'timer',
    runtimeBehavior: 'timer',
    acceptanceCriteria: ['AC-WF-08', 'AC-WF-15', 'AC-WF-16'],
    aliases: ['timer', 'timer_node', 'timer_event', 'event_based_gateway'],
    requiresAssignee: false,
    requiresConfiguration: true,
  },
  {
    code: 'notification_task',
    volume2Name: 'Notification Node',
    category: 'automation',
    priority: 'advanced',
    defaultTaskType: 'automation',
    defaultKind: 'notification',
    runtimeBehavior: 'notification',
    acceptanceCriteria: ['AC-WF-08', 'AC-WF-14', 'AC-WF-16'],
    aliases: ['notification', 'notification_node', 'notification_task', 'send_task', 'sendtask'],
    requiresAssignee: false,
    requiresConfiguration: true,
  },
  {
    code: 'sub_workflow',
    volume2Name: 'Sub-Workflow Node',
    category: 'automation',
    priority: 'advanced',
    defaultTaskType: 'automation',
    defaultKind: 'sub_workflow',
    runtimeBehavior: 'sub_workflow',
    acceptanceCriteria: ['AC-WF-11', 'AC-WF-12', 'AC-WF-16'],
    aliases: ['sub_workflow', 'sub_workflow_node', 'sub_process', 'subprocess', 'call_activity', 'callactivity'],
    requiresAssignee: false,
    requiresConfiguration: true,
  },
  {
    code: 'error_event',
    volume2Name: 'Error Node',
    category: 'resilience',
    priority: 'advanced',
    defaultTaskType: 'routing',
    defaultKind: 'error',
    runtimeBehavior: 'error',
    acceptanceCriteria: ['AC-WF-14', 'AC-WF-15', 'AC-WF-16'],
    aliases: ['error', 'error_node', 'error_event'],
    requiresAssignee: false,
    requiresConfiguration: true,
  },
];

export const WORKFLOW_CORE_NODE_CODES = [
  'start_event',
  'end_event',
  'user_task',
  'approval_task',
  'decision_gateway',
  'parallel_gateway',
  'merge_gateway',
] as const;

export const WORKFLOW_CONNECTOR_TYPES = [
  { code: 'sequence', label: 'Sequence connector', priority: 'core', outcomes: ['next'] },
  { code: 'conditional', label: 'Conditional connector', priority: 'core', outcomes: ['yes', 'no', 'named_outcome'] },
  { code: 'default', label: 'Default connector', priority: 'core', outcomes: ['otherwise'] },
  { code: 'approval', label: 'Approval connector', priority: 'core', outcomes: ['approved', 'rejected', WORKFLOW_RETURN_FOR_CLARIFICATION] },
  { code: 'return', label: 'Return connector', priority: 'core', outcomes: [WORKFLOW_RETURN_FOR_CLARIFICATION, 'returned', 'clarification'] },
  { code: 'parallel_split', label: 'Parallel split connector', priority: 'core', outcomes: ['all_branches'] },
  { code: 'merge_join', label: 'Merge join connector', priority: 'core', outcomes: ['all_incoming_complete'] },
  { code: 'success', label: 'Automation success connector', priority: 'advanced', outcomes: ['success'] },
  { code: 'failure', label: 'Automation failure connector', priority: 'advanced', outcomes: ['failure'] },
  { code: 'timeout', label: 'Timer timeout connector', priority: 'advanced', outcomes: ['timeout', 'sla_expired'] },
];

export const WORKFLOW_END_OUTCOMES = ['completed', 'rejected', 'cancelled', 'failed'] as const;
export const WORKFLOW_VARIABLE_TYPES = ['text', 'number', 'boolean', 'date', 'user', 'role', 'list'] as const;

export const WORKFLOW_DEFAULT_VARIABLES = [
  { code: 'case.id', nameEn: 'Workflow case id', variableType: 'text', scope: 'case', source: 'system', required: true },
  { code: 'case.status', nameEn: 'Workflow case status', variableType: 'text', scope: 'case', source: 'system', required: true },
  { code: 'identity.verified', nameEn: 'Identity verification result', variableType: 'boolean', scope: 'case', source: 'system', required: false },
  { code: 'incident.confirmed', nameEn: 'Incident confirmation result', variableType: 'boolean', scope: 'case', source: 'system', required: false },
  { code: 'case.type', nameEn: 'Workflow case type', variableType: 'text', scope: 'case', source: 'system', required: true },
  { code: 'asset.id', nameEn: 'Linked asset id', variableType: 'text', scope: 'asset', source: 'system', required: false },
  { code: 'asset.type', nameEn: 'Asset type', variableType: 'text', scope: 'asset', source: 'system', required: false },
  { code: 'task.decision', nameEn: 'Task decision', variableType: 'text', scope: 'task', source: 'runtime', required: false },
  { code: 'stage.code', nameEn: 'Stage code', variableType: 'text', scope: 'task', source: 'system', required: true },
  { code: 'stage.kind', nameEn: 'Stage kind', variableType: 'text', scope: 'task', source: 'system', required: false },
  { code: 'actor.user', nameEn: 'Actor user', variableType: 'user', scope: 'actor', source: 'runtime', required: false },
  { code: 'actor.roles', nameEn: 'Actor roles', variableType: 'list', scope: 'actor', source: 'runtime', required: false },
  { code: 'task.formRequiredComplete', nameEn: 'Required form complete', variableType: 'boolean', scope: 'task', source: 'runtime', required: false },
  { code: 'task.slaDueDate', nameEn: 'Task SLA due date', variableType: 'date', scope: 'task', source: 'system', required: false },
] as const;

export const WORKFLOW_ACCEPTANCE_CRITERIA = [
  ['AC-WF-01', 'Create a new workflow', 'Volume 2 section 23.2', 'core'],
  ['AC-WF-02', 'Add nodes through drag-and-drop', 'Volume 2 sections 23.2 and 23.3', 'core'],
  ['AC-WF-03', 'Connect and configure nodes', 'Volume 2 section 23.3', 'core'],
  ['AC-WF-04', 'Assign user tasks to users or roles', 'Volume 2 section 23.4', 'core'],
  ['AC-WF-05', 'Attach forms to tasks', 'Volume 2 section 23.4', 'core'],
  ['AC-WF-06', 'Configure decision conditions', 'Volume 2 sections 23.3 and 23.4', 'core'],
  ['AC-WF-07', 'Configure parallel paths', 'Volume 2 section 23.3', 'core'],
  ['AC-WF-08', 'Add timers and notifications', 'Volume 2 section 23.3', 'advanced'],
  ['AC-WF-09', 'Validate the workflow', 'Volume 2 sections 23.2 and 23.6', 'core'],
  ['AC-WF-10', 'Execute a test workflow', 'Volume 2 section 23.6', 'advanced'],
  ['AC-WF-11', 'Publish a valid version', 'Volume 2 section 23.7', 'core'],
  ['AC-WF-12', 'Initiate a published workflow', 'Volume 2 section 23.8', 'core'],
  ['AC-WF-13', 'Complete assigned user tasks', 'Volume 2 section 23.9', 'core'],
  ['AC-WF-14', 'Execute automated tasks', 'Volume 2 sections 23.3 and 23.8', 'advanced'],
  ['AC-WF-15', 'Monitor the workflow visually', 'Volume 2 section 23.10', 'core'],
  ['AC-WF-16', 'View workflow and task audit history', 'Volume 2 sections 23.10 and 23.13', 'core'],
  ['AC-WF-17', 'Generate basic operational reports', 'Volume 2 section 23.11', 'core'],
] as const;

export const WORKFLOW_DESIGNER_LIFECYCLE = {
  states: ['draft', 'under_review', 'published', 'active', 'suspended', 'retired', 'archived'],
  roles: {
    designer: ['system_admin', 'dmo_admin', 'workflow_designer'],
    reviewer: ['system_admin', 'dmo_admin', 'workflow_reviewer'],
    publisher: ['system_admin', 'dmo_admin', 'workflow_publisher'],
  },
  segregationOfDuties: [
    'Designer saves draft changes and cannot be the only evidence of publish approval in production pilot.',
    'Reviewer comments and publisher actions are audit logged.',
    'System administrators may operate all roles in local/demo mode, but production pilot review gates must name separate accountable roles.',
  ],
};

export const PRODUCTION_PILOT_GUARDRAILS = [
  { code: 'workflow_mvp_gate', label: 'Workflow Canvas MVP gate blocks pilot readiness when core AC-WF items fail.' },
  { code: 'signed_workflow_models', label: 'Published workflow models require signed BPMN snapshots and immutable versions.' },
  { code: 'audit_chain', label: 'Workflow design, publish, case, task, and decision actions emit audit events.' },
  { code: 'scope_enforcement', label: 'Workflow cases linked to assets honor RBAC and data-scope visibility.' },
  { code: 'external_targets_declared', label: 'Camunda/Zeebe, SIEM, SSO/Nafath, OpenSearch, and HSM/KMS remain deployment targets unless integrated.' },
];

export const WORKFLOW_AUDIT_EVENT_CATALOG = [
  { action: 'workflow_template.create', entityType: 'workflow_template', metadata: ['code', 'caseType'] },
  { action: 'workflow_template.bpmn_draft.save', entityType: 'workflow_template', metadata: ['status', 'errors', 'warnings'] },
  { action: 'workflow_template.review.submit', entityType: 'workflow_template', metadata: ['status', 'warnings', 'reviewModelSignature'] },
  { action: 'workflow_template.review.approve', entityType: 'workflow_template', metadata: ['requestedBy', 'approvedModelSignature', 'sodOverride'] },
  { action: 'workflow_template.bpmn.publish', entityType: 'workflow_template', metadata: ['version', 'stageCount', 'transitionCount'] },
  { action: 'workflow_template.test_run.execute', entityType: 'workflow_template', metadata: ['runNumber', 'status', 'environment', 'pathLength'] },
  { action: 'workflow_template.test_run.reset', entityType: 'workflow_template', metadata: ['runNumber', 'previousStatus', 'newStatus'] },
  { action: 'workflow_case.create', entityType: 'workflow_case', metadata: ['code', 'templateId'] },
  { action: 'workflow_case.submit', entityType: 'workflow_case', metadata: ['fromStatus', 'toStatus'] },
  { action: 'workflow_case.suspend', entityType: 'workflow_case', metadata: ['fromStatus', 'toStatus', 'reason'] },
  { action: 'workflow_case.resume', entityType: 'workflow_case', metadata: ['fromStatus', 'toStatus', 'reason'] },
  { action: 'workflow_case.cancel', entityType: 'workflow_case', metadata: ['fromStatus', 'toStatus', 'reason'] },
  { action: 'workflow_task.form.draft.save', entityType: 'workflow_task', metadata: ['stageCode', 'fieldCount', 'previousSubmittedAt'] },
  { action: 'workflow_task.form.submit', entityType: 'workflow_task', metadata: ['stageCode', 'validatedFields', 'attachmentFields'] },
  { action: 'workflow_task.approved', entityType: 'workflow_task', metadata: ['decision', 'stageCode', 'routeTransitionId'] },
  { action: 'workflow_task.rejected', entityType: 'workflow_task', metadata: ['decision', 'stageCode', 'routeTransitionId'] },
  { action: 'workflow_task.return_for_clarification', entityType: 'workflow_task', metadata: ['commentRequired'] },
  { action: 'workflow_execution.retry', entityType: 'workflow_execution_attempt', metadata: ['caseId', 'taskId', 'templateStageCode', 'previousStatus', 'previousErrorCode'] },
  { action: 'access_grant.requested', entityType: 'access_grant', metadata: ['assetId', 'assetType', 'permissionCode', 'principalType'] },
  { action: 'access_grant.owner_approved', entityType: 'access_grant', metadata: ['previousStatus', 'newStatus', 'newOwnerDecision'] },
  { action: 'access_grant.owner_rejected', entityType: 'access_grant', metadata: ['previousStatus', 'newStatus', 'newOwnerDecision'] },
  { action: 'access_grant.enforcement_update', entityType: 'access_grant', metadata: ['previousEnforcementStatus', 'newEnforcementStatus'] },
  { action: 'access_grant.revoked', entityType: 'access_grant', metadata: ['previousStatus', 'previousEnforcementStatus', 'reason'] },
] as const;

export function evaluateWorkflowDmnTable(table: unknown, context: Record<string, unknown>): WorkflowDmnDecisionResult {
  const source = asRecord(table);
  const dmn = asRecord(source['dmnTable'] ?? source['decisionTable'] ?? source);
  const rules = Array.isArray(dmn['rules']) ? dmn['rules'] : [];
  const trace: string[] = [];
  for (const [index, rawRule] of rules.entries()) {
    const rule = asRecord(rawRule);
    const compactCondition = rule['variable'] ?? rule['path'] ?? rule['field']
      ? [{
          path: rule['variable'] ?? rule['path'] ?? rule['field'],
          operator: rule['operator'] ?? rule['op'] ?? 'eq',
          value: rule['value'] ?? rule['equals'],
        }]
      : [];
    const conditions = normalizeDmnConditions(rule['conditions'] ?? rule['when'] ?? rule['inputs'] ?? compactCondition);
    const logicalOperator = String(rule['logicalOperator'] ?? rule['match'] ?? 'AND').trim().toUpperCase();
    const matches = conditions.length === 0 || (logicalOperator === 'OR'
      ? conditions.some((condition) => dmnConditionMatches(condition, context))
      : conditions.every((condition) => dmnConditionMatches(condition, context)));
    trace.push(`${String(rule['id'] ?? index + 1)}:${matches ? 'matched' : 'skipped'}`);
    if (!matches) continue;
    const result = asRecord(rule['result'] ?? rule['outputs'] ?? rule['then'] ?? rule);
    return {
      matched: true,
      ruleId: String(rule['id'] ?? index + 1),
      decision: cleanDmnString(result['decision'] ?? result['taskDecision'] ?? rule['decision'] ?? rule['outcome']),
      targetStageCode: cleanDmnString(result['targetStageCode'] ?? result['toStageCode'] ?? rule['targetStageCode']),
      trace,
    };
  }
  return { matched: false, ruleId: null, decision: null, targetStageCode: null, trace };
}

export function validateWorkflowFormData(schema: unknown, data: unknown): WorkflowFormValidationResult {
  const formData = asRecord(data);
  const requiredFields = workflowFormRequiredFields(schema);
  const missing = requiredFields.filter((field) => !hasPresentValue(readPath(formData, field)));
  const errors: string[] = [];
  for (const field of workflowFormFields(schema)) {
    const value = readPath(formData, field.name);
    if (!hasPresentValue(value)) continue;
    const type = normalizeWorkflowVariableType(field.type);
    if (type === 'text' && typeof value !== 'string') errors.push(`${field.label} must be text`);
    if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      errors.push(`${field.label} must be a number`);
    }
    if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${field.label} must be true or false`);
    if (type === 'date' && Number.isNaN(Date.parse(String(value)))) errors.push(`${field.label} must be a valid date`);
    if (type === 'user' && typeof value !== 'string') errors.push(`${field.label} must reference a user`);
    if (type === 'role' && typeof value !== 'string') errors.push(`${field.label} must reference a role`);
    if (type === 'list' && !Array.isArray(value)) errors.push(`${field.label} must be a list`);
    if (field.type === 'attachment' && !(typeof value === 'string' || Array.isArray(value) || (value && typeof value === 'object'))) {
      errors.push(`${field.label} must reference one or more attachments`);
    }
    const allowed = field.allowed.map(String);
    if (allowed.length > 0) {
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      if (!values.every((item) => allowed.includes(item))) {
        errors.push(`${field.label} must use one of the configured allowed values`);
      }
    }
  }
  return { valid: missing.length === 0 && errors.length === 0, missing, errors };
}

export function workflowFormRequiredFields(schema: unknown): string[] {
  return workflowFormFields(schema).filter((field) => field.required).map((field) => field.name);
}

export function workflowFormAttachmentFieldNames(schema: unknown): string[] {
  return workflowFormFields(schema).filter((field) => field.required && field.type === 'attachment').map((field) => field.name);
}

export function buildWorkflowVersionDiff(
  current: {
    stages: Array<{ code: string; nameEn?: string | null; assigneeRoleCode?: string | null; dueDays?: number | null; isDecision?: boolean; isFinal?: boolean }>;
    transitions: Array<{ fromStageId: string; toStageId: string; decision?: string | null; labelEn?: string | null }>;
  },
  target: {
    stages: Array<{ code: string; nameEn?: string | null; assigneeRoleCode?: string | null; dueDays?: number | null; isDecision?: boolean; isFinal?: boolean }>;
    transitions: Array<{ fromStageId: string; toStageId: string; decision?: string | null; labelEn?: string | null }>;
  },
) {
  const currentStages = new Map(current.stages.map((stage) => [stage.code, stage]));
  const targetStages = new Map(target.stages.map((stage) => [stage.code, stage]));
  const addedStages = [...targetStages.keys()].filter((code) => !currentStages.has(code));
  const removedStages = [...currentStages.keys()].filter((code) => !targetStages.has(code));
  const changedStages = [...targetStages.entries()]
    .filter(([code, stage]) => {
      const before = currentStages.get(code);
      return before && JSON.stringify(stageComparable(before)) !== JSON.stringify(stageComparable(stage));
    })
    .map(([code]) => code);
  const currentTransitions = new Set(current.transitions.map(transitionKey));
  const targetTransitions = new Set(target.transitions.map(transitionKey));
  const addedTransitions = [...targetTransitions].filter((key) => !currentTransitions.has(key));
  const removedTransitions = [...currentTransitions].filter((key) => !targetTransitions.has(key));
  return {
    summary: {
      addedStages: addedStages.length,
      removedStages: removedStages.length,
      changedStages: changedStages.length,
      addedTransitions: addedTransitions.length,
      removedTransitions: removedTransitions.length,
    },
    stages: { added: addedStages, removed: removedStages, changed: changedStages },
    transitions: { added: addedTransitions, removed: removedTransitions },
  };
}

export type WorkflowSlaTemplateItem = {
  code: string;
  caseType: string;
  defaultSlaDays: number;
  stageSlaDays: number;
  escalationAfterDays: number;
  status: WorkflowConfigurationStatus;
};

export const DEFAULT_WORKFLOW_TEMPLATES: WorkflowTemplateSeed[] = [
  {
    code: 'WF-GEN-GOV-REVIEW',
    caseType: 'general',
    trigger: 'manual',
    nameEn: 'Governance review route',
    nameAr: 'مسار مراجعة الحوكمة',
    description: 'General intake, review, decision, and closure route for governance work.',
    defaultSlaDays: 5,
    stages: [
      stage('intake', 'Intake', 'استلام', 'Capture the request and linked data context.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('review', 'Review', 'مراجعة', 'Steward reviews the impact and evidence needed.', 'review', 'review', 'data_steward', 3),
      stage('decision', 'Decision', 'قرار', 'Decision owner approves, rejects, or asks for more information.', 'decision', 'approval', 'data_owner', 2, { isDecision: true }),
      stage('decision-control', 'Decision control record', 'سجل ضبط القرار', 'Persist the approved governance decision as executable control evidence.', 'automation', 'automation', undefined, 0, {
        nodeType: 'automated_task',
        assignmentStrategy: 'automation',
        automationConfigJson: {
          action: 'record_control_event',
          eventAction: 'governance.decision.recorded',
          comment: 'Approved governance decision recorded by the workflow engine.',
        },
      }),
      stage('closure', 'Closure', 'إغلاق', 'Close the loop and leave an auditable decision trail.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('intake', 'review', 'Ready for review', 'جاهز للمراجعة'),
      link('review', 'decision', 'Ready for decision', 'جاهز للقرار'),
      link('decision', 'decision-control', 'Record approved decision', 'تسجيل القرار المعتمد', 'approved'),
      link('decision', 'review', 'More information', 'معلومات إضافية', 'rejected', false),
      link('decision-control', 'closure', 'Control evidence recorded', 'تم تسجيل دليل الضبط', 'approved', true, 'success'),
      link('decision-control', 'review', 'Control recording failed', 'فشل تسجيل الضبط', 'rejected', false, 'failure'),
    ],
  },
  {
    code: 'WF-OWN-APPROVAL',
    caseType: 'owner_assignment_approval',
    trigger: 'owner_assignment',
    nameEn: 'Ownership approval route',
    nameAr: 'مسار اعتماد الملكية',
    description: 'Routes owner changes through steward review, decision, and asset update.',
    defaultSlaDays: 4,
    stages: [
      stage('proposal', 'Assignment proposal', 'اقتراح الإسناد', 'Confirm the proposed owner and affected asset.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('steward-check', 'Steward check', 'تحقق الأمين', 'Check conflicts, active windows, and accountability coverage.', 'review', 'review', 'data_steward', 2),
      stage('owner-decision', 'Owner decision', 'قرار المالك', 'Approve or reject the proposed accountable owner.', 'approval', 'approval', 'data_owner', 2, { isDecision: true }),
      stage('asset-sync', 'Asset accountability update', 'تحديث مساءلة الأصل', 'Apply the approved owner and update the case trail.', 'implementation', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('proposal', 'steward-check', 'Check proposal', 'تحقق من الاقتراح'),
      link('steward-check', 'owner-decision', 'Ready for approval', 'جاهز للاعتماد'),
      link('owner-decision', 'asset-sync', 'Approved', 'معتمد', 'approved'),
      link('owner-decision', 'steward-check', 'Needs correction', 'يحتاج تصحيحاً', 'rejected', false),
    ],
  },
  {
    code: 'WF-STW-APPROVAL',
    caseType: 'steward_assignment_approval',
    trigger: 'steward_assignment',
    nameEn: 'Stewardship approval route',
    nameAr: 'مسار اعتماد الأمانة',
    description: 'Routes steward changes through parallel coverage and segregation-of-duties reviews, merge control, approval, and activation.',
    defaultSlaDays: 4,
    stages: [
      stage('proposal', 'Steward proposal', 'اقتراح الأمين', 'Confirm who will act on quality, policy, and issue work.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('review-split', 'Parallel review split', 'تقسيم المراجعة المتوازية', 'Open accountability coverage and segregation-of-duties reviews together.', 'routing', 'routing', undefined, 0, {
        nodeType: 'parallel_gateway',
        parallelGroup: 'steward-readiness',
        gatewayConfigJson: { mode: 'parallel', branches: ['coverage-check', 'sod-check'], join: 'review-merge' },
      }),
      stage('coverage-check', 'Coverage review', 'مراجعة التغطية', 'Review role fit, domain coverage, capacity, and accountability gaps.', 'review', 'review', 'data_owner', 2, { parallelGroup: 'steward-readiness' }),
      stage('sod-check', 'Segregation-of-duties review', 'مراجعة فصل المهام', 'Check conflicts between requester, proposed steward, owner, and approving authority.', 'review', 'approval', 'dmo_admin', 1, { parallelGroup: 'steward-readiness' }),
      stage('review-merge', 'Merge readiness evidence', 'دمج أدلة الجاهزية', 'Wait until both readiness reviews are complete before approval.', 'routing', 'routing', undefined, 0, {
        nodeType: 'merge_gateway',
        parallelGroup: 'steward-readiness',
        gatewayConfigJson: { mode: 'all_incoming_complete', incoming: ['coverage-check', 'sod-check'] },
      }),
      stage('approval', 'Stewardship approval', 'اعتماد الأمانة', 'Record the accountable approval decision and rationale.', 'approval', 'approval', 'dmo_admin', 1),
      stage('decision-gateway', 'Approval outcome', 'نتيجة الاعتماد', 'Route approved assignments to activation and returned assignments to correction.', 'decision', 'routing', undefined, 0, {
        isDecision: true,
        nodeType: 'decision_gateway',
        gatewayConfigJson: { branches: ['approved', 'rejected'], defaultPath: 'rejected' },
      }),
      stage('activation', 'Activation', 'تفعيل', 'Activate the assignment and update the operating record.', 'implementation', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('proposal', 'review-split', 'Begin readiness review', 'بدء مراجعة الجاهزية'),
      link('review-split', 'coverage-check', 'Coverage workstream', 'مسار عمل التغطية', undefined, true, 'parallel_split'),
      link('review-split', 'sod-check', 'Conflict review workstream', 'مسار مراجعة التعارض', undefined, true, 'parallel_split'),
      link('coverage-check', 'review-merge', 'Coverage confirmed', 'تم تأكيد التغطية', undefined, true, 'merge_join'),
      link('sod-check', 'review-merge', 'No conflict confirmed', 'تم تأكيد عدم وجود تعارض', undefined, true, 'merge_join'),
      link('review-merge', 'approval', 'Ready for approval', 'جاهز للاعتماد'),
      link('approval', 'decision-gateway', 'Decision recorded', 'تم تسجيل القرار'),
      link('decision-gateway', 'activation', 'Approved', 'معتمد', 'approved'),
      link('decision-gateway', 'proposal', 'Revise assignment', 'تعديل الإسناد', 'rejected', false),
    ],
  },
  {
    code: 'WF-DQ-REMEDIATION',
    caseType: 'data_quality_issue',
    trigger: 'data_quality_issue',
    nameEn: 'Quality remediation route',
    nameAr: 'مسار معالجة الجودة',
    description: 'Turns quality issues into triage, root cause, remediation, validation, and closure.',
    defaultSlaDays: 7,
    stages: [
      stage('issue-intake', 'Issue intake', 'استلام المشكلة', 'Register severity, asset, owner, and SLA.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('triage', 'Triage', 'فرز', 'Prioritize impact and confirm accountable steward.', 'triage', 'review', 'dq_steward', 1),
      stage('rca', 'Root cause', 'سبب جذري', 'Record why the quality issue happened.', 'analysis', 'review', 'dq_steward', 2),
      stage('remediate', 'Remediate', 'معالجة', 'Fix the issue and provide evidence.', 'implementation', 'review', 'data_steward', 3),
      stage('validate', 'Validate', 'تحقق', 'Confirm the quality signal is acceptable.', 'validation', 'approval', 'data_owner', 1, { isDecision: true }),
      stage('close', 'Close', 'إغلاق', 'Close the case and keep the evidence trail.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('issue-intake', 'triage', 'Triage issue', 'فرز المشكلة'),
      link('triage', 'rca', 'Analyze cause', 'تحليل السبب'),
      link('rca', 'remediate', 'Fix issue', 'معالجة المشكلة'),
      link('remediate', 'validate', 'Validate fix', 'تحقق من المعالجة'),
      link('validate', 'close', 'Accepted', 'مقبول', 'approved'),
      link('validate', 'remediate', 'Needs more work', 'يحتاج عملاً إضافياً', 'rejected', false),
    ],
  },
  {
    code: 'WF-DLP-INCIDENT',
    caseType: 'dlp_incident',
    trigger: 'dlp_incident',
    nameEn: 'Protection incident route',
    nameAr: 'مسار حادثة الحماية',
    description: 'Routes DLP incidents through triage, parallel containment/privacy-risk workstreams, merge control, decision, and closure.',
    defaultSlaDays: 3,
    stages: [
      stage('detect', 'Detect', 'اكتشاف', 'Capture incident source, asset, and severity.', 'intake', 'information', undefined, 0, { isStart: true }),
      stage('triage-gateway', 'Triage gateway', 'بوابة الفرز', 'Route false positives to closure and confirmed incidents to parallel response.', 'decision', 'routing', undefined, 0, {
        isDecision: true,
        nodeType: 'decision_gateway',
        gatewayConfigJson: { branches: ['approved', 'rejected'], defaultPath: 'rejected', rules: [{ variable: 'incident.confirmed', operator: 'equals', value: true, outcome: 'approved' }] },
      }),
      stage('response-split', 'Parallel response split', 'تقسيم الاستجابة المتوازية', 'Start containment and privacy/risk review at the same time.', 'routing', 'routing', undefined, 0, {
        nodeType: 'parallel_gateway',
        parallelGroup: 'dlp-response',
        gatewayConfigJson: { mode: 'parallel', branches: ['contain', 'review'], join: 'response-merge' },
      }),
      stage('contain', 'Contain', 'احتواء', 'Reduce exposure, preserve evidence, and assign the incident owner.', 'implementation', 'review', 'security_reviewer', 1, { parallelGroup: 'dlp-response' }),
      stage('review', 'Privacy and risk review', 'مراجعة الخصوصية والمخاطر', 'Review classification, personal data exposure, legal risk, and policy impact.', 'review', 'approval', 'privacy_officer', 1, { parallelGroup: 'dlp-response' }),
      stage('response-merge', 'Merge response evidence', 'دمج أدلة الاستجابة', 'Wait until containment and privacy/risk review both complete.', 'routing', 'routing', undefined, 0, {
        nodeType: 'merge_gateway',
        parallelGroup: 'dlp-response',
        gatewayConfigJson: { mode: 'all_incoming_complete', incoming: ['contain', 'review'] },
      }),
      stage('decision', 'Decision', 'قرار', 'Decide whether to close, escalate, or mark false positive.', 'decision', 'approval', 'dmo_admin', 1, { isDecision: true }),
      stage('close', 'Closure evidence', 'دليل الإغلاق', 'Record containment summary and close the case.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('detect', 'triage-gateway', 'Classify incident', 'تصنيف الحادثة'),
      link('triage-gateway', 'response-split', 'Confirmed incident', 'حادثة مؤكدة', 'approved'),
      link('triage-gateway', 'close', 'False positive', 'إنذار غير صحيح', 'rejected', false),
      link('response-split', 'contain', 'Containment branch', 'فرع الاحتواء', undefined, true, 'parallel_split'),
      link('response-split', 'review', 'Privacy/risk branch', 'فرع الخصوصية والمخاطر', undefined, true, 'parallel_split'),
      link('contain', 'response-merge', 'Containment complete', 'اكتمل الاحتواء', undefined, true, 'merge_join'),
      link('review', 'response-merge', 'Risk review complete', 'اكتملت مراجعة المخاطر', undefined, true, 'merge_join'),
      link('response-merge', 'decision', 'Decision needed', 'يحتاج قراراً'),
      link('decision', 'close', 'Close incident', 'إغلاق الحادثة', 'approved'),
      link('decision', 'contain', 'Escalate containment', 'تصعيد الاحتواء', 'rejected', false),
    ],
  },
  {
    code: 'WF-CLS-CHANGE',
    caseType: 'classification_change_request',
    trigger: 'classification_change',
    nameEn: 'Classification change route',
    nameAr: 'مسار تغيير التصنيف',
    description: 'Routes classification changes through impact review and controlled implementation.',
    defaultSlaDays: 5,
    stages: [
      stage('request', 'Change request', 'طلب تغيير', 'Capture requested classification and reason.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('impact', 'Impact review', 'مراجعة الأثر', 'Check access, masking, open data, and evidence impact.', 'review', 'review', 'security_reviewer', 2),
      stage('decision', 'Classification decision', 'قرار التصنيف', 'Approve or reject the new classification.', 'approval', 'approval', 'dmo_admin', 2, { isDecision: true }),
      stage('implement', 'Implement change', 'تنفيذ التغيير', 'Apply classification and notify affected operations.', 'implementation', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('request', 'impact', 'Review impact', 'مراجعة الأثر'),
      link('impact', 'decision', 'Ready for decision', 'جاهز للقرار'),
      link('decision', 'implement', 'Approved', 'معتمد', 'approved'),
      link('decision', 'impact', 'Needs reassessment', 'يحتاج إعادة تقييم', 'rejected', false),
    ],
  },
  {
    code: 'WF-FOI-REQUEST',
    caseType: 'foi_request',
    trigger: 'foi_request',
    nameEn: 'FOI request route',
    nameAr: 'مسار طلب حرية المعلومات',
    description: 'Routes FOI requests through intake, legal/privacy review, decision, disclosure, and closure.',
    defaultSlaDays: 20,
    stages: [
      stage('intake', 'Intake validation', 'تحقق الاستلام', 'Validate identity, contact details, channel, and request scope.', 'intake', 'information', 'foi_officer', 1, { isStart: true }),
      stage('classification', 'Classification and exemption review', 'مراجعة التصنيف والاستثناءات', 'Check information classification, exemptions, privacy, and legal risk.', 'review', 'review', 'privacy_officer', 5),
      stage('decision', 'Disclosure decision', 'قرار الإفصاح', 'Approve, partially approve, reject, or extend the request with justification.', 'decision', 'approval', 'foi_officer', 3, { isDecision: true }),
      stage('disclosure', 'Response and disclosure', 'الرد والإفصاح', 'Prepare the response package and record release evidence.', 'implementation', 'review', 'foi_officer', 3),
      stage('closure', 'Closure and evidence', 'الإغلاق والأدلة', 'Close the request with audit-ready evidence and appeal readiness.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('intake', 'classification', 'Ready for review', 'جاهز للمراجعة'),
      link('classification', 'decision', 'Ready for decision', 'جاهز للقرار'),
      link('decision', 'disclosure', 'Disclose response', 'الإفصاح عن الرد', 'approved'),
      link('decision', 'closure', 'No disclosure', 'لا يوجد إفصاح', 'rejected', false),
      link('disclosure', 'closure', 'Disclosure complete', 'اكتمل الإفصاح'),
    ],
  },
  {
    code: 'WF-FOI-APPEAL',
    caseType: 'foi_appeal',
    trigger: 'foi_appeal',
    nameEn: 'FOI appeal route',
    nameAr: 'مسار تظلم حرية المعلومات',
    description: 'Routes FOI appeals through intake, parallel independent/privacy reviews, merge control, appeal decision branching, and closure.',
    defaultSlaDays: 10,
    stages: [
      stage('appeal-intake', 'Appeal intake', 'استلام التظلم', 'Capture appeal reason and link it to the original request.', 'intake', 'information', 'foi_officer', 1, { isStart: true }),
      stage('appeal-review-split', 'Parallel appeal review split', 'تقسيم مراجعة التظلم', 'Start independent review and privacy/legal checks in parallel.', 'routing', 'routing', undefined, 0, {
        nodeType: 'parallel_gateway',
        parallelGroup: 'foi-appeal-review',
        gatewayConfigJson: { mode: 'parallel', branches: ['independent-review', 'privacy-legal-check'], join: 'appeal-review-merge' },
      }),
      stage('independent-review', 'Independent review', 'مراجعة مستقلة', 'Review original decision, exemption evidence, and disclosure package.', 'review', 'review', 'dmo_admin', 4, { parallelGroup: 'foi-appeal-review' }),
      stage('privacy-legal-check', 'Privacy and legal check', 'فحص الخصوصية والشؤون القانونية', 'Validate PDPL privacy limits, exemptions, redaction, and legal defensibility.', 'review', 'approval', 'privacy_officer', 3, { parallelGroup: 'foi-appeal-review' }),
      stage('appeal-review-merge', 'Merge appeal evidence', 'دمج أدلة التظلم', 'Wait for independent and privacy/legal reviews before a decision is made.', 'routing', 'routing', undefined, 0, {
        nodeType: 'merge_gateway',
        parallelGroup: 'foi-appeal-review',
        gatewayConfigJson: { mode: 'all_incoming_complete', incoming: ['independent-review', 'privacy-legal-check'] },
      }),
      stage('appeal-decision', 'Appeal decision', 'قرار التظلم', 'Uphold or overturn the original FOI decision with rationale.', 'decision', 'approval', 'dmo_admin', 2, { isDecision: true }),
      stage('appeal-closure', 'Appeal closure', 'إغلاق التظلم', 'Close appeal and update the request record.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('appeal-intake', 'appeal-review-split', 'Review appeal', 'مراجعة التظلم'),
      link('appeal-review-split', 'independent-review', 'Independent review branch', 'فرع المراجعة المستقلة', undefined, true, 'parallel_split'),
      link('appeal-review-split', 'privacy-legal-check', 'Privacy and legal branch', 'فرع الخصوصية والشؤون القانونية', undefined, true, 'parallel_split'),
      link('independent-review', 'appeal-review-merge', 'Independent review complete', 'اكتملت المراجعة المستقلة', undefined, true, 'merge_join'),
      link('privacy-legal-check', 'appeal-review-merge', 'Privacy/legal check complete', 'اكتمل فحص الخصوصية والشؤون القانونية', undefined, true, 'merge_join'),
      link('appeal-review-merge', 'appeal-decision', 'Ready for decision', 'جاهز للقرار'),
      link('appeal-decision', 'appeal-closure', 'Decision recorded', 'تم تسجيل القرار', 'approved'),
      link('appeal-decision', 'independent-review', 'Needs more review', 'يحتاج مراجعة إضافية', 'rejected', false),
    ],
  },
  {
    code: 'WF-PDP-DPIA',
    caseType: 'privacy_dpia',
    trigger: 'privacy_dpia',
    nameEn: 'DPIA and privacy-by-design route',
    nameAr: 'مسار تقييم أثر الخصوصية',
    description: 'Routes DPIA work through requirements, design, development, testing, deployment gates, and DPO decision.',
    defaultSlaDays: 10,
    stages: [
      stage('requirements', 'Requirements gate', 'بوابة المتطلبات', 'Confirm purpose, lawful basis, data subjects, and minimum data needed.', 'review', 'review', 'privacy_officer', 2, { isStart: true }),
      stage('design', 'Design gate', 'بوابة التصميم', 'Review controls, masking, consent, retention, and cross-border transfer risk.', 'review', 'review', 'privacy_officer', 2),
      stage('development', 'Development gate', 'بوابة التطوير', 'Check implementation evidence before testing.', 'implementation', 'review', 'technical_steward', 2),
      stage('testing', 'Testing gate', 'بوابة الاختبار', 'Validate controls and residual risk.', 'validation', 'review', 'security_reviewer', 2),
      stage('deployment', 'Deployment decision', 'قرار الإطلاق', 'Approve, block, or request corrective actions before launch.', 'decision', 'approval', 'privacy_officer', 2, { isDecision: true }),
      stage('closure', 'DPIA closure', 'إغلاق تقييم أثر الخصوصية', 'Record the approved deployment decision and close the DPIA route.', 'closure', 'review', 'privacy_officer', 1, { isFinal: true }),
    ],
    transitions: [
      link('requirements', 'design', 'Purpose accepted', 'تم قبول الغرض'),
      link('design', 'development', 'Controls accepted', 'تم قبول الضوابط'),
      link('development', 'testing', 'Ready to test', 'جاهز للاختبار'),
      link('testing', 'deployment', 'Ready for decision', 'جاهز للقرار'),
      link('deployment', 'closure', 'Approved for deployment', 'معتمد للإطلاق', 'approved'),
      link('deployment', 'testing', 'Needs remediation', 'يحتاج معالجة', 'rejected', false),
    ],
  },
  {
    code: 'WF-PDP-DSR',
    caseType: 'privacy_dsr',
    trigger: 'privacy_dsr',
    nameEn: 'Data subject request route',
    nameAr: 'مسار طلب صاحب البيانات',
    description: 'Routes DSR work through identity validation, decision branching, parallel owner/privacy workstreams, fulfillment, and closure.',
    defaultSlaDays: 20,
    stages: [
      stage('intake', 'Identity validation', 'التحقق من الهوية', 'Validate requester identity and request type.', 'intake', 'information', 'privacy_officer', 2, { isStart: true }),
      stage('request-check', 'Request eligibility gateway', 'بوابة أهلية الطلب', 'Branch the route after identity and request-scope checks.', 'decision', 'routing', undefined, 0, {
        isDecision: true,
        nodeType: 'decision_gateway',
        gatewayConfigJson: { branches: ['approved', 'rejected'], defaultPath: 'rejected', rules: [{ variable: 'identity.verified', operator: 'equals', value: true, outcome: 'approved' }] },
      }),
      stage('parallel-workstream', 'Parallel fulfillment split', 'تقسيم التنفيذ المتوازي', 'Start owner response and privacy review at the same time.', 'routing', 'routing', undefined, 0, {
        nodeType: 'parallel_gateway',
        parallelGroup: 'dsr-fulfillment',
        gatewayConfigJson: { mode: 'parallel', branches: ['owner-response', 'privacy-review'], join: 'fulfillment-merge' },
      }),
      stage('owner-response', 'Owner response', 'رد مالك البيانات', 'Collect records or correction decision from the accountable data owner.', 'review', 'review', 'data_owner', 8, { parallelGroup: 'dsr-fulfillment' }),
      stage('privacy-review', 'Privacy review', 'مراجعة الخصوصية', 'Confirm lawful response limits, masking, redaction, and disclosure risk.', 'review', 'approval', 'privacy_officer', 5, { parallelGroup: 'dsr-fulfillment' }),
      stage('fulfillment-merge', 'Merge fulfillment evidence', 'دمج أدلة التنفيذ', 'Wait until owner response and privacy review are both complete.', 'routing', 'routing', undefined, 0, {
        nodeType: 'merge_gateway',
        parallelGroup: 'dsr-fulfillment',
        gatewayConfigJson: { mode: 'all_incoming_complete', incoming: ['owner-response', 'privacy-review'] },
      }),
      stage('fulfillment', 'Fulfillment package', 'حزمة التنفيذ', 'Prepare response, rejection reason, correction evidence, and requester communication.', 'implementation', 'review', 'privacy_officer', 6),
      stage('closure', 'DSR closure', 'إغلاق الطلب', 'Close the request with evidence and decision summary.', 'closure', 'approval', 'privacy_officer', 2, { isFinal: true }),
    ],
    transitions: [
      link('intake', 'request-check', 'Validated', 'تم التحقق'),
      link('request-check', 'parallel-workstream', 'Eligible request', 'طلب مؤهل', 'approved'),
      link('request-check', 'closure', 'Identity or scope rejected', 'رفض الهوية أو النطاق', 'rejected', false),
      link('parallel-workstream', 'owner-response', 'Owner branch', 'فرع المالك', undefined, true, 'parallel_split'),
      link('parallel-workstream', 'privacy-review', 'Privacy branch', 'فرع الخصوصية', undefined, true, 'parallel_split'),
      link('owner-response', 'fulfillment-merge', 'Owner response ready', 'رد المالك جاهز', undefined, true, 'merge_join'),
      link('privacy-review', 'fulfillment-merge', 'Privacy clearance ready', 'تصريح الخصوصية جاهز', undefined, true, 'merge_join'),
      link('fulfillment-merge', 'fulfillment', 'All branches complete', 'اكتملت كل الفروع'),
      link('fulfillment', 'closure', 'Fulfilled', 'تم التنفيذ'),
    ],
  },
  {
    code: 'WF-PDP-BREACH',
    caseType: 'privacy_breach',
    trigger: 'privacy_breach',
    nameEn: 'Privacy breach escalation route',
    nameAr: 'مسار تصعيد حادثة الخصوصية',
    description: 'Routes breach work through triage, containment, 72-hour notification, and closure.',
    defaultSlaDays: 3,
    stages: [
      stage('triage', 'Breach triage', 'فرز الحادثة', 'Confirm severity, impacted asset, subjects, and notification clock.', 'triage', 'information', 'privacy_officer', 0, { isStart: true }),
      stage('containment', 'Containment', 'الاحتواء', 'Contain exposure and coordinate security response.', 'implementation', 'review', 'security_reviewer', 1),
      stage('notification', 'Notification decision', 'قرار الإشعار', 'Decide regulator and subject notification before the 72-hour deadline.', 'decision', 'approval', 'privacy_officer', 1, { isDecision: true }),
      stage('closure', 'Breach closure', 'إغلاق الحادثة', 'Record evidence, lessons learned, and closure notes.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('triage', 'containment', 'Contain exposure', 'احتواء التعرض'),
      link('containment', 'notification', 'Ready for notification decision', 'جاهز لقرار الإشعار'),
      link('notification', 'closure', 'Notification recorded', 'تم تسجيل الإشعار', 'approved'),
      link('notification', 'containment', 'Containment incomplete', 'الاحتواء غير مكتمل', 'rejected', false),
    ],
  },
  {
    code: 'WF-DSI-SHARING',
    caseType: 'data_sharing_request',
    trigger: 'data_sharing_request',
    nameEn: 'Data sharing agreement route',
    nameAr: 'مسار اتفاقية مشاركة البيانات',
    description: 'Routes sharing requests through owner, privacy, security, technical review, agreement activation, and renewal planning.',
    defaultSlaDays: 8,
    stages: [
      stage('intake', 'Sharing intake', 'استلام طلب المشاركة', 'Capture purpose, recipient, asset, legal basis, and required controls.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('owner-review', 'Owner review', 'مراجعة المالك', 'Confirm purpose, necessity, and accountability.', 'review', 'review', 'data_owner', 2),
      stage('privacy-security-review', 'Privacy and security review', 'مراجعة الخصوصية والأمن', 'Validate consent/legal basis, classification, masking, and access controls.', 'review', 'review', 'security_reviewer', 3),
      stage('technical-review', 'Technical review', 'مراجعة تقنية', 'Confirm integration method, logging, and monitoring approach.', 'review', 'review', 'technical_steward', 2),
      stage('agreement', 'Agreement activation', 'تفعيل الاتفاقية', 'Store agreement, renewal date, and usage monitoring baseline.', 'implementation', 'approval', 'dmo_admin', 1, { isDecision: true }),
      stage('closure', 'Agreement closure', 'إغلاق الاتفاقية', 'Confirm activation evidence and close the governed sharing route.', 'closure', 'review', 'dmo_admin', 1, { isFinal: true }),
    ],
    transitions: [
      link('intake', 'owner-review', 'Owner review', 'مراجعة المالك'),
      link('owner-review', 'privacy-security-review', 'Controls review', 'مراجعة الضوابط'),
      link('privacy-security-review', 'technical-review', 'Technical review', 'مراجعة تقنية'),
      link('technical-review', 'agreement', 'Activate agreement', 'تفعيل الاتفاقية', 'approved'),
      link('agreement', 'closure', 'Agreement active', 'الاتفاقية نشطة', 'approved'),
      link('agreement', 'privacy-security-review', 'Needs revision', 'يحتاج تعديل', 'rejected', false),
    ],
  },
  {
    code: 'WF-OPEN-DATA-APPROVAL',
    caseType: 'open_data_publication_approval',
    trigger: 'open_data_candidate',
    nameEn: 'Open data publication approval route',
    nameAr: 'مسار اعتماد نشر البيانات المفتوحة',
    description: 'Routes open data candidates through readiness, privacy/security review, and publication approval.',
    defaultSlaDays: 8,
    stages: [
      stage('readiness', 'Readiness review', 'مراجعة الجاهزية', 'Confirm metadata, owner, license, quality, and publication channel.', 'review', 'review', 'open_data_reviewer', 2, { isStart: true }),
      stage('risk-review', 'Privacy and security check', 'فحص الخصوصية والأمن', 'Check classification, personal data, exemptions, and masking requirements.', 'review', 'review', 'security_reviewer', 2),
      stage('approval', 'Publication decision', 'قرار النشر', 'Approve, reject, or request changes before publication.', 'decision', 'approval', 'dmo_admin', 2, { isDecision: true }),
      stage('publish', 'Publication evidence', 'دليل النشر', 'Record publication evidence, review date, and operational owner.', 'implementation', 'review', 'open_data_reviewer', 2, { isFinal: true }),
    ],
    transitions: [
      link('readiness', 'risk-review', 'Ready for risk review', 'جاهز لمراجعة المخاطر'),
      link('risk-review', 'approval', 'Ready for decision', 'جاهز للقرار'),
      link('approval', 'publish', 'Approved to publish', 'معتمد للنشر', 'approved'),
      link('approval', 'readiness', 'Needs changes', 'يحتاج تعديلات', 'rejected', false),
    ],
  },
  {
    code: 'WF-META-CERTIFICATION',
    caseType: 'metadata_certification',
    trigger: 'metadata_certification',
    nameEn: 'Metadata certification route',
    nameAr: 'مسار اعتماد البيانات الوصفية',
    description: 'Routes metadata certification through steward completion, owner review, and certification evidence.',
    defaultSlaDays: 6,
    stages: [
      stage('completion-check', 'Metadata completion check', 'فحص اكتمال البيانات الوصفية', 'Confirm mandatory metadata fields and business definitions.', 'review', 'review', 'data_steward', 2, { isStart: true }),
      stage('owner-review', 'Owner review', 'مراجعة المالك', 'Confirm business meaning, classification, and usage context.', 'review', 'review', 'data_owner', 2),
      stage('certify', 'Certification decision', 'قرار الاعتماد', 'Approve or reject metadata certification.', 'decision', 'approval', 'dmo_admin', 1, { isDecision: true }),
      stage('evidence', 'Certification evidence', 'دليل الاعتماد', 'Publish certification status and evidence trail.', 'closure', 'review', 'data_steward', 1, { isFinal: true }),
    ],
    transitions: [
      link('completion-check', 'owner-review', 'Ready for owner review', 'جاهز لمراجعة المالك'),
      link('owner-review', 'certify', 'Ready to certify', 'جاهز للاعتماد'),
      link('certify', 'evidence', 'Certified', 'معتمد', 'approved'),
      link('certify', 'completion-check', 'Needs metadata fixes', 'يحتاج تصحيحات للبيانات الوصفية', 'rejected', false),
    ],
  },
  {
    code: 'WF-ARCH-REVIEW',
    caseType: 'architecture_review',
    trigger: 'architecture_review',
    nameEn: 'Architecture review route',
    nameAr: 'مسار مراجعة المعمارية',
    description: 'Routes data architecture changes through impact, controls, and technical approval.',
    defaultSlaDays: 7,
    stages: [
      stage('impact', 'Architecture impact review', 'مراجعة أثر المعمارية', 'Assess lineage, integration, platform, and operational impact.', 'analysis', 'review', 'technical_steward', 2, { isStart: true }),
      stage('controls', 'Governance controls review', 'مراجعة ضوابط الحوكمة', 'Validate ownership, quality, security, and retention controls.', 'review', 'review', 'data_steward', 2),
      stage('decision', 'Architecture decision', 'قرار المعمارية', 'Approve implementation or request remediation.', 'decision', 'approval', 'dmo_admin', 2, { isDecision: true }),
      stage('implementation-note', 'Implementation evidence', 'دليل التنفيذ', 'Capture change evidence and post-implementation checks.', 'implementation', 'review', 'technical_steward', 1, { isFinal: true }),
    ],
    transitions: [
      link('impact', 'controls', 'Controls review', 'مراجعة الضوابط'),
      link('controls', 'decision', 'Ready for decision', 'جاهز للقرار'),
      link('decision', 'implementation-note', 'Approved', 'معتمد', 'approved'),
      link('decision', 'impact', 'Reassess design', 'إعادة تقييم التصميم', 'rejected', false),
    ],
  },
  {
    code: 'WF-GLOSSARY-TERM',
    caseType: 'business_glossary_term',
    trigger: 'business_glossary_term',
    nameEn: 'Business glossary term route',
    nameAr: 'مسار مراجعة مصطلح قاموس الأعمال',
    description: 'Routes glossary terms through definition, domain review, and publication.',
    defaultSlaDays: 5,
    stages: [
      stage('definition', 'Definition drafting', 'صياغة التعريف', 'Prepare term, synonyms, examples, and linked assets.', 'intake', 'information', 'data_steward', 1, { isStart: true }),
      stage('domain-review', 'Domain meaning review', 'مراجعة المعنى في المجال', 'Confirm business meaning and avoid duplicate terms.', 'review', 'review', 'data_owner', 2),
      stage('approval', 'Glossary approval', 'اعتماد المصطلح', 'Approve or reject term publication.', 'decision', 'approval', 'dmo_admin', 1, { isDecision: true }),
      stage('publish', 'Publish term', 'نشر المصطلح', 'Publish approved term and keep the decision trail.', 'closure', 'review', 'data_steward', 1, { isFinal: true }),
    ],
    transitions: [
      link('definition', 'domain-review', 'Review meaning', 'مراجعة المعنى'),
      link('domain-review', 'approval', 'Ready for approval', 'جاهز للاعتماد'),
      link('approval', 'publish', 'Approved', 'معتمد', 'approved'),
      link('approval', 'definition', 'Needs revision', 'يحتاج مراجعة', 'rejected', false),
    ],
  },
  {
    code: 'WF-ASSET-LIFECYCLE',
    caseType: 'asset_lifecycle_decision',
    trigger: 'asset_lifecycle_decision',
    nameEn: 'Asset lifecycle decision route',
    nameAr: 'مسار قرار دورة حياة الأصل',
    description: 'Routes lifecycle decisions through owner review, risk check, and controlled implementation.',
    defaultSlaDays: 6,
    stages: [
      stage('owner-review', 'Owner lifecycle review', 'مراجعة المالك لدورة الحياة', 'Confirm requested lifecycle state and business impact.', 'review', 'review', 'data_owner', 2, { isStart: true }),
      stage('risk-check', 'Risk and dependency check', 'فحص المخاطر والاعتماديات', 'Review downstream dependencies, evidence, and compliance impact.', 'analysis', 'review', 'data_steward', 2),
      stage('decision', 'Lifecycle decision', 'قرار دورة الحياة', 'Approve retirement, activation, or change request.', 'decision', 'approval', 'dmo_admin', 1, { isDecision: true }),
      stage('apply', 'Apply lifecycle change', 'تطبيق تغيير دورة الحياة', 'Apply approved state and record evidence.', 'implementation', 'review', 'data_steward', 1, { isFinal: true }),
    ],
    transitions: [
      link('owner-review', 'risk-check', 'Check dependencies', 'فحص الاعتماديات'),
      link('risk-check', 'decision', 'Ready for decision', 'جاهز للقرار'),
      link('decision', 'apply', 'Approved', 'معتمد', 'approved'),
      link('decision', 'owner-review', 'Needs reassessment', 'يحتاج إعادة تقييم', 'rejected', false),
    ],
  },
  {
    code: 'WF-BIA',
    caseType: 'business_impact_assessment',
    trigger: 'business_impact_assessment',
    nameEn: 'Business impact assessment route',
    nameAr: 'مسار تقييم أثر الأعمال',
    description: 'Routes value, dependency, risk, and prioritization assessment for governed assets.',
    defaultSlaDays: 7,
    stages: [
      stage('impact-capture', 'Impact capture', 'تسجيل الأثر', 'Capture criticality, users, dependency, and value indicators.', 'intake', 'information', 'data_steward', 2, { isStart: true }),
      stage('owner-validation', 'Owner validation', 'تحقق المالك', 'Validate impact scoring and business context.', 'review', 'review', 'data_owner', 2),
      stage('priority-decision', 'Priority decision', 'قرار الأولوية', 'Approve value tier and governance priority.', 'decision', 'approval', 'dmo_admin', 2, { isDecision: true }),
      stage('publish-score', 'Publish impact score', 'نشر درجة الأثر', 'Publish accepted impact score and evidence.', 'closure', 'review', 'data_steward', 1, { isFinal: true }),
    ],
    transitions: [
      link('impact-capture', 'owner-validation', 'Validate impact', 'التحقق من الأثر'),
      link('owner-validation', 'priority-decision', 'Ready for priority decision', 'جاهز لقرار الأولوية'),
      link('priority-decision', 'publish-score', 'Approved', 'معتمد', 'approved'),
      link('priority-decision', 'impact-capture', 'Needs more evidence', 'يحتاج أدلة إضافية', 'rejected', false),
    ],
  },
  {
    code: 'WF-COMPLIANCE-CALENDAR',
    caseType: 'compliance_calendar',
    trigger: 'compliance_calendar',
    nameEn: 'Compliance calendar route',
    nameAr: 'مسار تقويم الالتزام',
    description: 'Routes recurring compliance work through assignment, evidence collection, review, and closure.',
    defaultSlaDays: 5,
    stages: [
      stage('assignment', 'Assign compliance work', 'إسناد عمل الالتزام', 'Confirm owner, due date, and compliance scope.', 'intake', 'information', 'dmo_admin', 1, { isStart: true }),
      stage('evidence', 'Collect evidence', 'جمع الأدلة', 'Collect required evidence and supporting links.', 'implementation', 'review', 'data_steward', 2),
      stage('review', 'Evidence review', 'مراجعة الأدلة', 'Review completeness and readiness for audit.', 'review', 'approval', 'auditor', 1, { isDecision: true }),
      stage('closure', 'Calendar closure', 'إغلاق التقويم', 'Close recurring work and keep audit trail.', 'closure', 'review', 'dmo_admin', 1, { isFinal: true }),
    ],
    transitions: [
      link('assignment', 'evidence', 'Start evidence collection', 'بدء جمع الأدلة'),
      link('evidence', 'review', 'Ready for review', 'جاهز للمراجعة'),
      link('review', 'closure', 'Accepted', 'مقبول', 'approved'),
      link('review', 'evidence', 'Evidence incomplete', 'الأدلة غير مكتملة', 'rejected', false),
    ],
  },
];

export const WORKFLOW_CASE_TYPES = Array.from(
  new Set([
    ...DEFAULT_WORKFLOW_TEMPLATES.map((template) => template.caseType),
    'open_data_publication_approval',
    'metadata_certification',
    'architecture_review',
    'business_glossary_term',
    'asset_lifecycle_decision',
    'business_impact_assessment',
    'compliance_calendar',
  ]),
) as readonly string[];

export const WORKFLOW_TASK_TYPES = ['approval', 'review', 'information', 'routing', 'automation'] as const;

function stage(
  code: string,
  nameEn: string,
  nameAr: string,
  description: string,
  kind: string,
  taskType: string,
  assigneeRoleCode: string | undefined,
  dueDays: number,
  flags: Pick<WorkflowStageSeed, 'gatewayConfigJson' | 'isStart' | 'isDecision' | 'isFinal' | 'nodeType' | 'parallelGroup' | 'assignmentStrategy' | 'assignmentConfigJson' | 'formSchemaJson' | 'slaConfigJson' | 'notificationRulesJson' | 'evidenceRequirementsJson' | 'automationConfigJson'> = {},
): WorkflowStageSeed {
  const formSchemaJson = taskType === 'information' || kind === 'intake'
    ? {
        fields: [
          { name: 'request_summary', label: 'Request summary', type: 'textarea', required: true },
          { name: 'supporting_context', label: 'Supporting context', type: 'textarea', required: false },
          { name: 'supporting_files', label: 'Supporting files', type: 'file_attachment', required: false },
        ],
        required: ['request_summary'],
      }
    : undefined;
  const evidenceRequirementsJson = taskType === 'approval'
    ? [{ name: `${nameEn} decision record`, required: true, evidenceTypes: ['comment', 'attachment'] }]
    : undefined;
  const notificationRulesJson = taskType !== 'routing'
    ? [
        { event: 'assigned', channel: 'in_app', audience: 'assignee' },
        { event: 'sla_50_percent', channel: 'in_app', audience: 'assignee' },
        { event: 'sla_80_percent', channel: 'email', audience: 'assignee' },
        { event: 'overdue', channel: 'email', audience: ['assignee', 'workflow_owner'] },
      ]
    : undefined;
  const slaConfigJson = dueDays > 0
    ? { dueDays, calendar: 'ksa_business_days', reminderThresholds: [50, 80], overdueAction: 'escalate' }
    : undefined;
  return {
    code,
    nameEn,
    nameAr,
    description,
    kind,
    taskType,
    assigneeRoleCode,
    dueDays,
    formSchemaJson,
    evidenceRequirementsJson,
    notificationRulesJson,
    slaConfigJson,
    ...flags,
  };
}

function link(
  from: string,
  to: string,
  labelEn: string,
  labelAr: string,
  decision?: string,
  isHappyPath = true,
  connectorType?: string,
): WorkflowTransitionSeed {
  return {
    from,
    to,
    labelEn,
    labelAr,
    decision,
    connectorType: connectorType ?? (decision === 'approved' ? 'success' : decision === 'rejected' ? 'failure' : 'sequence'),
    isDefaultPath: decision === 'rejected' && isHappyPath === false,
    isHappyPath,
  };
}

export function selectWorkflowTemplate(
  input: WorkflowRouteInput,
  candidates: WorkflowRouteCandidate[],
): WorkflowRouteCandidate | null {
  const active = candidates.filter((candidate) => candidate.isActive);
  if (input.templateId) {
    return active.find((candidate) => candidate.id === input.templateId) ?? null;
  }
  const caseType = input.caseType || 'general';
  const sameType = active.filter((candidate) => candidate.caseType === caseType);
  if (input.domainId) {
    const domainSpecific = sameType.find((candidate) => candidate.domainId === input.domainId);
    if (domainSpecific) return domainSpecific;
  }
  return sameType.find((candidate) => !candidate.domainId) ??
    active.find((candidate) => candidate.caseType === 'general' && !candidate.domainId) ??
    null;
}

export function workflowHealth(openCases: number, overdueTasks: number): 'healthy' | 'review' | 'critical' {
  if (overdueTasks > 0) return 'critical';
  if (openCases > 0) return 'review';
  return 'healthy';
}

export type WorkflowRouteGateResult = {
  allowed: boolean;
  reason?: string;
};

export function routeGateForOpenStagePeers(openPeerTasks: number): WorkflowRouteGateResult {
  if (openPeerTasks > 0) {
    return {
      allowed: false,
      reason: 'Complete all active tasks in this workflow stage before advancing the route',
    };
  }
  return { allowed: true };
}

const AUTOMATED_ROUTE_NODE_TYPES = new Set([
  'automated_task',
  'service_task',
  'business_rule_task',
  'script_task',
  'send_task',
  'receive_task',
  'notification_task',
  'sub_workflow',
  'timer_event',
]);

const ROUTING_ONLY_NODE_TYPES = new Set([
  'start_event',
  'end_event',
  'decision_gateway',
  'exclusive_gateway',
  'parallel_gateway',
  'merge_gateway',
  'inclusive_gateway',
  'event_based_gateway',
  'error_event',
]);

export function normalizeWorkflowNodeType(value?: string | null): string {
  const clean = String(value ?? 'user_task')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_') || 'user_task';
  for (const definition of WORKFLOW_NODE_TYPES) {
    if (definition.code === clean || definition.aliases.includes(clean)) return definition.code;
  }
  if (clean === 'manual_task') return 'user_task';
  if (clean === 'exclusive_gateway') return 'decision_gateway';
  if (clean === 'inclusive_gateway') return 'merge_gateway';
  if (clean === 'send_task') return 'notification_task';
  if (clean === 'service_task' || clean === 'business_rule_task' || clean === 'script_task') return 'automated_task';
  if (clean === 'call_activity' || clean === 'sub_process') return 'sub_workflow';
  if (clean === 'event_based_gateway') return 'timer_event';
  return clean;
}

export function isAutomatedWorkflowStage(stage: { nodeType?: string | null }): boolean {
  return AUTOMATED_ROUTE_NODE_TYPES.has(normalizeWorkflowNodeType(stage.nodeType));
}

export function isRoutingOnlyWorkflowStage(stage: { nodeType?: string | null; taskType?: string | null; kind?: string | null }): boolean {
  if (isAutomatedWorkflowStage(stage)) return false;
  const nodeType = normalizeWorkflowNodeType(stage.nodeType);
  return ROUTING_ONLY_NODE_TYPES.has(nodeType) || stage.kind === 'gateway' || stage.taskType === 'routing';
}

export function isActionableWorkflowStage(stage: WorkflowStageRouteNode): boolean {
  if (!stage.isActive) return false;
  if (isAutomatedWorkflowStage(stage) || isRoutingOnlyWorkflowStage(stage)) return false;
  if (normalizeWorkflowNodeType(stage.nodeType) === 'approval_task') return true;
  if (stage.isFinal) return Boolean(stage.assigneeRoleCode);
  if (stage.isStart && !stage.assigneeRoleCode) return false;
  return true;
}

export function firstActionableWorkflowStage<TStage extends WorkflowStageRouteNode>(
  stages: TStage[],
): TStage | null {
  return [...stages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .find((stage) => isActionableWorkflowStage(stage)) ?? null;
}

export function selectWorkflowTransitionForDecision<TEdge extends WorkflowTransitionRouteEdge>(
  transitions: TEdge[],
  fromStageId: string,
  decision?: string | null,
): TEdge | null {
  const outgoing = transitions
    .filter((transition) => transition.fromStageId === fromStageId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (outgoing.length === 0) return null;
  const defaultPath = outgoing.find(isWorkflowDefaultPath) ?? null;
  if (decision === WORKFLOW_RETURN_FOR_CLARIFICATION) {
    return outgoing.find((transition) => normalizeWorkflowConnectorType(transition.connectorType) === 'return') ??
      outgoing.find((transition) => transition.decision === WORKFLOW_RETURN_FOR_CLARIFICATION) ??
      outgoing.find((transition) => transition.decision === 'returned') ??
      outgoing.find((transition) => transition.decision === 'clarification') ??
      outgoing.find((transition) => !transition.isHappyPath) ??
      outgoing.find((transition) => transition.decision === 'rejected') ??
      defaultPath;
  }
  if (decision === 'rejected') {
    return outgoing.find((transition) => normalizeWorkflowConnectorType(transition.connectorType) === 'failure') ??
      outgoing.find((transition) => transition.decision === 'rejected') ??
      outgoing.find((transition) => !transition.isHappyPath) ??
      defaultPath;
  }
  if (decision === 'approved') {
    return outgoing.find((transition) => normalizeWorkflowConnectorType(transition.connectorType) === 'success') ??
      outgoing.find((transition) => transition.decision === 'approved') ??
      outgoing.find((transition) => transition.decision == null && transition.isHappyPath) ??
      outgoing.find((transition) => transition.isHappyPath) ??
      defaultPath;
  }
  return outgoing.find((transition) => normalizeWorkflowConnectorType(transition.connectorType) === 'sequence' && transition.decision == null) ??
    outgoing.find((transition) => transition.decision == null) ??
    outgoing.find((transition) => transition.isHappyPath) ??
    defaultPath ??
    outgoing[0] ??
    null;
}

export function normalizeWorkflowConnectorType(value?: string | null): string {
  const clean = String(value ?? 'sequence').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || 'sequence';
  if (clean === 'return_for_clarification' || clean === 'returned' || clean === 'clarification') return 'return';
  if (clean === 'parallel' || clean === 'parallel_gateway') return 'parallel_split';
  if (clean === 'merge' || clean === 'merge_gateway') return 'merge_join';
  if (clean === 'default_path' || clean === 'otherwise') return 'default';
  if (clean === 'conditional_path' || clean === 'condition') return 'conditional';
  if (WORKFLOW_CONNECTOR_TYPES.some((connector) => connector.code === clean)) return clean;
  return 'sequence';
}

export function isWorkflowDefaultPath(edge: { connectorType?: string | null; isDefaultPath?: boolean | null; decision?: string | null }): boolean {
  return Boolean(edge.isDefaultPath) ||
    normalizeWorkflowConnectorType(edge.connectorType) === 'default' ||
    String(edge.decision ?? '').toLowerCase() === 'default' ||
    String(edge.decision ?? '').toLowerCase() === 'rejected';
}

export function normalizeWorkflowVariableType(value?: string | null): string {
  const clean = String(value ?? 'text').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || 'text';
  if (clean === 'string') return 'text';
  if (clean === 'integer' || clean === 'decimal') return 'number';
  if (clean === 'datetime') return 'date';
  if (['textarea', 'read_only', 'readonly', 'dropdown', 'radio'].includes(clean)) return 'text';
  if (clean === 'checkbox') return 'boolean';
  if (clean === 'multi_select' || clean === 'multiselect') return 'list';
  if (clean === 'file_attachment' || clean === 'file') return 'attachment';
  if ((WORKFLOW_VARIABLE_TYPES as readonly string[]).includes(clean)) return clean;
  if (clean === 'attachment') return 'attachment';
  return 'text';
}

export function buildWorkflowVariableContext(input: {
  decision?: string | null;
  caseId?: string | null;
  caseStatus?: string | null;
  caseType?: string | null;
  assetId?: string | null;
  assetType?: string | null;
  stageCode?: string | null;
  stageKind?: string | null;
  actorUserId?: string | null;
  actorRoles?: string[] | null;
  formRequiredComplete?: boolean | null;
  taskSlaDueDate?: Date | string | null;
  formData?: unknown | null;
}): Record<string, unknown> {
  return {
    decision: input.decision ?? null,
    taskDecision: input.decision ?? null,
    caseId: input.caseId ?? null,
    caseStatus: input.caseStatus ?? null,
    caseType: input.caseType ?? null,
    assetId: input.assetId ?? null,
    assetType: input.assetType ?? null,
    stageCode: input.stageCode ?? null,
    stageKind: input.stageKind ?? null,
    actorUserId: input.actorUserId ?? null,
    actorRoles: input.actorRoles ?? [],
    formRequiredComplete: Boolean(input.formRequiredComplete),
    taskSlaDueDate: input.taskSlaDueDate ? new Date(input.taskSlaDueDate).toISOString() : null,
    formData: input.formData ?? {},
    case: {
      id: input.caseId ?? null,
      status: input.caseStatus ?? null,
      type: input.caseType ?? null,
    },
    asset: {
      id: input.assetId ?? null,
      type: input.assetType ?? null,
    },
    task: {
      decision: input.decision ?? null,
      formRequiredComplete: Boolean(input.formRequiredComplete),
      slaDueDate: input.taskSlaDueDate ? new Date(input.taskSlaDueDate).toISOString() : null,
    },
    stage: {
      code: input.stageCode ?? null,
      kind: input.stageKind ?? null,
    },
    actor: {
      user: input.actorUserId ?? null,
      roles: input.actorRoles ?? [],
    },
  };
}

export function workflowTemplateConfigurationStatus(template: WorkflowConfigurationTemplate): WorkflowConfigurationStatus {
  if (!template.isActive) return 'blocked';
  if (!template.stages.length) return 'blocked';
  const activeStages = template.stages.filter((stage) => stage.isActive);
  if (!activeStages.length) return 'blocked';
  if (activeStages.filter((stage) => stage.isStart).length !== 1) return 'blocked';
  if (!activeStages.some((stage) => stage.isFinal)) return 'watch';
  if (!activeStages.some((stage) => stage.isDecision)) return 'watch';
  if (!template.transitions.length && activeStages.length > 1) return 'watch';
  return 'ready';
}

export function buildWorkflowCaseTypeRegistry(
  templates: WorkflowConfigurationTemplate[],
  knownCaseTypes: readonly string[] = WORKFLOW_CASE_TYPES,
): WorkflowCaseTypeRegistryItem[] {
  return [...knownCaseTypes].sort().map((caseType) => {
    const matches = templates.filter((template) => template.caseType === caseType);
    const active = matches.filter((template) => template.isActive);
    const stageCount = active.reduce((sum, template) => sum + template.stages.filter((stage) => stage.isActive).length, 0);
    const statuses = active.map(workflowTemplateConfigurationStatus);
    const status: WorkflowConfigurationStatus =
      active.length === 0 ? 'blocked' : statuses.includes('blocked') ? 'blocked' : statuses.includes('watch') ? 'watch' : 'ready';
    const defaultSlaDays =
      active.length > 0
        ? Math.max(1, Math.round(active.reduce((sum, template) => sum + template.defaultSlaDays, 0) / active.length))
        : null;
    return {
      caseType,
      templateCount: matches.length,
      routeCodes: active.map((template) => template.code),
      stageCount,
      defaultSlaDays,
      hasDecisionPoint: active.some((template) => template.stages.some((stage) => stage.isActive && stage.isDecision)),
      hasClosurePoint: active.some((template) => template.stages.some((stage) => stage.isActive && stage.isFinal)),
      hasActiveRoute: active.length > 0,
      status,
    };
  });
}

export function workflowNodePalette(priority?: WorkflowNodePriority): WorkflowNodeTypeDefinition[] {
  return WORKFLOW_NODE_TYPES.filter((node) => !priority || node.priority === priority);
}

export function workflowEndOutcomes(stage?: { gatewayConfigJson?: unknown | null } | null): string[] {
  const config = asRecord(stage?.gatewayConfigJson);
  const configured = Array.isArray(config['outcomes']) ? config['outcomes'].map(String).filter(Boolean) : [];
  return configured.length ? configured : [...WORKFLOW_END_OUTCOMES];
}

export function buildWorkflowMvpReadinessGate(
  templates: WorkflowConfigurationTemplate[],
  evidence: {
    testRunCount?: number;
    automatedExecutionCount?: number;
    operationalReportReady?: boolean;
    timerNotificationConfigured?: boolean;
  } = {},
) {
  const activeTemplates = templates.filter((template) => template.isActive);
  const templateStatuses = activeTemplates.map(workflowTemplateConfigurationStatus);
  const hasAnyActiveRoute = activeTemplates.length > 0;
  const allRoutesStartSafe = activeTemplates.every(
    (template) => template.stages.filter((stage) => stage.isActive && stage.isStart).length === 1,
  );
  const allRoutesHaveEnd = activeTemplates.every((template) =>
    template.stages.some((stage) => stage.isActive && stage.isFinal),
  );
  const paletteNodes = workflowNodePalette('core');
  const paletteReady = WORKFLOW_CORE_NODE_CODES.every((code) =>
    paletteNodes.some((node) => node.code === code),
  );
  const decisionSupportReady = WORKFLOW_CONNECTOR_TYPES.some((connector) =>
    connector.outcomes.includes(WORKFLOW_RETURN_FOR_CLARIFICATION),
  );
  const publishEvidenceReady = templateStatuses.every((status) => status === 'ready' || status === 'watch');

  const criteria = WORKFLOW_ACCEPTANCE_CRITERIA.map(([code, label, trace, priority]) => {
    let status: WorkflowConfigurationStatus = 'watch';
    if (code === 'AC-WF-01') {
      status = hasAnyActiveRoute ? 'ready' : 'blocked';
    } else if (code === 'AC-WF-02') {
      status = paletteReady ? 'ready' : 'blocked';
    } else if (code === 'AC-WF-03') {
      status = WORKFLOW_CONNECTOR_TYPES.length >= 6 ? 'ready' : 'blocked';
    } else if (code === 'AC-WF-06') {
      status = decisionSupportReady ? 'ready' : 'blocked';
    } else if (code === 'AC-WF-07') {
      status = WORKFLOW_CONNECTOR_TYPES.some((connector) => connector.code === 'parallel_split') &&
        WORKFLOW_CONNECTOR_TYPES.some((connector) => connector.code === 'merge_join')
        ? 'ready'
        : 'blocked';
    } else if (code === 'AC-WF-08') {
      const advancedNodesRegistered = ['timer_event', 'notification_task'].every((nodeCode) =>
        WORKFLOW_NODE_TYPES.some((node) => node.code === nodeCode),
      );
      status = advancedNodesRegistered && evidence.timerNotificationConfigured ? 'ready' : 'watch';
    } else if (code === 'AC-WF-09') {
      status = allRoutesStartSafe && allRoutesHaveEnd ? 'ready' : 'blocked';
    } else if (code === 'AC-WF-10') {
      status = (evidence.testRunCount ?? 0) > 0 ? 'ready' : 'watch';
    } else if (code === 'AC-WF-11') {
      status = publishEvidenceReady ? 'ready' : 'watch';
    } else if (code === 'AC-WF-14') {
      status = (evidence.automatedExecutionCount ?? 0) > 0 ? 'ready' : 'watch';
    } else if (code === 'AC-WF-17') {
      status = evidence.operationalReportReady ? 'ready' : 'watch';
    } else {
      status = hasAnyActiveRoute ? 'ready' : 'watch';
    }
    return { code, label, trace, priority, status };
  });
  const blockers = criteria.filter((item) => item.status === 'blocked');
  const watch = criteria.filter((item) => item.status === 'watch');
  const status: WorkflowConfigurationStatus = blockers.length ? 'blocked' : watch.length ? 'watch' : 'ready';
  return {
    status,
    summary: {
      acceptanceCriteria: criteria.length,
      ready: criteria.filter((item) => item.status === 'ready').length,
      watch: watch.length,
      blocked: blockers.length,
      corePaletteNodes: paletteNodes.length,
      coreNodesRegistered: paletteNodes.length,
      requiredCoreNodes: WORKFLOW_CORE_NODE_CODES.length,
      activeRoutes: activeTemplates.length,
      templatesChecked: activeTemplates.length,
      connectorTypes: WORKFLOW_CONNECTOR_TYPES.length,
      testRunCount: evidence.testRunCount ?? 0,
      automatedExecutionCount: evidence.automatedExecutionCount ?? 0,
      operationalReportReady: Boolean(evidence.operationalReportReady),
      publishEvidenceReady,
      exactlyOneStartPolicy: allRoutesStartSafe,
      endOutcomeModel: [...WORKFLOW_END_OUTCOMES],
    },
    criteria,
    nodePalette: WORKFLOW_NODE_TYPES,
    connectorTypes: WORKFLOW_CONNECTOR_TYPES,
    designerLifecycle: WORKFLOW_DESIGNER_LIFECYCLE,
    productionPilotGuardrails: PRODUCTION_PILOT_GUARDRAILS,
  };
}

export function buildWorkflowSlaTemplates(templates: WorkflowConfigurationTemplate[]): WorkflowSlaTemplateItem[] {
  return templates
    .filter((template) => template.isActive)
    .map((template) => {
      const activeStages = template.stages.filter((stage) => stage.isActive);
      const stageSlaDays = activeStages.reduce((sum, stage) => sum + Math.max(stage.dueDays, 0), 0);
      const defaultSlaDays = Math.max(template.defaultSlaDays, stageSlaDays, 1);
      const hasAssignedReviewStep = activeStages.some((stage) => stage.assigneeRoleCode && !stage.isFinal);
      return {
        code: template.code,
        caseType: template.caseType,
        defaultSlaDays,
        stageSlaDays,
        escalationAfterDays: Math.max(defaultSlaDays + 2, 3),
        status: activeStages.length && hasAssignedReviewStep ? 'ready' : 'watch',
      };
    });
}

export function buildWorkflowNotificationRules(templates: WorkflowConfigurationTemplate[]) {
  return templates
    .filter((template) => template.isActive)
    .flatMap((template) =>
      template.stages
        .filter((stage) => stage.isActive && stage.assigneeRoleCode)
        .map((stage) => ({
          code: `${template.code}:${stage.code}:notify`,
          templateCode: template.code,
          caseType: template.caseType,
          stageCode: stage.code,
          targetRoleCode: stage.assigneeRoleCode,
          trigger: stage.dueDays <= 1 ? 'on_assignment_and_due_soon' : 'on_assignment_and_at_risk',
          status: 'ready' as WorkflowConfigurationStatus,
        })),
    );
}

export function buildWorkflowEscalationTemplates(templates: WorkflowConfigurationTemplate[]) {
  return templates
    .filter((template) => template.isActive)
    .flatMap((template) =>
      template.stages
        .filter((stage) => stage.isActive && !stage.isFinal)
        .map((stage) => ({
          code: `${template.code}:${stage.code}:escalate`,
          templateCode: template.code,
          caseType: template.caseType,
          stageCode: stage.code,
          triggerAfterBusinessDays: Math.max(stage.dueDays + 2, 2),
          targetRoleCode: stage.assigneeRoleCode ?? 'dmo_admin',
          status: stage.assigneeRoleCode ? 'ready' : 'watch' as WorkflowConfigurationStatus,
        })),
    );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanDmnString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeDmnConditions(value: unknown): Array<{ path: string; operator: string; value?: unknown }> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const row = asRecord(item);
      const path = cleanDmnString(row['path'] ?? row['field'] ?? row['name']);
      if (!path) return [];
      return [{ path, operator: cleanDmnString(row['operator'] ?? row['op']) ?? 'eq', value: row['value'] ?? row['equals'] }];
    });
  }
  const row = asRecord(value);
  return Object.entries(row).map(([path, expected]) => ({ path, operator: 'eq', value: expected }));
}

function dmnConditionMatches(
  condition: { path: string; operator: string; value?: unknown },
  context: Record<string, unknown>,
): boolean {
  const actual = readPath(context, condition.path);
  const expected = condition.value;
  switch (condition.operator) {
    case 'neq':
    case 'ne':
    case 'does_not_equal':
      return String(actual) !== String(expected);
    case 'in':
      return Array.isArray(expected) && expected.map(String).includes(String(actual));
    case 'not_in':
      return Array.isArray(expected) && !expected.map(String).includes(String(actual));
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'exists':
    case 'is_not_empty':
      return hasPresentValue(actual);
    case 'empty':
    case 'is_empty':
      return !hasPresentValue(actual);
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'not_contains':
    case 'does_not_contain':
      return !String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'equals':
    case 'eq':
    default:
      return String(actual) === String(expected);
  }
}

function workflowFormFields(schema: unknown): Array<{ name: string; label: string; type: string; required: boolean; allowed: unknown[] }> {
  const root = asRecord(schema);
  const rawFields = [
    ...(Array.isArray(root['fields']) ? root['fields'] : []),
    ...(Array.isArray(root['sections'])
      ? root['sections'].flatMap((section) => Array.isArray(asRecord(section)['fields']) ? asRecord(section)['fields'] as unknown[] : [])
      : []),
  ];
  const required = new Set((Array.isArray(root['required']) ? root['required'] : []).map(String));
  if (rawFields.length === 0) {
    return [...required].map((name) => ({ name, label: name, type: 'text', required: true, allowed: [] }));
  }
  return rawFields.flatMap((raw) => {
    if (typeof raw === 'string') {
      return [{ name: raw, label: raw, type: 'text', required: required.has(raw), allowed: [] }];
    }
    const row = asRecord(raw);
    const name = cleanDmnString(row['name'] ?? row['code'] ?? row['field'] ?? row['key']);
    if (!name) return [];
    return [{
      name,
      label: cleanDmnString(row['label'] ?? row['title'] ?? name) ?? name,
      type: normalizeWorkflowVariableType(cleanDmnString(row['type'] ?? row['fieldType'] ?? row['variableType']) ?? 'text'),
      required: row['required'] === true || required.has(name),
      allowed: Array.isArray(row['allowed'])
        ? row['allowed']
        : Array.isArray(row['allowedValues'])
          ? row['allowedValues']
          : Array.isArray(row['options'])
            ? row['options']
            : [],
    }];
  });
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function hasPresentValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function stageComparable(stage: { nameEn?: string | null; assigneeRoleCode?: string | null; dueDays?: number | null; isDecision?: boolean; isFinal?: boolean }) {
  return {
    nameEn: stage.nameEn ?? null,
    assigneeRoleCode: stage.assigneeRoleCode ?? null,
    dueDays: stage.dueDays ?? null,
    isDecision: Boolean(stage.isDecision),
    isFinal: Boolean(stage.isFinal),
  };
}

function transitionKey(edge: { fromStageId: string; toStageId: string; decision?: string | null; labelEn?: string | null }): string {
  return `${edge.fromStageId}->${edge.toStageId}:${edge.decision ?? edge.labelEn ?? 'default'}`;
}
