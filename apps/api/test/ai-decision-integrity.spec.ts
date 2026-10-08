import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiClassificationService } from '../src/ai-governance/ai-classification.service';
import { AiRegistrationService } from '../src/ai-governance/ai-registration.service';

const stages = [['aiuc-privacy-review', 'privacy_officer'], ['aiuc-security-review', 'security_reviewer'], ['aiuc-ethics-review', 'AI_ETHICS_COMMITTEE']];
function reviewHarness(stage: string, role: string, assigneeUserId: string | null) {
  let writes = 0;
  const task = { id: 'task', assigneeUserId, assigneeRoleCode: role, approvalGroupId: 'group', templateStage: { code: stage }, formDataJson: { approvedTierCode: 'HIGH', classificationDecisionId: 'round' } };
  const tx = {
    aiUseCase: { findFirst: async () => ({ version: 1, workflowCaseId: 'case', workflowCase: { status: 'under_review' }, requesterUserId: 'requester', owner: { userId: 'owner' } }), updateMany: async () => { writes++; return { count: 1 }; }, findUniqueOrThrow: async () => ({ version: 2 }) },
    workflowTask: { findFirst: async () => task, update: async () => { writes++; }, count: async () => 1 },
    ndiEvidence: { count: async () => 1 }, workflowEvent: { create: async () => { writes++; } },
  };
  const db = { $transaction: async (work: any) => work(tx) };
  const service = new AiClassificationService(db as any, { authorizeBusiness: async (id: string) => ({ id, roles: [role] }), enforceDuty: async () => {} } as any, { logRequired: async () => { writes++; } } as any, { routingFacts: () => ({}) } as any);
  return { service, task, db, writes: () => writes };
}

async function main() {
  let checks = 0;
  for (const [stage, role] of stages) {
    for (const decision of ['approve', 'return', 'reject'] as const) {
      const h = reviewHarness(stage, role, 'alice');
      await assert.rejects(h.service.reviewGate('bob', 'uc', 'task', 1, decision, 'Independent review', ['evidence']), (error: any) => error instanceof ForbiddenException && error.getStatus() === 403, `${stage}: another same-role actor cannot ${decision} Alice's task`);
      assert.equal(h.writes(), 0, 'Assignment denial must precede every business write'); checks++;
    }
    for (const assigned of ['bob', null]) {
      const h = reviewHarness(stage, role, assigned);
      assert.equal((await h.service.reviewGate('bob', 'uc', 'task', 1, 'approve', 'Independent review', ['evidence'])).version, 2);
      assert.equal(h.writes(), 4); checks++;
    }
    const stale = reviewHarness(stage, role, 'bob');
    await assert.rejects(stale.service.reviewGate('bob', 'uc', 'task', 2, 'approve', 'Independent review', ['evidence']), ConflictException);
    assert.equal(stale.writes(), 0); checks++;
  }
  const conflict = reviewHarness(stages[0][0], stages[0][1], 'bob');
  conflict.db.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('Write conflict', { code: 'P2034', clientVersion: 'test' }); };
  await assert.rejects(conflict.service.reviewGate('bob', 'uc', 'task', 1, 'approve', 'Independent review', ['evidence']), ConflictException); checks++;
  const infrastructure = new Error('Transaction connection failure');
  conflict.db.$transaction = async () => { throw infrastructure; };
  await assert.rejects(conflict.service.reviewGate('bob', 'uc', 'task', 1, 'approve', 'Independent review', ['evidence']), (error: unknown) => error === infrastructure); checks++;
  for (const orgUnits of [['unit'], 'all']) {
    const failure = new Error('Injected organization repository outage');
    let organizationFailure: Error | null = null;
    let mapped = [{ id: 'unit', code: 'Example', nameEn: 'Example', nameAr: 'مثال' }];
    const db: any = { aiUseCase: { findMany: async () => [{ id: 'uc', organizationUnitId: 'unit', owner: { organization: 'Example' }, assessments: [], workflowCase: { tasks: [] } }] }, organizationUnit: { findMany: async () => { if (organizationFailure) throw organizationFailure; return mapped; } } };
    db.$transaction = async (work: any) => work(db);
    const service = new AiRegistrationService(db, { authorizeRead: async () => ({ id: 'reviewer', roles: ['AI_WORKING_GROUP'], administratorOversight: false }), queueReadScope: async () => ({ where: {}, filter: async (rows: any[]) => rows }) } as any, null!, null!, null!, null!, { resolve: async () => ({ orgUnits }) } as any);
    assert.equal((await service.queue('reviewer')).total, 1); checks++;
    organizationFailure = failure;
    await assert.rejects(service.queue('reviewer'), (error: unknown) => error === failure, 'Infrastructure failure must not become an empty successful queue'); checks++;
    organizationFailure = null; mapped = [];
    await assert.rejects(service.queue('reviewer'), ConflictException, 'An unmapped department must expose the existing actionable conflict'); checks++;
  }
  console.log(JSON.stringify({ batch: 1, passed: true, checks, coverage: 'three specialist stages; wrong actor for every decision; named and role-pool success; stale versions; registration repository and mapping failures' }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
