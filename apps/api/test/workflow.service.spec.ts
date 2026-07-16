/**
 * Lightweight unit tests for the workflow engine: SLA derivation, decision
 * authority, segregation of duties and assignment-approval wiring.
 * (no jest dependency). Run with: ts-node test/workflow.service.spec.ts
 */
import assert from 'node:assert';
import { WorkflowService } from '../src/workflow/workflow.service';
import {
  DEFAULT_WORKFLOW_TEMPLATES,
  firstActionableWorkflowStage,
  routeGateForOpenStagePeers,
  selectWorkflowTransitionForDecision,
  selectWorkflowTemplate,
  workflowHealth,
} from '../src/workflow/workflow.logic';

const DAY = 24 * 60 * 60 * 1000;

type Over = {
  task?: any;
  case?: any;
  assignment?: any;
  assignmentUpdate?: any;
  template?: any;
  createdTasks?: any[];
  caseUpdates?: any[];
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
      findFirst: async () => over.case ?? ({ id: 'case-new', status: 'submitted', assetId: null, tasks: [], asset: null, assignment: null }),
    },
    workflowTemplate: {
      findUnique: async () => over.template ?? null,
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
      findMany: async () =>
        over.userRoleCandidates ?? [
          {
            userId: 'u-next',
            user: {
              userRoles: [{ role: { code: 'data_owner', isActive: true, deletedAt: null } }],
            },
          },
        ],
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

  assert.strictEqual(over.taskFindManyArgs.where.assigneeUserId, 'u1');
  assert.deepStrictEqual(over.taskFindManyArgs.where.status.in, ['pending', 'in_progress']);
  assert.strictEqual(over.taskFindManyArgs.take, 50);
  assert.strictEqual(over.taskFindManyArgs.skip, 0);
  assert.ok(over.taskFindManyArgs.where.case.OR.some((branch: any) => branch.assetId?.in?.includes('visible-asset')));
  assert.ok(over.taskFindManyArgs.where.case.OR.some((branch: any) => branch.AND?.some((part: any) => part.createdBy === 'user@dgop.local')));
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
