/**
 * Unit tests for Sprint 14 security governance decision logic.
 * Run with: ts-node test/security-governance.service.spec.ts
 */
import assert from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import { AccessDecision } from '@prisma/client';
import { SecurityGovernanceService } from '../src/security-governance/security-governance.service';
import { classificationRisk, evaluateAccessDecision } from '../src/security-governance/security-governance.logic';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

test('evaluateAccessDecision denies access when no role-data mapping exists', () => {
  const result = evaluateAccessDecision({
    hasMapping: false,
    requestedAction: 'read',
    personalDataRequested: false,
    personalDataAllowed: false,
    approvalRequired: true,
    hasMaskingPolicy: false,
    assetClassificationRank: 3,
    allowedClassificationRank: 3,
  });
  assert.strictEqual(result.decision, AccessDecision.deny);
});

test('evaluateAccessDecision applies masking when personal data is not directly allowed', () => {
  const result = evaluateAccessDecision({
    hasMapping: true,
    requestedAction: 'read',
    personalDataRequested: true,
    personalDataAllowed: false,
    approvalRequired: true,
    hasMaskingPolicy: true,
    assetClassificationRank: 3,
    allowedClassificationRank: 3,
  });
  assert.strictEqual(result.decision, AccessDecision.masked);
});

test('evaluateAccessDecision requires review for export actions with approval gates', () => {
  const result = evaluateAccessDecision({
    hasMapping: true,
    requestedAction: 'export',
    personalDataRequested: false,
    personalDataAllowed: true,
    approvalRequired: true,
    hasMaskingPolicy: false,
    assetClassificationRank: 2,
    allowedClassificationRank: 3,
  });
  assert.strictEqual(result.decision, AccessDecision.review_required);
});

test('classificationRisk maps rank into business risk bands', () => {
  assert.strictEqual(classificationRisk(1), 'low');
  assert.strictEqual(classificationRisk(3), 'medium');
  assert.strictEqual(classificationRisk(4), 'high');
  assert.strictEqual(classificationRisk(5), 'critical');
});

test('upsertAccessMap uses a stable scope key and updates an existing active mapping', async () => {
  let updatedData: any;
  let lookupWhere: any;
  const service = new SecurityGovernanceService(
    {
      role: { findFirst: async () => ({ id: 'role-1', code: 'dq_steward' }) },
      dataDomain: { findFirst: async () => ({ id: 'domain-1' }) },
      classification: { findFirst: async () => ({ id: 'class-1', rank: 2 }) },
      roleDataAccessMap: {
        findFirst: async (args: any) => {
          lookupWhere = args.where;
          return { id: 'map-1' };
        },
        update: async (args: any) => {
          updatedData = args.data;
          return { id: 'map-1', role: { code: 'dq_steward' } };
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
    {
      openRoutedCase: async (input: any) => ({ id: 'case-1', code: input.preferredCode, tasks: [] }),
    } as never,
  );

  await service.upsertAccessMap(
    ['system_admin'],
    {
      roleId: 'role-1',
      domainId: 'domain-1',
      classificationId: 'class-1',
      personalDataAllowed: false,
      approvalRequired: true,
    },
    'actor',
  );

  assert.strictEqual(lookupWhere.scopeKey, 'domain:domain-1|class:class-1');
  assert.strictEqual(updatedData.scopeKey, 'domain:domain-1|class:class-1');
});

test('createMaskingPolicy rejects global policies for scoped users', async () => {
  const service = new SecurityGovernanceService(
    {
      dataAsset: { findMany: async () => [] },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await assert.rejects(
    () =>
      service.createMaskingPolicy(
        ['security_reviewer'],
        { nameEn: 'Global mask', nameAr: 'Global mask', technique: 'redaction' },
        'actor',
      ),
    ForbiddenException,
  );
});

test('createDlpIncident rejects assets outside scoped user access', async () => {
  const service = new SecurityGovernanceService(
    {
      dataAsset: {
        findMany: async () => [{ id: 'visible-asset' }],
        findFirst: async () => ({ id: 'hidden-asset' }),
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: 'all', maxClassRank: null }),
    } as never,
  );

  await assert.rejects(
    () =>
      service.createDlpIncident(
        ['security_reviewer'],
        { title: 'Hidden export', assetId: 'hidden-asset', severity: 'high' },
        'actor',
      ),
    ForbiddenException,
  );
});

test('accessReviews scopes included items, not only parent reviews', async () => {
  let includeArg: any;
  const service = new SecurityGovernanceService(
    {
      dataAsset: { findMany: async () => [{ id: 'visible-asset' }] },
      accessReview: {
        findMany: async (args: any) => {
          includeArg = args.include;
          return [];
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await service.accessReviews(['security_reviewer']);
  const itemWhere = JSON.stringify(includeArg.items.where);
  assert.ok(itemWhere.includes('visible-asset'));
  assert.ok(itemWhere.includes('domain-1'));
});

test('createDlpIncident links new incidents to workflow cases', async () => {
  let workflowCaseId: string | null = null;
  const tx: any = {
    dlpIncident: {
      create: async () => ({
        id: 'dlp-1',
        code: 'DLP-1',
        title: 'Sensitive export',
        description: 'Export needs review',
        assetId: 'asset-1',
        assignedPersonId: null,
        severity: 'high',
      }),
      update: async (args: any) => {
        workflowCaseId = args.data.workflowCaseId;
        return { id: 'dlp-1', workflowCaseId };
      },
    },
    workflowCase: {
      count: async () => 0,
      findUnique: async () => null,
      create: async () => ({ id: 'case-1' }),
    },
    workflowTask: { create: async () => ({ id: 'task-1' }) },
    workflowEvent: { createMany: async () => ({ count: 2 }) },
  };
  const service = new SecurityGovernanceService(
    {
      dataAsset: { findFirst: async () => ({ id: 'asset-1' }) },
      dlpIncident: { count: async () => 0, findUnique: async () => null },
      $transaction: async (fn: (client: unknown) => unknown) => fn(tx),
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
    {
      openRoutedCase: async (input: any) => ({ id: 'case-1', code: input.preferredCode, tasks: [] }),
    } as never,
  );

  await service.createDlpIncident(
    ['system_admin'],
    { title: 'Sensitive export', assetId: 'asset-1', severity: 'high' },
    'actor',
  );

  assert.strictEqual(workflowCaseId, 'case-1');
});

test('createClassificationRequest links new requests to workflow cases', async () => {
  let workflowCaseId: string | null = null;
  const tx: any = {
    classificationChangeRequest: {
      create: async () => ({
        id: 'class-request-1',
        assetId: 'asset-1',
        reason: 'Raise sensitivity for executive dataset',
      }),
      update: async (args: any) => {
        workflowCaseId = args.data.workflowCaseId;
        return { id: 'class-request-1', workflowCaseId };
      },
    },
    workflowCase: {
      count: async () => 0,
      findUnique: async () => null,
      create: async () => ({ id: 'case-class-1' }),
    },
    workflowTask: { create: async () => ({ id: 'task-class-1' }) },
    workflowEvent: { createMany: async () => ({ count: 2 }) },
  };
  const service = new SecurityGovernanceService(
    {
      dataAsset: {
        findFirst: async () => ({
          id: 'asset-1',
          code: 'AST-EXEC',
          nameEn: 'Executive dataset',
          classificationId: 'class-old',
        }),
      },
      classification: { findFirst: async () => ({ id: 'class-new', rank: 3 }) },
      $transaction: async (fn: (client: unknown) => unknown) => fn(tx),
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
    {
      openRoutedCase: async (input: any) => ({ id: 'case-class-1', code: input.preferredCode, tasks: [] }),
    } as never,
  );

  await service.createClassificationRequest(
    ['system_admin'],
    {
      assetId: 'asset-1',
      toClassificationId: 'class-new',
      reason: 'Raise sensitivity for executive dataset',
    },
    'actor',
  );

  assert.strictEqual(workflowCaseId, 'case-class-1');
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
