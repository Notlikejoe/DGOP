import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  DataSharingAgreementStatus,
  DataSharingReviewDecision,
  DataSharingReviewStep,
  DataSharingRequestStatus,
  DataSharingUsageStatus,
} from '@prisma/client';
import { DataSharingService } from '../src/data-sharing/data-sharing.service';
import {
  agreementRenewalStatus,
  calculateSharingRisk,
  statusFromReviews,
  usageStatus,
} from '../src/data-sharing/data-sharing.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('sharing risk adds controls for missing basis, cross-border transfer, and masking', () => {
  const result = calculateSharingRisk({
    classificationRank: 4,
    consentRequired: true,
    crossBorderTransfer: true,
    hasMasking: false,
    hasLegalBasis: false,
  });
  assert.ok(result.riskScore >= 90);
  assert.ok(result.controls.includes('consent_check'));
  assert.ok(result.controls.includes('cross_border_review'));
  assert.ok(result.controls.includes('legal_basis_required'));
  assert.ok(result.controls.includes('masking_or_minimization'));
  assert.ok(result.controls.includes('security_review'));
});

test('sharing review decisions roll up to lifecycle status', () => {
  assert.equal(
    statusFromReviews([
      { decision: DataSharingReviewDecision.approved },
      { decision: DataSharingReviewDecision.approved },
    ]),
    DataSharingRequestStatus.approved,
  );
  assert.equal(
    statusFromReviews([{ decision: DataSharingReviewDecision.rejected }]),
    DataSharingRequestStatus.rejected,
  );
  assert.equal(
    statusFromReviews([{ decision: DataSharingReviewDecision.needs_changes }]),
    DataSharingRequestStatus.under_review,
  );
});

test('agreement renewal signal flags near due active agreements but leaves retired ones alone', () => {
  const now = new Date('2026-07-13T08:00:00Z');
  assert.equal(
    agreementRenewalStatus(new Date('2026-07-20T08:00:00Z'), DataSharingAgreementStatus.active, now),
    DataSharingAgreementStatus.renewal_due,
  );
  assert.equal(
    agreementRenewalStatus(new Date('2026-07-01T08:00:00Z'), DataSharingAgreementStatus.retired, now),
    DataSharingAgreementStatus.retired,
  );
});

test('usage status escalates incidents and watches abnormal volume', () => {
  assert.equal(usageStatus({ incidents: 1 }), DataSharingUsageStatus.escalated);
  assert.equal(usageStatus({ recordsShared: 150000 }), DataSharingUsageStatus.watch);
  assert.equal(usageStatus({ recordsShared: 100, apiCalls: 20 }), DataSharingUsageStatus.normal);
});

test('agreement lists are constrained to visible scoped assets', async () => {
  let agreementWhere: unknown;
  const service = new DataSharingService(
    {
      dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
      dataSharingAgreement: {
        findMany: async (args: any) => {
          agreementWhere = args.where;
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

  await service.listAgreements(['data_owner'], { page: '1', pageSize: '10' });
  const whereText = JSON.stringify(agreementWhere);
  assert.ok(whereText.includes('visible-asset'));
  assert.ok(!whereText.includes('"assetId":null'));
});

test('request and agreement list filters reject invalid lifecycle statuses', async () => {
  let requestFinds = 0;
  let agreementFinds = 0;
  const service = new DataSharingService(
    {
      dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
      dataSharingRequest: {
        findMany: async () => {
          requestFinds++;
          return [];
        },
        count: async () => 0,
      },
      dataSharingAgreement: {
        findMany: async () => {
          agreementFinds++;
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

  await assert.rejects(
    () => service.listRequests(['data_owner'], { status: 'almost-approved', page: '1', pageSize: '10' }),
    BadRequestException,
  );
  await assert.rejects(
    () => service.listAgreements(['data_owner'], { status: 'almost-active', page: '1', pageSize: '10' }),
    BadRequestException,
  );
  assert.equal(requestFinds, 0);
  assert.equal(agreementFinds, 0);
});

test('summary scopes usage metrics through visible agreements', async () => {
  let usageWhere: unknown;
  const service = new DataSharingService(
    {
      dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
      dataSharingRequest: { findMany: async () => [] },
      dataSharingAgreement: { findMany: async () => [] },
      dataSharingReview: { count: async () => 0 },
      dataSharingUsageMetric: {
        aggregate: async (args: any) => {
          usageWhere = args.where;
          return { _sum: { recordsShared: 0, apiCalls: 0, incidents: 0 } };
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await service.summary(['data_owner']);
  assert.ok(JSON.stringify(usageWhere).includes('visible-asset'));
});

test('scoped users cannot create unanchored data sharing requests', async () => {
  const service = new DataSharingService(
    {} as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await assert.rejects(
    () => service.createRequest(['data_owner'], { requesterOrg: 'A', recipientOrg: 'B', purpose: 'Test' }, 'actor'),
    BadRequestException,
  );
});

test('agreement updates fail closed when the agreement is out of scope', async () => {
  const service = new DataSharingService(
    {
      dataAsset: { findMany: async () => [] },
      dataSharingAgreement: { findFirst: async () => null },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await assert.rejects(
    () => service.updateAgreement(['data_owner'], 'hidden-agreement', { status: DataSharingAgreementStatus.retired }, 'actor'),
    NotFoundException,
  );
});

test('request creators cannot record their own approving review', async () => {
  const service = new DataSharingService(
    {
      dataSharingRequest: {
        findFirst: async () => ({
          id: 'request-1',
          createdBy: 'creator@dgop.local',
          reviews: [],
          agreements: [],
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
      service.saveReview(
        ['system_admin'],
        'request-1',
        { step: DataSharingReviewStep.privacy, decision: DataSharingReviewDecision.approved },
        'creator@dgop.local',
      ),
    ForbiddenException,
  );
});

test('createRequest opens a routed data sharing workflow case', async () => {
  const workflowInputs: any[] = [];
  const tx: any = {
    dataSharingRequest: {
      count: async () => 0,
      findUnique: async () => null,
      create: async (args: any) => ({
        id: 'request-1',
        requestNumber: args.data.requestNumber,
        purpose: args.data.purpose,
        assetId: null,
      }),
      update: async () => ({ id: 'request-1' }),
      findUniqueOrThrow: async () => ({ id: 'request-1', createdBy: 'actor', reviews: [], agreements: [] }),
    },
    dataSharingReview: { create: async () => ({ id: 'review-1' }) },
    workflowTemplate: {
      findFirst: async () => ({
        id: 'template-1',
        stages: [
          { nameEn: 'Sharing intake', taskType: 'information', dueDays: 1 },
          { nameEn: 'Owner review', taskType: 'review', dueDays: 2 },
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
  const service = new DataSharingService(
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

  await service.createRequest(
    ['system_admin'],
    { requesterOrg: 'Requester', recipientOrg: 'Recipient', purpose: 'Approved exchange' },
    'actor',
  );

  assert.equal(workflowInputs.length, 1);
  assert.equal(workflowInputs[0].type, 'data_sharing_request');
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
