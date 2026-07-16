import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  BreachStatus,
  DpiaRiskLevel,
  DsrRequestStatus,
  DsrRequestType,
  PrivacyGatePhase,
  PrivacyGateStatus,
  PrivacyWorkStatus,
} from '@prisma/client';
import { PrivacyService } from '../src/privacy/privacy.service';
import {
  addKsaBusinessDays,
  breachNotificationStatus,
  calculateDpiaRisk,
  dpiaStatusFromGates,
  privacySlaStatus,
} from '../src/privacy/privacy.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('PDP business days skip Friday and Saturday', () => {
  const thursday = new Date('2026-07-16T08:00:00Z');
  const due = addKsaBusinessDays(thursday, 1);
  assert.equal(due.toISOString().slice(0, 10), '2026-07-19');
});

test('privacy SLA treats open overdue work and closed DSRs correctly', () => {
  const now = new Date('2026-07-13T08:00:00Z');
  assert.equal(
    privacySlaStatus(new Date('2026-07-10T08:00:00Z'), DsrRequestStatus.in_progress, now),
    'overdue',
  );
  assert.equal(
    privacySlaStatus(new Date('2026-07-10T08:00:00Z'), DsrRequestStatus.fulfilled, now),
    'closed',
  );
});

test('breach notification signal identifies urgent and completed notifications', () => {
  const now = new Date('2026-07-13T08:00:00Z');
  assert.equal(
    breachNotificationStatus(new Date('2026-07-13T14:00:00Z'), BreachStatus.detected, null, now),
    'urgent',
  );
  assert.equal(
    breachNotificationStatus(new Date('2026-07-10T08:00:00Z'), BreachStatus.notified, new Date('2026-07-10T07:00:00Z'), now),
    'notified',
  );
});

test('DPIA risk escalates sensitive cross-border high classification processing', () => {
  const result = calculateDpiaRisk({
    classificationRank: 4,
    crossBorderTransfer: true,
    sensitiveSubjects: true,
    existingControls: 15,
  });
  assert.ok(result.residualRiskScore >= 60);
  assert.ok(['high', 'critical'].includes(result.riskLevel));
  assert.ok(result.controls.includes('classification_review'));
  assert.ok(result.controls.includes('cross_border_transfer_review'));
  assert.ok(result.controls.includes('sensitive_subject_controls'));
});

test('DPIA gate status rolls up to action required or approved', () => {
  assert.equal(
    dpiaStatusFromGates([{ status: PrivacyGateStatus.blocked }]),
    PrivacyWorkStatus.action_required,
  );
  assert.equal(
    dpiaStatusFromGates([
      { status: PrivacyGateStatus.approved },
      { status: PrivacyGateStatus.not_required },
    ]),
    PrivacyWorkStatus.approved,
  );
});

test('privacy lists do not expose unanchored records to scoped users', async () => {
  let dpiaWhere: unknown;
  const service = new PrivacyService(
    {
      dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
      privacyDpia: {
        findMany: async (args: any) => {
          dpiaWhere = args.where;
          return [];
        },
        count: async () => 0,
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await service.listDpias(['privacy_officer'], { page: '1', pageSize: '10' });
  const whereText = JSON.stringify(dpiaWhere);
  assert.ok(whereText.includes('visible-asset'));
  assert.ok(!whereText.includes('"assetId":null'));
});

test('privacy summary scopes consent and retention counters', async () => {
  const countWheres: unknown[] = [];
  const service = new PrivacyService(
    {
      dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
      privacyDpia: { findMany: async () => [] },
      privacyDsrRequest: { findMany: async () => [] },
      privacyBreach: { findMany: async () => [] },
      privacyRopaRecord: { count: async () => 0 },
      privacyConsentRecord: {
        count: async (args: any) => {
          countWheres.push(args.where);
          return 0;
        },
      },
      privacyRetentionRule: {
        count: async (args: any) => {
          countWheres.push(args.where);
          return 0;
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await service.summary(['privacy_officer']);
  assert.ok(countWheres.every((where) => JSON.stringify(where).includes('visible-asset')));
});

test('scoped users cannot create unanchored DSR requests', async () => {
  const service = new PrivacyService(
    {} as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await assert.rejects(
    () =>
      service.createDsr(
        ['privacy_officer'],
        { requesterName: 'Requester', requestType: DsrRequestType.access, description: 'Need access' },
        'actor',
      ),
    BadRequestException,
  );
});

test('direct DPIA status and risk updates are blocked', async () => {
  const service = new PrivacyService(
    {
      privacyDpia: {
        findFirst: async () => ({
          id: 'dpia-1',
          createdBy: 'owner@dgop.local',
          gates: [],
        }),
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  await assert.rejects(
    () => service.updateDpia(['system_admin'], 'dpia-1', { status: PrivacyWorkStatus.approved }, 'actor'),
    BadRequestException,
  );
  await assert.rejects(
    () => service.updateDpia(['system_admin'], 'dpia-1', { riskLevel: DpiaRiskLevel.low }, 'actor'),
    BadRequestException,
  );
});

test('DPIA creators cannot approve their own gates', async () => {
  const service = new PrivacyService(
    {
      privacyDpia: {
        findFirst: async () => ({
          id: 'dpia-1',
          createdBy: 'creator@dgop.local',
          gates: [],
        }),
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  await assert.rejects(
    () =>
      service.saveGate(
        ['system_admin'],
        'dpia-1',
        { phase: PrivacyGatePhase.requirements, status: PrivacyGateStatus.approved },
        'creator@dgop.local',
      ),
    ForbiddenException,
  );
});

test('createDpia opens a routed privacy workflow case', async () => {
  const workflowInputs: any[] = [];
  const gatePhases: string[] = [];
  const tx: any = {
    privacyDpia: {
      count: async () => 0,
      findUnique: async () => null,
      create: async (args: any) => ({
        id: 'dpia-1',
        code: args.data.code,
        title: args.data.title,
        description: args.data.description,
        assetId: null,
        reviewerPersonId: null,
        dueAt: args.data.dueAt,
      }),
      update: async () => ({ id: 'dpia-1' }),
      findUniqueOrThrow: async () => ({
        id: 'dpia-1',
        createdBy: 'actor',
        dueAt: new Date(),
        status: PrivacyWorkStatus.under_review,
        gates: [],
      }),
    },
    privacyGate: {
      create: async (args: any) => {
        gatePhases.push(args.data.phase);
        return { id: `gate-${gatePhases.length}` };
      },
    },
    workflowTemplate: {
      findFirst: async () => ({
        id: 'template-1',
        stages: [
          { nameEn: 'Requirements gate', taskType: 'review', dueDays: 2, isStart: true },
          { nameEn: 'Design gate', taskType: 'review', dueDays: 2, isStart: false },
        ],
      }),
    },
    workflowCase: {
      count: async () => 0,
      findUnique: async () => null,
      create: async () => ({ id: 'case-1' }),
    },
    workflowTask: {
      create: async () => ({ id: 'task-1' }),
    },
    workflowEvent: { create: async () => ({ id: 'event-1' }) },
    auditLog: { create: async () => ({ id: 'audit-1' }) },
  };
  const service = new PrivacyService(
    {
      $transaction: async (fn: (client: unknown) => unknown) => fn(tx),
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
    {
      openRoutedCase: async (input: any) => {
        workflowInputs.push(input);
        return { id: 'case-1', code: input.preferredCode, tasks: [{ id: 'task-1' }] };
      },
    } as never,
  );

  await service.createDpia(['system_admin'], { title: 'Privacy impact review' }, 'actor');

  assert.equal(workflowInputs.length, 1);
  assert.equal(workflowInputs[0].type, 'privacy_dpia');
  assert.equal(gatePhases.length, 5);
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (error) {
      console.error(`  ✗ ${t.name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
