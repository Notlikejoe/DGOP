import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { ScopeService } from '../src/access/scope.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiRiskAssessmentService } from '../src/ai-governance/ai-risk-assessment.service';
import { RiskDimension, jsonRecord } from '../src/ai-governance/ai-risk-scoring';
import { riskScoringFixture } from './ai-risk-scoring.fixture';

export async function testPhase3B(db: PrismaClient, fixture: { riskId: string; riskOwnerId: string; useCaseOwnerId: string;
  otherRiskOwnerId: string; privacyId: string; securityId: string; auditorId: string; officerId: string }) {
  const prisma = db as PrismaService, audit = new AuditService(prisma), auth = new AiAuthorizationService(prisma, audit);
  const routing = new AiWorkflowRoutingService(prisma), risks = new AiRiskIntakeService(prisma, auth, new ScopeService(prisma), routing, new AiIdentifiersService(), audit);
  const service = new AiRiskAssessmentService(prisma, auth, risks, routing, audit);
  const failed = new AiRiskAssessmentService(prisma, auth, risks, routing, { logRequired: async () => { throw new Error('Injected assessment audit failure'); } } as unknown as AuditService);
  const config = riskScoringFixture(), id = fixture.riskId;
  const preserved = await db.aiRisk.findUniqueOrThrow({ where: { id } });
  async function publish(listCode: string, values: Array<{ code: string; labelEn: string; labelAr: string; metadata: Prisma.InputJsonObject }>) {
    await db.governedReferenceList.upsert({ where: { code: listCode }, create: { code: listCode, nameEn: listCode, nameAr: listCode, ownerRoleCode: 'AI_GOVERNANCE_OFFICER' }, update: {} });
    await db.governedReferenceVersion.updateMany({ where: { listCode, state: 'published' }, data: { state: 'retired', effectiveTo: new Date() } });
    const previous = await db.governedReferenceVersion.aggregate({ where: { listCode }, _max: { version: true } });
    const version = await db.governedReferenceVersion.create({ data: { listCode, version: (previous._max.version ?? 0) + 1, createdBy: 'phase3b-fixture',
      values: { create: values.map((value, index) => ({ ...value, sortOrder: index + 1 })) } } });
    await db.governedReferenceVersion.update({ where: { id: version.id }, data: { state: 'published', effectiveFrom: new Date('2020-01-01'), approvedBy: 'phase3b-fixture', approvedAt: new Date('2020-01-01') } });
    return version.id;
  }
  async function actor(roleCode: string) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    return db.user.create({ data: { email: `${roleCode}@phase3b.test`, displayName: roleCode, passwordHash: 'not-a-login', userRoles: { create: { roleId: role.id } } } });
  }
  const model = await actor('AI_MODEL_OWNER'), mlops = await actor('AI_MLOPS_LEAD'), business = await actor('business_steward'), technical = await actor('technical_steward');
  assert.equal((await service.context(fixture.riskOwnerId, id)).canStart, false);
  await assert.rejects(service.start(fixture.riskOwnerId, id, 5), /configuration/);
  await publish('R_SCORE14', config.scores.map(({ code, labelEn, labelAr, ...metadata }) => ({ code, labelEn, labelAr, metadata })));
  await publish('R_LEVEL', config.bands.map(({ code, labelEn, labelAr, ...metadata }) => ({ code, labelEn, labelAr, metadata })));
  await publish('R_IMPD', config.dimensions.map(({ code, labelEn, labelAr, ...metadata }) => ({ code, labelEn, labelAr, metadata: { ...metadata, assessorRoleCode: 'AI_RISK_OWNER' } })));
  await assert.rejects(service.start(fixture.riskOwnerId, id, 5), /configuration/);
  assert.equal((await db.aiRisk.findUniqueOrThrow({ where: { id } })).version, 5);
  await publish('R_IMPD', config.dimensions.map(({ code, labelEn, labelAr, ...metadata }) => ({ code, labelEn, labelAr, metadata })));
  await assert.rejects(service.start(fixture.otherRiskOwnerId, id, 5));
  await assert.rejects(service.start(fixture.officerId, id, 5));
  await assert.rejects(failed.start(fixture.riskOwnerId, id, 5), /Injected assessment audit failure/);
  assert.equal(await db.workflowTask.count({ where: { caseId: preserved.workflowCaseId!, status: 'pending' } }), 1);
  await service.start(fixture.riskOwnerId, id, 5);
  let context = await service.context(fixture.riskOwnerId, id);
  assert.equal(context.tasks.length, 8); assert.equal(context.canStart, false); assert.equal(context.canComplete, false);
  assert.equal(context.tasks.filter(task => task.canContribute).length, 2);
  assert.ok((await risks.list(model.id)).some(risk => risk.id === id), 'competent role queues grant own-case visibility within effective scope');
  await assert.rejects(service.start(fixture.riskOwnerId, id, 6), /already started/);
  await assert.rejects(service.complete(fixture.riskOwnerId, id, { expectedVersion: 6, likelihood: 2, justification: 'Likelihood reason' }), /eight/);
  const privacyTask = context.tasks.find(task => task.dimension === 'dim_privacy')!;
  await assert.rejects(service.contribute(fixture.riskOwnerId, id, privacyTask.id, { expectedVersion: 6, value: 4, justification: 'Wrong role' }), /competent/);
  await assert.rejects(service.contribute(fixture.auditorId, id, privacyTask.id, { expectedVersion: 6, value: 4, justification: 'Auditor attempt' }));
  await assert.rejects(service.contribute(fixture.privacyId, id, privacyTask.id, { expectedVersion: 6, value: 4, justification: ' ' }), /justification/);
  await assert.rejects(service.contribute(fixture.privacyId, id, privacyTask.id, { expectedVersion: 6, value: 5, justification: 'Invalid grade' }), /1–4/);
  await assert.rejects(failed.contribute(fixture.privacyId, id, privacyTask.id, { expectedVersion: 6, value: 4, justification: 'Privacy evidence' }), /Injected assessment audit failure/);
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: privacyTask.id } })).status, 'pending');
  const claims = await Promise.allSettled([service.contribute(fixture.privacyId, id, privacyTask.id, { expectedVersion: 6, value: 4, justification: 'Privacy evidence' }),
    service.contribute(fixture.privacyId, id, privacyTask.id, { expectedVersion: 6, value: 4, justification: 'Privacy evidence' })]);
  assert.equal(claims.filter(value => value.status === 'fulfilled').length, 1);
  await assert.rejects(service.contribute(fixture.privacyId, id, privacyTask.id, { expectedVersion: 7, value: 3, justification: 'Replay attempt' }), /task/);
  const oldScoreVersion = context.configuration.referenceVersions.R_SCORE14;
  await publish('R_SCORE14', config.scores.map(({ code, labelEn, labelAr, ...metadata }) => ({ code, labelEn, labelAr, metadata })));
  context = await service.context(fixture.riskOwnerId, id);
  assert.equal(context.referencesCurrent, false); assert.equal(context.canComplete, false); assert.ok(context.tasks.every(task => !task.canContribute));
  assert.equal(context.configuration.referenceVersions.R_SCORE14, oldScoreVersion, 'an in-flight configuration is never silently replaced');
  const biasTask = context.tasks.find(task => task.dimension === 'dim_bias')!;
  await assert.rejects(service.contribute(fixture.riskOwnerId, id, biasTask.id, { expectedVersion: 7, value: 2, justification: 'Bias review' }), /restart/);
  await assert.rejects(service.start(fixture.riskOwnerId, id, 7, undefined, true, ''), /justification/);
  await assert.rejects(failed.start(fixture.riskOwnerId, id, 7, undefined, true, 'References changed'), /Injected assessment audit failure/);
  assert.equal((await db.aiRisk.findUniqueOrThrow({ where: { id } })).version, 7);
  await service.start(fixture.riskOwnerId, id, 7, undefined, true, 'Reassess all dimensions against the new approved reference version');
  context = await service.context(fixture.riskOwnerId, id);
  assert.equal(context.version, 8); assert.equal(context.tasks.length, 8); assert.equal(context.referencesCurrent, true);
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: privacyTask.id } })).status, 'completed', 'restart preserves earlier submitted provenance');
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: biasTask.id } })).status, 'cancelled');
  const owners: Record<RiskDimension, string> = { dim_privacy: fixture.privacyId, dim_bias: fixture.riskOwnerId, dim_safety: fixture.riskOwnerId,
    dim_transparency: model.id, dim_security: fixture.securityId, dim_operational: mlops.id, dim_reputation: fixture.useCaseOwnerId, dim_data_quality: business.id };
  const modelRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_MODEL_OWNER' } });
  const scoped = await db.roleDataScope.create({ data: { roleId: modelRole.id, scopeType: 'org_unit', refId: 'excluded-test-org', includeDescendants: false } });
  await assert.rejects(service.context(model.id, id), /not found/);
  await db.roleDataScope.delete({ where: { id: scoped.id } });
  const modelTask = context.tasks.find(task => task.dimension === 'dim_transparency')!;
  await assert.rejects(service.contribute(technical.id, id, modelTask.id, { expectedVersion: 8, value: 2, justification: 'Permission without dimension role' }), /competent/);
  let version = 8;
  for (const task of context.tasks) {
    const value = ['dim_privacy', 'dim_security'].includes(task.dimension) ? 4 : 2;
    await service.contribute(owners[task.dimension as RiskDimension], id, task.id, { expectedVersion: version++, value, justification: `Documented ${task.dimension} impact assessment` }, '127.0.0.3');
  }
  assert.equal(version, 16); assert.equal((await service.context(fixture.riskOwnerId, id)).canComplete, true);
  const completion = { expectedVersion: version, likelihood: 2, justification: 'Indicative annual probability from incident and exposure review' };
  await assert.rejects(service.complete(model.id, id, completion), /Risk Owner/);
  await assert.rejects(failed.complete(fixture.riskOwnerId, id, completion), /Injected assessment audit failure/);
  assert.equal(await db.aiAssessmentRound.count({ where: { riskId: id } }), 0);
  assert.equal((await db.aiRisk.findUniqueOrThrow({ where: { id } })).version, version);
  const completions = await Promise.allSettled([service.complete(fixture.riskOwnerId, id, completion, '127.0.0.3'), service.complete(fixture.riskOwnerId, id, completion, '127.0.0.3')]);
  assert.equal(completions.filter(value => value.status === 'fulfilled').length, 1);
  const round = await db.aiAssessmentRound.findFirstOrThrow({ where: { riskId: id }, orderBy: { round: 'desc' } });
  const result = jsonRecord(round.result), inputs = jsonRecord(round.inputs);
  assert.equal(round.round, 1); assert.equal(result.score, 8); assert.equal(result.impactFinal, 4); assert.equal(result.impactTopDimension, 'dim_privacy');
  assert.equal(result.bandCode, 'HIGH'); assert.equal(result.severityCode, 'P2'); assert.equal(result.ethicsReviewRequired, true); assert.equal(result.adopted, false);
  assert.equal((inputs['dimensions'] as unknown[]).length, 8);
  assert.notEqual(jsonRecord(result.referenceVersions)['R_SCORE14'], oldScoreVersion);
  assert.equal((await db.workflowTask.findFirstOrThrow({ where: { caseId: preserved.workflowCaseId!, status: 'pending' } })).assigneeRoleCode, 'AI_GOVERNANCE_OFFICER');
  assert.equal(await db.workflowTask.count({ where: { caseId: preserved.workflowCaseId!, status: 'pending' } }), 1);
  await assert.rejects(db.aiAssessmentRound.update({ where: { id: round.id }, data: { result: {} } }));
  await assert.rejects(db.aiAssessmentRound.delete({ where: { id: round.id } }));
  const finalRisk = await db.aiRisk.findUniqueOrThrow({ where: { id } });
  assert.equal(finalRisk.riskRef, preserved.riskRef); assert.equal(JSON.stringify(finalRisk.intakeData), JSON.stringify(preserved.intakeData));
  assert.equal(JSON.stringify(finalRisk.handoffPayload), JSON.stringify(preserved.handoffPayload));
  assert.equal(await db.aiAssessmentRound.count({ where: { riskId: id, kind: 'residual' } }), 0);
  await assert.rejects(service.complete(fixture.riskOwnerId, id, { ...completion, expectedVersion: 17 }), /coordinator/);
  assert.equal((await service.context(fixture.auditorId, id)).rounds.length, 1);
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl(), jwt = app.get(JwtService), headers = { authorization: `Bearer ${jwt.sign({ sub: fixture.riskOwnerId, tokenVersion: 0, roles: ['system_admin'] })}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/api/ai/risks/${id}/assessment`)).status, 401);
    assert.equal((await fetch(`${base}/api/ai/risks/${id}/assessment`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/risks/${id}/assessment/complete`, { method: 'POST', headers,
      body: JSON.stringify({ ...completion, expectedVersion: 17, score: 16 }) })).status, 400);
    assert.equal((await fetch(`${base}/api/ai/risks/${id}/assessment/tasks/${modelTask.id}`, { method: 'POST', headers,
      body: JSON.stringify({ expectedVersion: 17, value: 4, justification: 'Injected score', assessedBy: model.id }) })).status, 400);
  } finally { await app.close(); }
  console.log('Phase 3B integration passed: governed role-specific impact tasks, own/scoped queues, scoring/restart provenance, stale/computed-input/role blocks, audit rollback, exactly-one claims/final round, immutable inputs/results, no residual fabrication and HTTP authorization.');
}
