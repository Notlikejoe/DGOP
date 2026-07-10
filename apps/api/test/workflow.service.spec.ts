/**
 * Lightweight unit tests for the workflow engine: SLA derivation, decision
 * authority, segregation of duties and assignment-approval wiring.
 * (no jest dependency). Run with: ts-node test/workflow.service.spec.ts
 */
import assert from 'node:assert';
import { WorkflowService } from '../src/workflow/workflow.service';

const DAY = 24 * 60 * 60 * 1000;

type Over = {
  task?: any;
  case?: any;
  assignment?: any;
  assignmentUpdate?: any;
  submitter?: any;
  visibleAssets?: { id: string }[];
  scope?: any;
  setCalls?: any[][];
};

function makeService(over: Over): WorkflowService {
  const prisma: any = {
    $transaction: async (fn: (client: any) => unknown) => fn(prisma),
    workflowTask: {
      findUnique: async () => over.task ?? null,
      update: async ({ data }: any) => ({ ...over.task, ...data, assignee: null }),
      create: async ({ data }: any) => ({ id: 'task-new', ...data, assignee: null }),
    },
    workflowCase: {
      update: async ({ data }: any) => ({ ...(over.case ?? { id: 'case-new' }), ...data, tasks: [], asset: null, assignment: null }),
      create: async ({ data }: any) => ({ id: 'case-new', ...data, tasks: [], asset: null, assignment: null }),
      findUnique: async () => over.case ?? ({ id: 'case-new', status: 'draft', assetId: null, tasks: [], asset: null, assignment: null }),
    },
    workflowEvent: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
    user: { findFirst: async () => over.submitter ?? null },
    dataAsset: {
      findMany: async () => over.visibleAssets ?? [],
      findFirst: async () => ({ id: 'asset-1' }),
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
  const audit = { log: async () => {} };
  const scope = {
    resolve: async () => over.scope ?? ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
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
