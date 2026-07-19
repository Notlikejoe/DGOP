import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { FoiDecisionOutcome, FoiRequestStatus } from '@prisma/client';
import { FoiService } from '../src/foi/foi.service';
import { addKsaBusinessDays, foiSlaStatus, statusForFoiDecision } from '../src/foi/foi.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('addKsaBusinessDays skips Friday and Saturday placeholder weekend', () => {
  const thursday = new Date('2026-07-16T08:00:00Z');
  const due = addKsaBusinessDays(thursday, 1);
  assert.strictEqual(due.toISOString().slice(0, 10), '2026-07-19');
});

test('FOI SLA labels open overdue work clearly', () => {
  const due = new Date('2026-07-10T08:00:00Z');
  const now = new Date('2026-07-13T08:00:00Z');
  assert.strictEqual(foiSlaStatus(due, FoiRequestStatus.under_review, now), 'overdue');
});

test('FOI decision outcome maps to request lifecycle status', () => {
  assert.strictEqual(statusForFoiDecision(FoiDecisionOutcome.approved), FoiRequestStatus.approved);
  assert.strictEqual(statusForFoiDecision(FoiDecisionOutcome.partially_approved), FoiRequestStatus.partially_approved);
  assert.strictEqual(statusForFoiDecision(FoiDecisionOutcome.rejected), FoiRequestStatus.rejected);
});

function makeService() {
  const data: Record<string, any> = {
    request: null,
    reviews: [],
    workflowCases: [],
    workflowTasks: [],
    workflowProgress: [],
    decisions: [],
    disclosures: [],
    audit: [],
  };
  const tx: Record<string, any> = {
    foiRequest: {
      count: async () => 0,
      findUnique: async () => null,
      create: async (args: any) => {
        data.request = {
          id: 'foi-1',
          requestNumber: args.data.requestNumber,
          requesterName: args.data.requesterName,
          requesterEmail: args.data.requesterEmail,
          requesterPhone: args.data.requesterPhone,
          requesterType: args.data.requesterType,
          channel: args.data.channel,
          category: args.data.category,
          subject: args.data.subject,
          description: args.data.description,
          receivedAt: args.data.receivedAt,
          dueAt: args.data.dueAt,
          status: FoiRequestStatus.registered,
          identityValidated: args.data.identityValidated,
          contactValidated: args.data.contactValidated,
          assignedOfficerPersonId: args.data.assignedOfficerPersonId,
          assetId: args.data.assetId,
          dataDomainId: args.data.dataDomainId,
          classificationId: args.data.classificationId,
          createdBy: args.data.createdBy,
          assignedOfficer: null,
          asset: null,
          dataDomain: null,
          classification: null,
          responseTemplate: null,
          workflowCase: null,
          reviews: data.reviews,
          exemptions: [],
          decisions: [],
          disclosures: [],
          appeals: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return {
          id: data.request.id,
          requestNumber: data.request.requestNumber,
          subject: data.request.subject,
          assetId: data.request.assetId,
          assignedOfficerPersonId: data.request.assignedOfficerPersonId,
        };
      },
      update: async (args: any) => {
        data.request = { ...data.request, ...args.data };
        return data.request;
      },
      findFirst: async () => data.request,
    },
    foiAppeal: {
      count: async () => 0,
      findUnique: async () => null,
    },
    workflowTemplate: { findFirst: async () => ({ id: 'tpl-foi' }) },
    workflowCase: {
      count: async () => data.workflowCases.length,
      findUnique: async () => null,
      create: async (args: any) => {
        const row = { id: `case-${data.workflowCases.length + 1}`, ...args.data };
        data.workflowCases.push(row);
        return args.select ? { id: row.id } : row;
      },
    },
    workflowTask: {
      create: async (args: any) => {
        const row = { id: `task-${data.workflowTasks.length + 1}`, ...args.data };
        data.workflowTasks.push(row);
        return row;
      },
    },
    workflowEvent: { create: async (args: any) => args.data },
    foiDecision: {
      create: async (args: any) => {
        const row = { id: `decision-${data.decisions.length + 1}`, ...args.data };
        data.decisions.push(row);
        return row;
      },
    },
    foiDisclosure: {
      create: async (args: any) => {
        const row = { id: `disclosure-${data.disclosures.length + 1}`, ...args.data };
        data.disclosures.push(row);
        return row;
      },
    },
    foiReview: {
      create: async (args: any) => {
        const row = { id: `review-${data.reviews.length + 1}`, ...args.data, reviewer: null };
        data.reviews.push(row);
        return row;
      },
    },
    person: {
      findFirst: async (args: any) => ({ id: args.where.id ?? 'person-1', userId: 'user-1' }),
    },
    auditLog: {
      create: async (args: any) => data.audit.push(args.data),
    },
  };
  const prisma = {
    ...tx,
    dataAsset: {
      findMany: async () => [{ id: 'asset-1' }],
      findFirst: async () => ({ id: 'asset-1', domainId: 'domain-1', classificationId: 'class-1' }),
    },
    dataDomain: { findFirst: async () => ({ id: 'domain-1' }) },
    classification: { findFirst: async () => ({ id: 'class-1' }) },
    foiResponseTemplate: { findMany: async () => [] },
    $transaction: async (callback: any) => callback(tx),
  };
  const service = new FoiService(
    prisma as never,
    { log: async (entry: any) => data.audit.push(entry) } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
    {
      openRoutedCase: async (input: any) => {
        const wfCase = {
          id: `case-${data.workflowCases.length + 1}`,
          code: input.preferredCode,
          title: input.title,
          description: input.description,
          type: input.type,
          status: input.status,
          assetId: input.assetId ?? null,
          tasks: [] as any[],
        };
        const task = {
          id: `task-${data.workflowTasks.length + 1}`,
          caseId: wfCase.id,
          title: input.initialTaskTitle,
          status: 'pending',
          assigneeUserId: input.initialAssigneeUserId ?? null,
          dueDate: input.initialDueDate ?? null,
        };
        wfCase.tasks.push(task);
        data.workflowCases.push(wfCase);
        data.workflowTasks.push(task);
        return wfCase;
      },
      recordDomainCaseProgress: async (input: any, client: any) => {
        data.workflowProgress.push({ input, client });
      },
    } as never,
  );
  return { service, data };
}

test('create FOI request generates number, workflow task, and starter reviews', async () => {
  const { service, data } = makeService();
  const created = await service.create(
    ['foi_officer'],
    {
      requesterName: 'Requester',
      requesterEmail: 'requester@example.com',
      subject: 'Policy records',
      description: 'Need records for public policy reporting.',
      assetId: 'asset-1',
      assignedOfficerPersonId: 'person-1',
    },
    'officer@dgop.local',
  );
  assert.strictEqual(created.requestNumber, `FOI-${new Date().getFullYear()}-0001`);
  assert.strictEqual(data.workflowCases.length, 1);
  assert.strictEqual(data.workflowTasks.length, 1);
  assert.strictEqual(data.reviews.length, 3);
  assert.strictEqual(created.workflowCaseId, 'case-1');
});

test('list rejects invalid FOI status and channel filters before Prisma receives them', async () => {
  let requestFinds = 0;
  const service = new FoiService(
    {
      foiRequest: {
        findMany: async () => {
          requestFinds++;
          return [];
        },
        count: async () => 0,
      },
    } as never,
    { log: async () => undefined } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  await assert.rejects(
    () => service.list(['foi_officer'], { status: 'almost_done', page: '1', pageSize: '10' }),
    BadRequestException,
  );
  await assert.rejects(
    () => service.list(['foi_officer'], { channel: 'fax_machine', page: '1', pageSize: '10' }),
    BadRequestException,
  );
  assert.strictEqual(requestFinds, 0);
});

test('FOI scoped lists do not expose unanchored records to restricted users', async () => {
  let requestWhere: unknown;
  const service = new FoiService(
    {
      dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
      foiRequest: {
        findMany: async (args: any) => {
          requestWhere = args.where;
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

  await service.list(['foi_officer'], { page: '1', pageSize: '10' });
  const whereText = JSON.stringify(requestWhere);
  assert.ok(whereText.includes('visible-asset'));
  assert.ok(!whereText.includes('"assetId":null'));
  assert.ok(!whereText.includes('"dataDomainId"'));
});

test('FOI domain-only requests are visible only for matching domain-scoped users', async () => {
  let requestWhere: unknown;
  const service = new FoiService(
    {
      dataAsset: { findMany: async () => [] },
      foiRequest: {
        findMany: async (args: any) => {
          requestWhere = args.where;
          return [];
        },
        count: async () => 0,
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await service.list(['foi_officer'], { page: '1', pageSize: '10' });
  const whereText = JSON.stringify(requestWhere);
  assert.ok(whereText.includes('"assetId":null'));
  assert.ok(whereText.includes('"dataDomainId":{"in":["domain-1"]}'));
});

test('FOI summary reuses one scoped SLA row query for overdue and due-soon counts', async () => {
  let requestFinds = 0;
  const service = new FoiService(
    {
      dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
      foiRequest: {
        count: async () => 0,
        findMany: async () => {
          requestFinds++;
          return [];
        },
      },
      foiAppeal: { count: async () => 0 },
      foiDisclosure: { count: async () => 0 },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await service.summary(['foi_officer']);
  assert.strictEqual(requestFinds, 1);
});

test('saveDecision delegates workflow progress to the engine', async () => {
  const { service, data } = makeService();
  data.request = {
    id: 'foi-1',
    requestNumber: 'FOI-2026-0001',
    requesterName: 'Requester',
    requesterEmail: 'requester@example.com',
    subject: 'Policy records',
    status: FoiRequestStatus.under_review,
    dueAt: new Date('2026-07-20T08:00:00Z'),
    workflowCaseId: 'case-1',
    decisions: [],
    disclosures: [],
    appeals: [],
    reviews: [],
    exemptions: [],
  };

  await service.saveDecision(
    ['foi_officer'],
    'foi-1',
    {
      outcome: FoiDecisionOutcome.approved,
      summary: 'Approved for release.',
      justification: 'Public record.',
    } as never,
    'officer@dgop.local',
  );

  assert.strictEqual(data.workflowProgress.length, 1);
  assert.strictEqual(data.workflowProgress[0].input.caseId, 'case-1');
  assert.strictEqual(data.workflowProgress[0].input.targetStatus, 'decision_made');
  assert.strictEqual(data.workflowProgress[0].input.eventAction, 'foi_decision.recorded');
});

test('createDisclosure closes linked workflow through the engine', async () => {
  const { service, data } = makeService();
  data.request = {
    id: 'foi-1',
    requestNumber: 'FOI-2026-0001',
    requesterName: 'Requester',
    requesterEmail: 'requester@example.com',
    subject: 'Policy records',
    status: FoiRequestStatus.approved,
    dueAt: new Date('2026-07-20T08:00:00Z'),
    workflowCaseId: 'case-1',
    decisions: [{ id: 'decision-1', outcome: FoiDecisionOutcome.approved }],
    disclosures: [],
    appeals: [],
    reviews: [],
    exemptions: [],
  };

  await service.createDisclosure(
    ['foi_officer'],
    'foi-1',
    {
      recipient: 'requester@example.com',
      summary: 'Released the approved record.',
    } as never,
    'officer@dgop.local',
  );

  assert.strictEqual(data.workflowProgress.length, 1);
  assert.strictEqual(data.workflowProgress[0].input.caseId, 'case-1');
  assert.strictEqual(data.workflowProgress[0].input.targetStatus, 'closed');
  assert.strictEqual(data.workflowProgress[0].input.completeOpenTasks, true);
  assert.strictEqual(data.workflowProgress[0].input.eventAction, 'foi_disclosure.recorded');
});

(async () => {
  for (const t of tests) {
    await t.fn();
    console.log(`ok - ${t.name}`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
