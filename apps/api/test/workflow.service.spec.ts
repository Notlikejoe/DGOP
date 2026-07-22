/**
 * Lightweight unit tests for the workflow engine: SLA derivation, decision
 * authority, segregation of duties and assignment-approval wiring.
 * (no jest dependency). Run with: ts-node test/workflow.service.spec.ts
 */
import assert from 'node:assert';
import { WorkflowService } from '../src/workflow/workflow.service';
import {
  DEFAULT_WORKFLOW_TEMPLATES,
  buildWorkflowCaseTypeRegistry,
  buildWorkflowEscalationTemplates,
  buildWorkflowNotificationRules,
  buildWorkflowSlaTemplates,
  firstActionableWorkflowStage,
  routeGateForOpenStagePeers,
  selectWorkflowTransitionForDecision,
  selectWorkflowTemplate,
  workflowTemplateConfigurationStatus,
  workflowHealth,
} from '../src/workflow/workflow.logic';
import {
  parseBpmnXml,
  simulateWorkflowRoute,
  templateToBpmnXml,
  validateWorkflowRoute,
} from '../src/workflow/workflow.bpmn';

const DAY = 24 * 60 * 60 * 1000;

type Over = {
  task?: any;
  case?: any;
  assignment?: any;
  assignmentUpdate?: any;
  template?: any;
  templates?: any[];
  createdTasks?: any[];
  caseUpdates?: any[];
  workflowCases?: any[];
  caseFindManyArgs?: any;
  caseFindFirstArgs?: any[];
  caseFindFirstResult?: any;
  taskBulkUpdates?: any[];
  taskUpdates?: any[];
  tasks?: any[];
  taskFindManyArgs?: any;
  events?: any[];
  auditEntries?: any[];
  submitter?: any;
  visibleAssets?: { id: string }[];
  scope?: any;
  scopeForRoles?: (roleCodes: string[]) => any;
  userRoleCandidates?: any[];
  userRoleCandidatesByRole?: Record<string, any[]>;
  setCalls?: any[][];
};

function makeService(over: Over): WorkflowService {
  const prisma: any = {
    $transaction: async (fn: (client: any) => unknown) => fn(prisma),
    workflowTask: {
      findUnique: async () => over.task ?? null,
      count: async () => 0,
      update: async ({ data }: any) => {
        (over.taskUpdates ??= []).push(data);
        return { ...over.task, ...data, assignee: null };
      },
      updateMany: async ({ data }: any) => {
        (over.taskBulkUpdates ??= []).push(data);
        return { count: 1 };
      },
      findMany: async (args: any) => {
        over.taskFindManyArgs = args;
        return over.tasks ?? [];
      },
      create: async ({ data }: any) => {
        (over.createdTasks ??= []).push(data);
        return { id: `task-${over.createdTasks.length}`, ...data, assignee: null };
      },
    },
    workflowCase: {
      update: async ({ data }: any) => {
        (over.caseUpdates ??= []).push(data);
        return { ...(over.case ?? { id: 'case-new' }), ...data, tasks: [], asset: null, assignment: null };
      },
      create: async ({ data }: any) => ({ id: 'case-new', ...data, tasks: [], asset: null, assignment: null }),
      findUnique: async () => over.case ?? ({ id: 'case-new', status: 'draft', assetId: null, tasks: [], asset: null, assignment: null }),
      findFirst: async (args: any) => {
        (over.caseFindFirstArgs ??= []).push(args);
        if ('caseFindFirstResult' in over) return over.caseFindFirstResult;
        return over.case ?? ({ id: 'case-new', status: 'submitted', assetId: null, tasks: [], asset: null, assignment: null });
      },
      findMany: async (args: any) => {
        over.caseFindManyArgs = args;
        return over.workflowCases ?? [];
      },
      count: async () => over.workflowCases?.length ?? 0,
    },
    workflowTemplate: {
      findUnique: async () => over.template ?? null,
      findFirst: async (args: any) => over.templates?.find((template) => template.id === args.where?.id) ?? over.template ?? null,
      findMany: async () => over.templates ?? [],
    },
    workflowEvent: {
      create: async (args: any) => {
        (over.events ??= []).push(args.data);
        return args.data;
      },
      createMany: async (args: any) => {
        (over.events ??= []).push(...args.data);
        return { count: args.data.length };
      },
      findMany: async () => over.events ?? [],
    },
    auditLog: {
      create: async (args: any) => {
        (over.auditEntries ??= []).push(args.data);
        return args.data;
      },
    },
    userRole: {
      findFirst: async () => ({ userId: 'u-next' }),
      findMany: async (args: any) => {
        const roleCode = args.where?.role?.code;
        if (over.userRoleCandidatesByRole) return over.userRoleCandidatesByRole[roleCode] ?? [];
        return over.userRoleCandidates ?? [
          {
            userId: 'u-next',
            user: {
              userRoles: [{ role: { code: 'data_owner', isActive: true, deletedAt: null } }],
            },
          },
        ];
      },
    },
    user: { findFirst: async () => over.submitter ?? null },
    dataAsset: {
      findMany: async () => over.visibleAssets ?? [],
      findFirst: async (args: any) => {
        if (Array.isArray(args.where?.domainId?.in) && args.where.domainId.in.length === 0) return null;
        if (Array.isArray(args.where?.orgUnitId?.in) && args.where.orgUnitId.in.length === 0) return null;
        return { id: args.where?.id ?? 'asset-1' };
      },
      update: async () => ({}),
    },
    stewardshipAssignment: {
      findFirst: async (args: any) => (args.where?.id ? over.assignment ?? null : null),
      update: async (args: any) => {
        over.assignmentUpdate = args.data;
        return { ...(over.assignment ?? {}), ...args.data };
      },
    },
  };
  const audit = {
    log: async (entry: any) => {
      (over.auditEntries ??= []).push(entry);
    },
  };
  const scope = {
    resolve: async (roleCodes: string[]) =>
      over.scopeForRoles?.(roleCodes) ?? over.scope ?? ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
  };
  const assignments = {
    getAssignment: async () => over.assignment,
    setApprovalStatus: async (...args: any[]) => {
      (over.setCalls ??= []).push(args);
    },
  };
  return new WorkflowService(
    prisma as never,
    audit as never,
    scope as never,
    assignments as never,
  );
}

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

// ---------- SLA derivation ----------
test('slaOf: completed task is done', () => {
  const svc = makeService({});
  assert.strictEqual(svc.slaOf({ status: 'completed' as never, dueDate: null, completedAt: new Date() }), 'done');
});

test('configuration is read-only and does not seed default templates', async () => {
  const svc = makeService({ templates: [], workflowCases: [] });
  const result = await svc.configuration(['system_admin'], {
    id: 'admin',
    email: 'admin@dgop.local',
    roles: ['system_admin'],
  });

  assert.strictEqual(result.summary.templates, 0);
  assert.strictEqual(result.summary.totalCases, 0);
  assert.ok(result.caseTypeRegistry.length > 0);
  assert.ok(result.caseTypeRegistry.every((row) => !row.hasActiveRoute));
});

test('updateCase: rejects invalid status transitions', async () => {
  const svc = makeService({
    case: { id: 'c1', status: 'draft', assetId: null },
  });
  await assert.rejects(
    () => svc.updateCase('c1', { status: 'approved' } as never, ['system_admin'], 'actor'),
    /Invalid workflow case transition/,
  );
});

test('updateCase: routed cases cannot bypass task decisions with manual status edits', async () => {
  const svc = makeService({
    case: { id: 'c1', status: 'submitted', assetId: null, templateId: 'tpl-1' },
  });
  await assert.rejects(
    () => svc.updateCase('c1', { status: 'approved' } as never, ['system_admin'], 'actor'),
    /controlled by task decisions/,
  );
});

test('recordDomainCaseProgress: walks valid status path and completes open tasks', async () => {
  const over: Over = {
    case: { id: 'c1', status: 'submitted', assetId: null },
    caseUpdates: [],
    taskBulkUpdates: [],
    events: [],
  };
  const svc = makeService(over);
  await svc.recordDomainCaseProgress({
    caseId: 'c1',
    roleCodes: ['system_admin'],
    actor: 'actor@dgop.local',
    targetStatus: 'decision_made' as never,
    eventAction: 'domain.decision.recorded',
    comment: 'Decision recorded by domain engine.',
    completeOpenTasks: true,
  });

  assert.deepStrictEqual(over.taskBulkUpdates?.map((row) => row.status), ['completed']);
  assert.deepStrictEqual(over.caseUpdates?.map((row) => row.status), ['under_review', 'decision_made']);
  assert.ok(over.events?.some((event) => event.action === 'domain.decision.recorded'));
});

test('recordDomainTaskDecision: completes task and advances configured route', async () => {
  const over: Over = {
    createdTasks: [],
    caseUpdates: [],
    taskUpdates: [],
    events: [],
    task: {
      id: 't1',
      assigneeUserId: 'u1',
      status: 'pending',
      caseId: 'c1',
      templateStageId: 'stage-review',
      case: {
        id: 'c1',
        type: 'general',
        status: 'submitted',
        createdBy: 'x@dgop.local',
        assignmentId: null,
        templateId: 'template-1',
        assetId: null,
      },
    },
    template: {
      stages: [
        {
          id: 'stage-review',
          code: 'review',
          nameEn: 'Review',
          nameAr: 'Review',
          kind: 'review',
          taskType: 'review',
          assigneeRoleCode: 'data_steward',
          dueDays: 1,
          sortOrder: 1,
          isStart: false,
          isDecision: false,
          isFinal: false,
          isActive: true,
        },
        {
          id: 'stage-decision',
          code: 'decision',
          nameEn: 'Decision',
          nameAr: 'Decision',
          kind: 'decision',
          taskType: 'approval',
          assigneeRoleCode: 'data_owner',
          dueDays: 2,
          sortOrder: 2,
          isStart: false,
          isDecision: true,
          isFinal: false,
          isActive: true,
        },
      ],
      transitions: [
        {
          id: 'transition-1',
          fromStageId: 'stage-review',
          toStageId: 'stage-decision',
          decision: null,
          isHappyPath: true,
          sortOrder: 1,
          toStage: { id: 'stage-decision', code: 'decision' },
        },
      ],
    },
  };
  const svc = makeService(over);
  await svc.recordDomainTaskDecision({
    taskId: 't1',
    roleCodes: ['system_admin'],
    actor: 'actor@dgop.local',
    decision: 'approved' as never,
    comment: 'Approved by domain step.',
    eventAction: 'domain.task.approved',
  });

  assert.strictEqual(over.taskUpdates?.[0].status, 'completed');
  assert.strictEqual(over.createdTasks?.[0].templateStageId, 'stage-decision');
  assert.strictEqual(over.caseUpdates?.[0].status, 'under_review');
  assert.ok(over.events?.some((event) => event.action === 'domain.task.approved'));
});

test('workflow templates: default routes include graphable stages and transitions', () => {
  const dq = DEFAULT_WORKFLOW_TEMPLATES.find((template) => template.caseType === 'data_quality_issue');
  assert.ok(dq);
  assert.ok(dq.stages.length >= 5);
  assert.ok(dq.transitions.some((transition) => transition.isHappyPath === false));
});

test('BPMN designer: exports default route XML and parses it back into executable stages', () => {
  const dq = DEFAULT_WORKFLOW_TEMPLATES.find((template) => template.caseType === 'data_quality_issue');
  assert.ok(dq);
  const stages = dq.stages.map((stage, index) => ({
    id: stage.code,
    code: stage.code,
    nameEn: stage.nameEn,
    nameAr: stage.nameAr,
    description: stage.description,
    kind: stage.kind,
    taskType: stage.taskType,
    assigneeRoleCode: stage.assigneeRoleCode ?? null,
    dueDays: stage.dueDays,
    sortOrder: index + 1,
    isStart: Boolean(stage.isStart),
    isDecision: Boolean(stage.isDecision),
    isFinal: Boolean(stage.isFinal),
    isActive: true,
  }));
  const xml = templateToBpmnXml({
    id: 'tpl-dq',
    code: dq.code,
    caseType: dq.caseType,
    nameEn: dq.nameEn,
    nameAr: dq.nameAr,
    description: dq.description,
    defaultSlaDays: dq.defaultSlaDays,
    stages,
    transitions: dq.transitions.map((transition, index) => ({
      fromStageId: transition.from,
      toStageId: transition.to,
      labelEn: transition.labelEn,
      labelAr: transition.labelAr,
      decision: transition.decision ?? null,
      isHappyPath: transition.isHappyPath ?? true,
      sortOrder: index + 1,
    })),
  });
  const parsed = parseBpmnXml(xml);
  assert.strictEqual(parsed.validation.status, 'warning');
  assert.ok(parsed.validation.readinessScore > 0);
  assert.ok(parsed.validation.checklist.some((item) => item.code === 'route_shape' && item.status === 'pass'));
  assert.ok(parsed.stages.some((stage) => stage.code === 'validate' && stage.isDecision));
  assert.ok(parsed.transitions.some((transition) => transition.decision === 'rejected'));
});

test('BPMN designer: validation blocks routes without a final stage', () => {
  const validation = validateWorkflowRoute(
    [
      {
        code: 'intake',
        nameEn: 'Intake',
        nameAr: 'Intake',
        kind: 'intake',
        taskType: 'information',
        assigneeRoleCode: 'dmo_admin',
        dueDays: 1,
        sortOrder: 1,
        isStart: true,
        isDecision: false,
        isFinal: false,
        isActive: true,
      },
    ],
    [],
  );
  assert.strictEqual(validation.status, 'blocked');
  assert.ok(validation.errors.some((message) => message.includes('final stage')));
});

test('BPMN designer: simulation previews task path and governance requirements', () => {
  const stages = [
    {
      code: 'intake',
      nameEn: 'Intake',
      nameAr: 'Intake',
      kind: 'intake',
      nodeType: 'user_task',
      taskType: 'information',
      assignmentStrategy: 'role',
      assigneeRoleCode: 'dmo_admin',
      dueDays: 1,
      formSchemaJson: { fields: ['title'] },
      notificationRulesJson: [{ event: 'created' }],
      sortOrder: 1,
      isStart: true,
      isDecision: false,
      isFinal: false,
      isActive: true,
    },
    {
      code: 'approve',
      nameEn: 'Approve',
      nameAr: 'Approve',
      kind: 'decision',
      nodeType: 'user_task',
      taskType: 'approval',
      assignmentStrategy: 'role',
      assigneeRoleCode: 'data_owner',
      dueDays: 2,
      evidenceRequirementsJson: [{ name: 'Decision evidence' }],
      notificationRulesJson: [{ event: 'assigned' }],
      sortOrder: 2,
      isStart: false,
      isDecision: true,
      isFinal: false,
      isActive: true,
    },
    {
      code: 'close',
      nameEn: 'Close',
      nameAr: 'Close',
      kind: 'closure',
      nodeType: 'user_task',
      taskType: 'approval',
      assignmentStrategy: 'role',
      assigneeRoleCode: 'dmo_admin',
      dueDays: 1,
      evidenceRequirementsJson: [{ name: 'Closure note' }],
      notificationRulesJson: [{ event: 'completed' }],
      sortOrder: 3,
      isStart: false,
      isDecision: false,
      isFinal: true,
      isActive: true,
    },
  ];
  const simulation = simulateWorkflowRoute(stages, [
    { fromStageId: 'intake', toStageId: 'approve', labelEn: 'Ready', labelAr: 'Ready', isHappyPath: true, sortOrder: 1 },
    { fromStageId: 'approve', toStageId: 'close', labelEn: 'Approved', labelAr: 'Approved', decision: 'approved', isHappyPath: true, sortOrder: 2 },
  ]);

  assert.strictEqual(simulation.status, 'warning');
  assert.deepStrictEqual(simulation.path.map((step) => step.code), ['intake', 'approve', 'close']);
  assert.strictEqual(simulation.summary.estimatedSlaDays, 4);
  assert.strictEqual(simulation.summary.evidenceItems, 2);
});

test('workflow templates: v5 universal case types have dedicated route templates', () => {
  const required = [
    'open_data_publication_approval',
    'metadata_certification',
    'architecture_review',
    'business_glossary_term',
    'asset_lifecycle_decision',
    'business_impact_assessment',
    'compliance_calendar',
  ];
  for (const caseType of required) {
    assert.ok(DEFAULT_WORKFLOW_TEMPLATES.some((template) => template.caseType === caseType), caseType);
  }
});

test('workflow configuration builders expose case registry, SLA, notifications, and escalations', () => {
  const templates = DEFAULT_WORKFLOW_TEMPLATES.map((template, templateIndex) => {
    const stageIds = new Map(template.stages.map((stage, index) => [stage.code, `stage-${templateIndex}-${index}`]));
    return {
      id: `template-${templateIndex}`,
      code: template.code,
      caseType: template.caseType,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
      trigger: template.trigger,
      defaultSlaDays: template.defaultSlaDays,
      isSystem: true,
      isActive: true,
      domainId: null,
      stages: template.stages.map((stage, index) => ({
        id: stageIds.get(stage.code)!,
        code: stage.code,
        kind: stage.kind,
        taskType: stage.taskType,
        assigneeRoleCode: stage.assigneeRoleCode ?? null,
        dueDays: stage.dueDays,
        sortOrder: index + 1,
        isStart: Boolean(stage.isStart),
        isDecision: Boolean(stage.isDecision),
        isFinal: Boolean(stage.isFinal),
        isActive: true,
      })),
      transitions: template.transitions.map((transition) => ({
        fromStageId: stageIds.get(transition.from)!,
        toStageId: stageIds.get(transition.to)!,
        decision: transition.decision ?? null,
        isHappyPath: transition.isHappyPath ?? true,
      })),
    };
  });
  const registry = buildWorkflowCaseTypeRegistry(templates);
  const slaTemplates = buildWorkflowSlaTemplates(templates);
  const notifications = buildWorkflowNotificationRules(templates);
  const escalations = buildWorkflowEscalationTemplates(templates);

  assert.equal(registry.every((item) => item.hasActiveRoute), true);
  assert.equal(registry.some((item) => item.caseType === 'compliance_calendar'), true);
  assert.equal(slaTemplates.length, templates.length);
  assert.equal(notifications.length > templates.length, true);
  assert.equal(escalations.length > templates.length, true);
  assert.equal(workflowTemplateConfigurationStatus(templates[0]), 'ready');
});

test('workflow routes: first actionable stage skips passive intake nodes', () => {
  const dq = DEFAULT_WORKFLOW_TEMPLATES.find((template) => template.caseType === 'data_quality_issue');
  assert.ok(dq);
  const stage = firstActionableWorkflowStage(
    dq.stages.map((row, index) => ({
      id: row.code,
      sortOrder: index + 1,
      dueDays: row.dueDays,
      isStart: Boolean(row.isStart),
      isFinal: Boolean(row.isFinal),
      isActive: true,
      assigneeRoleCode: row.assigneeRoleCode ?? null,
    })),
  );
  assert.strictEqual(stage?.id, 'triage');
});

test('workflow routes: rejected decisions follow the non-happy transition', () => {
  const transition = selectWorkflowTransitionForDecision(
    [
      { fromStageId: 'decision', toStageId: 'close', decision: 'approved', isHappyPath: true, sortOrder: 1 },
      { fromStageId: 'decision', toStageId: 'review', decision: 'rejected', isHappyPath: false, sortOrder: 2 },
    ],
    'decision',
    'rejected',
  );
  assert.strictEqual(transition?.toStageId, 'review');
});

test('workflow designer publish retires old transitions instead of hard deleting them', async () => {
  const svc = makeService({});
  const retired: unknown[] = [];
  const created: unknown[] = [];
  const tx: any = {
    workflowTemplateStage: {
      findMany: async () => [
        { id: 'stage-intake-old', code: 'intake' },
        { id: 'stage-review-old', code: 'review' },
      ],
      update: async ({ where, data }: any) => ({ id: where.id, ...data }),
      create: async ({ data }: any) => ({ id: `stage-${data.code}`, ...data }),
      updateMany: async () => ({ count: 0 }),
    },
    workflowTemplateTransition: {
      updateMany: async (args: any) => {
        retired.push(args);
        return { count: 1 };
      },
      create: async (args: any) => {
        created.push(args.data);
        return { id: `transition-${created.length}`, ...args.data };
      },
      deleteMany: async () => {
        throw new Error('workflow route publish must not hard delete transitions');
      },
    },
  };

  await (svc as any).applyPublishedBpmnRoute(
    tx,
    'tpl-1',
    [
      {
        code: 'intake',
        nameEn: 'Intake',
        nameAr: 'Intake',
        description: null,
        kind: 'intake',
        taskType: 'review',
        assigneeRoleCode: 'data_steward',
        dueDays: 1,
        sortOrder: 1,
        isStart: true,
        isDecision: false,
        isFinal: false,
        isActive: true,
      },
      {
        code: 'review',
        nameEn: 'Review',
        nameAr: 'Review',
        description: null,
        kind: 'review',
        taskType: 'approval',
        assigneeRoleCode: 'data_owner',
        dueDays: 2,
        sortOrder: 2,
        isStart: false,
        isDecision: false,
        isFinal: true,
        isActive: true,
      },
    ],
    [
      {
        fromStageId: 'intake',
        toStageId: 'review',
        labelEn: 'Ready',
        labelAr: 'Ready',
        decision: null,
        isHappyPath: true,
        sortOrder: 1,
      },
    ],
    'admin@dgop.local',
  );

  assert.strictEqual(retired.length, 1);
  assert.deepStrictEqual((retired[0] as any).where, { templateId: 'tpl-1', isActive: true });
  assert.strictEqual((retired[0] as any).data.isActive, false);
  assert.strictEqual((retired[0] as any).data.retiredBy, 'admin@dgop.local');
  assert.strictEqual((created[0] as any).isActive, true);
});

test('selectWorkflowTemplate: chooses domain route before generic case route', () => {
  const selected = selectWorkflowTemplate(
    { caseType: 'data_quality_issue', domainId: 'domain-finance' },
    [
      { id: 'generic', code: 'GEN', caseType: 'data_quality_issue', domainId: null, isActive: true },
      { id: 'finance', code: 'FIN', caseType: 'data_quality_issue', domainId: 'domain-finance', isActive: true },
    ],
  );
  assert.strictEqual(selected?.id, 'finance');
});

test('selectWorkflowTemplate: falls back to the generic governance route', () => {
  const selected = selectWorkflowTemplate(
    { caseType: 'unknown_case' },
    [
      { id: 'general', code: 'GEN', caseType: 'general', domainId: null, isActive: true },
    ],
  );
  assert.strictEqual(selected?.id, 'general');
});

test('workflowHealth: overdue tasks make a route critical', () => {
  assert.strictEqual(workflowHealth(2, 1), 'critical');
  assert.strictEqual(workflowHealth(2, 0), 'review');
  assert.strictEqual(workflowHealth(0, 0), 'healthy');
});

test('route gate: blocks stage advance while peer tasks are still open', () => {
  assert.strictEqual(routeGateForOpenStagePeers(0).allowed, true);
  const blocked = routeGateForOpenStagePeers(2);
  assert.strictEqual(blocked.allowed, false);
  assert.ok(blocked.reason?.includes('active tasks'));
});

test('route backfill attaches legacy open cases and tasks to matching templates', async () => {
  const template = {
    id: 'tpl-dq',
    code: 'WF-DQ-REMEDIATION',
    caseType: 'data_quality_issue',
    nameEn: 'Quality remediation route',
    nameAr: 'Quality remediation route',
    trigger: 'data_quality_issue',
    defaultSlaDays: 7,
    domainId: null,
    isSystem: true,
    isActive: true,
    stages: [
      {
        id: 'stage-triage',
        code: 'triage',
        nameEn: 'Triage',
        nameAr: 'Triage',
        kind: 'triage',
        taskType: 'review',
        assigneeRoleCode: 'dq_steward',
        dueDays: 1,
        sortOrder: 1,
        isStart: false,
        isDecision: false,
        isFinal: false,
        isActive: true,
      },
    ],
    transitions: [],
    _count: { cases: 0, stages: 1 },
  };
  const over: Over = {
    templates: [template],
    workflowCases: [
      {
        id: 'case-legacy',
        code: 'WFC-DQI-OLD',
        type: 'data_quality_issue',
        status: 'submitted',
        assetId: 'asset-1',
        createdBy: 'seed',
        asset: { domainId: null },
        tasks: [{ id: 'task-legacy', templateStageId: null, createdAt: new Date() }],
      },
    ],
  };
  const svc = makeService(over);
  const count = await (svc as any).backfillUnroutedOpenCases();

  assert.strictEqual(count, 1);
  assert.strictEqual(over.caseUpdates?.[0].templateId, 'tpl-dq');
  assert.strictEqual(over.taskBulkUpdates?.[0].templateStageId, 'stage-triage');
  assert.ok(over.events?.some((event) => event.action === 'route.template.backfilled'));
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_case.route_backfill'));
});

test('assignUnownedRoutedTasks uses DMO admin as controlled fallback queue owner', async () => {
  const currentTask = {
    id: 'task-unassigned',
    caseId: 'case-1',
    status: 'pending',
    assigneeUserId: null,
    case: { assetId: 'asset-1', status: 'submitted' },
    templateStage: { nameEn: 'Definition drafting', assigneeRoleCode: 'data_steward' },
  };
  const over: Over = {
    task: currentTask,
    tasks: [currentTask],
    userRoleCandidatesByRole: {
      data_steward: [],
      dmo_admin: [
        {
          userId: 'admin-user',
          user: {
            userRoles: [{ role: { code: 'dmo_admin', isActive: true, deletedAt: null } }],
          },
        },
      ],
    },
    scopeForRoles: (roleCodes) =>
      roleCodes.includes('dmo_admin')
        ? { orgUnits: 'all', domains: 'all', maxClassRank: null }
        : { orgUnits: [], domains: [], maxClassRank: null },
  };
  const svc = makeService(over);
  const count = await (svc as any).assignUnownedRoutedTasks();

  assert.strictEqual(count, 1);
  assert.strictEqual(over.taskUpdates?.[0].assigneeUserId, 'admin-user');
  assert.ok(over.events?.some((event) => event.action === 'task.auto_assigned'));
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_task.auto_assign'));
});

test('dueDateForStage keeps zero-day urgent tasks due through the current day', () => {
  const svc = makeService({});
  const due = (svc as any).dueDateForStage({
    id: 'stage-urgent',
    sortOrder: 1,
    dueDays: 0,
    isStart: false,
    isFinal: false,
    isActive: true,
    assigneeRoleCode: 'privacy_officer',
  });

  assert.ok(due instanceof Date);
  assert.strictEqual(due.getHours(), 23);
  assert.strictEqual(due.getMinutes(), 59);
});

test('openRoutedCase fails closed when no route candidate is available', async () => {
  const svc = makeService({
    template: { id: 'seed-already-present' },
    templates: [],
  });

  await assert.rejects(
    () =>
      svc.createCase(
        { title: 'Unrouted quality case', type: 'data_quality_issue' } as never,
        ['system_admin'],
        'admin@dgop.local',
      ),
    /No workflow route template is available/,
  );
});

test('updateCase: hides out-of-scope asset-linked cases', async () => {
  const svc = makeService({
    case: { id: 'c1', status: 'submitted', assetId: 'hidden-asset' },
    visibleAssets: [{ id: 'visible-asset' }],
    scope: { orgUnits: ['org-1'], domains: 'all', maxClassRank: null },
  });
  await assert.rejects(
    () => svc.updateCase('c1', { title: 'New title' } as never, ['dq_steward'], 'actor'),
    /workflow case not found/,
  );
});

test('updateCase: hides unanchored cases unless actor created or owns the route', async () => {
  const over: Over = {
    case: { id: 'case-hidden', status: 'submitted', assetId: null, createdBy: 'other@dgop.local' },
    visibleAssets: [],
    scope: { orgUnits: ['org-1'], domains: 'all', maxClassRank: null },
    caseFindFirstResult: null,
  };
  const svc = makeService(over);

  await assert.rejects(
    () =>
      svc.updateCase(
        'case-hidden',
        { title: 'Leaked edit' } as never,
        ['dq_steward'],
        'viewer@dgop.local',
        { id: 'viewer-1', email: 'viewer@dgop.local', roles: ['dq_steward'] },
      ),
    /workflow case not found/,
  );

  const text = JSON.stringify(over.caseFindFirstArgs?.[0]?.where);
  assert.ok(text.includes('"id":"case-hidden"'));
  assert.ok(text.includes('"assetId":null'));
  assert.ok(text.includes('"createdBy":"viewer@dgop.local"'));
  assert.ok(text.includes('"assigneeUserId":"viewer-1"'));
  assert.ok(text.includes('"assigneeRoleCode":{"in":["dq_steward"]}'));
});

test('updateTask: hides tasks on unanchored cases outside actor visibility', async () => {
  const over: Over = {
    task: {
      id: 'task-hidden',
      caseId: 'case-hidden',
      title: 'Hidden task',
      status: 'pending',
      assigneeUserId: null,
      case: { id: 'case-hidden', status: 'submitted', assetId: null, createdBy: 'other@dgop.local' },
    },
    visibleAssets: [],
    scope: { orgUnits: ['org-1'], domains: 'all', maxClassRank: null },
    caseFindFirstResult: null,
  };
  const svc = makeService(over);

  await assert.rejects(
    () =>
      svc.updateTask(
        'task-hidden',
        { title: 'Leaked task edit' } as never,
        ['dq_steward'],
        'viewer@dgop.local',
        { id: 'viewer-1', email: 'viewer@dgop.local', roles: ['dq_steward'] },
      ),
    /workflow case not found/,
  );

  const text = JSON.stringify(over.caseFindFirstArgs?.[0]?.where);
  assert.ok(text.includes('"id":"case-hidden"'));
  assert.ok(text.includes('"assetId":null'));
  assert.ok(text.includes('"createdBy":"viewer@dgop.local"'));
});

test('listMyTasks: applies case visibility to inbox rows', async () => {
  const over: Over = {
    tasks: [],
    visibleAssets: [{ id: 'visible-asset' }],
    scope: { orgUnits: ['org-1'], domains: 'all', maxClassRank: null },
  };
  const svc = makeService(over);
  await svc.listMyTasks(
    { id: 'u1', email: 'user@dgop.local', roles: ['dq_steward'] },
    { status: 'open' },
  );

  assert.ok(over.taskFindManyArgs.where.OR.some((branch: any) => branch.assigneeUserId === 'u1'));
  assert.ok(
    over.taskFindManyArgs.where.OR.some(
      (branch: any) =>
        branch.assigneeUserId === null &&
        branch.OR?.some((part: any) => part.assigneeRoleCode?.in?.includes('dq_steward')) &&
        branch.OR?.some((part: any) => part.templateStage?.assigneeRoleCode?.in?.includes('dq_steward')),
    ),
  );
  assert.deepStrictEqual(over.taskFindManyArgs.where.status.in, ['pending', 'in_progress']);
  assert.strictEqual(over.taskFindManyArgs.take, 50);
  assert.strictEqual(over.taskFindManyArgs.skip, 0);
  assert.ok(over.taskFindManyArgs.where.case.OR.some((branch: any) => branch.assetId?.in?.includes('visible-asset')));
  assert.ok(over.taskFindManyArgs.where.case.OR.some((branch: any) => branch.AND?.some((part: any) => part.createdBy === 'user@dgop.local')));
  assert.ok(
    over.taskFindManyArgs.where.case.OR.some((branch: any) =>
      branch.AND?.some((part: any) => part.tasks?.some?.OR?.some((taskBranch: any) =>
        taskBranch.OR?.some((part: any) => part.assigneeRoleCode?.in?.includes('dq_steward')) ||
        taskBranch.OR?.some((part: any) => part.templateStage?.assigneeRoleCode?.in?.includes('dq_steward')),
      )),
    ),
  );
});

test('listCases: rejects invalid status filters before Prisma receives them', async () => {
  const svc = makeService({});
  await assert.rejects(
    () => svc.listCases(['system_admin'], { status: 'not_a_real_status' }, { id: 'u1', email: 'u1@dgop.local', roles: ['system_admin'] }),
    /Invalid workflow case status/,
  );
});

test('recordDomainTaskDecision: auto-assigns next stage only to a scoped role holder', async () => {
  const over: Over = {
    createdTasks: [],
    caseUpdates: [],
    taskUpdates: [],
    events: [],
    task: {
      id: 't1',
      assigneeUserId: 'u1',
      status: 'pending',
      caseId: 'c1',
      templateStageId: 'stage-review',
      case: {
        id: 'c1',
        type: 'general',
        status: 'submitted',
        createdBy: 'x@dgop.local',
        assignmentId: null,
        templateId: 'template-1',
        assetId: 'asset-visible',
      },
    },
    template: {
      stages: [
        {
          id: 'stage-review',
          code: 'review',
          nameEn: 'Review',
          nameAr: 'Review',
          kind: 'review',
          taskType: 'review',
          assigneeRoleCode: 'data_steward',
          dueDays: 1,
          sortOrder: 1,
          isStart: false,
          isDecision: false,
          isFinal: false,
          isActive: true,
        },
        {
          id: 'stage-decision',
          code: 'decision',
          nameEn: 'Decision',
          nameAr: 'Decision',
          kind: 'decision',
          taskType: 'approval',
          assigneeRoleCode: 'data_owner',
          dueDays: 2,
          sortOrder: 2,
          isStart: false,
          isDecision: true,
          isFinal: false,
          isActive: true,
        },
      ],
      transitions: [
        {
          id: 'transition-1',
          fromStageId: 'stage-review',
          toStageId: 'stage-decision',
          decision: null,
          isHappyPath: true,
          sortOrder: 1,
          toStage: { id: 'stage-decision', code: 'decision' },
        },
      ],
    },
    userRoleCandidates: [
      {
        userId: 'u-hidden',
        user: {
          userRoles: [{ role: { code: 'data_owner', isActive: true, deletedAt: null } }],
        },
      },
      {
        userId: 'u-visible',
        user: {
          userRoles: [
            { role: { code: 'data_owner', isActive: true, deletedAt: null } },
            { role: { code: 'finance_scope', isActive: true, deletedAt: null } },
          ],
        },
      },
    ],
    scopeForRoles: (roleCodes: string[]) =>
      roleCodes.includes('system_admin') || roleCodes.includes('finance_scope')
        ? { orgUnits: 'all', domains: 'all', maxClassRank: null }
        : { orgUnits: 'all', domains: [], maxClassRank: null },
  };
  const svc = makeService(over);
  await svc.recordDomainTaskDecision({
    taskId: 't1',
    roleCodes: ['system_admin'],
    actor: 'actor@dgop.local',
    decision: 'approved' as never,
    comment: 'Approved by domain step.',
    eventAction: 'domain.task.approved',
  });

  assert.strictEqual(over.createdTasks?.[0].assigneeUserId, 'u-visible');
});

test('slaOf: open task with no due date is none', () => {
  const svc = makeService({});
  assert.strictEqual(svc.slaOf({ status: 'pending' as never, dueDate: null, completedAt: null }), 'none');
});

test('slaOf: due far in the future is on_track', () => {
  const svc = makeService({});
  const due = new Date(Date.now() + 10 * DAY);
  assert.strictEqual(svc.slaOf({ status: 'pending' as never, dueDate: due, completedAt: null }), 'on_track');
});

test('slaOf: due within two days is at_risk', () => {
  const svc = makeService({});
  const due = new Date(Date.now() + 1 * DAY);
  assert.strictEqual(svc.slaOf({ status: 'pending' as never, dueDate: due, completedAt: null }), 'at_risk');
});

test('slaOf: past due date is overdue', () => {
  const svc = makeService({});
  const due = new Date(Date.now() - 1 * DAY);
  assert.strictEqual(svc.slaOf({ status: 'in_progress' as never, dueDate: due, completedAt: null }), 'overdue');
});

// ---------- decision authority ----------
test('decideTask: non-assignee without admin role is forbidden', async () => {
  const svc = makeService({
    task: { id: 't1', assigneeUserId: 'u-owner', status: 'pending', caseId: 'c1', case: { type: 'generic', createdBy: 'x@dgop.local' } },
  });
  await assert.rejects(
    () => svc.decideTask('t1', { decision: 'approved' } as never, { id: 'u-other', email: 'other@dgop.local', roles: ['auditor'] } as never),
    /Only the assigned user/,
  );
});

test('decideTask: role queue member can claim and decide an unassigned routed task', async () => {
  const over: Over = {
    taskUpdates: [],
    events: [],
    task: {
      id: 't-role',
      assigneeUserId: null,
      status: 'pending',
      caseId: 'c-role',
      templateStageId: 'stage-review',
      templateStage: { assigneeRoleCode: 'dq_steward' },
      case: {
        id: 'c-role',
        type: 'data_quality_issue',
        status: 'submitted',
        createdBy: 'owner@dgop.local',
        assignmentId: null,
        templateId: null,
        assetId: null,
      },
    },
  };
  const svc = makeService(over);

  const res = await svc.decideTask(
    't-role',
    { decision: 'approved', comment: 'Reviewed from queue.' } as never,
    { id: 'u-steward', email: 'steward@dgop.local', roles: ['dq_steward'] } as never,
  );

  assert.strictEqual(res.status, 'completed');
  assert.strictEqual(over.taskUpdates?.[0].assigneeUserId, 'u-steward');
  assert.ok(over.events?.some((event) => event.action === 'task.claimed'));
});

test('decideTask: cannot decide a task after the parent case is final', async () => {
  const svc = makeService({
    task: {
      id: 't1',
      assigneeUserId: 'u1',
      status: 'pending',
      caseId: 'c1',
      case: { id: 'c1', type: 'general', status: 'closed', createdBy: 'x@dgop.local', assetId: null },
    },
  });
  await assert.rejects(
    () => svc.decideTask('t1', { decision: 'approved' } as never, { id: 'u1', email: 'u1@dgop.local', roles: [] } as never),
    /cannot be modified/,
  );
});

test('decideTask: assignee may decide a generic task (no approval wiring)', async () => {
  const setCalls: any[][] = [];
  const svc = makeService({
    setCalls,
    task: { id: 't1', assigneeUserId: 'u1', status: 'pending', caseId: 'c1', case: { type: 'generic', createdBy: 'x@dgop.local', assignmentId: null } },
  });
  const res = await svc.decideTask('t1', { decision: 'approved' } as never, { id: 'u1', email: 'u1@dgop.local', roles: [] } as never);
  assert.strictEqual(res.status, 'completed');
  assert.strictEqual(setCalls.length, 0);
});

test('decideTask: routed task activates the next route stage', async () => {
  const over: Over = {
    createdTasks: [],
    caseUpdates: [],
    task: {
      id: 't1',
      assigneeUserId: 'u1',
      status: 'pending',
      caseId: 'c1',
      templateStageId: 'stage-review',
      case: {
        id: 'c1',
        type: 'general',
        status: 'submitted',
        createdBy: 'x@dgop.local',
        assignmentId: null,
        templateId: 'template-1',
        assetId: null,
      },
    },
    template: {
      stages: [
        {
          id: 'stage-review',
          code: 'review',
          nameEn: 'Review',
          nameAr: 'Review',
          kind: 'review',
          taskType: 'review',
          assigneeRoleCode: 'data_steward',
          dueDays: 1,
          sortOrder: 1,
          isStart: false,
          isDecision: false,
          isFinal: false,
          isActive: true,
        },
        {
          id: 'stage-decision',
          code: 'decision',
          nameEn: 'Decision',
          nameAr: 'Decision',
          kind: 'decision',
          taskType: 'approval',
          assigneeRoleCode: 'data_owner',
          dueDays: 2,
          sortOrder: 2,
          isStart: false,
          isDecision: true,
          isFinal: false,
          isActive: true,
        },
      ],
      transitions: [
        {
          id: 'transition-1',
          fromStageId: 'stage-review',
          toStageId: 'stage-decision',
          decision: null,
          isHappyPath: true,
          sortOrder: 1,
          toStage: { id: 'stage-decision', code: 'decision' },
        },
      ],
    },
  };
  const svc = makeService(over);
  await svc.decideTask('t1', { decision: 'approved' } as never, { id: 'u1', email: 'u1@dgop.local', roles: [] } as never);
  assert.strictEqual(over.createdTasks?.[0].templateStageId, 'stage-decision');
  assert.strictEqual(over.caseUpdates?.[0].status, 'under_review');
});

// ---------- segregation of duties ----------
test('decideTask: submitter cannot decide their own approval case', async () => {
  const svc = makeService({
    task: { id: 't1', assigneeUserId: 'u1', status: 'pending', caseId: 'c1', case: { type: 'owner_assignment_approval', createdBy: 'u1@dgop.local', assignmentId: 'as1' } },
  });
  await assert.rejects(
    () => svc.decideTask('t1', { decision: 'approved' } as never, { id: 'u1', email: 'u1@dgop.local', roles: ['system_admin'] } as never),
    /cannot decide an approval you submitted/,
  );
});

test('submitAssignmentForApproval: approver must differ from submitter', async () => {
  const svc = makeService({
    assignment: { approvalStatus: 'draft', roleType: { code: 'data_owner', nameEn: 'Data Owner' }, targetType: 'asset', targetId: 'a1', person: { fullNameEn: 'Alice', userId: null } },
    submitter: { id: 'u-approver', email: 'sub@dgop.local' },
  });
  await assert.rejects(
    () => svc.submitAssignmentForApproval({ assignmentId: 'as1', approverUserId: 'u-approver' } as never, ['system_admin'], 'sub@dgop.local'),
    /different from the submitter/,
  );
});

test('submitAssignmentForApproval: approver cannot be the assigned person', async () => {
  const svc = makeService({
    assignment: { approvalStatus: 'draft', roleType: { code: 'data_owner', nameEn: 'Data Owner' }, targetType: 'asset', targetId: 'a1', person: { fullNameEn: 'Alice', userId: 'u-person' } },
    submitter: { id: 'u-sub', email: 'sub@dgop.local' },
  });
  await assert.rejects(
    () => svc.submitAssignmentForApproval({ assignmentId: 'as1', approverUserId: 'u-person' } as never, ['system_admin'], 'sub@dgop.local'),
    /cannot be the person being assigned/,
  );
});

test('submitAssignmentForApproval: marks pending and opens the case inside the transaction path', async () => {
  const over: Over = {
    assignment: {
      id: 'as1',
      approvalStatus: 'draft',
      isActive: true,
      roleType: { code: 'data_owner', nameEn: 'Data Owner' },
      targetType: 'asset',
      targetId: 'a1',
      person: { fullNameEn: 'Alice', userId: null },
    },
    submitter: { id: 'u-sub', email: 'sub@dgop.local' },
  };
  const svc = makeService(over);
  (svc as any).openRoutedCase = async (input: any, client: any) => {
    assert.ok(client, 'workflow case should be opened with the transaction client');
    assert.strictEqual(input.assignmentId, 'as1');
    assert.strictEqual(input.initialAssigneeUserId, 'u-approver');
    assert.strictEqual(over.assignmentUpdate?.approvalStatus, 'pending');
    return { id: 'case-new', code: 'WFC-APP', templateId: 'tpl-1' };
  };

  await svc.submitAssignmentForApproval(
    { assignmentId: 'as1', approverUserId: 'u-approver' } as never,
    ['system_admin'],
    'sub@dgop.local',
  );

  assert.strictEqual(over.assignmentUpdate?.approvalStatus, 'pending');
  assert.strictEqual(over.setCalls?.length ?? 0, 0);
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'assignment.pending'));
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'assignment.submit_for_approval'));
});

// ---------- approval wiring ----------
test('decideTask: approving an approval task activates the assignment', async () => {
  const over: Over = {
    task: { id: 't1', assigneeUserId: 'u-appr', status: 'pending', caseId: 'c1', case: { type: 'owner_assignment_approval', createdBy: 'sub@dgop.local', assignmentId: 'as1' } },
    assignment: { id: 'as1', targetType: 'asset', targetId: 'asset-1', isActive: true },
  };
  const svc = makeService(over);
  await svc.decideTask('t1', { decision: 'approved' } as never, { id: 'u-appr', email: 'appr@dgop.local', roles: ['system_admin'] } as never);
  assert.strictEqual(over.assignmentUpdate?.approvalStatus, 'approved');
  assert.strictEqual(over.assignmentUpdate?.isActive, true);
});

test('decideTask: rejecting an approval task rejects the assignment', async () => {
  const over: Over = {
    task: { id: 't1', assigneeUserId: 'u-appr', status: 'pending', caseId: 'c1', case: { type: 'steward_assignment_approval', createdBy: 'sub@dgop.local', assignmentId: 'as1' } },
    assignment: { id: 'as1', targetType: 'asset', targetId: 'asset-1', isActive: true },
  };
  const svc = makeService(over);
  await svc.decideTask('t1', { decision: 'rejected' } as never, { id: 'u-appr', email: 'appr@dgop.local', roles: ['system_admin'] } as never);
  assert.strictEqual(over.assignmentUpdate?.approvalStatus, 'rejected');
  assert.strictEqual(over.assignmentUpdate?.isActive, false);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  \u2713 ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  \u2717 ${t.name}`);
      console.error(`    ${(err as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
