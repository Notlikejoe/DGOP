import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiClassificationService } from '../src/ai-governance/ai-classification.service';
import { AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

async function main() {
  const startedAt = new Date().toISOString(), group = process.env.DGOP_INTEGRITY_GROUP ?? 'all';
  assert.ok(['all', 'native', 'api'].includes(group));
  const url = new URL(process.env.DGOP_AI_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55438');
  assert.match(url.pathname, /^\/dgop_ai_test_repair_batch1_\d+$/u);
  assert.equal(process.env.NODE_ENV, 'test');
  const manifest = JSON.parse(readFileSync(process.env.DGOP_DEMO_MANIFEST!, 'utf8'));
  const accounts = JSON.parse(readFileSync(process.env.DGOP_DEMO_CREDENTIALS!, 'utf8')).accounts;
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const audit = new AuditService(db as any), authorization = new AiAuthorizationService(db as any, audit);
  const routing = new AiWorkflowRoutingService(db as any);
  const service = new AiClassificationService(db as any, authorization, audit, routing);
  const stages = [['privacy', 'privacy_officer', 'aiuc-privacy-review'], ['security', 'security_reviewer', 'aiuc-security-review'], ['ethics', 'AI_ETHICS_COMMITTEE', 'aiuc-ethics-review']];
  const checks: string[] = [];
  let passed = false, failure: string | null = null;
  let app: any;
  try {
    const source = await db.aiUseCase.findFirstOrThrow({ where: { assetId: { not: null }, deletedAt: null }, include: { intakeRevisions: { orderBy: { revision: 'desc' }, take: 1 }, assessments: { where: { kind: 'classification' }, orderBy: { round: 'desc' }, take: 1 } } });
    assert.ok(source.intakeRevisions[0]); assert.ok(source.assessments[0]);
    const template = await db.workflowTemplate.findUniqueOrThrow({ where: { code: 'AIUC_APPROVAL_V1' }, include: { stages: true } });
    const evidence = await db.ndiEvidence.findFirstOrThrow({ where: { id:manifest.evidenceId,deletedAt: null,status:'approved' } });
    const outsider = randomUUID();
    const roles = await db.role.findMany({ where: { code: { in: stages.map(s => s[1]) }, isActive: true, deletedAt: null } });
    assert.equal(roles.length, 3);
    await db.user.create({ data: { id: outsider, email: `batch1-${outsider}@synthetic-test.invalid`, passwordHash: 'unusable-synthetic-account', displayName: 'Synthetic named reviewer', userRoles: { create: roles.map(role => ({ roleId: role.id })) } } });
    async function fixture(stageCode: string, role: string, assignee: string | null, registration = false) {
      return db.$transaction(async tx => {
        const caseId = randomUUID(), useCaseId = randomUUID(), taskId = randomUUID();
        await tx.workflowCase.create({ data: { id: caseId, code: 'AIUC-BATCH1-' + caseId, title: 'Synthetic Batch 1 integrity fixture', type: 'AIUC', status: registration ? 'approved' : 'under_review', templateId: template.id, templateVersion: template.designerVersion, createdBy: manifest.actors.showcase } });
        await tx.aiUseCase.create({ data: { id: useCaseId, name: 'Synthetic Batch 1 integrity fixture', workflowCaseId: caseId, requesterUserId: manifest.actors.showcase, ownerPersonId: source.ownerPersonId, organizationUnitId: source.organizationUnitId, createdBy: manifest.actors.showcase, intakeRevisions: { create: { revision: 1, payload: source.intakeRevisions[0].payload as any, submittedAt: new Date(), createdBy: manifest.actors.showcase } } } });
        await tx.aiEvidenceLink.create({data:{evidenceId:evidence.id,targetType:'ai_use_case',targetId:useCaseId,evidenceUpdatedAt:evidence.updatedAt,sha256:evidence.sha256,actorId:manifest.actors.showcase,justification:'Explicit synthetic evidence for this named specialist assignment diagnostic'}});
        const basis = source.assessments[0];
        const assessment = await tx.aiAssessmentRound.create({ data: { useCaseId, kind: 'classification', round: 1, schemaVersion: basis.schemaVersion, engineVersion: basis.engineVersion, ruleReferenceVersionId: basis.ruleReferenceVersionId, inputs: basis.inputs as any, result: basis.result as any, createdBy: basis.createdBy } });
        const group = randomUUID(), stage = template.stages.find(s => s.code === stageCode)!; assert.ok(stage);
        const form = { approvedTierCode: 'HIGH', classificationDecisionId: assessment.id, routingFacts: { personalDataInvolved: true, sensitiveDataInvolved: false } };
        await tx.workflowTask.create({ data: { id: taskId, caseId, templateStageId: stage.id, title: 'Synthetic Batch 1 assigned task', type: 'approval', status: 'pending', assigneeRoleCode: role, assigneeUserId: assignee, approvalGroupId: group, formDataJson: form } });
        if (!registration) {
          const peerStage = template.stages.find(s => s.code === (stageCode === 'aiuc-privacy-review' ? 'aiuc-security-review' : 'aiuc-privacy-review'))!;
          await tx.workflowTask.create({ data: { caseId, templateStageId: peerStage.id, title: 'Synthetic pending peer', type: 'approval', status: 'pending', assigneeRoleCode: peerStage.code === 'aiuc-privacy-review' ? 'privacy_officer' : 'security_reviewer', approvalGroupId: group, formDataJson: form } });
        }
        return { caseId, useCaseId, taskId };
      });
    }
    const submit = (target: any, actor: string, current = service, version = 1) => current.reviewGate(actor, target.useCaseId, target.taskId, version, 'approve', 'Independent synthetic Batch 1 review', [evidence.id]);
    async function unchanged(target: any) {
      assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: target.useCaseId } })).version, 1);
      assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: target.taskId } })).status, 'pending');
      assert.equal(await db.workflowEvent.count({ where: { caseId: target.caseId } }), 0);
      assert.equal(await db.auditLog.count({ where: { entityId: target.useCaseId, action: { startsWith: 'aiuc.review.' } } }), 0);
    }
    if (group !== 'api') {
    for (const [persona, role, stage] of stages) {
      const actor = manifest.actors[persona], wrong = await fixture(stage, role, outsider);
      await assert.rejects(submit(wrong, actor), ForbiddenException); await unchanged(wrong); checks.push(persona + ': named mismatch denied without writes');
      for (const assignment of [actor, null]) {
        const target = await fixture(stage, role, assignment); await submit(target, actor);
        const task = await db.workflowTask.findUniqueOrThrow({ where: { id: target.taskId } });
        assert.equal(task.status, 'completed'); assert.equal(task.formSubmittedBy, actor);
        assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: target.useCaseId } })).version, 2);
        assert.equal(await db.workflowEvent.count({ where: { caseId: target.caseId } }), 1);
        assert.equal(await db.auditLog.count({ where: { entityId: target.useCaseId, action: { startsWith: 'aiuc.review.' } } }), 1);
        await assert.rejects(submit(target, actor), ConflictException);
        checks.push(persona + ': ' + (assignment ? 'named' : 'role-pool') + ' success and duplicate conflict');
      }
      const reassigned = await fixture(stage, role, actor);
      await db.workflowTask.update({ where: { id: reassigned.taskId }, data: { assigneeUserId: outsider } });
      await assert.rejects(submit(reassigned, actor), ForbiddenException); await unchanged(reassigned); checks.push(persona + ': reassignment honored');
    }
    const rollback = await fixture(stages[0][2], stages[0][1], manifest.actors.privacy);
    const sentinel = new Error('Injected required audit failure');
    const failingAudit = Object.create(audit); failingAudit.logRequired = async () => { throw sentinel; };
    const failing = new AiClassificationService(db as any, authorization, failingAudit, routing);
    await assert.rejects(submit(rollback, manifest.actors.privacy, failing), (error: unknown) => error === sentinel);
    await unchanged(rollback); checks.push('required audit failure rolls back task, version and event');
    const concurrent = await fixture(stages[0][2], stages[0][1], manifest.actors.privacy);
    let arrived = 0, release!: () => void;
    const barrier = new Promise<void>(done => { release = done; });
    const timer = setTimeout(release, 10000);
    const concurrentDb = { $transaction: (work: any, options: any) => db.$transaction(async tx => {
      const delegate = new Proxy(tx.workflowTask, { get(target, property) { if (property === 'findFirst') return async (args: any) => { const row = await target.findFirst(args); if (args.where.id === concurrent.taskId) { if (++arrived === 2) release(); await barrier; } return row; }; const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; } });
      return work(new Proxy(tx, { get(target, property) { return property === 'workflowTask' ? delegate : Reflect.get(target, property); } }));
    }, options) };
    const racing = new AiClassificationService(concurrentDb as any, authorization, audit, routing);
    const results = await Promise.allSettled([submit(concurrent, manifest.actors.privacy, racing), submit(concurrent, manifest.actors.privacy, racing)]); clearTimeout(timer);
    assert.equal(arrived, 2); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult; assert.ok(rejected.reason instanceof ConflictException);
    assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: concurrent.useCaseId } })).version, 2);
    assert.equal(await db.auditLog.count({ where: { entityId: concurrent.useCaseId, action: { startsWith: 'aiuc.review.' } } }), 1);
    checks.push('overlapping same-version decisions: one commit, one 409, one audit');
    }

    // Actual AppModule controllers, authentication/permission guards, DTOs and common error filter.
    if (group !== 'native') {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1'); const base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
    process.env.PUBLIC_ORIGIN = base; process.env.CORS_ORIGINS = base;
    async function login(persona: string) { const account = accounts.find((a: any) => a.purpose === persona); assert.ok(account); const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ email: account.email, password: account.password }), signal: AbortSignal.timeout(5000) }); assert.equal(response.status, 201); return response.headers.getSetCookie().map(v => v.split(';')[0]).join('; '); }
    async function request(path: string, cookie: string, body?: object) { return fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: base, ...(body ? { 'Content-Type': 'application/json', 'x-dgop-csrf': 'same-origin' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) }); }
    for (const [persona, role, stage] of stages) {
      const cookie = await login(persona), wrong = await fixture(stage, role, outsider), target = await fixture(stage, role, manifest.actors[persona]);
      const body = { expectedVersion: 1, decision: 'approve', justification: 'Independent synthetic API review', evidenceIds: [evidence.id] };
      assert.equal((await request(`/api/ai/use-cases/classification/${wrong.useCaseId}/reviews/${wrong.taskId}`, cookie, body)).status, 403); await unchanged(wrong);
      const response = await request(`/api/ai/use-cases/classification/${target.useCaseId}/reviews/${target.taskId}`, cookie, body);
      assert.equal(response.status, 201, JSON.stringify(await response.json()));
      assert.equal((await request(`/api/ai/use-cases/classification/${target.useCaseId}/reviews/${target.taskId}`, cookie, body)).status, 409);
      checks.push(persona + ': authenticated HTTP denial, success and stale conflict');
    }
    await fixture('aiuc-asset-registration', 'AI_WORKING_GROUP', manifest.actors.working, true);
    const workingCookie = await login('working'), appDb = app.get(PrismaService), original = appDb.$transaction.bind(appDb);
    try {
      appDb.$transaction = (work: any, options: any) => original(async (tx: any) => {
        tx.organizationUnit.findMany = async () => { throw new Error('Injected registration repository outage'); };
        return work(tx);
      }, options);
      const response = await request('/api/ai/use-cases/registration/queue', workingCookie);
      assert.equal(response.status, 500); const body = await response.json() as any; assert.equal(body.code, 'SYS-500');
      checks.push('authenticated registration outage returns 500, never a successful empty queue');
    } finally { appDb.$transaction = original; }
    }
    const proof = await audit.verifyChain(); assert.equal(proof.valid, true); assert.equal(proof.truncated, false); assert.equal(proof.totalRowsRead, proof.totalRows);
    checks.push('complete stored audit chain remains valid');
    passed = true;
    console.log(JSON.stringify({ batch: 1, group, passed, checks: checks.length, scenarios: checks, database: url.pathname.slice(1), testDataRetained: true, bootstrapMiddlewareReviewed: false }));
  } catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }
  finally { if (app) await app.close(); await db.$disconnect(); if (process.env.DGOP_INTEGRITY_RECEIPT) writeFileSync(process.env.DGOP_INTEGRITY_RECEIPT, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), group, passed, checks: checks.length, scenarios: checks, error: failure, database: url.pathname.slice(1) }, null, 2) + '\n'); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
