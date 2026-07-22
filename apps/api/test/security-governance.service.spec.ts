/**
 * Unit tests for Sprint 14 security governance decision logic.
 * Run with: ts-node test/security-governance.service.spec.ts
 */
import assert from 'node:assert';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessDecision } from '@prisma/client';
import { SecurityGovernanceService } from '../src/security-governance/security-governance.service';
import {
  classificationRisk,
  evaluateAbacDecision,
  evaluateAccessDecision,
  validateRoleDataAccessMapIntegrity,
} from '../src/security-governance/security-governance.logic';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

function filterText(value: unknown): string {
  return JSON.stringify(value);
}

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

test('evaluateAbacDecision denies unknown access actions', () => {
  const result = evaluateAbacDecision({
    hasMapping: true,
    requestedAction: 'print_everything',
    purpose: 'governance',
    networkZone: 'internal',
    personalDataRequested: false,
    personalDataAllowed: true,
    approvalRequired: false,
    hasMaskingPolicy: false,
    assetClassificationRank: 2,
    allowedClassificationRank: 3,
  });

  assert.strictEqual(result.decision, AccessDecision.deny);
  assert.ok(result.violations.includes('invalid_action'));
});

test('evaluateAbacDecision requires legal basis before personal data access', () => {
  const result = evaluateAbacDecision({
    hasMapping: true,
    requestedAction: 'read',
    purpose: 'privacy',
    networkZone: 'internal',
    personalDataRequested: true,
    legalBasisConfirmed: false,
    personalDataAllowed: true,
    approvalRequired: false,
    hasMaskingPolicy: false,
    assetClassificationRank: 3,
    allowedClassificationRank: 3,
  });

  assert.strictEqual(result.decision, AccessDecision.review_required);
  assert.ok(result.obligations.includes('verify_legal_basis'));
});

test('evaluateAbacDecision routes high classification public access to review', () => {
  const result = evaluateAbacDecision({
    hasMapping: true,
    requestedAction: 'read',
    purpose: 'audit',
    networkZone: 'public',
    personalDataRequested: false,
    personalDataAllowed: true,
    approvalRequired: false,
    hasMaskingPolicy: false,
    assetClassificationRank: 4,
    allowedClassificationRank: 4,
  });

  assert.strictEqual(result.decision, AccessDecision.review_required);
  assert.ok(result.obligations.includes('route_security_network_review'));
});

test('evaluateAbacDecision always reviews break-glass access', () => {
  const result = evaluateAbacDecision({
    hasMapping: true,
    requestedAction: 'read',
    purpose: 'break_glass',
    networkZone: 'trusted',
    personalDataRequested: false,
    personalDataAllowed: true,
    approvalRequired: false,
    hasMaskingPolicy: false,
    emergencyAccess: true,
    approvalTicketId: 'INC-100',
    businessJustification: 'Emergency data restoration',
    assetClassificationRank: 2,
    allowedClassificationRank: 3,
  });

  assert.strictEqual(result.decision, AccessDecision.review_required);
  assert.ok(result.obligations.includes('record_break_glass_review'));
});

test('validateRoleDataAccessMapIntegrity blocks unsafe global and personal-data grants', () => {
  const errors = validateRoleDataAccessMapIntegrity({
    personalDataAllowed: true,
    approvalRequired: false,
    reviewCadenceDays: 500,
  });

  assert.ok(errors.some((message) => message.includes('personal data')));
  assert.ok(errors.some((message) => message.includes('global')));
  assert.ok(errors.some((message) => message.includes('review cadence')));
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

test('upsertAccessMap rejects unsafe personal-data grants before persistence', async () => {
  const service = new SecurityGovernanceService(
    {
      role: { findFirst: async () => ({ id: 'role-1', code: 'analyst' }) },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  await assert.rejects(
    () =>
      service.upsertAccessMap(
        ['system_admin'],
        {
          roleId: 'role-1',
          personalDataAllowed: true,
          approvalRequired: false,
        },
        'actor',
      ),
    BadRequestException,
  );
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
      resolve: async () => ({ orgUnits: 'all', domains: ['domain-1'], maxClassRank: 2 }),
    } as never,
  );

  await service.accessReviews(['security_reviewer']);
  const itemWhere = JSON.stringify(includeArg.items.where);
  assert.ok(itemWhere.includes('visible-asset'));
  assert.ok(itemWhere.includes('domain-1'));
});

test('accessReviews do not expose unlinked items to organization-scoped reviewers', async () => {
  let itemWhere: unknown;
  const service = new SecurityGovernanceService(
    {
      dataAsset: { findMany: async () => [] },
      accessReview: {
        findMany: async (args: any) => {
          itemWhere = args.include.items.where;
          return [];
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: 'all', maxClassRank: null }),
    } as never,
  );

  await service.accessReviews(['security_reviewer']);

  const text = filterText(itemWhere);
  assert.ok(text.includes('__no_visible_access_review_items__'));
  assert.ok(!text.includes('{"assetId":null}'));
});

test('dlpIncidents do not expose unlinked incidents to organization-scoped reviewers', async () => {
  let dlpWhere: unknown;
  const service = new SecurityGovernanceService(
    {
      dataAsset: { findMany: async () => [] },
      dlpIncident: {
        findMany: async (args: any) => {
          dlpWhere = args.where;
          return [];
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: ['org-1'], domains: 'all', maxClassRank: null }),
    } as never,
  );

  await service.dlpIncidents(['security_reviewer']);

  const text = filterText(dlpWhere);
  assert.ok(text.includes('__no_visible_security_records__'));
  assert.ok(!text.includes('{"assetId":null}'));
});

test('dlpIncidents allow classification-anchored unlinked incidents for classification scopes', async () => {
  let dlpWhere: unknown;
  const service = new SecurityGovernanceService(
    {
      dataAsset: { findMany: async () => [] },
      dlpIncident: {
        findMany: async (args: any) => {
          dlpWhere = args.where;
          return [];
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: 2 }),
    } as never,
  );

  await service.dlpIncidents(['security_reviewer']);

  const text = filterText(dlpWhere);
  assert.ok(text.includes('"assetId":null'));
  assert.ok(text.includes('"classificationId":{"not":null}'));
  assert.ok(text.includes('"rank":{"lte":2}'));
});

test('decisionLog scopes unlinked decisions by allowed domain', async () => {
  let decisionWhere: unknown;
  const service = new SecurityGovernanceService(
    {
      dataAsset: { findMany: async () => [] },
      abacDecisionLog: {
        findMany: async (args: any) => {
          decisionWhere = args.where;
          return [];
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: ['domain-1'], maxClassRank: null }),
    } as never,
  );

  await service.decisionLog(['security_reviewer']);

  const text = filterText(decisionWhere);
  assert.ok(text.includes('"assetId":null'));
  assert.ok(text.includes('"domainId":{"in":["domain-1"]}'));
  assert.ok(!text.includes('__no_visible_security_decisions__'));
});

test('simulateDecision persists ABAC trace metadata for review-required decisions', async () => {
  let createdDecision: any;
  let auditMetadata: any;
  const service = new SecurityGovernanceService(
    {
      dataAsset: {
        findFirst: async () => ({
          id: 'asset-1',
          code: 'AST-1',
          nameEn: 'Sensitive asset',
          nameAr: 'Sensitive asset',
          domainId: 'domain-1',
          classificationId: 'class-3',
          domain: { id: 'domain-1', code: 'FIN' },
          classification: { id: 'class-3', code: 'restricted', rank: 3, color: '#f59e0b' },
        }),
      },
      role: { findFirst: async () => ({ id: 'role-1', code: 'analyst', maxClassificationRank: 3 }) },
      user: { findUnique: async () => ({ id: 'user-1', email: 'admin@dgop.local' }) },
      roleDataAccessMap: {
        findMany: async () => [
          {
            id: 'map-1',
            roleId: 'role-1',
            domainId: 'domain-1',
            classificationId: 'class-3',
            maskingPolicyId: null,
            personalDataAllowed: true,
            approvalRequired: true,
            role: { id: 'role-1', code: 'analyst', nameEn: 'Analyst', nameAr: 'Analyst', maxClassificationRank: 3 },
            domain: { id: 'domain-1', code: 'FIN', nameEn: 'Finance', nameAr: 'Finance' },
            classification: { id: 'class-3', code: 'restricted', nameEn: 'Restricted', nameAr: 'Restricted', rank: 3, color: '#f59e0b' },
            maskingPolicy: null,
          },
        ],
      },
      abacDecisionLog: {
        create: async (args: any) => {
          createdDecision = args.data;
          return {
            id: 'decision-1',
            ...args.data,
            role: { id: 'role-1', code: 'analyst', nameEn: 'Analyst', nameAr: 'Analyst' },
            asset: { id: 'asset-1', code: 'AST-1', nameEn: 'Sensitive asset', nameAr: 'Sensitive asset' },
            classification: { id: 'class-3', code: 'restricted', nameEn: 'Restricted', nameAr: 'Restricted', rank: 3, color: '#f59e0b' },
            maskingPolicy: null,
          };
        },
      },
    } as never,
    {
      log: async (entry: any) => {
        auditMetadata = entry.metadata;
      },
    } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  const result = await service.simulateDecision(
    ['system_admin'],
    {
      roleId: 'role-1',
      assetId: 'asset-1',
      requestedAction: 'export',
      purpose: 'compliance',
      networkZone: 'internal',
      personalDataRequested: false,
      businessJustification: 'Regulatory evidence export',
    },
    'admin@dgop.local',
  );

  assert.strictEqual(createdDecision.requestedAction, 'export');
  assert.strictEqual(createdDecision.decision, AccessDecision.review_required);
  assert.strictEqual(result.abac.purpose, 'compliance');
  assert.ok(result.abac.obligations.includes('route_owner_security_review'));
  assert.ok(auditMetadata.ruleTrace.length > 0);
  assert.strictEqual(auditMetadata.risk, 'medium');
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

test('backfillWorkflowLinks repairs legacy DLP and classification records', async () => {
  const openedCases: any[] = [];
  const updates: any[] = [];
  const tx: any = {
    dlpIncident: {
      findMany: async () => [
        {
          id: 'dlp-old',
          title: 'Legacy incident',
          description: 'Needs route',
          assetId: 'asset-1',
          assignedPersonId: null,
        },
      ],
      update: async (args: any) => {
        updates.push({ type: 'dlp', ...args });
        return { id: args.where.id, workflowCaseId: args.data.workflowCaseId };
      },
    },
    classificationChangeRequest: {
      findMany: async () => [
        {
          id: 'class-old',
          reason: 'Legacy classification request',
          assetId: 'asset-1',
          asset: { code: 'AST-1', nameEn: 'Asset one' },
        },
      ],
      update: async (args: any) => {
        updates.push({ type: 'classification', ...args });
        return { id: args.where.id, workflowCaseId: args.data.workflowCaseId };
      },
    },
    workflowCase: {
      count: async () => 0,
      findUnique: async () => null,
    },
  };
  const service = new SecurityGovernanceService(
    {
      $transaction: async (fn: (client: unknown) => unknown) => fn(tx),
    } as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
    {
      openRoutedCase: async (input: any) => {
        openedCases.push(input);
        return { id: `case-${openedCases.length}`, code: input.preferredCode, tasks: [] };
      },
    } as never,
  );

  const result = await service.backfillWorkflowLinks(['system_admin'], 'admin@dgop.local');

  assert.deepStrictEqual(result, { dlpIncidents: 1, classificationRequests: 1 });
  assert.strictEqual(openedCases.length, 2);
  assert.deepStrictEqual(updates.map((update) => update.data.workflowCaseId), ['case-1', 'case-2']);
});

test('backfillWorkflowLinks rejects non-admin callers', async () => {
  const service = new SecurityGovernanceService(
    {} as never,
    { log: async () => undefined } as never,
    {
      resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
    } as never,
  );

  await assert.rejects(
    () => service.backfillWorkflowLinks(['security_reviewer'], 'reviewer@dgop.local'),
    ForbiddenException,
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
