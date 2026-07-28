/**
 * Lightweight unit tests for the ownership recommendation / conflict / exception logic
 * (no jest dependency). Run with: ts-node test/ownership.service.spec.ts
 */
import assert from 'node:assert';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, AssignmentTargetType } from '@prisma/client';
import { AssignmentsService } from '../src/ownership/assignments.service';
import {
  confidenceLabel,
  recommendationConfidence,
  recommendationReasons,
  validateOwnershipText,
  validateOwnershipWindow,
} from '../src/ownership/assignments.logic';

const PAST = new Date('2020-01-01');

type Over = {
  asset?: any;
  assets?: any[];
  roleTypes?: any[];
  assignments?: any[];
  rules?: any[];
  certificationAttempts?: any[];
  auditLogs?: any[];
  scope?: any;
  people?: any[];
  createdAssignments?: any[];
};

// Builds an AssignmentsService backed by canned data. Scope resolves as unrestricted,
// so scope filtering is a no-op and we exercise the pure recommendation/conflict logic.
function makeService(over: Over): AssignmentsService {
  const assignmentRows = over.assignments ?? [];
  const roleTypes = over.roleTypes ?? [];
  const people = over.people ?? [];
  const lookup = (rows: any[] | undefined, id: string) => (rows ?? []).find((row) => row.id === id) ?? null;
  const withAssignmentIncludes = (assignment: any) =>
    assignment
      ? {
          ...assignment,
          roleType: assignment.roleType ?? lookup(roleTypes, assignment.roleTypeId),
          person: assignment.person ?? lookup(people, assignment.personId),
        }
      : null;
  const prisma = {
    dataAsset: {
      findFirst: async (args?: any) => {
        const id = args?.where?.id;
        if (id && over.assets) return lookup(over.assets, id);
        return over.asset ?? null;
      },
      findMany: async () => over.assets ?? [],
      update: async () => undefined,
    },
    roleType: {
      findMany: async () => roleTypes,
      findFirst: async (args?: any) => lookup(roleTypes, args?.where?.id),
    },
    person: { findFirst: async (args?: any) => lookup(people, args?.where?.id) },
    stewardshipAssignment: {
      findFirst: async (args?: any) => withAssignmentIncludes(lookup(assignmentRows, args?.where?.id)),
      findMany: async (args?: any) => {
        const where = args?.where ?? {};
        if (where.NOT?.id) return assignmentRows.filter((assignment) => assignment.id !== where.NOT.id).map(withAssignmentIncludes);
        if (where.targetType && where.targetId) {
          return assignmentRows.filter(
            (assignment) =>
              (!assignment.targetType || assignment.targetType === where.targetType) &&
              (!assignment.targetId || assignment.targetId === where.targetId) &&
              (!where.roleTypeId || assignment.roleTypeId === where.roleTypeId),
          ).map(withAssignmentIncludes);
        }
        return assignmentRows.map(withAssignmentIncludes);
      },
      create: async (args: any) => {
        const created = { id: `created-assignment-${(over.createdAssignments?.length ?? 0) + 1}`, ...args.data, roleType: roleTypes.find((role) => role.id === args.data.roleTypeId) ?? roleTypes[0], person: people.find((person) => person.id === args.data.personId) ?? people[0] };
        (over.createdAssignments ??= []).push(created);
        return created;
      },
      update: async (args: any) => withAssignmentIncludes({ ...lookup(assignmentRows, args.where.id), ...args.data }),
      updateMany: async (args: any) => {
        for (const assignment of assignmentRows) {
          if (args.where.id.in.includes(assignment.id)) Object.assign(assignment, args.data);
        }
        return { count: args.where.id.in.length };
      },
    },
    assignmentRule: {
      findMany: async () => over.rules ?? [],
      findFirst: async (args?: any) => {
        const id = args?.where?.id;
        if (id) return lookup(over.rules, id);
        return (over.rules ?? []).find((rule) =>
          rule.scopeType === args?.where?.scopeType &&
          rule.refId === args?.where?.refId &&
          rule.roleTypeId === args?.where?.roleTypeId &&
          rule.priority === args?.where?.priority &&
          rule.isActive !== false &&
          !rule.deletedAt,
        ) ?? null;
      },
      create: async (args: any) => ({ id: 'created-rule', ...args.data, roleType: roleTypes[0], person: people[0] }),
    },
    certificationAttempt: { findMany: async () => over.certificationAttempts ?? [] },
    dataDomain: { findMany: async () => [], findFirst: async (args?: any) => lookup(over.assets, args?.where?.id) },
    businessCapability: { findMany: async () => [], findFirst: async () => null },
    dataSubject: { findMany: async () => [], findFirst: async () => null },
    organizationUnit: { findMany: async () => [], findFirst: async () => null },
    systemPlatform: { findMany: async () => [], findFirst: async () => null },
  };
  const audit = { log: async (entry: any) => { over.auditLogs?.push(entry); } };
  const scope = {
    resolve: async () => over.scope ?? ({ orgUnits: 'all', domains: 'all', maxClassRank: null }),
  };
  return new AssignmentsService(prisma as never, audit as never, scope as never);
}

const owner = { id: 'rt_owner', code: 'data_owner', nameEn: 'Data Owner', nameAr: '' };

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

test('recommend: a direct asset assignment is authoritative (status assigned)', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: 's1', subjects: [] },
    roleTypes: [owner],
    assignments: [
      {
        id: 'as1',
        roleTypeId: 'rt_owner',
        isPrimary: true,
        isActive: true,
        approvalStatus: 'approved',
        effectiveDate: PAST,
        expiryDate: null,
        source: 'manual',
        person: { id: 'p1', fullNameEn: 'Alice' },
      },
    ],
    rules: [{ id: 'r1', roleTypeId: 'rt_owner', scopeType: 'domain', refId: 'd1', priority: 100, person: { id: 'p2' } }],
  });
  const recs = await svc.recommend(['system_admin'], 'a1');
  const rec = recs[0];
  assert.strictEqual(rec.status, 'assigned');
  assert.strictEqual(rec.current?.person.id, 'p1');
});

test('recommend: a pending assignment is NOT authoritative (falls back to rule)', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [] },
    roleTypes: [owner],
    assignments: [
      {
        id: 'as1',
        roleTypeId: 'rt_owner',
        isPrimary: true,
        isActive: true,
        approvalStatus: 'pending',
        effectiveDate: PAST,
        expiryDate: null,
        source: 'manual',
        person: { id: 'p1', fullNameEn: 'Alice' },
      },
    ],
    rules: [{ id: 'r1', roleTypeId: 'rt_owner', scopeType: 'domain', refId: 'd1', priority: 100, person: { id: 'p2' } }],
  });
  const rec = (await svc.recommend(['system_admin'], 'a1'))[0];
  assert.strictEqual(rec.status, 'recommended');
  assert.strictEqual(rec.recommended?.person.id, 'p2');
});

test('recommend: domain scope wins over system scope regardless of priority number', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: 's1', subjects: [] },
    roleTypes: [owner],
    assignments: [],
    rules: [
      { id: 'rSys', roleTypeId: 'rt_owner', scopeType: 'system', refId: 's1', priority: 1, person: { id: 'pSys' } },
      { id: 'rDom', roleTypeId: 'rt_owner', scopeType: 'domain', refId: 'd1', priority: 100, person: { id: 'pDom' } },
    ],
  });
  const rec = (await svc.recommend(['system_admin'], 'a1'))[0];
  assert.strictEqual(rec.status, 'recommended');
  assert.strictEqual(rec.recommended?.scopeType, 'domain');
  assert.strictEqual(rec.recommended?.person.id, 'pDom');
});

test('recommend: recommendations include confidence, signals, and readable reasons', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [] },
    roleTypes: [owner],
    assignments: [],
    certificationAttempts: [
      {
        personId: 'p2',
        status: 'passed',
        expiresAt: new Date('2099-01-01'),
        renewalDueAt: null,
      },
    ],
    rules: [
      {
        id: 'r1',
        roleTypeId: 'rt_owner',
        scopeType: 'domain',
        refId: 'd1',
        priority: 1,
        personId: 'p2',
        person: { id: 'p2', fullNameEn: 'Certified Owner' },
      },
    ],
  });
  const rec = (await svc.recommend(['system_admin'], 'a1'))[0];
  assert.strictEqual(rec.status, 'recommended');
  assert.strictEqual(rec.recommended?.confidenceLabel, 'high');
  assert.strictEqual(rec.recommended?.signals.certificationState, 'current');
  assert.ok(rec.recommended?.reasons.some((reason: string) => reason.includes('certification')));
});

test('recommendation scoring helpers expose explainable confidence levels', () => {
  const score = recommendationConfidence({
    scopeType: 'domain',
    rulePriority: 1,
    activeAssignments: 1,
    approvedAssignments: 2,
    certificationState: 'current',
  });
  assert.ok(score >= 85);
  assert.strictEqual(confidenceLabel(score), 'high');
  assert.deepStrictEqual(confidenceLabel(0), 'none');
  assert.ok(recommendationReasons({ scopeType: 'domain', rulePriority: 1 }).length > 0);
});

test('ownership validation helpers reject unsafe text and date windows', () => {
  assert.deepStrictEqual(
    validateOwnershipWindow({
      effectiveDate: new Date('2026-01-02'),
      expiryDate: new Date('2026-01-01'),
    }),
    ['Expiry date must be after the effective date'],
  );
  assert.deepStrictEqual(
    validateOwnershipText({ nameEn: '', nameAr: 'قاعدة' }),
    ['English name cannot be blank'],
  );
  assert.deepStrictEqual(
    validateOwnershipText({ description: 'x'.repeat(1001) }),
    ['Description must be 1000 characters or fewer'],
  );
});

test('assignment lists reject invalid filters before Prisma receives them', async () => {
  const svc = makeService({});
  await assert.rejects(
    () => svc.listAssignments(['system_admin'], { targetType: 'bad-target' }),
    BadRequestException,
  );
  await assert.rejects(
    () => svc.listAssignments(['system_admin'], { approvalStatus: 'half_approved' }),
    BadRequestException,
  );
  await assert.rejects(
    () => svc.listRules({ scopeType: 'asset' }),
    BadRequestException,
  );
});

test('assignment create hides targets outside the writer data scope', async () => {
  const svc = makeService({
    scope: { orgUnits: 'all', domains: ['domain-visible'], maxClassRank: null },
    assets: [
      {
        id: 'asset-visible',
        domainId: 'domain-visible',
        capabilityId: null,
        orgUnitId: null,
        systemId: null,
        subjects: [],
      },
    ],
    roleTypes: [{ id: 'role-owner', code: 'data_owner', isActive: true }],
    people: [{ id: 'person-1', isActive: true }],
  });
  await assert.rejects(
    () =>
      svc.createAssignment(
        {
          targetType: AssignmentTargetType.asset,
          targetId: 'asset-hidden',
          roleTypeId: 'role-owner',
          personId: 'person-1',
        },
        'admin@dgop.local',
        undefined,
        ApprovalStatus.approved,
        ['scoped_role'],
      ),
    NotFoundException,
  );
});

test('assignment update blocks a new overlapping approved primary', async () => {
  const svc = makeService({
    roleTypes: [{ id: 'role-owner', code: 'data_owner', isActive: true }],
    people: [{ id: 'person-1', isActive: true }],
    assignments: [
      {
        id: 'a1',
        targetType: AssignmentTargetType.asset,
        targetId: 'asset-1',
        roleTypeId: 'role-owner',
        personId: 'person-1',
        isPrimary: false,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: new Date('2026-01-01'),
        expiryDate: null,
      },
      {
        id: 'a2',
        targetType: AssignmentTargetType.asset,
        targetId: 'asset-1',
        roleTypeId: 'role-owner',
        personId: 'person-2',
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: new Date('2026-01-01'),
        expiryDate: null,
      },
    ],
  });
  await assert.rejects(
    () => svc.updateAssignment('a1', { isPrimary: true }, 'admin@dgop.local'),
    BadRequestException,
  );
});

test('assignment create auto-saves another accountable owner candidate as a proposal', async () => {
  const svc = makeService({
    assets: [{ id: 'asset-1', deletedAt: null, isActive: true }],
    roleTypes: [{ id: 'role-owner', code: 'data_owner', isActive: true }],
    people: [{ id: 'person-1', isActive: true }, { id: 'person-2', isActive: true }],
    assignments: [
      {
        id: 'existing-owner',
        targetType: AssignmentTargetType.asset,
        targetId: 'asset-1',
        roleTypeId: 'role-owner',
        personId: 'person-1',
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: new Date('2026-01-01'),
        expiryDate: null,
      },
    ],
  });
  const created = await svc.createAssignment(
    {
      targetType: AssignmentTargetType.asset,
      targetId: 'asset-1',
      roleTypeId: 'role-owner',
      personId: 'person-2',
      demoteExisting: true,
    },
    'admin@dgop.local',
  );
  assert.strictEqual((created as any).approvalStatus, ApprovalStatus.draft);
  assert.strictEqual((created as any).isPrimary, true);
});

test('assignment create can save a second owner candidate as a non-authoritative proposal', async () => {
  const svc = makeService({
    assets: [{ id: 'asset-1', deletedAt: null, isActive: true }],
    roleTypes: [{ id: 'role-owner', code: 'data_owner', isActive: true }],
    people: [{ id: 'person-1', isActive: true }, { id: 'person-2', isActive: true }],
    assignments: [
      {
        id: 'existing-owner',
        targetType: AssignmentTargetType.asset,
        targetId: 'asset-1',
        roleTypeId: 'role-owner',
        personId: 'person-1',
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: new Date('2026-01-01'),
        expiryDate: null,
      },
    ],
  });
  const created = await svc.createAssignment(
    {
      targetType: AssignmentTargetType.asset,
      targetId: 'asset-1',
      roleTypeId: 'role-owner',
      personId: 'person-2',
      saveAsProposal: true,
    },
    'admin@dgop.local',
  );
  assert.strictEqual((created as any).approvalStatus, ApprovalStatus.draft);
  assert.strictEqual((created as any).isPrimary, true);
});

test('assignment update auto-saves approved accountable owner replacement as a proposal', async () => {
  const over: Over = {
    assets: [{ id: 'asset-1', deletedAt: null, isActive: true }],
    roleTypes: [{ id: 'role-owner', code: 'data_owner', isActive: true }],
    people: [{ id: 'person-1', isActive: true }, { id: 'person-2', isActive: true }],
    createdAssignments: [],
    assignments: [
      {
        id: 'current-owner',
        targetType: AssignmentTargetType.asset,
        targetId: 'asset-1',
        roleTypeId: 'role-owner',
        roleType: { id: 'role-owner', code: 'data_owner' },
        personId: 'person-1',
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: new Date('2026-01-01'),
        expiryDate: null,
        justification: null,
      },
    ],
  };
  const svc = makeService(over);
  const proposal = await svc.updateAssignment('current-owner', { personId: 'person-2' }, 'admin@dgop.local');
  assert.strictEqual((proposal as any).approvalStatus, ApprovalStatus.draft);
  assert.strictEqual((proposal as any).personId, 'person-2');
  assert.strictEqual(over.createdAssignments?.length, 1);
  assert.strictEqual(over.assignments?.[0].personId, 'person-1');
});

test('assignment update rejects removing an approved accountable owner without an approval path', async () => {
  const svc = makeService({
    assets: [{ id: 'asset-1', deletedAt: null, isActive: true }],
    roleTypes: [{ id: 'role-owner', code: 'data_owner', isActive: true }],
    people: [{ id: 'person-1', isActive: true }, { id: 'person-2', isActive: true }],
    assignments: [
      {
        id: 'current-owner',
        targetType: AssignmentTargetType.asset,
        targetId: 'asset-1',
        roleTypeId: 'role-owner',
        roleType: { id: 'role-owner', code: 'data_owner' },
        personId: 'person-1',
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: new Date('2026-01-01'),
        expiryDate: null,
      },
    ],
  });
  await assert.rejects(
    () => svc.updateAssignment('current-owner', { isPrimary: false }, 'admin@dgop.local'),
    /requires a proposed owner approval/,
  );
});

test('assignment update creates a separate stewardship assignment when changing an approved owner row to another responsibility', async () => {
  const over: Over = {
    assets: [
      { id: 'asset-owner', deletedAt: null, isActive: true },
      { id: 'asset-steward', deletedAt: null, isActive: true },
    ],
    roleTypes: [
      { id: 'role-owner', code: 'data_owner', isActive: true },
      { id: 'role-enterprise-steward', code: 'enterprise_data_steward', isActive: true },
    ],
    people: [{ id: 'person-owner', isActive: true }, { id: 'person-steward', isActive: true }],
    createdAssignments: [],
    assignments: [
      {
        id: 'current-owner',
        targetType: AssignmentTargetType.asset,
        targetId: 'asset-owner',
        roleTypeId: 'role-owner',
        roleType: { id: 'role-owner', code: 'data_owner' },
        personId: 'person-owner',
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: new Date('2026-01-01'),
        expiryDate: null,
        justification: null,
      },
    ],
  };
  const svc = makeService(over);
  const created = await svc.updateAssignment(
    'current-owner',
    {
      targetType: AssignmentTargetType.asset,
      targetId: 'asset-steward',
      roleTypeId: 'role-enterprise-steward',
      personId: 'person-steward',
      isPrimary: true,
      demoteExisting: true,
    },
    'admin@dgop.local',
  );
  assert.strictEqual((created as any).approvalStatus, ApprovalStatus.approved);
  assert.strictEqual((created as any).roleTypeId, 'role-enterprise-steward');
  assert.strictEqual((created as any).personId, 'person-steward');
  assert.strictEqual(over.createdAssignments?.length, 1);
  assert.strictEqual(over.assignments?.[0].roleTypeId, 'role-owner');
  assert.strictEqual(over.assignments?.[0].personId, 'person-owner');
});

test('assignment update saves an approved accountable owner replacement as a separate proposal', async () => {
  const over: Over = {
    assets: [{ id: 'asset-1', deletedAt: null, isActive: true }],
    roleTypes: [{ id: 'role-owner', code: 'data_owner', isActive: true }],
    people: [{ id: 'person-1', isActive: true }, { id: 'person-2', isActive: true }],
    createdAssignments: [],
    assignments: [
      {
        id: 'current-owner',
        targetType: AssignmentTargetType.asset,
        targetId: 'asset-1',
        roleTypeId: 'role-owner',
        roleType: { id: 'role-owner', code: 'data_owner' },
        personId: 'person-1',
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: new Date('2026-01-01'),
        expiryDate: null,
        justification: null,
      },
    ],
  };
  const svc = makeService(over);
  const proposal = await svc.updateAssignment(
    'current-owner',
    { personId: 'person-2', saveAsProposal: true, justification: 'Nominate new accountable owner' },
    'admin@dgop.local',
  );
  assert.strictEqual((proposal as any).approvalStatus, ApprovalStatus.draft);
  assert.strictEqual((proposal as any).personId, 'person-2');
  assert.strictEqual(over.createdAssignments?.length, 1);
  assert.strictEqual(over.assignments?.[0].personId, 'person-1');
});

test('assignment update can change a non-accountable steward assignment when references are valid', async () => {
  const auditLogs: any[] = [];
  const svc = makeService({
    auditLogs,
    assets: [
      { id: 'asset-1', deletedAt: null, isActive: true },
      { id: 'asset-2', deletedAt: null, isActive: true },
    ],
    roleTypes: [
      { id: 'role-technical', code: 'technical_steward', isActive: true },
      { id: 'role-steward', code: 'business_steward', isActive: true },
    ],
    people: [
      { id: 'person-1', isActive: true },
      { id: 'person-2', isActive: true },
    ],
    assignments: [
      {
        id: 'a1',
        targetType: AssignmentTargetType.asset,
        targetId: 'asset-1',
        roleTypeId: 'role-technical',
        roleType: { id: 'role-technical', code: 'technical_steward' },
        personId: 'person-1',
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: new Date('2026-01-01'),
        expiryDate: null,
      },
    ],
  });
  const updated = await svc.updateAssignment(
    'a1',
    {
      targetType: AssignmentTargetType.asset,
      targetId: 'asset-2',
      roleTypeId: 'role-steward',
      personId: 'person-2',
    },
    'admin@dgop.local',
  );
  assert.strictEqual((updated as any).targetId, 'asset-2');
  assert.strictEqual((updated as any).roleTypeId, 'role-steward');
  assert.strictEqual((updated as any).personId, 'person-2');
  assert.strictEqual(auditLogs[0].metadata.from.targetId, 'asset-1');
  assert.strictEqual(auditLogs[0].metadata.to.roleTypeId, 'role-steward');
});

test('recommend: no assignment and no rule is an exception', async () => {
  const svc = makeService({
    asset: { id: 'a1', domainId: null, capabilityId: null, orgUnitId: null, systemId: null, subjects: [] },
    roleTypes: [owner],
    assignments: [],
    rules: [],
  });
  const rec = (await svc.recommend(['system_admin'], 'a1'))[0];
  assert.strictEqual(rec.status, 'exception');
});

test('recordRecommendationFeedback: captures accepted or override decisions in the audit trail', async () => {
  const auditLogs: any[] = [];
  const svc = makeService({
    asset: { id: 'a1', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [] },
    roleTypes: [owner],
    assignments: [],
    rules: [
      {
        id: 'r1',
        roleTypeId: 'rt_owner',
        scopeType: 'domain',
        refId: 'd1',
        priority: 1,
        personId: 'p2',
        person: { id: 'p2', fullNameEn: 'Alice' },
      },
    ],
    auditLogs,
  });
  const result = await svc.recordRecommendationFeedback(
    ['system_admin'],
    'a1',
    'rt_owner',
    { decision: 'accepted', comment: 'Good match' },
    'admin@dgop.local',
  );

  assert.strictEqual(result.recorded, true);
  assert.strictEqual(auditLogs.length, 1);
  assert.strictEqual(auditLogs[0].action, 'assignment_recommendation.feedback');
  assert.strictEqual(auditLogs[0].metadata.recommendedPersonId, 'p2');
  assert.strictEqual(auditLogs[0].metadata.confidenceLabel, 'high');
});

test('conflicts: two overlapping approved primaries on the same target+role conflict', async () => {
  const base = {
    targetType: 'asset',
    targetId: 'a1',
    roleTypeId: 'rt_owner',
    isPrimary: true,
    isActive: true,
    approvalStatus: 'approved',
    roleType: owner,
    person: { id: 'p', fullNameEn: 'X' },
    source: 'manual',
  };
  const svc = makeService({
    assignments: [
      { ...base, id: 'c1', effectiveDate: new Date('2020-01-01'), expiryDate: null },
      { ...base, id: 'c2', effectiveDate: new Date('2021-01-01'), expiryDate: null },
    ],
  });
  const conflicts = await svc.conflicts(['system_admin']);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual((conflicts[0] as any).assignments.length, 2);
});

test('conflicts: non-overlapping windows do not conflict', async () => {
  const base = {
    targetType: 'asset',
    targetId: 'a1',
    roleTypeId: 'rt_owner',
    isPrimary: true,
    isActive: true,
    approvalStatus: 'approved',
    roleType: owner,
    person: { id: 'p', fullNameEn: 'X' },
    source: 'manual',
  };
  const svc = makeService({
    assignments: [
      { ...base, id: 'c1', effectiveDate: new Date('2020-01-01'), expiryDate: new Date('2020-12-31') },
      { ...base, id: 'c2', effectiveDate: new Date('2021-01-01'), expiryDate: null },
    ],
  });
  const conflicts = await svc.conflicts(['system_admin']);
  assert.strictEqual(conflicts.length, 0);
});

test('exceptions: asset with no owner and no covering rule is an exception', async () => {
  const svc = makeService({
    assets: [
      { id: 'a1', code: 'A1', nameEn: 'Asset 1', nameAr: '', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [], domain: null, classification: null },
    ],
    assignments: [],
    rules: [],
  });
  const ex = await svc.exceptions(['system_admin']);
  assert.strictEqual(ex.length, 1);
  assert.strictEqual(ex[0].code, 'A1');
});

test('exceptions: a covering data_owner rule clears the exception', async () => {
  const svc = makeService({
    assets: [
      { id: 'a1', code: 'A1', nameEn: 'Asset 1', nameAr: '', domainId: 'd1', capabilityId: null, orgUnitId: null, systemId: null, subjects: [], domain: null, classification: null },
    ],
    assignments: [],
    rules: [{ id: 'r1', scopeType: 'domain', refId: 'd1' }],
  });
  const ex = await svc.exceptions(['system_admin']);
  assert.strictEqual(ex.length, 0);
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
