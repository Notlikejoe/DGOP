/**
 * Unit tests for Data Quality service scoping and bounded list behavior.
 * Run with: ts-node test/data-quality.service.spec.ts
 */
import assert from 'node:assert';
import { BadRequestException } from '@nestjs/common';
import { DataQualityPriority, DataQualitySeverity } from '@prisma/client';
import { DataQualityService } from '../src/data-quality/data-quality.service';
import { priorityForSeverity, profileScore, slaDueDates } from '../src/data-quality/data-quality.logic';
import {
  isAcceptedDataQualityImportFile,
  isSafeDataQualityImportContent,
} from '../src/data-quality/data-quality.config';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

function includesScopedAsset(where: unknown, assetId: string): boolean {
  const text = JSON.stringify(where);
  return text.includes('"assetId"') && text.includes(assetId);
}

function includesOwnUnlinkedIssue(where: unknown, actor: string): boolean {
  const text = JSON.stringify(where);
  return text.includes('"assetId":null') && text.includes('"createdBy"') && text.includes(actor);
}

function includesBroadUnlinkedIssue(where: unknown): boolean {
  const text = JSON.stringify(where);
  return text.includes('{"assetId":null}') && !text.includes('"createdBy"');
}

test('summary applies data-scope asset filtering to every count', async () => {
  const countWhere: unknown[] = [];
  const service = new DataQualityService(
    {
      dataAsset: {
        findMany: async () => [{ id: 'visible-asset' }],
      },
      dataQualityIssue: {
        findMany: async () => [],
        count: async (args: { where: unknown }) => {
          countWhere.push(args.where);
          return 1;
        },
      },
      dataQualityRule: { count: async () => 1 },
      dataQualityProfile: { count: async () => 1 },
      dataQualityScore: { findMany: async () => [] },
    } as never,
    {} as never,
    {
      resolve: async () => ({
        orgUnits: ['org-1'],
        domains: ['domain-1'],
        maxClassRank: 2,
      }),
    } as never,
  );

  const summary = await service.summary(['dq_steward']);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(countWhere.length, 6);
  assert.ok(countWhere.every((where) => includesScopedAsset(where, 'visible-asset')));
  assert.ok(countWhere.every((where) => !includesBroadUnlinkedIssue(where)));
});

test('summary includes only the scoped actor own unlinked data quality issues', async () => {
  const countWhere: unknown[] = [];
  const service = new DataQualityService(
    {
      dataAsset: {
        findMany: async () => [],
      },
      dataQualityIssue: {
        findMany: async () => [],
        count: async (args: { where: unknown }) => {
          countWhere.push(args.where);
          return 0;
        },
      },
      dataQualityRule: { count: async () => 0 },
      dataQualityProfile: { count: async () => 0 },
      dataQualityScore: { findMany: async () => [] },
    } as never,
    {} as never,
    {
      resolve: async () => ({
        orgUnits: ['org-1'],
        domains: ['domain-1'],
        maxClassRank: 2,
      }),
    } as never,
  );

  await service.summary(['dq_steward'], 'steward@dgop.local');

  assert.strictEqual(countWhere.length, 6);
  assert.ok(countWhere.every((where) => includesOwnUnlinkedIssue(where, 'steward@dgop.local')));
  assert.ok(countWhere.every((where) => !includesBroadUnlinkedIssue(where)));
});

test('get hides unlinked data quality issues from other scoped users', async () => {
  let getWhere: unknown;
  const service = new DataQualityService(
    {
      dataAsset: {
        findMany: async () => [],
      },
      dataQualityIssue: {
        findFirst: async (args: { where: unknown }) => {
          getWhere = args.where;
          return null;
        },
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({
        orgUnits: ['org-1'],
        domains: ['domain-1'],
        maxClassRank: 2,
      }),
    } as never,
  );

  await assert.rejects(
    () => service.get(['dq_steward'], 'dq-hidden', 'viewer@dgop.local'),
    /data quality issue not found/i,
  );
  assert.ok(includesOwnUnlinkedIssue(getWhere, 'viewer@dgop.local'));
  assert.ok(!includesBroadUnlinkedIssue(getWhere));
});

test('list keeps legacy array shape but applies a bounded default when pagination is omitted', async () => {
  const findManyCalls: any[] = [];
  const service = new DataQualityService(
    {
      dataQualityIssue: {
        findMany: async (args: any) => {
          findManyCalls.push(args);
          return [{ id: 'dq-1' }, { id: 'dq-2' }];
        },
        count: async () => 3,
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  const plain = await service.list(['system_admin'], {});
  assert.ok(Array.isArray(plain));
  assert.strictEqual(findManyCalls[0].skip, 0);
  assert.strictEqual(findManyCalls[0].take, 200);

  const paged = await service.list(['system_admin'], {}, '1', '2') as any;
  assert.deepStrictEqual(
    {
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
      totalPages: paged.totalPages,
      rowCount: paged.data.length,
    },
    { total: 3, page: 1, pageSize: 2, totalPages: 2, rowCount: 2 },
  );
  assert.strictEqual(findManyCalls[1].skip, 0);
  assert.strictEqual(findManyCalls[1].take, 2);
});

test('list rejects invalid issue enum filters before Prisma receives them', async () => {
  let queried = false;
  const service = new DataQualityService(
    {
      dataQualityIssue: {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  await assert.rejects(
    () => service.list(['system_admin'], { status: 'almost_closed' }),
    /invalid data quality status/i,
  );
  assert.strictEqual(queried, false);
});

test('listRules rejects invalid enum filters before Prisma receives them', async () => {
  let queried = false;
  const service = new DataQualityService(
    {
      dataQualityRule: {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  await assert.rejects(
    () => service.listRules(['system_admin'], { dimension: 'trustworthiness' }),
    /invalid data quality rule dimension/i,
  );
  assert.strictEqual(queried, false);
});

test('refreshSlaBreachMarkers is the explicit write path for SLA breach markers', async () => {
  let breachCreated = false;
  const past = new Date(Date.now() - 60_000);
  const service = new DataQualityService(
    {
      dataQualityIssue: {
        findMany: async () => [{
          id: 'dq-overdue',
          status: 'open',
          triageDueAt: past,
          remediationDueAt: past,
          validationDueAt: past,
          dueDate: past,
        }],
      },
      dataQualitySlaBreach: {
        findFirst: async () => null,
        create: async () => {
          breachCreated = true;
          return {};
        },
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  const result = await service.refreshSlaBreachMarkers(['system_admin']);
  assert.deepStrictEqual(result, { created: 1 });
  assert.strictEqual(breachCreated, true);
});

test('listRules applies data-scope filtering to rule registry reads', async () => {
  let ruleWhere: unknown;
  const service = new DataQualityService(
    {
      dataAsset: {
        findMany: async () => [{ id: 'visible-asset' }],
      },
      dataQualityRule: {
        findMany: async (args: { where: unknown }) => {
          ruleWhere = args.where;
          return [];
        },
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({
        orgUnits: ['org-1'],
        domains: ['domain-1'],
        maxClassRank: 2,
      }),
    } as never,
  );

  await service.listRules(['dq_steward'], {});
  assert.ok(includesScopedAsset(ruleWhere, 'visible-asset'));
});

test('createRule rejects global rules for scoped users', async () => {
  const service = new DataQualityService(
    {} as never,
    {} as never,
    {
      resolve: async () => ({
        orgUnits: ['org-1'],
        domains: ['domain-1'],
        maxClassRank: 2,
      }),
    } as never,
  );

  await assert.rejects(
    () => service.createRule(['dq_steward'], { nameEn: 'Rule', nameAr: 'Rule' } as never, 'actor'),
    BadRequestException,
  );
});

test('transitionRule rejects rules outside scoped user assets', async () => {
  const service = new DataQualityService(
    {
      dataAsset: {
        findMany: async () => [{ id: 'visible-asset' }],
      },
      dataQualityRule: {
        findFirst: async () => ({ id: 'rule-hidden', assetId: 'hidden-asset', domainId: null }),
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({
        orgUnits: ['org-1'],
        domains: ['domain-1'],
        maxClassRank: 2,
      }),
    } as never,
  );

  await assert.rejects(
    () => service.transitionRule('rule-hidden', ['dq_steward'], 'submit', {}, 'actor'),
    BadRequestException,
  );
});

test('update rejects closing through the generic issue patch endpoint', async () => {
  const service = new DataQualityService(
    {
      dataQualityIssue: {
        findFirst: async () => ({ id: 'dq-1', status: 'in_progress', assetId: null, detectedAt: new Date(), evidence: [] }),
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  await assert.rejects(
    () => service.update('dq-1', ['system_admin'], { status: 'closed' } as never, 'actor'),
    /Use the close action/,
  );
});

test('close delegates linked workflow closure to the workflow engine', async () => {
  let progressInput: any;
  let progressClient: any;
  const tx = {
    dataQualityIssue: {
      update: async ({ data }: any) => ({ id: 'dq-1', ...data }),
    },
    dataQualityIssueEvidence: { create: async () => ({}) },
    dataQualitySlaBreach: { updateMany: async () => ({ count: 0 }) },
  };
  const service = new DataQualityService(
    {
      dataQualityIssue: {
        findFirst: async () => ({
          id: 'dq-1',
          status: 'in_progress',
          assetId: null,
          workflowCaseId: 'case-1',
          workflowCase: { id: 'case-1', status: 'submitted' },
          detectedAt: new Date(),
          evidence: [],
        }),
      },
      $transaction: async (callback: any) => callback(tx),
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
    {
      recordDomainCaseProgress: async (input: any, client: any) => {
        progressInput = input;
        progressClient = client;
      },
    } as never,
  );

  await service.close('dq-1', ['system_admin'], { resolutionSummary: 'Issue fixed.' } as never, 'actor@dgop.local');

  assert.strictEqual(progressInput.caseId, 'case-1');
  assert.strictEqual(progressInput.targetStatus, 'closed');
  assert.strictEqual(progressInput.completeOpenTasks, true);
  assert.strictEqual(progressInput.eventAction, 'data_quality_issue.closed');
  assert.strictEqual(progressClient, tx);
});

test('transitionRule prevents creators from approving their own rule', async () => {
  const service = new DataQualityService(
    {
      dataQualityRule: {
        findFirst: async () => ({
          id: 'rule-1',
          status: 'in_review',
          assetId: null,
          domainId: null,
          createdBy: 'creator@dgop.local',
        }),
      },
    } as never,
    {} as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  await assert.rejects(
    () => service.transitionRule('rule-1', ['system_admin'], 'approve', {}, 'creator@dgop.local'),
    /cannot approve their own rule/,
  );
});

test('importCsv does not distinguish hidden asset codes from unavailable codes', async () => {
  const service = new DataQualityService(
    {
      dataAsset: { findMany: async () => [] },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: 'all', maxClassRank: null }),
    } as never,
  );

  const result = await service.importCsv(
    ['dq_steward'],
    'title,assetCode\nHidden issue,HIDDEN-ASSET',
    'actor',
  );

  assert.strictEqual(result.created, 0);
  assert.strictEqual(result.failed, 1);
  assert.ok(result.batchId.startsWith('dq-import-'));
  assert.strictEqual(result.errors[0].code, 'asset_unavailable');
});

test('importCsv rejects invalid enum values before creating issue rows', async () => {
  let createCalled = false;
  const service = new DataQualityService(
    {
      dataAsset: { findMany: async () => [] },
      dataQualityIssue: {
        create: async () => {
          createCalled = true;
          return { id: 'bad-row' };
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  const result = await service.importCsv(
    ['system_admin'],
    'title,severity,priority,dimension\nBad enum,urgent,P9,fuzziness',
    'actor',
  );

  assert.strictEqual(createCalled, false);
  assert.strictEqual(result.created, 0);
  assert.strictEqual(result.failed, 1);
  assert.strictEqual(result.errors[0].code, 'row_rejected');
  assert.match(result.errors[0].params?.reason ?? '', /invalid severity/i);
});

test('importCsv normalizes friendly enum casing for CSV operators', async () => {
  let capturedDto: any = null;
  const service = new DataQualityService(
    {
      dataAsset: { findMany: async () => [] },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );
  const originalCreate = service.create.bind(service);
  service.create = (async (_roles, dto) => {
    capturedDto = dto;
    return { id: 'dq-1' } as never;
  }) as typeof originalCreate;

  const result = await service.importCsv(
    ['system_admin'],
    'title,severity,priority,dimension\nReadable enums,HIGH,p2,Accuracy',
    'actor',
  );

  assert.strictEqual(result.created, 1);
  assert.strictEqual(capturedDto.severity, 'high');
  assert.strictEqual(capturedDto.priority, 'P2');
  assert.strictEqual(capturedDto.dimension, 'accuracy');
});

test('CSV file upload gate requires a CSV extension and safe upload MIME', () => {
  assert.strictEqual(isAcceptedDataQualityImportFile('issues.csv', 'text/csv'), true);
  assert.strictEqual(isAcceptedDataQualityImportFile('issues.csv', 'application/octet-stream'), true);
  assert.strictEqual(isAcceptedDataQualityImportFile('issues.txt', 'text/csv'), false);
  assert.strictEqual(isAcceptedDataQualityImportFile('issues.csv.exe', 'text/csv'), false);
  assert.strictEqual(isAcceptedDataQualityImportFile('issues.csv', 'application/x-msdownload'), false);
  assert.strictEqual(isSafeDataQualityImportContent(Buffer.from('title\nValid issue', 'utf8')), true);
  assert.strictEqual(isSafeDataQualityImportContent(Buffer.from([0x4d, 0x5a, 0x00, 0x01])), false);
  assert.strictEqual(isSafeDataQualityImportContent(Buffer.from([0xc3, 0x28])), false);
});

test('priority and SLA helpers map v4 severity timing consistently', () => {
  assert.strictEqual(priorityForSeverity(DataQualitySeverity.critical), DataQualityPriority.P1);
  assert.strictEqual(priorityForSeverity(DataQualitySeverity.low), DataQualityPriority.P4);

  const detectedAt = new Date('2026-01-01T00:00:00.000Z');
  const dates = slaDueDates(detectedAt, DataQualityPriority.P2);
  assert.strictEqual(dates.triageDueAt.toISOString(), '2026-01-01T08:00:00.000Z');
  assert.strictEqual(dates.remediationDueAt.toISOString(), '2026-01-03T00:00:00.000Z');
  assert.strictEqual(dates.validationDueAt.toISOString(), '2026-01-04T00:00:00.000Z');
});

test('profileScore converts profiling columns into score and recommendations', () => {
  const result = profileScore([
    { completenessPct: 100, uniquenessPct: 100, validityPct: 100, anomalyCount: 0 },
    { completenessPct: 80, uniquenessPct: 90, validityPct: 70, anomalyCount: 2, recommendation: 'Create validity rule' },
  ]);
  assert.strictEqual(result.qualityScore, 90);
  assert.strictEqual(result.anomalyCount, 2);
  assert.strictEqual(result.recommendedRules, 1);
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
