import assert from 'node:assert/strict';
import {
  GovernanceEscalationLevel,
  GovernanceEscalationStatus,
  GovernanceNotificationSeverity,
} from '@prisma/client';
import { GovernanceOperationsService } from '../src/governance-operations/governance-operations.service';
import {
  addKsaBusinessDays,
  businessDaysBetween,
  escalationLevel,
  escalationPenalty,
  isKsaBusinessDay,
  ksaSlaSignal,
  notificationSeverity,
} from '../src/governance-operations/governance-operations.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('KSA business days skip Friday, Saturday, and configured holidays', () => {
  const friday = new Date('2026-07-17T12:00:00Z');
  const sundayHoliday = new Date('2026-07-19T12:00:00Z');
  assert.equal(isKsaBusinessDay(friday), false);
  assert.equal(isKsaBusinessDay(sundayHoliday, ['2026-07-19']), false);
  assert.equal(isKsaBusinessDay(new Date('2026-07-20T12:00:00Z')), true);
});

test('addKsaBusinessDays lands on the next available working date', () => {
  const start = new Date('2026-07-16T12:00:00Z');
  const due = addKsaBusinessDays(start, 1);
  assert.equal(due.toISOString().slice(0, 10), '2026-07-19');
});

test('business day distance drives SLA signals', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  assert.equal(ksaSlaSignal({ status: 'pending', dueDate: new Date('2026-07-16T12:00:00Z') }, now), 'at_risk');
  assert.equal(ksaSlaSignal({ status: 'pending', dueDate: new Date('2026-07-27T12:00:00Z') }, now), 'on_track');
  assert.equal(ksaSlaSignal({ status: 'pending', dueDate: new Date('2026-07-12T12:00:00Z') }, now), 'overdue');
  assert.equal(businessDaysBetween(new Date('2026-07-12T12:00:00Z'), now), 2);
});

test('overdue days map to four escalation councils', () => {
  assert.equal(escalationLevel(1), GovernanceEscalationLevel.domain_council);
  assert.equal(escalationLevel(3), GovernanceEscalationLevel.data_stewardship_council);
  assert.equal(escalationLevel(6), GovernanceEscalationLevel.data_governance_board);
  assert.equal(escalationLevel(11), GovernanceEscalationLevel.executive_steering_committee);
  assert.equal(escalationPenalty(3), 15);
});

test('notification severity follows SLA risk without color-only meaning', () => {
  assert.equal(notificationSeverity('done'), GovernanceNotificationSeverity.success);
  assert.equal(notificationSeverity('at_risk'), GovernanceNotificationSeverity.warning);
  assert.equal(notificationSeverity('overdue', 7), GovernanceNotificationSeverity.critical);
});

test('SLA recalculation uses stable dedupe keys for workflow task signals', async () => {
  const createdNotifications: any[] = [];
  const updatedNotifications: any[] = [];
  const createdEscalations: any[] = [];
  const updatedEscalations: any[] = [];
  let existingNotification: { id: string } | null = null;
  let existingEscalation: { id: string; status: GovernanceEscalationStatus } | null = null;
  const overdueTask = {
    id: 'task-1',
    caseId: 'case-1',
    title: 'Validate evidence',
    status: 'pending',
    dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    completedAt: null,
    assigneeUserId: 'user-1',
    assignee: { id: 'user-1', email: 'owner@dgop.local', displayName: 'Owner' },
    case: {
      id: 'case-1',
      code: 'WFC-0001',
      title: 'Evidence case',
      type: 'general',
      status: 'submitted',
      assetId: null,
      asset: null,
    },
  };
  const prisma: any = {
    ksaHoliday: { findMany: async () => [] },
    workflowTask: { findMany: async () => [overdueTask] },
    governanceNotification: {
      findUnique: async ({ where }: any) => {
        assert.equal(where.dedupeKey, 'workflow_task:task-1:notification');
        return existingNotification;
      },
      create: async ({ data }: any) => {
        createdNotifications.push(data);
        existingNotification = { id: 'notice-1' };
        return { id: 'notice-1', ...data };
      },
      update: async ({ where, data }: any) => {
        updatedNotifications.push({ where, data });
        return { id: where.id, ...data };
      },
    },
    governanceEscalation: {
      count: async () => 0,
      findUnique: async ({ where }: any) => {
        assert.equal(where.dedupeKey, 'workflow_task:task-1:escalation');
        return existingEscalation;
      },
      create: async ({ data }: any) => {
        createdEscalations.push(data);
        existingEscalation = { id: 'esc-1', status: GovernanceEscalationStatus.open };
        return { id: 'esc-1', ...data };
      },
      update: async ({ where, data }: any) => {
        updatedEscalations.push({ where, data });
        return { id: where.id, ...data };
      },
    },
  };
  const service = new GovernanceOperationsService(
    prisma,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );
  (service as any).ensureDefaultCalendarTemplates = async () => {};
  (service as any).workspace = async () => ({});

  await service.recalculateSla({ id: 'system', email: 'system@dgop.local', roles: ['system_admin'] });
  await service.recalculateSla({ id: 'system', email: 'system@dgop.local', roles: ['system_admin'] });

  assert.equal(createdNotifications.length, 1);
  assert.equal(updatedNotifications.length, 1);
  assert.equal(createdNotifications[0].dedupeKey, 'workflow_task:task-1:notification');
  assert.equal(createdEscalations.length, 1);
  assert.equal(updatedEscalations.length, 1);
  assert.equal(createdEscalations[0].dedupeKey, 'workflow_task:task-1:escalation');
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  OK ${t.name}`);
    } catch (err) {
      console.error(`  FAIL ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
