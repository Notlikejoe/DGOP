/**
 * Lightweight unit tests for the workflow engine: SLA derivation, decision
 * authority, segregation of duties and assignment-approval wiring.
 * (no jest dependency). Run with: ts-node test/workflow.service.spec.ts
 */
import assert from 'node:assert';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowService } from '../src/workflow/workflow.service';
import {
  DEFAULT_WORKFLOW_TEMPLATES,
  WORKFLOW_RETURN_FOR_CLARIFICATION,
  buildWorkflowVariableContext,
  buildWorkflowMvpReadinessGate,
  buildWorkflowCaseTypeRegistry,
  buildWorkflowEscalationTemplates,
  buildWorkflowNotificationRules,
  buildWorkflowSlaTemplates,
  buildWorkflowVersionDiff,
  evaluateWorkflowDmnTable,
  firstActionableWorkflowStage,
  isAutomatedWorkflowStage,
  isRoutingOnlyWorkflowStage,
  routeGateForOpenStagePeers,
  selectWorkflowTransitionForDecision,
  selectWorkflowTemplate,
  validateWorkflowFormData,
  workflowTemplateConfigurationStatus,
  workflowNodePalette,
  workflowHealth,
} from '../src/workflow/workflow.logic';
import {
  parseBpmnXml,
  simulateWorkflowRoute,
  templateToBpmnXml,
  validateWorkflowRoute,
} from '../src/workflow/workflow.bpmn';
import { validateWorkflowAutomationConfig } from '../src/workflow/workflow.automation';

const DAY = 24 * 60 * 60 * 1000;

type Over = {
  task?: any;
  case?: any;
  assignment?: any;
  assignmentUpdate?: any;
  assignmentBulkUpdates?: any[];
  template?: any;
  templates?: any[];
  templateUpdates?: any[];
  templateVersionCreates?: any[];
  templateStageCreates?: any[];
  templateStageUpdates?: any[];
  templateStageBulkUpdates?: any[];
  templateTransitionCreates?: any[];
  templateTransitionBulkUpdates?: any[];
  createdTasks?: any[];
  caseUpdates?: any[];
  workflowCases?: any[];
  caseFindManyArgs?: any;
  caseFindFirstArgs?: any[];
  caseFindFirstResult?: any;
  taskBulkUpdates?: any[];
  taskUpdateManyCount?: number;
  taskUpdates?: any[];
  tasks?: any[];
  taskFindManyArgs?: any;
  runtimeTokens?: any[];
  runtimeTokenCreates?: any[];
  runtimeTokenUpdates?: any[];
  runtimeTokenFindManyArgs?: any;
  runtimeTokenFindFirstArgs?: any;
  integrationCalls?: unknown[];
  integrationResult?: any;
  executionAttempts?: any[];
  executionAttemptFindManyArgs?: any;
  executionAttemptUpdates?: any[];
  events?: any[];
  auditEntries?: any[];
  testRuns?: any[];
  testRunCreates?: any[];
  testRunUpdates?: any[];
  testRunFindManyArgs?: any;
  testRunFindFirstArgs?: any;
  testRunAggregateMax?: number;
  testRunCreateErrors?: string[];
  submitter?: any;
  visibleAssets?: { id: string }[];
  scope?: any;
  scopeForRoles?: (roleCodes: string[]) => any;
  userRoleCandidates?: any[];
  userRoleCandidatesByRole?: Record<string, any[]>;
  setCalls?: any[][];
  attachmentCount?: number;
  attachmentCreates?: any[];
};

function makeService(over: Over): WorkflowService {
  const prisma: any = {
    $transaction: async (fn: (client: any) => unknown) => fn(prisma),
    businessSequence: {
      upsert: async () => ({ value: BigInt((over.workflowCases?.length ?? 0) + 1) }),
    },
    workflowTask: {
      findUnique: async () => over.task ?? null,
      count: async () => 0,
      update: async ({ data }: any) => {
        (over.taskUpdates ??= []).push(data);
        return { ...over.task, ...data, assignee: null };
      },
      updateMany: async ({ where, data }: any) => {
        (over.taskBulkUpdates ??= []).push(data);
        const atomicDecision = where?.id && Array.isArray(where?.status?.in);
        const count = over.taskUpdateManyCount ??
          (atomicDecision && over.task ? (where.status.in.includes(over.task.status) ? 1 : 0) : 1);
        if (count === 1 && over.task) over.task = { ...over.task, ...data };
        return { count };
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
    workflowTaskAttachment: {
      count: async () => over.attachmentCount ?? 0,
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: new Date('2026-08-23T10:00:00Z') };
        (over.attachmentCreates ??= []).push(row);
        return row;
      },
      findMany: async () => over.attachmentCreates ?? [],
      findUnique: async ({ where }: any) => {
        const row = (over.attachmentCreates ?? []).find((attachment) => attachment.id === where.id);
        return row ? { ...row, case: over.case ?? { id: row.caseId, assetId: null } } : null;
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
      update: async ({ data }: any) => {
        (over.templateUpdates ??= []).push(data);
        over.template = { ...(over.template ?? {}), ...data };
        return over.template;
      },
      create: async ({ data }: any) => {
        over.template = { id: 'tpl-new', ...data, stages: [], transitions: [] };
        return over.template;
      },
    },
    workflowTemplateVersion: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }: any) => {
        (over.templateVersionCreates ??= []).push(data);
        return { id: `version-${over.templateVersionCreates.length}`, ...data };
      },
    },
    workflowTemplateStage: {
      findMany: async () => (over.template?.stages ?? []).map((stage: any) => ({ id: stage.id, code: stage.code })),
      update: async ({ where, data }: any) => {
        (over.templateStageUpdates ??= []).push({ where, data });
        return { id: where.id, ...data };
      },
      create: async ({ data }: any) => {
        (over.templateStageCreates ??= []).push(data);
        return { id: `stage-${data.code}`, ...data };
      },
      updateMany: async (args: any) => {
        (over.templateStageBulkUpdates ??= []).push(args);
        return { count: 0 };
      },
    },
    workflowTemplateTransition: {
      updateMany: async (args: any) => {
        (over.templateTransitionBulkUpdates ??= []).push(args);
        return { count: 1 };
      },
      create: async ({ data }: any) => {
        (over.templateTransitionCreates ??= []).push(data);
        return { id: `transition-${over.templateTransitionCreates.length}`, ...data };
      },
    },
    workflowVariableDefinition: {
      findMany: async () => [],
    },
    workflowRuntimeToken: {
      count: async (args: any) => {
        over.runtimeTokenFindManyArgs = args;
        return (over.runtimeTokens ?? []).filter((token) =>
          token.caseId === args.where.caseId &&
          token.joinKey === args.where.joinKey &&
          token.state === args.where.state &&
          token.id !== args.where.id?.not,
        ).length;
      },
      create: async (args: any) => {
        const token = { id: `token-${(over.runtimeTokenCreates?.length ?? 0) + 1}`, ...args.data };
        (over.runtimeTokenCreates ??= []).push(token);
        return token;
      },
      updateMany: async (args: any) => {
        (over.runtimeTokenUpdates ??= []).push(args);
        return { count: 1 };
      },
      update: async ({ where, data }: any) => {
        (over.runtimeTokenUpdates ??= []).push({ where, data });
        const token = (over.runtimeTokens ?? []).find((entry) => entry.id === where.id);
        if (token) Object.assign(token, data);
        return { ...(token ?? { id: where.id }), ...data };
      },
      findFirst: async (args: any) => {
        over.runtimeTokenFindFirstArgs = args;
        return over.runtimeTokens?.[0] ?? null;
      },
      findMany: async (args: any) => {
        over.runtimeTokenFindManyArgs = args;
        return over.runtimeTokens ?? [];
      },
    },
    workflowExecutionAttempt: {
      count: async ({ where }: any = {}) => (over.executionAttempts ?? []).filter((attempt) =>
        (!where.status || attempt.status === where.status),
      ).length,
      create: async ({ data }: any) => {
        const errorCode = over.testRunCreateErrors?.shift();
        if (errorCode) {
          const error = new Error(`simulated ${errorCode}`) as Error & { code: string };
          error.code = errorCode;
          throw error;
        }
        const row = {
          id: `execution-${(over.executionAttempts?.length ?? 0) + 1}`,
          status: 'queued',
          attemptCount: 0,
          ...data,
          createdAt: new Date('2026-08-15T09:00:00Z'),
        };
        (over.executionAttempts ??= []).push(row);
        return row;
      },
      findMany: async (args: any) => {
        over.executionAttemptFindManyArgs = args;
        return over.executionAttempts ?? [];
      },
      findUnique: async ({ where }: any) => (over.executionAttempts ?? []).find((attempt) => attempt.id === where.id) ?? null,
      updateMany: async (args: any) => {
        (over.executionAttemptUpdates ??= []).push(args);
        return { count: 1 };
      },
      update: async ({ where, data }: any) => {
        (over.executionAttemptUpdates ??= []).push({ where, data });
        const attempt = (over.executionAttempts ?? []).find((row) => row.id === where.id);
        return { ...(attempt ?? { id: where.id }), ...data };
      },
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
      count: async (args?: any) => {
        if (!args?.where) return over.events?.length ?? 0;
        return (over.events ?? []).filter((event) =>
          (!args.where.action || event.action === args.where.action) &&
          (!args.where.case?.templateId?.in || args.where.case.templateId.in.includes(event.case?.templateId ?? event.templateId)),
        ).length;
      },
      findMany: async () => over.events ?? [],
    },
    workflowDesignerTestRun: {
      aggregate: async () => ({
        _max: {
          runNumber: over.testRunAggregateMax ?? Math.max(0, ...(over.testRuns ?? []).map((run) => run.runNumber ?? 0)),
        },
      }),
      create: async ({ data }: any) => {
        const row = {
          id: `test-run-${(over.testRunCreates?.length ?? 0) + 1}`,
          ...data,
          resetAt: null,
          resetBy: null,
          createdAt: new Date('2026-08-15T09:00:00Z'),
          updatedAt: new Date('2026-08-15T09:00:00Z'),
        };
        (over.testRunCreates ??= []).push(data);
        (over.testRuns ??= []).push(row);
        return row;
      },
      findMany: async (args: any) => {
        over.testRunFindManyArgs = args;
        const rows = over.testRuns ?? [];
        return rows
          .filter((run) => !args.where?.status || run.status === args.where.status)
          .sort((a, b) => (b.runNumber ?? 0) - (a.runNumber ?? 0))
          .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length));
      },
      count: async (args?: any) => {
        const rows = over.testRuns ?? [];
        return rows.filter((run) => !args?.where?.status || run.status === args.where.status).length;
      },
      findFirst: async (args: any) => {
        over.testRunFindFirstArgs = args;
        return (over.testRuns ?? []).find((run) => run.id === args.where?.id && run.templateId === args.where?.templateId) ?? null;
      },
      update: async ({ where, data }: any) => {
        (over.testRunUpdates ??= []).push({ where, data });
        const existing = (over.testRuns ?? []).find((run) => run.id === where.id);
        if (!existing) return { id: where.id, ...data };
        Object.assign(existing, data, { updatedAt: new Date('2026-08-15T10:00:00Z') });
        return existing;
      },
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
      updateMany: async (args: any) => {
        (over.assignmentBulkUpdates ??= []).push(args);
        return { count: over.assignmentBulkUpdates.length };
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
  const integrations = {
    executeWorkflowConnectorAction: async (input: unknown) => {
      (over.integrationCalls ??= []).push(input);
      return over.integrationResult ?? { ok: true, status: 200, statusText: 'OK', body: {}, durationMs: 1, endpoint: 'health' };
    },
  };
  return new WorkflowService(
    prisma as never,
    audit as never,
    scope as never,
    assignments as never,
    integrations as never,
  );
}

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

function designerTemplateFixture(overrides: Partial<any> = {}) {
  const now = new Date('2026-08-15T08:00:00Z');
  const stages = [
    {
      id: 'stage-intake',
      templateId: 'tpl-designer',
      code: 'intake',
      nameEn: 'Intake',
      nameAr: 'Intake',
      description: 'Capture request context.',
      kind: 'intake',
      nodeType: 'user_task',
      taskType: 'information',
      assignmentStrategy: 'role',
      assigneeRoleCode: 'dmo_admin',
      dueDays: 1,
      formSchemaJson: { fields: ['request_title'], required: ['request_title'] },
      slaConfigJson: { dueDays: 1 },
      notificationRulesJson: [{ event: 'created', channel: 'in_app' }],
      evidenceRequirementsJson: null,
      automationConfigJson: null,
      gatewayConfigJson: null,
      parallelGroup: null,
      sortOrder: 1,
      isStart: true,
      isDecision: false,
      isFinal: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'stage-review',
      templateId: 'tpl-designer',
      code: 'review',
      nameEn: 'Review',
      nameAr: 'Review',
      description: 'Review evidence and decide.',
      kind: 'review',
      nodeType: 'approval_task',
      taskType: 'approval',
      assignmentStrategy: 'role',
      assigneeRoleCode: 'data_owner',
      dueDays: 2,
      formSchemaJson: null,
      slaConfigJson: { dueDays: 2 },
      notificationRulesJson: [{ event: 'assigned', channel: 'in_app' }],
      evidenceRequirementsJson: [{ name: 'Review note', required: true }],
      automationConfigJson: null,
      gatewayConfigJson: null,
      parallelGroup: null,
      sortOrder: 2,
      isStart: false,
      isDecision: false,
      isFinal: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'stage-closure',
      templateId: 'tpl-designer',
      code: 'closure',
      nameEn: 'Closure',
      nameAr: 'Closure',
      description: 'Record final outcome.',
      kind: 'closure',
      nodeType: 'user_task',
      taskType: 'approval',
      assignmentStrategy: 'role',
      assigneeRoleCode: 'dmo_admin',
      dueDays: 1,
      formSchemaJson: null,
      slaConfigJson: { dueDays: 1 },
      notificationRulesJson: [{ event: 'completed', channel: 'in_app' }],
      evidenceRequirementsJson: [{ name: 'Decision note', required: true }],
      automationConfigJson: null,
      gatewayConfigJson: null,
      parallelGroup: null,
      sortOrder: 3,
      isStart: false,
      isDecision: false,
      isFinal: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const transitions = [
    {
      id: 'transition-intake-review',
      templateId: 'tpl-designer',
      fromStageId: 'stage-intake',
      toStageId: 'stage-review',
      fromStage: stages[0],
      toStage: stages[1],
      labelEn: 'Submit',
      labelAr: 'Submit',
      connectorType: 'sequence',
      decision: null,
      conditionExpression: null,
      conditionJson: null,
      isDefaultPath: false,
      timeoutAfterSeconds: null,
      isHappyPath: true,
      sortOrder: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'transition-review-closure',
      templateId: 'tpl-designer',
      fromStageId: 'stage-review',
      toStageId: 'stage-closure',
      fromStage: stages[1],
      toStage: stages[2],
      labelEn: 'Approve',
      labelAr: 'Approve',
      connectorType: 'success',
      decision: 'approved',
      conditionExpression: null,
      conditionJson: null,
      isDefaultPath: false,
      timeoutAfterSeconds: null,
      isHappyPath: true,
      sortOrder: 2,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  return {
    id: 'tpl-designer',
    code: 'WF-DESIGNER',
    caseType: 'general',
    nameEn: 'Designer fixture route',
    nameAr: 'Designer fixture route',
    description: 'Fixture route',
    trigger: 'manual',
    domainId: null,
    defaultSlaDays: 4,
    isSystem: true,
    isActive: true,
    bpmnXml: null,
    designerJson: null,
    designerVersion: 1,
    lastPublishedAt: now,
    lastPublishedBy: 'admin@dgop.local',
    modelSignature: 'signed-fixture',
    signatureAlgorithm: 'HMAC-SHA256',
    securityJson: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    stages,
    transitions,
    ...overrides,
  };
}

function designerFixtureBpmn(template = designerTemplateFixture()) {
  return templateToBpmnXml({
    id: template.id,
    code: template.code,
    caseType: template.caseType,
    nameEn: template.nameEn,
    nameAr: template.nameAr,
    description: template.description,
    defaultSlaDays: template.defaultSlaDays,
    stages: template.stages.map((stage: any) => ({
      id: stage.code,
      code: stage.code,
      nameEn: stage.nameEn,
      nameAr: stage.nameAr,
      description: stage.description,
      kind: stage.kind,
      nodeType: stage.nodeType,
      taskType: stage.taskType,
      assigneeRoleCode: stage.assigneeRoleCode,
      dueDays: stage.dueDays,
      formSchemaJson: stage.formSchemaJson,
      slaConfigJson: stage.slaConfigJson,
      notificationRulesJson: stage.notificationRulesJson,
      evidenceRequirementsJson: stage.evidenceRequirementsJson,
      automationConfigJson: stage.automationConfigJson,
      gatewayConfigJson: stage.gatewayConfigJson,
      parallelGroup: stage.parallelGroup,
      sortOrder: stage.sortOrder,
      isStart: stage.isStart,
      isDecision: stage.isDecision,
      isFinal: stage.isFinal,
      isActive: stage.isActive,
    })),
    transitions: template.transitions.map((transition: any) => ({
      fromStageId: transition.fromStage.code,
      toStageId: transition.toStage.code,
      labelEn: transition.labelEn,
      labelAr: transition.labelAr,
      connectorType: transition.connectorType,
      decision: transition.decision,
      conditionExpression: transition.conditionExpression,
      conditionJson: transition.conditionJson,
      isDefaultPath: transition.isDefaultPath,
      isHappyPath: transition.isHappyPath,
      sortOrder: transition.sortOrder,
    })),
  });
}

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

  assert.strictEqual(over.taskBulkUpdates?.[0].status, 'completed');
  assert.strictEqual(over.createdTasks?.[0].templateStageId, 'stage-decision');
  assert.strictEqual(over.caseUpdates?.[0].status, 'under_review');
  assert.strictEqual(over.runtimeTokenUpdates?.[0].where.taskId, 't1');
  assert.strictEqual(over.runtimeTokenCreates?.[0].templateStageId, 'stage-decision');
  assert.strictEqual(over.runtimeTokenCreates?.[0].sourceTransitionId, 'transition-1');
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

test('BPMN designer: explicit connector decisions survive notification labels without false rejection inference', () => {
  const base = designerTemplateFixture();
  const stages = base.stages.map((stage: any) => stage.code === 'review' ? { ...stage, isDecision: true } : stage);
  const stageByCode = new Map(stages.map((stage: any) => [stage.code, stage]));
  const transitions = [
    {
      ...base.transitions[0],
      fromStage: stageByCode.get('intake'),
      toStage: stageByCode.get('review'),
    },
    {
      ...base.transitions[1],
      labelEn: 'Notification recorded',
      labelAr: 'Notification recorded',
      fromStage: stageByCode.get('review'),
      toStage: stageByCode.get('closure'),
    },
    {
      ...base.transitions[1],
      id: 'transition-review-intake',
      fromStageId: 'stage-review',
      toStageId: 'stage-intake',
      fromStage: stageByCode.get('review'),
      toStage: stageByCode.get('intake'),
      labelEn: 'Containment incomplete',
      labelAr: 'Containment incomplete',
      connectorType: 'failure',
      decision: 'rejected',
      isDefaultPath: true,
      isHappyPath: false,
      sortOrder: 3,
    },
  ];
  const xml = designerFixtureBpmn({ ...base, stages, transitions });
  assert.ok(xml.includes('dgop:decision="approved"'));
  assert.ok(xml.includes('dgop:isHappyPath="false"'));

  const parsed = parseBpmnXml(xml);
  const reviewTransitions = parsed.transitions.filter((transition) => transition.fromStageId === 'review');
  assert.equal(reviewTransitions.find((transition) => transition.toStageId === 'closure')?.decision, 'approved');
  assert.equal(reviewTransitions.find((transition) => transition.toStageId === 'intake')?.decision, 'rejected');
  assert.equal(reviewTransitions.filter((transition) => transition.isDefaultPath).length, 1);
  assert.ok(!parsed.validation.errors.some((message) => message.includes('multiple default connector paths')));

  const legacyParsed = parseBpmnXml(xml.replace(' dgop:decision="approved"', ''));
  assert.equal(
    legacyParsed.transitions.find((transition) => transition.fromStageId === 'review' && transition.toStageId === 'closure')?.decision,
    'approved',
  );
});

test('BPMN designer: accepts JSON extension attributes escaped by a canvas export round trip', () => {
  const xml = designerFixtureBpmn();
  const canvasExport = xml.replace(/&quot;/g, '&amp;quot;');
  const parsed = parseBpmnXml(canvasExport);

  assert.ok(parsed.stages.every((stage) => stage.invalidConfigurationFields?.length === 0));
  assert.deepStrictEqual(
    parsed.stages.find((stage) => stage.code === 'intake')?.formSchemaJson,
    { fields: ['request_title'], required: ['request_title'] },
  );
  assert.ok(!parsed.validation.errors.some((message) => message.includes('invalid JSON')));
});

test('BPMN designer: validation enforces exactly one active start node', () => {
  const validation = validateWorkflowRoute(
    [
      {
        code: 'start_a',
        nameEn: 'Start A',
        nameAr: 'Start A',
        kind: 'intake',
        nodeType: 'start_event',
        taskType: 'routing',
        assigneeRoleCode: null,
        dueDays: 0,
        sortOrder: 1,
        isStart: true,
        isDecision: false,
        isFinal: false,
        isActive: true,
      },
      {
        code: 'start_b',
        nameEn: 'Start B',
        nameAr: 'Start B',
        kind: 'intake',
        nodeType: 'start_event',
        taskType: 'routing',
        assigneeRoleCode: null,
        dueDays: 0,
        sortOrder: 2,
        isStart: true,
        isDecision: false,
        isFinal: false,
        isActive: true,
      },
      {
        code: 'closed',
        nameEn: 'Closed',
        nameAr: 'Closed',
        kind: 'closure',
        nodeType: 'end_event',
        taskType: 'routing',
        assigneeRoleCode: null,
        dueDays: 0,
        sortOrder: 3,
        isStart: false,
        isDecision: false,
        isFinal: true,
        isActive: true,
      },
    ],
    [
      { fromStageId: 'start_a', toStageId: 'closed', labelEn: 'Finish', labelAr: 'Finish', isHappyPath: true, sortOrder: 1 },
      { fromStageId: 'start_b', toStageId: 'closed', labelEn: 'Finish', labelAr: 'Finish', isHappyPath: true, sortOrder: 2 },
    ],
  );

  assert.strictEqual(validation.status, 'blocked');
  assert.ok(validation.errors.some((message) => message.includes('exactly one active start')));
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
  const gate = buildWorkflowMvpReadinessGate(templates);
  assert.equal(gate.summary.templatesChecked, templates.length);
  assert.equal(gate.summary.requiredCoreNodes, 7);
  assert.equal(gate.summary.coreNodesRegistered, 7);
  assert.ok(gate.connectorTypes.some((connector) => connector.outcomes.includes(WORKFLOW_RETURN_FOR_CLARIFICATION)));
});

test('workflow v6 palette exposes core and advanced Volume 2 node types', () => {
  const allNodes = workflowNodePalette();
  const coreCodes = workflowNodePalette('core').map((node) => node.code);

  assert.deepStrictEqual(coreCodes, [
    'start_event',
    'end_event',
    'user_task',
    'approval_task',
    'decision_gateway',
    'parallel_gateway',
    'merge_gateway',
  ]);
  assert.ok(allNodes.some((node) => node.code === 'timer_event' && node.priority === 'advanced'));
  assert.ok(allNodes.some((node) => node.code === 'error_event' && node.category === 'resilience'));
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

test('workflow routes: return-for-clarification follows the explicit clarification path', () => {
  const transition = selectWorkflowTransitionForDecision(
    [
      { fromStageId: 'review', toStageId: 'close', decision: 'approved', isHappyPath: true, sortOrder: 1 },
      { fromStageId: 'review', toStageId: 'close', decision: 'rejected', isHappyPath: false, sortOrder: 2 },
      { fromStageId: 'review', toStageId: 'intake', decision: WORKFLOW_RETURN_FOR_CLARIFICATION, isHappyPath: false, sortOrder: 3 },
    ],
    'review',
    WORKFLOW_RETURN_FOR_CLARIFICATION,
  );
  assert.strictEqual(transition?.toStageId, 'intake');
});

test('workflow routes: decision gateways require and use an explicit default path', () => {
  const svc = makeService({});
  const fromStage = {
    id: 'stage-risk',
    code: 'risk_gateway',
    kind: 'gateway',
    isDecision: true,
    formSchemaJson: null,
    gatewayConfigJson: null,
  };
  const task = {
    dueDate: null,
    formDataJson: { risk: 'medium' },
    case: { id: 'case-1', status: 'submitted', type: 'general', assetId: null, asset: null },
  };

  assert.throws(
    () =>
      (svc as any).selectTransitionWithDmn(
        [
          { fromStageId: 'stage-risk', toStageId: 'manual', decision: 'manual_review', isHappyPath: false, sortOrder: 1 },
          { fromStageId: 'stage-risk', toStageId: 'auto', decision: 'auto_approve', isHappyPath: false, sortOrder: 2 },
        ],
        fromStage,
        task,
        'approved',
      ),
    /must define a default connector path/,
  );

  const selected = (svc as any).selectTransitionWithDmn(
    [
      { fromStageId: 'stage-risk', toStageId: 'manual', decision: 'manual_review', isHappyPath: false, sortOrder: 1 },
      {
        fromStageId: 'stage-risk',
        toStageId: 'fallback',
        decision: 'default',
        connectorType: 'default',
        isDefaultPath: true,
        isHappyPath: false,
        sortOrder: 2,
      },
    ],
    fromStage,
    task,
    'approved',
  );
  assert.strictEqual(selected?.toStageId, 'fallback');
});

test('workflow designer test run persists isolated route evidence without production cases', async () => {
  const template = designerTemplateFixture();
  const over: Over = {
    template,
    templates: [template],
    testRuns: [],
    auditEntries: [],
  };
  const svc = makeService(over);

  const run = await svc.executeDesignerTestRun(
    template.id,
    { environment: 'test', variables: { requestPriority: 'pilot' } },
    { id: 'admin', email: 'admin@dgop.local', roles: ['system_admin'] },
  );

  assert.equal(run.templateId, template.id);
  assert.equal(run.runNumber, 1);
  assert.equal(run.isolation.productionCasesCreated, 0);
  assert.equal(run.isolation.productionTasksCreated, 0);
  assert.equal((run.executedPath as any).path.length, 3);
  assert.equal(over.workflowCases?.length ?? 0, 0);
  assert.ok(over.testRunCreates?.[0].bpmnXml.includes('<bpmn:definitions'));
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_template.test_run.execute'));
});

test('workflow designer test run persists blocked diagnostics instead of failing the request', async () => {
  const template = designerTemplateFixture();
  const over: Over = {
    template,
    templates: [template],
    testRuns: [],
    auditEntries: [],
  };
  const svc = makeService(over);
  const invalidXml = designerFixtureBpmn(template).replace(' dgop:assigneeRoleCode="data_owner"', '');

  const run = await svc.executeDesignerTestRun(
    template.id,
    { environment: 'test', bpmnXml: invalidXml },
    { id: 'admin', email: 'admin@dgop.local', roles: ['system_admin'] },
  );

  assert.equal(run.status, 'blocked');
  assert.ok((run.executedPath as any).blockers.some((message: string) => message.includes('responsible role')));
  assert.equal(over.testRunCreates?.[0].status, 'blocked');
  assert.equal(over.workflowCases?.length ?? 0, 0);
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_template.test_run.execute'));
});

test('workflow designer test run retries a concurrent run-number collision', async () => {
  const template = designerTemplateFixture();
  const over: Over = {
    template,
    templates: [template],
    testRuns: [],
    auditEntries: [],
    testRunCreateErrors: ['P2002'],
  };
  const svc = makeService(over);

  const run = await svc.executeDesignerTestRun(
    template.id,
    { environment: 'test' },
    { id: 'admin', email: 'admin@dgop.local', roles: ['system_admin'] },
  );

  assert.equal(run.runNumber, 1);
  assert.equal(over.testRunCreates?.length, 1);
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_template.test_run.execute'));
});

test('workflow designer test run reset preserves evidence and records audit', async () => {
  const template = designerTemplateFixture();
  const existing = {
    id: 'test-run-1',
    templateId: template.id,
    runNumber: 3,
    environment: 'test',
    status: 'warning',
    bpmnXml: '<bpmn:definitions />',
    validationJson: { status: 'warning' },
    inputJson: { isolation: { mode: 'designer_test_space', productionCasesCreated: 0, productionTasksCreated: 0 } },
    simulationJson: { status: 'warning' },
    executedPathJson: { path: [] },
    resetAt: null,
    resetBy: null,
    createdBy: 'admin@dgop.local',
    createdAt: new Date('2026-08-15T09:00:00Z'),
    updatedAt: new Date('2026-08-15T09:00:00Z'),
  };
  const over: Over = {
    template,
    templates: [template],
    testRuns: [existing],
    auditEntries: [],
  };
  const svc = makeService(over);

  const reset = await svc.resetDesignerTestRun(
    template.id,
    existing.id,
    { id: 'admin', email: 'admin@dgop.local', roles: ['system_admin'] },
  );

  assert.equal(reset.status, 'reset');
  assert.equal(reset.resetBy, 'admin@dgop.local');
  assert.equal(over.testRunUpdates?.[0].data.status, 'reset');
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_template.test_run.reset'));
});

test('workflow operations report returns scoped AC-WF-17 evidence and operational metrics', async () => {
  const template = designerTemplateFixture();
  const over: Over = {
    workflowCases: [
      {
        id: 'case-1',
        code: 'WF-001',
        title: 'Pilot route case',
        status: 'submitted',
        type: 'general',
        createdBy: 'owner@dgop.local',
        createdAt: new Date('2026-08-14T08:00:00Z'),
        updatedAt: new Date('2026-08-14T09:00:00Z'),
        templateId: template.id,
        template: { id: template.id, code: template.code, nameEn: template.nameEn, nameAr: template.nameAr },
        asset: {
          orgUnitId: 'org-1',
          orgUnit: { id: 'org-1', code: 'DG', nameEn: 'Data Governance Office', nameAr: 'Data Governance Office' },
        },
        tasks: [
          {
            id: 'task-1',
            status: 'pending',
            type: 'review',
            dueDate: new Date('2026-08-14T08:00:00Z'),
            createdAt: new Date('2026-08-13T08:00:00Z'),
            completedAt: null,
            templateStage: { code: 'review', nameEn: 'Review', nameAr: 'Review' },
          },
        ],
      },
    ],
  };
  const svc = makeService(over);

  const report = await svc.workflowOperationsReport(
    ['system_admin'],
    { periodDays: 30, status: 'submitted' as never, ownerEmail: 'owner@dgop.local', orgUnitId: 'org-1' },
    { id: 'admin', email: 'admin@dgop.local', roles: ['system_admin'] },
  );

  const whereText = JSON.stringify(over.caseFindManyArgs.where);
  assert.equal(report.summary.initiatedWorkflows, 1);
  assert.equal(report.summary.overdueTasks, 1);
  assert.equal(report.acceptanceEvidence.criterion, 'AC-WF-17');
  assert.ok(whereText.includes('"createdBy":"owner@dgop.local"'));
  assert.ok(whereText.includes('"orgUnitId":"org-1"'));
});

test('workflow canvas MVP gate promotes Sprint 48/49 execution and reporting evidence', () => {
  const gate = buildWorkflowMvpReadinessGate([designerTemplateFixture()], {
    testRunCount: 1,
    automatedExecutionCount: 1,
    operationalReportReady: true,
  });

  const statusByCode = new Map(gate.criteria.map((item) => [item.code, item.status]));
  assert.equal(statusByCode.get('AC-WF-10'), 'ready');
  assert.equal(statusByCode.get('AC-WF-14'), 'ready');
  assert.equal(statusByCode.get('AC-WF-17'), 'ready');
});

test('workflow designer lifecycle: saving a draft resets reviewer approval', async () => {
  const template = designerTemplateFixture({
    securityJson: {
      workflowLifecycle: {
        state: 'under_review',
        reviewStatus: 'approved',
        approvedModelSignature: 'previous-signature',
        reviewedBy: 'reviewer@dgop.local',
      },
    },
  });
  const over: Over = { template, templateUpdates: [], auditEntries: [] };
  const svc = makeService(over);

  await svc.saveTemplateBpmnDraft(
    template.id,
    { bpmnXml: designerFixtureBpmn(template), changeSummary: 'Draft after review' },
    { id: 'designer', email: 'designer@dgop.local', roles: ['workflow_designer'] },
  );

  const lifecycle = over.templateUpdates?.[0].securityJson.workflowLifecycle;
  assert.equal(lifecycle.state, 'draft');
  assert.equal(lifecycle.reviewStatus, 'not_submitted');
  assert.equal(lifecycle.approvedModelSignature, null);
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_template.bpmn_draft.save'));
});

test('workflow designer lifecycle: publish rejects unapproved BPMN snapshots', async () => {
  const template = designerTemplateFixture();
  const xml = designerFixtureBpmn(template);
  (template as any).bpmnXml = xml;
  const svc = makeService({ template });

  await assert.rejects(
    () => svc.publishTemplateBpmn(
      template.id,
      { bpmnXml: xml, changeSummary: 'Attempt publish' },
      { id: 'publisher', email: 'publisher@dgop.local', roles: ['workflow_publisher'] },
    ),
    /reviewed and approved/,
  );
});

test('workflow designer lifecycle: submit, approve and publish records reviewer gate', async () => {
  const template = designerTemplateFixture();
  const xml = designerFixtureBpmn(template);
  const over: Over = {
    template,
    workflowCases: [],
    templateUpdates: [],
    templateVersionCreates: [],
    auditEntries: [],
  };
  const svc = makeService(over);

  await svc.submitTemplateReview(
    template.id,
    { bpmnXml: xml, comment: 'Ready for review' },
    { id: 'designer', email: 'designer@dgop.local', roles: ['workflow_designer'] },
  );
  await svc.approveTemplateReview(
    template.id,
    { comment: 'Approved for pilot' },
    { id: 'reviewer', email: 'reviewer@dgop.local', roles: ['workflow_reviewer'] },
  );
  await svc.publishTemplateBpmn(
    template.id,
    { bpmnXml: xml, changeSummary: 'Publish approved workflow' },
    { id: 'publisher', email: 'publisher@dgop.local', roles: ['workflow_publisher'] },
  );

  const publishUpdate = over.templateUpdates?.find((update) => update.lastPublishedBy === 'publisher@dgop.local');
  const publishLifecycle = publishUpdate.securityJson.workflowLifecycle;
  assert.equal(publishLifecycle.reviewStatus, 'published');
  assert.equal(publishLifecycle.reviewedBy, 'reviewer@dgop.local');
  assert.equal(over.templateVersionCreates?.[0].createdBy, 'publisher@dgop.local');
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_template.review.submit'));
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_template.review.approve'));
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_template.bpmn.publish'));
});

test('workflow designer lifecycle: administrators cannot override three-actor segregation of duties', async () => {
  const template = designerTemplateFixture();
  const xml = designerFixtureBpmn(template);
  const over: Over = { template, workflowCases: [], templateUpdates: [], templateVersionCreates: [], auditEntries: [] };
  const svc = makeService(over);
  const designer = { id: 'admin-designer', email: 'admin-designer@dgop.local', roles: ['system_admin'] };

  await svc.submitTemplateReview(template.id, { bpmnXml: xml, comment: 'Ready' }, designer);
  await assert.rejects(
    () => svc.approveTemplateReview(template.id, { comment: 'Self approval' }, designer),
    /Segregation of duties/,
  );
  await svc.approveTemplateReview(
    template.id,
    { comment: 'Independent approval' },
    { id: 'reviewer', email: 'reviewer@dgop.local', roles: ['workflow_reviewer'] },
  );
  await assert.rejects(
    () => svc.publishTemplateBpmn(template.id, { bpmnXml: xml, changeSummary: 'Self publish' }, designer),
    /Segregation of duties/,
  );
  assert.ok(!over.templateVersionCreates?.length);
});

test('workflow designer lifecycle: publish rejects diagrams changed after approval', async () => {
  const template = designerTemplateFixture();
  const xml = designerFixtureBpmn(template);
  const changedXml = xml.replace('Designer fixture route', 'Changed fixture route');
  const svc = makeService({ template, workflowCases: [] });

  await svc.submitTemplateReview(
    template.id,
    { bpmnXml: xml, comment: 'Ready for review' },
    { id: 'designer', email: 'designer@dgop.local', roles: ['workflow_designer'] },
  );
  await svc.approveTemplateReview(
    template.id,
    { comment: 'Approved' },
    { id: 'reviewer', email: 'reviewer@dgop.local', roles: ['workflow_reviewer'] },
  );

  await assert.rejects(
    () => svc.publishTemplateBpmn(
      template.id,
      { bpmnXml: changedXml, changeSummary: 'Publish changed route' },
      { id: 'publisher', email: 'publisher@dgop.local', roles: ['workflow_publisher'] },
    ),
    /changed after approval/,
  );
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

test('getCaseTokenTrace: returns ordered runtime token lineage with parent stage hints', async () => {
  const activatedAt = new Date('2026-08-14T10:00:00.000Z');
  const over: Over = {
    case: { id: 'case-1', assetId: null, createdBy: 'admin@dgop.local' },
    runtimeTokens: [
      {
        id: 'token-root',
        instanceKey: 'case-1:stage-review:task-review',
        state: 'completed',
        tokenType: 'stage',
        parentTokenId: null,
        rootTokenId: null,
        branchKey: null,
        branchIndex: null,
        joinKey: null,
        sourceTransitionId: null,
        parallelGroup: null,
        dataJson: { stageCode: 'review' },
        activatedAt,
        completedAt: new Date('2026-08-14T11:00:00.000Z'),
        createdAt: activatedAt,
        templateStage: { id: 'stage-review', code: 'review', nameEn: 'Review', nodeType: 'user_task', isDecision: false, isFinal: false },
        task: { id: 'task-review', title: 'Review', status: 'completed', decision: 'approved', completedAt: new Date('2026-08-14T11:00:00.000Z') },
      },
      {
        id: 'token-branch',
        instanceKey: 'case-1:stage-remediate:task-remediate',
        state: 'active',
        tokenType: 'stage',
        parentTokenId: 'token-root',
        rootTokenId: 'token-root',
        branchKey: 'branch-remediate',
        branchIndex: 1,
        joinKey: 'join-1',
        sourceTransitionId: 'transition-parallel',
        parallelGroup: 'join-1',
        dataJson: { stageCode: 'remediate' },
        activatedAt: new Date('2026-08-14T11:05:00.000Z'),
        completedAt: null,
        createdAt: new Date('2026-08-14T11:05:00.000Z'),
        templateStage: { id: 'stage-remediate', code: 'remediate', nameEn: 'Remediate', nodeType: 'user_task', isDecision: false, isFinal: false },
        task: { id: 'task-remediate', title: 'Remediate', status: 'pending', decision: null, completedAt: null },
      },
    ],
  };
  const svc = makeService(over);

  const trace = await svc.getCaseTokenTrace(
    ['system_admin'],
    'case-1',
    { id: 'admin', email: 'admin@dgop.local', roles: ['system_admin'] } as never,
  );

  assert.deepStrictEqual(over.runtimeTokenFindManyArgs.where, { caseId: 'case-1' });
  assert.strictEqual(trace.tokens.length, 2);
  assert.strictEqual(trace.tokens[1].parentStageCode, 'review');
  assert.strictEqual(trace.tokens[1].rootTokenId, 'token-root');
  assert.strictEqual(trace.lineage[1].branchKey, 'branch-remediate');
});

test('recordDomainTaskDecision: auto-assigns next stage only to a scoped role holder', async () => {
  const over: Over = {
    createdTasks: [],
    caseUpdates: [],
    taskBulkUpdates: [],
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

test('decideTask: required stage evidence blocks approval until evidence exists', async () => {
  const svc = makeService({
    attachmentCount: 0,
    task: {
      id: 'task-evidence',
      assigneeUserId: 'u1',
      status: 'pending',
      caseId: 'case-evidence',
      case: { id: 'case-evidence', type: 'general', status: 'submitted', createdBy: 'x@dgop.local', assetId: null },
      templateStage: {
        code: 'approval',
        nameEn: 'Approval decision',
        evidenceRequirementsJson: [{ name: 'Signed approval note', required: true }],
        formSchemaJson: null,
      },
    },
  });

  await assert.rejects(
    () => svc.decideTask('task-evidence', { decision: 'approved', comment: 'Looks fine' } as never, { id: 'u1', email: 'u1@dgop.local', roles: [] } as never),
    /attach the required evidence/,
  );
});

test('workflow inbox saves task form progress as an audited draft', async () => {
  const over: Over = {
    taskUpdates: [],
    events: [],
    auditEntries: [],
    task: {
      id: 'task-draft',
      title: 'Capture request',
      assigneeUserId: 'u1',
      assigneeRoleCode: null,
      status: 'pending',
      caseId: 'case-draft',
      formSubmittedAt: new Date('2026-08-20T08:00:00Z'),
      case: { id: 'case-draft', type: 'general', status: 'submitted', createdBy: 'u1@dgop.local', assetId: null },
      templateStage: {
        code: 'intake',
        nameEn: 'Request intake',
        assigneeRoleCode: null,
        formSchemaJson: { fields: ['request_summary'], required: ['request_summary'] },
      },
    },
  };
  const svc = makeService(over);

  const saved = await svc.saveTaskFormDraft(
    'task-draft',
    { data: { request_summary: 'Draft governance request' } },
    { id: 'u1', email: 'u1@dgop.local', roles: [] } as never,
  );

  assert.deepStrictEqual(over.taskUpdates?.[0].formDataJson, { request_summary: 'Draft governance request' });
  assert.strictEqual(over.taskUpdates?.[0].formSubmittedAt, null);
  assert.strictEqual(over.events?.[0].action, 'task.form.draft_saved');
  assert.strictEqual(over.auditEntries?.[0].action, 'workflow_task.form.draft.save');
  assert.deepStrictEqual(saved.formDataJson, { request_summary: 'Draft governance request' });
});

test('decideTask: a complete but unsubmitted inbox draft cannot be approved', async () => {
  const svc = makeService({
    task: {
      id: 'task-form-draft',
      assigneeUserId: 'u1',
      status: 'pending',
      caseId: 'case-form-draft',
      formDataJson: { request_summary: 'Complete draft' },
      formSubmittedAt: null,
      case: { id: 'case-form-draft', type: 'general', status: 'submitted', createdBy: 'u1@dgop.local', assetId: null },
      templateStage: {
        code: 'intake',
        nameEn: 'Request intake',
        evidenceRequirementsJson: null,
        formSchemaJson: { fields: ['request_summary'], required: ['request_summary'] },
      },
    },
  });

  await assert.rejects(
    () => svc.decideTask('task-form-draft', { decision: 'approved', comment: 'Approved' } as never, { id: 'u1', email: 'u1@dgop.local', roles: [] } as never),
    /submit the completed task form/i,
  );
});

test('workflow routes: automated stages create a durable execution before the next human task', async () => {
  const over: Over = {
    attachmentCount: 0,
    createdTasks: [],
    caseUpdates: [],
    taskUpdates: [],
    events: [],
    task: {
      id: 'task-review',
      assigneeUserId: 'u1',
      status: 'pending',
      caseId: 'case-auto',
      templateStageId: 'stage-review',
      case: {
        id: 'case-auto',
        type: 'general',
        status: 'submitted',
        createdBy: 'x@dgop.local',
        assignmentId: null,
        templateId: 'template-auto',
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
          nodeType: 'user_task',
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
          id: 'stage-score',
          code: 'score',
          nameEn: 'Score routing rule',
          nameAr: 'Score routing rule',
          kind: 'automation',
          nodeType: 'business_rule_task',
          taskType: 'review',
          assigneeRoleCode: null,
          dueDays: 0,
          sortOrder: 2,
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
          nodeType: 'user_task',
          taskType: 'approval',
          assigneeRoleCode: 'data_owner',
          dueDays: 1,
          sortOrder: 3,
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
          toStageId: 'stage-score',
          decision: null,
          isHappyPath: true,
          sortOrder: 1,
          toStage: { id: 'stage-score', code: 'score' },
        },
        {
          id: 'transition-2',
          fromStageId: 'stage-score',
          toStageId: 'stage-decision',
          decision: null,
          isHappyPath: true,
          sortOrder: 2,
          toStage: { id: 'stage-decision', code: 'decision' },
        },
      ],
    },
  };
  const svc = makeService(over);
  await svc.decideTask('task-review', { decision: 'approved', comment: 'Proceed' } as never, { id: 'u1', email: 'u1@dgop.local', roles: [] } as never);

  assert.strictEqual(over.createdTasks?.length, 1);
  assert.strictEqual(over.createdTasks?.[0].templateStageId, 'stage-score');
  assert.strictEqual(over.executionAttempts?.length, 1);
  assert.strictEqual(over.executionAttempts?.[0].executionKind, 'business_rule_task');
  assert.ok(over.events?.some((event) => event.action === 'route.automation.queued'));
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
test('workflow attachments: controlled upload hashes content and authorizes managed download', async () => {
  const previousStorage = process.env.WORKFLOW_ATTACHMENT_STORAGE_DIR;
  const storageDir = await mkdtemp(join(tmpdir(), 'dgop-workflow-attachment-'));
  process.env.WORKFLOW_ATTACHMENT_STORAGE_DIR = storageDir;
  const over: Over = {
    attachmentCreates: [],
    events: [],
    auditEntries: [],
    case: {
      id: 'case-attachment',
      assetId: null,
      status: 'submitted',
      type: 'general',
      createdBy: 'admin@dgop.local',
    },
  };
  try {
    const svc = makeService(over);
    const file = {
      originalname: 'decision-evidence.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nDGOP workflow evidence'),
      size: 32,
    };
    const user = { id: 'admin', email: 'admin@dgop.local', roles: ['system_admin'] } as never;

    const attachment = await svc.addCaseAttachment('case-attachment', {} as never, file, user);

    assert.strictEqual(attachment.checksum?.length, 64);
    assert.match(attachment.storageUrl, /^\/api\/workflow\/attachments\/[0-9a-f-]+\/file$/u);
    assert.strictEqual('storedName' in attachment, false);
    assert.strictEqual((await readdir(storageDir)).length, 1);
    const managedFile = await svc.attachmentFile(attachment.id, user);
    assert.strictEqual(managedFile.originalName, 'decision-evidence.pdf');
    assert.ok(managedFile.path.startsWith(storageDir));

    await assert.rejects(
      () => svc.addCaseAttachment(
        'case-attachment',
        {} as never,
        { ...file, buffer: Buffer.from('not a pdf') },
        user,
      ),
      /does not match the declared file type/,
    );
  } finally {
    if (previousStorage === undefined) delete process.env.WORKFLOW_ATTACHMENT_STORAGE_DIR;
    else process.env.WORKFLOW_ATTACHMENT_STORAGE_DIR = previousStorage;
    await rm(storageDir, { recursive: true, force: true });
  }
});

test('merge gateway waits for an active sibling token even when that branch is still upstream', async () => {
  let tokenWhere: any;
  const client = {
    workflowRuntimeToken: {
      findFirst: async () => ({ id: 'token-current', rootTokenId: 'token-root', branchKey: 'branch-1', joinKey: 'join:review:instance:task-split' }),
      count: async ({ where }: any) => { tokenWhere = where; return 1; },
    },
    workflowTask: { count: async () => 0 },
  };
  const svc = makeService({});

  const waiting = await (svc as any).hasOpenIncomingMergeTasks(
    client,
    'case-1',
    { transitions: [] },
    { id: 'merge-1' },
    'task-current',
  );

  assert.strictEqual(waiting, true);
  assert.deepStrictEqual(tokenWhere, {
    caseId: 'case-1',
    joinKey: 'join:review:instance:task-split',
    state: 'active',
    id: { not: 'token-current' },
  });
});

test('nested merge gateways resolve the active join from the lineage stack', async () => {
  let tokenWhere: any;
  const client = {
    workflowRuntimeToken: {
      findFirst: async () => ({
        id: 'token-current',
        rootTokenId: 'token-root',
        branchKey: 'inner-branch',
        joinKey: 'join:inner',
        dataJson: { joinStack: ['join:outer', 'join:inner'] },
      }),
      count: async ({ where }: any) => { tokenWhere = where; return 1; },
    },
    workflowTask: { count: async () => 0 },
  };
  const svc = makeService({});

  const waiting = await (svc as any).hasOpenIncomingMergeTasks(
    client,
    'case-1',
    { transitions: [] },
    { id: 'merge-outer' },
    'task-current',
    1,
  );

  assert.strictEqual(waiting, true);
  assert.strictEqual(tokenWhere.joinKey, 'join:outer');
});

test('automation configuration rejects no-op actions and validates governed actions', () => {
  assert.strictEqual(validateWorkflowAutomationConfig({ action: 'noop' }).valid, false);
  assert.strictEqual(validateWorkflowAutomationConfig({ action: 'record_control_event', eventAction: 'control.checked' }).valid, true);
  assert.strictEqual(validateWorkflowAutomationConfig({ action: 'set_runtime_variables', values: { riskScore: 4 } }).valid, true);
  assert.strictEqual(validateWorkflowAutomationConfig({ action: 'invoke_connector', connectorCode: 'CATALOG-API', endpoint: 'health' }).valid, true);
});

test('configured automation updates runtime variables and executes connectors through the integration boundary', async () => {
  const over: Over = {
    runtimeTokens: [{ id: 'token-1', taskId: 'task-1', state: 'active', dataJson: { joinStack: ['join:1'], variables: { existing: true } } }],
    runtimeTokenUpdates: [],
    integrationCalls: [],
  };
  const svc = makeService(over);

  const variableResult = await (svc as any).executeConfiguredAutomation(
    { caseId: 'case-1', taskId: 'task-1' },
    { action: 'set_runtime_variables', values: { riskScore: 4 } },
  );
  const connectorResult = await (svc as any).executeConfiguredAutomation(
    { caseId: 'case-1', taskId: 'task-1' },
    { action: 'invoke_connector', connectorCode: 'CATALOG-API', endpoint: 'health' },
  );

  assert.deepStrictEqual(variableResult.updatedVariables, ['riskScore']);
  assert.deepStrictEqual((over.runtimeTokenUpdates?.[0] as any).data.dataJson.variables, { existing: true, riskScore: 4 });
  assert.deepStrictEqual(over.integrationCalls, [{ connectorId: null, connectorCode: 'CATALOG-API', endpoint: 'health', payload: undefined }]);
  assert.strictEqual(connectorResult.status, 200);
});

test('manual execution worker trigger is restricted to administrators and audited', async () => {
  const over: Over = { executionAttempts: [], auditEntries: [] };
  const svc = makeService(over);
  await assert.rejects(
    () => svc.processRuntimeExecutions({ email: 'steward@dgop.local', roles: ['data_steward'] } as never),
    /Only workflow administrators/,
  );

  const result = await svc.processRuntimeExecutions({ email: 'admin@dgop.local', roles: ['system_admin'] } as never);
  assert.strictEqual(result.processed, 0);
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_execution.worker.triggered'));
});

test('parallel gateway assigns a distinct join key to each split instance', () => {
  const gateway = { id: 'gateway-parallel', code: 'parallel', parallelGroup: 'review-group', nodeType: 'parallel_gateway' };
  const branchA = { id: 'stage-a', code: 'branch-a', nodeType: 'user_task', taskType: 'review', kind: 'review', isFinal: false, isActive: true };
  const branchB = { id: 'stage-b', code: 'branch-b', nodeType: 'user_task', taskType: 'review', kind: 'review', isFinal: false, isActive: true };
  const template = {
    stages: [gateway, branchA, branchB],
    transitions: [
      { id: 'transition-a', fromStageId: gateway.id, toStageId: branchA.id, sortOrder: 1 },
      { id: 'transition-b', fromStageId: gateway.id, toStageId: branchB.id, sortOrder: 2 },
    ],
  };
  const svc = makeService({});
  const task = { case: { id: 'case-1', status: 'submitted', type: 'general', assetId: null } };

  const first = (svc as any).parallelBranchesForGateway(template, gateway, { ...task, id: 'split-task-1' }, 'approved');
  const second = (svc as any).parallelBranchesForGateway(template, gateway, { ...task, id: 'split-task-2' }, 'approved');

  assert.strictEqual(first[0].joinKey, first[1].joinKey);
  assert.notStrictEqual(first[0].joinKey, second[0].joinKey);
  assert.match(first[0].joinKey, /instance:split-task-1$/u);
});

test('decideTask: a stale concurrent decision cannot emit events or advance the route', async () => {
  const over: Over = {
    taskUpdateManyCount: 0,
    events: [],
    createdTasks: [],
    task: {
      id: 'task-raced',
      assigneeUserId: 'u1',
      status: 'pending',
      caseId: 'case-raced',
      templateStageId: null,
      templateStage: null,
      case: {
        id: 'case-raced',
        type: 'general',
        status: 'submitted',
        createdBy: 'owner@dgop.local',
        assignmentId: null,
        templateId: null,
        assetId: null,
      },
    },
  };
  const svc = makeService(over);

  await assert.rejects(
    () => svc.decideTask(
      'task-raced',
      { decision: 'approved' } as never,
      { id: 'u1', email: 'u1@dgop.local', roles: [] } as never,
    ),
    /decided by another user/,
  );
  assert.strictEqual(over.events?.length, 0);
  assert.strictEqual(over.createdTasks?.length, 0);
});

test('decideTask: concurrent submissions produce exactly one committed decision', async () => {
  const over: Over = {
    events: [],
    createdTasks: [],
    task: {
      id: 'task-concurrent',
      assigneeUserId: 'u1',
      status: 'pending',
      caseId: 'case-concurrent',
      templateStageId: null,
      templateStage: null,
      case: {
        id: 'case-concurrent',
        type: 'general',
        status: 'submitted',
        createdBy: 'owner@dgop.local',
        assignmentId: null,
        templateId: null,
        assetId: null,
      },
    },
  };
  const svc = makeService(over);
  const actor = { id: 'u1', email: 'u1@dgop.local', roles: [] } as never;

  const results = await Promise.allSettled([
    svc.decideTask('task-concurrent', { decision: 'approved' } as never, actor),
    svc.decideTask('task-concurrent', { decision: 'rejected' } as never, actor),
  ]);

  assert.strictEqual(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.strictEqual(results.filter((result) => result.status === 'rejected').length, 1);
  assert.strictEqual(over.events?.filter((event) => String(event.action).startsWith('decision.')).length, 1);
});

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
    taskBulkUpdates: [],
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
  assert.strictEqual(over.taskBulkUpdates?.[0].assigneeUserId, 'u-steward');
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

test('submitAssignmentForApproval: approved assignments cannot be resubmitted', async () => {
  const svc = makeService({
    assignment: {
      approvalStatus: 'approved',
      roleType: { code: 'data_owner', nameEn: 'Data Owner' },
      targetType: 'asset',
      targetId: 'a1',
      person: { fullNameEn: 'Alice', userId: null },
    },
    submitter: { id: 'u-sub', email: 'sub@dgop.local' },
  });
  await assert.rejects(
    () => svc.submitAssignmentForApproval({ assignmentId: 'as1', approverUserId: 'u-approver' } as never, ['system_admin'], 'sub@dgop.local'),
    /Only proposed assignments can be submitted/,
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

test('decideTask: approving a proposed primary owner demotes the previous accountable owner', async () => {
  const over: Over = {
    task: {
      id: 't1',
      assigneeUserId: 'u-appr',
      status: 'pending',
      caseId: 'c1',
      case: { type: 'owner_assignment_approval', createdBy: 'sub@dgop.local', assignmentId: 'as-new' },
    },
    assignment: {
      id: 'as-new',
      targetType: 'asset',
      targetId: 'asset-1',
      roleTypeId: 'data-owner-role',
      isPrimary: true,
      isActive: true,
      effectiveDate: new Date('2026-01-01'),
      expiryDate: null,
    },
  };
  const svc = makeService(over);
  await svc.decideTask(
    't1',
    { decision: 'approved' } as never,
    { id: 'u-appr', email: 'appr@dgop.local', roles: ['system_admin'] } as never,
  );
  assert.strictEqual(over.assignmentUpdate?.approvalStatus, 'approved');
  assert.strictEqual(over.assignmentBulkUpdates?.[0].data.isPrimary, false);
  assert.strictEqual(over.assignmentBulkUpdates?.[0].where.NOT.id, 'as-new');
  assert.strictEqual(over.assignmentBulkUpdates?.[0].where.roleTypeId, 'data-owner-role');
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

test('decideTask: return for clarification opens an information task for the submitter', async () => {
  const over: Over = {
    createdTasks: [],
    caseUpdates: [],
    taskBulkUpdates: [],
    events: [],
    auditEntries: [],
    submitter: { id: 'u-submit' },
    task: {
      id: 't1',
      title: 'Approve owner assignment',
      assigneeUserId: 'u-appr',
      status: 'pending',
      caseId: 'c1',
      case: {
        id: 'c1',
        type: 'owner_assignment_approval',
        status: 'submitted',
        createdBy: 'sub@dgop.local',
        assignmentId: 'as1',
        assetId: 'asset-1',
      },
    },
    assignment: { id: 'as1', targetType: 'asset', targetId: 'asset-1', isActive: true },
  };
  const svc = makeService(over);

  await svc.decideTask(
    't1',
    { decision: WORKFLOW_RETURN_FOR_CLARIFICATION, comment: 'Need owner evidence.' } as never,
    { id: 'u-appr', email: 'appr@dgop.local', roles: ['system_admin'] } as never,
  );

  assert.strictEqual(over.taskBulkUpdates?.[0].decision, null);
  assert.strictEqual(over.createdTasks?.[0].type, 'information');
  assert.strictEqual(over.createdTasks?.[0].assigneeUserId, 'u-submit');
  assert.strictEqual(over.caseUpdates?.[0].status, 'awaiting_information');
  assert.strictEqual(over.assignmentUpdate, undefined);
  assert.ok(over.events?.some((event) => event.action === 'decision.return_for_clarification'));
  assert.ok(over.auditEntries?.some((entry) => entry.action === 'workflow_task.return_for_clarification'));
});

test('enterprise workflow helpers: DMN table evaluates a target stage decision', () => {
  const result = evaluateWorkflowDmnTable(
    {
      rules: [
        { id: 'low-risk', conditions: { risk: 'low' }, result: { targetStageCode: 'auto_close' } },
        { id: 'high-risk', conditions: { risk: 'high' }, result: { decision: 'approved', targetStageCode: 'owner_review' } },
      ],
    },
    { risk: 'high' },
  );

  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.ruleId, 'high-risk');
  assert.strictEqual(result.decision, 'approved');
  assert.strictEqual(result.targetStageCode, 'owner_review');
});

test('enterprise workflow helpers: reusable form schemas enforce required fields', () => {
  const schema = {
    fields: [
      { name: 'businessReason', required: true },
      { name: 'riskScore', type: 'number', required: true },
      { name: 'decision', options: ['approve', 'reject'] },
      { name: 'requiresDpia', label: 'DPIA required', type: 'boolean' },
      { name: 'targetDate', label: 'Target date', type: 'date' },
      { name: 'reviewers', label: 'Reviewers', type: 'list', allowed: ['privacy', 'security'] },
    ],
  };

  const missing = validateWorkflowFormData(schema, {
    businessReason: 'Needed for audit',
    requiresDpia: 'yes',
    targetDate: 'not-a-date',
    reviewers: ['privacy', 'legal'],
  });
  assert.strictEqual(missing.valid, false);
  assert.ok(missing.missing.includes('riskScore'));
  assert.ok(missing.errors.some((error) => error.includes('DPIA required must be true or false')));
  assert.ok(missing.errors.some((error) => error.includes('Target date must be a valid date')));
  assert.ok(missing.errors.some((error) => error.includes('Reviewers must use one of the configured allowed values')));

  const valid = validateWorkflowFormData(schema, {
    businessReason: 'Needed for audit',
    riskScore: 82,
    decision: 'approve',
    requiresDpia: true,
    targetDate: '2026-08-14',
    reviewers: ['privacy', 'security'],
  });
  assert.strictEqual(valid.valid, true);
});

test('enterprise workflow helpers: variable context exposes typed case, stage, actor, and form values', () => {
  const context = buildWorkflowVariableContext({
    decision: 'approved',
    caseId: 'case-1',
    caseStatus: 'submitted',
    caseType: 'data_quality_issue',
    assetId: 'asset-1',
    assetType: 'dataset',
    stageCode: 'decision',
    stageKind: 'approval',
    actorUserId: 'owner@dgop.local',
    actorRoles: ['data_owner'],
    formRequiredComplete: true,
    taskSlaDueDate: new Date('2026-08-14T10:00:00Z'),
    formData: { riskScore: 82, reviewers: ['privacy', 'security'] },
  });

  assert.strictEqual(context['caseId'], 'case-1');
  assert.strictEqual((context['case'] as Record<string, unknown>)['id'], 'case-1');
  assert.strictEqual((context['asset'] as Record<string, unknown>)['type'], 'dataset');
  assert.strictEqual((context['task'] as Record<string, unknown>)['decision'], 'approved');
  assert.deepStrictEqual((context['actor'] as Record<string, unknown>)['roles'], ['data_owner']);
  assert.strictEqual((context['formData'] as Record<string, unknown>)['riskScore'], 82);
  assert.deepStrictEqual((context['formData'] as Record<string, unknown>)['reviewers'], ['privacy', 'security']);
});

test('enterprise workflow helpers: route version diff identifies stage and transition changes', () => {
  const diff = buildWorkflowVersionDiff(
    {
      stages: [
        { code: 'intake', nameEn: 'Intake', dueDays: 1 },
        { code: 'approve', nameEn: 'Approve', dueDays: 2 },
      ],
      transitions: [{ fromStageId: 'intake', toStageId: 'approve', labelEn: 'Ready' }],
    },
    {
      stages: [
        { code: 'intake', nameEn: 'Intake', dueDays: 1 },
        { code: 'review', nameEn: 'Review', dueDays: 2 },
        { code: 'approve', nameEn: 'Approve', dueDays: 3 },
      ],
      transitions: [
        { fromStageId: 'intake', toStageId: 'review', labelEn: 'Review' },
        { fromStageId: 'review', toStageId: 'approve', labelEn: 'Approve' },
      ],
    },
  );

  assert.strictEqual(diff.summary.addedStages, 1);
  assert.strictEqual(diff.summary.changedStages, 1);
  assert.strictEqual(diff.summary.addedTransitions, 2);
  assert.strictEqual(diff.summary.removedTransitions, 1);
});

test('enterprise workflow runtime: parallel approval stage opens one task per approver role', async () => {
  const over: Over = {
    createdTasks: [],
    events: [],
    userRoleCandidatesByRole: {
      data_owner: [{ userId: 'owner-user', user: { userRoles: [{ role: { code: 'data_owner', isActive: true, deletedAt: null } }] } }],
      privacy_officer: [{ userId: 'privacy-user', user: { userRoles: [{ role: { code: 'privacy_officer', isActive: true, deletedAt: null } }] } }],
    },
  };
  const svc = makeService(over);
  await (svc as any).createStageTask(
    (svc as any).prisma,
    'case-parallel',
    {
      id: 'stage-approval',
      code: 'approval',
      nameEn: 'Enterprise approval',
      taskType: 'approval',
      assigneeRoleCode: 'data_owner',
      dueDays: 2,
      gatewayConfigJson: { approvalMode: 'parallel', approverRoleCodes: ['data_owner', 'privacy_officer'] },
      isStart: false,
      isFinal: false,
      isActive: true,
    },
    'admin@dgop.local',
    { assetId: null },
  );

  assert.strictEqual(over.createdTasks?.length, 2);
  assert.deepStrictEqual(over.createdTasks?.map((task) => task.assigneeRoleCode), ['data_owner', 'privacy_officer']);
  assert.ok(over.createdTasks?.every((task) => task.approvalMode === 'parallel'));
  assert.ok(over.events?.some((event) => event.action === 'route.parallel_approval.activated'));
});

test('enterprise workflow runtime: completed child workflow is resumed exactly once across workers', async () => {
  const attempt: any = {
    id: 'execution-child-1',
    caseId: 'case-parent',
    taskId: 'task-parent',
    status: 'waiting_child',
    resultJson: { childCaseId: 'case-child' },
    templateStage: { id: 'stage-sub', nameEn: 'Invoke governed child route' },
    task: {
      id: 'task-parent',
      status: 'completed',
      templateStage: { id: 'stage-sub', nameEn: 'Invoke governed child route' },
      case: { id: 'case-parent', status: 'submitted' },
    },
  };
  const first = makeService({ executionAttempts: [attempt] });
  const prisma = (first as any).prisma;
  let claimCount = 0;
  prisma.workflowCase.findUnique = async () => ({ status: 'closed' });
  prisma.workflowExecutionAttempt.updateMany = async ({ where, data }: any) => {
    if (!where.status.in.includes(attempt.status)) return { count: 0 };
    attempt.status = data.status;
    claimCount += 1;
    return { count: 1 };
  };
  prisma.workflowExecutionAttempt.update = async ({ data }: any) => {
    Object.assign(attempt, data);
    return attempt;
  };
  const second = new WorkflowService(
    prisma,
    (first as any).audit,
    (first as any).scope,
    (first as any).assignments,
    (first as any).integrations,
  );

  const results = await Promise.all([
    (first as any).resumeSubWorkflowAttempt(attempt.id),
    (second as any).resumeSubWorkflowAttempt(attempt.id),
  ]);

  assert.strictEqual(claimCount, 1);
  assert.strictEqual(
    results.reduce((sum, result) => sum + result.succeeded + result.failed, 0),
    1,
  );
  assert.strictEqual(attempt.status, 'succeeded');
});

test('enterprise workflow runtime: timer nodes create durable future execution attempts from SLA configuration', async () => {
  const over: Over = { createdTasks: [], executionAttempts: [], events: [] };
  const svc = makeService(over);
  const timerStage = {
    id: 'stage-timer',
    code: 'wait_for_sla',
    nameEn: 'Wait for SLA',
    nodeType: 'timer_event',
    kind: 'timer',
    taskType: 'routing',
    assignmentStrategy: 'automation',
    assigneeRoleCode: null,
    dueDays: 0,
    slaConfigJson: { durationMinutes: 5 },
    automationConfigJson: null,
    gatewayConfigJson: null,
    parallelGroup: null,
    isStart: false,
    isFinal: false,
    isActive: true,
  };
  const before = Date.now();

  await (svc as any).createStageTask((svc as any).prisma, 'case-timer', timerStage, 'system:test');

  assert.strictEqual(isAutomatedWorkflowStage(timerStage), true);
  assert.strictEqual(isRoutingOnlyWorkflowStage(timerStage), false);
  assert.strictEqual(over.createdTasks?.length, 1);
  assert.strictEqual(over.executionAttempts?.length, 1);
  assert.strictEqual(over.executionAttempts?.[0].executionKind, 'timer_event');
  assert.strictEqual(over.executionAttempts?.[0].maxAttempts, 1);
  assert.deepStrictEqual(over.executionAttempts?.[0].inputJson, { durationMinutes: 5 });
  assert.ok(over.executionAttempts?.[0].nextAttemptAt.getTime() >= before + 299_000);
  assert.ok(over.events?.some((event) => event.action === 'route.timer.scheduled'));
});

test('enterprise workflow runtime: invalid timer schedules fail closed', () => {
  const svc = makeService({});
  assert.throws(
    () => (svc as any).executionScheduleForStage({ nodeType: 'timer_event', slaConfigJson: { label: 'later' } }),
    /requires a valid due date, duration, timeout, or SLA expiration/,
  );
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
