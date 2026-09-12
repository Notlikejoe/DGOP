import assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { ScopeService } from '../src/access/scope.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiRiskAssessmentService } from '../src/ai-governance/ai-risk-assessment.service';
import { AiRiskAdoptionService } from '../src/ai-governance/ai-risk-adoption.service';
import { AIRS_STAGE, AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { computeInherentRisk, jsonRecord, RiskDimension, RiskScoringConfiguration } from '../src/ai-governance/ai-risk-scoring';
import { testPhase3D } from './ai-phase3d.integration';

export async function testPhase3C(db: PrismaClient, f: { riskId: string; riskOwnerId: string; useCaseOwnerId: string;
  otherRiskOwnerId: string; privacyId: string; securityId: string; auditorId: string; officerId: string }) {
  const prisma = db as PrismaService, audit = new AuditService(prisma), auth = new AiAuthorizationService(prisma, audit), routing = new AiWorkflowRoutingService(prisma);
  const risks = new AiRiskIntakeService(prisma, auth, new ScopeService(prisma), routing, new AiIdentifiersService(), audit);
  const assessment = new AiRiskAssessmentService(prisma, auth, risks, routing, audit), service = new AiRiskAdoptionService(prisma, auth, risks, routing, audit);
  const failed = new AiRiskAdoptionService(prisma, auth, risks, routing, { logRequired: async () => { throw new Error('Injected adoption audit failure'); } } as unknown as AuditService);
  const original = await db.aiRisk.findUniqueOrThrow({ where: { id: f.riskId }, include: { useCase: true } });
  const firstRound = await db.aiAssessmentRound.findFirstOrThrow({ where: { riskId: f.riskId, kind: 'inherent' } });
  const ethicsRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_ETHICS_COMMITTEE' } });
  const officerRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_GOVERNANCE_OFFICER' } });
  const reviewer = await db.user.create({ data: { email: 'independent-risk-review@phase3c.test', displayName: 'Independent risk reviewer', passwordHash: 'not-a-login', userRoles: { create: { roleId: ethicsRole.id } } } });
  const evidence = await db.ndiEvidence.findFirstOrThrow({ where: { deletedAt: null } });
  const decision = (expectedVersion: number, choice: 'approve' | 'return' = 'approve') => ({ expectedVersion, decision: choice, justification: 'Minutes and assessment evidence reviewed independently', evidenceIds: [evidence.id] });
  let context = await service.context(f.officerId, f.riskId), version = context.version;
  assert.equal(version, 17); assert.equal(context.ethicsRequired, true);
  const adoptionTask = context.tasks.find(task => task.kind === 'adoption')!;
  assert.equal(adoptionTask.canApprove, false); assert.equal(adoptionTask.canReturn, true);
  await assert.rejects(service.review(f.officerId, f.riskId, adoptionTask.id, decision(version)), /Ethics approval/);
  // Simulate an untouched pending Phase 3B case: explicit preparation is required, never a GET side effect.
  await db.workflowTask.delete({ where: { id: context.tasks.find(task => task.kind === 'ethics')!.id } });
  assert.equal((await service.context(f.officerId, f.riskId)).canPrepare, true);
  await assert.rejects(failed.prepare(f.officerId, f.riskId, version), /Injected adoption audit failure/);
  assert.equal(await db.workflowTask.count({ where: { caseId: original.workflowCaseId!, status: 'pending' } }), 1);
  const prepared = await Promise.allSettled([service.prepare(f.officerId, f.riskId, version), service.prepare(f.officerId, f.riskId, version)]);
  assert.equal(prepared.filter(value => value.status === 'fulfilled').length, 1); version++;
  context = await service.context(reviewer.id, f.riskId);
  const ethicsTask = context.tasks.find(task => task.kind === 'ethics')!;
  assert.equal(ethicsTask.canApprove, true);
  const excluded = await db.roleDataScope.create({ data: { roleId: ethicsRole.id, scopeType: 'org_unit', refId: 'excluded-risk-review-org', includeDescendants: false } });
  await assert.rejects(service.context(reviewer.id, f.riskId), /not found/);
  await db.roleDataScope.delete({ where: { id: excluded.id } });
  for (const ownerId of [f.riskOwnerId, f.useCaseOwnerId]) {
    const priorMembership = await db.userRole.findUnique({ where: { userId_roleId: { userId: ownerId, roleId: ethicsRole.id } } });
    const membership = await db.userRole.upsert({ where: { userId_roleId: { userId: ownerId, roleId: ethicsRole.id } }, create: { userId: ownerId, roleId: ethicsRole.id }, update: {} });
    assert.equal((await service.context(ownerId, f.riskId)).recused, true);
    await assert.rejects(service.review(ownerId, f.riskId, ethicsTask.id, decision(version)), /GEN-29/);
    assert.ok(await db.auditLog.findFirst({ where: { actor: ownerId, action: 'ai.sod.blocked', metadata: { path: ['recusal'], equals: true } } }));
    if (!priorMembership) await db.userRole.delete({ where: { userId_roleId: { userId: membership.userId, roleId: membership.roleId } } });
  }
  const ownerOfficer = await db.userRole.create({ data: { userId: f.riskOwnerId, roleId: officerRole.id } });
  await assert.rejects(service.review(f.riskOwnerId, f.riskId, adoptionTask.id, decision(version)), /WF-05/);
  await db.userRole.delete({ where: { userId_roleId: { userId: ownerOfficer.userId, roleId: ownerOfficer.roleId } } });
  const auditorCommittee = await db.userRole.create({ data: { userId: f.auditorId, roleId: ethicsRole.id } });
  await assert.rejects(service.review(f.auditorId, f.riskId, ethicsTask.id, decision(version)), /GEN-30/);
  await db.userRole.delete({ where: { userId_roleId: { userId: auditorCommittee.userId, roleId: auditorCommittee.roleId } } });
  await assert.rejects(service.review(f.officerId, f.riskId, ethicsTask.id, decision(version)), /competent role/);
  await assert.rejects(service.review(reviewer.id, f.riskId, ethicsTask.id, { ...decision(version), justification: ' ' }), /justification/);
  await assert.rejects(service.review(reviewer.id, f.riskId, ethicsTask.id, { ...decision(version), evidenceIds: [] }), /evidence/);
  await assert.rejects(service.review(reviewer.id, f.riskId, ethicsTask.id, { ...decision(version), evidenceIds: ['00000000-0000-4000-8000-000000000001'] }), /must exist/);
  await assert.rejects(failed.review(reviewer.id, f.riskId, ethicsTask.id, decision(version)), /Injected adoption audit failure/);
  assert.equal(await db.aiRiskAssessmentDecision.count({ where: { assessmentId: firstRound.id } }), 0);
  await service.review(reviewer.id, f.riskId, ethicsTask.id, decision(version++), '127.0.0.4');
  assert.equal((await service.context(f.officerId, f.riskId)).tasks.find(task => task.kind === 'adoption')!.canApprove, true);
  await assert.rejects(failed.review(f.officerId, f.riskId, adoptionTask.id, decision(version, 'return')), /Injected adoption audit failure/);
  await service.review(f.officerId, f.riskId, adoptionTask.id, decision(version++, 'return'));
  assert.equal((await assessment.context(f.riskOwnerId, f.riskId)).canStart, true, 'new coordinator has no inherited configuration from a prior round');
  assert.equal((await service.context(f.officerId, f.riskId)).tasks.length, 0);
  const historical = await db.aiRiskAssessmentDecision.findMany({ where: { assessmentId: firstRound.id } });
  assert.equal(historical.length, 2);
  await assert.rejects(db.aiRiskAssessmentDecision.update({ where: { id: historical[0].id }, data: { justification: 'Changed' } }));
  await assert.rejects(db.aiRiskAssessmentDecision.delete({ where: { id: historical[0].id } }));
  assert.equal(JSON.stringify((await db.aiAssessmentRound.findUniqueOrThrow({ where: { id: firstRound.id } })).result), JSON.stringify(firstRound.result));
  const actors = async (role: string) => (await db.user.findFirstOrThrow({ where: { email: `${role}@phase3b.test` } })).id;
  const owners: Record<RiskDimension, string> = { dim_privacy: f.privacyId, dim_bias: f.riskOwnerId, dim_safety: f.riskOwnerId,
    dim_transparency: await actors('AI_MODEL_OWNER'), dim_security: f.securityId, dim_operational: await actors('AI_MLOPS_LEAD'), dim_reputation: f.useCaseOwnerId, dim_data_quality: await actors('business_steward') };
  async function reassess(value: number, likelihood: number) {
    await assessment.start(f.riskOwnerId, f.riskId, version++);
    const context = await assessment.context(f.riskOwnerId, f.riskId);
    for (const task of context.tasks) await assessment.contribute(owners[task.dimension as RiskDimension], f.riskId, task.id,
      { expectedVersion: version++, value, justification: `Fresh ${task.dimension} assessment after return` });
    await assessment.complete(f.riskOwnerId, f.riskId, { expectedVersion: version++, likelihood, justification: 'Fresh likelihood evidence after return' });
  }
  await reassess(4, 2);
  context = await service.context(f.officerId, f.riskId);
  assert.equal(context.round, 2); assert.equal(context.ethicsApproved, false, 'old Ethics approval cannot authorize a new assessment round');
  const secondEthics = context.tasks.find(task => task.kind === 'ethics')!;
  await service.review(reviewer.id, f.riskId, secondEthics.id, decision(version++, 'return'));
  assert.equal((await assessment.context(f.riskOwnerId, f.riskId)).canStart, true);
  await reassess(4, 2);
  context = await service.context(f.officerId, f.riskId);
  assert.equal(context.ethicsRequired, true);
  await service.review(reviewer.id, f.riskId, context.tasks.find(task => task.kind === 'ethics')!.id, decision(version++));
  const finalAdoption = context.tasks.find(task => task.kind === 'adoption')!;
  await assert.rejects(failed.review(f.officerId, f.riskId, finalAdoption.id, decision(version)), /Injected adoption audit failure/);
  const adopted = await Promise.allSettled([service.review(f.officerId, f.riskId, finalAdoption.id, decision(version)), service.review(f.officerId, f.riskId, finalAdoption.id, decision(version))]);
  assert.equal(adopted.filter(value => value.status === 'fulfilled').length, 1); version++;
  assert.equal((await service.context(f.officerId, f.riskId)).tasks.length, 0);
  assert.equal(await db.workflowTask.count({ where: { caseId: original.workflowCaseId!, status: 'pending', templateStage: { code: AIRS_STAGE.response } } }), 1);
  assert.equal((await db.aiRisk.findUniqueOrThrow({ where: { id: f.riskId } })).version, version);
  assert.equal(JSON.stringify((await db.aiRisk.findUniqueOrThrow({ where: { id: f.riskId } })).handoffPayload), JSON.stringify(original.handoffPayload));
  assert.equal(await db.aiAssessmentRound.count({ where: { riskId: f.riskId, kind: 'residual' } }), 0);
  await assert.rejects(service.review(f.officerId, f.riskId, finalAdoption.id, decision(version)), /not awaiting/);

  // Synthetic source cases exercise Low/Medium, Critical and High-source/Low-score gating.
  const config = jsonRecord(firstRound.inputs)['configuration'] as RiskScoringConfiguration;
  for (const [index, likelihood, impact, band] of [[0,1,1,'LOW'],[1,2,2,'MEDIUM'],[2,4,4,'CRITICAL'],[3,1,1,'LOW'],[4,2,2,'MEDIUM']] as const) {
    const needsEthics = band === 'CRITICAL' || index === 3;
    const uc = await db.aiUseCase.create({ data: { name: `Synthetic ${band} source`, createdBy: f.useCaseOwnerId, requesterUserId: f.useCaseOwnerId, ownerPersonId: original.useCase.ownerPersonId,
      assetId: original.useCase.assetId, organizationUnitId: original.useCase.organizationUnitId } });
    const c = await db.workflowCase.create({ data: { code: `AIRS-TEST-3C-${index}`, title: `Synthetic ${band}`, type: 'AIRS', status: 'under_review',
      createdBy: f.riskOwnerId, templateId: (await routing.binding(prisma, AIRS_TEMPLATE_CODE)).id } });
    const risk = await db.aiRisk.create({ data: { useCaseId: uc.id, workflowCaseId: c.id, ownerPersonId: original.ownerPersonId,
      riskRef: `AIR-${900 + index}`, title: 'Synthetic risk', cause: 'Cause', event: 'Event', effect: 'Effect', createdBy: f.riskOwnerId,
      ...(index === 3 ? { handoffPayload: { approvedTierCode: 'HIGH' } } : {}), intakeData: original.intakeData as Prisma.InputJsonObject } });
    const dims = (jsonRecord(firstRound.inputs)['dimensions'] as Array<{ dimension: RiskDimension; value: number; justification: string }>).map(dim => ({ ...dim, value: impact }));
    const computed = computeInherentRisk(likelihood, dims, config);
    assert.equal(computed.bandCode, band);
    const round = await db.aiAssessmentRound.create({ data: { riskId: risk.id, useCaseId: uc.id, kind: 'inherent', round: 1, createdBy: f.riskOwnerId,
      engineVersion: 'airs-inherent-max8-v1', ruleReferenceVersionId: config.referenceVersions.R_LEVEL,
      inputs: { ...jsonRecord(firstRound.inputs), likelihood: { value: likelihood, justification: 'Synthetic justified likelihood' }, dimensions: dims } as Prisma.InputJsonObject,
      result: { ...computed, ethicsReviewRequired: band === 'CRITICAL', adopted: false } as Prisma.InputJsonObject } });
    await routing.openRiskAssessmentGate(prisma, c.id, round.id, needsEthics, risk.riskRef!, new Date());
    let gate = await service.context(f.officerId, risk.id), task = gate.tasks.find(task => task.kind === 'adoption')!;
    assert.equal(task.canApprove, !needsEthics);
    if (needsEthics) {
      await assert.rejects(service.review(f.officerId, risk.id, task.id, decision(1)), /Ethics approval/);
      await service.review(reviewer.id, risk.id, gate.tasks.find(task => task.kind === 'ethics')!.id, decision(1));
      gate = await service.context(f.officerId, risk.id);
    }
    if (index === 4) {
      await db.governedReferenceVersion.update({ where: { id: config.referenceVersions.R_SCORE14 }, data: { state: 'retired', effectiveTo: new Date() } });
      gate = await service.context(f.officerId, risk.id);
      assert.equal(gate.referencesCurrent, false); assert.equal(gate.tasks[0].canApprove, false); assert.equal(gate.tasks[0].canReturn, true);
      await assert.rejects(service.review(f.officerId, risk.id, task.id, decision(1)), /references changed/);
      await service.review(f.officerId, risk.id, task.id, decision(1, 'return'));
      continue;
    }
    await service.review(f.officerId, risk.id, task.id, decision(gate.version));
    assert.equal((await db.workflowCase.findUniqueOrThrow({ where: { id: c.id } })).status, 'under_review', 'assessment adoption is not risk acceptance');
  }
  const template = await db.workflowTemplate.findUniqueOrThrow({ where: { code: AIRS_TEMPLATE_CODE } });
  await db.workflowTemplate.update({ where: { id: template.id }, data: { designerJson: { ...jsonRecord(template.designerJson), seedRevision: 'airs-lifecycle-phase3b-1' } } });
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    assert.equal(jsonRecord((await db.workflowTemplate.findUniqueOrThrow({ where: { id: template.id } })).designerJson)['seedRevision'], 'airs-lifecycle-phase3e-1');
    const base = await app.getUrl(), jwt = app.get(JwtService), headers = { authorization: `Bearer ${jwt.sign({ sub: f.officerId, tokenVersion: 0, roles: ['system_admin'] })}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/assessment/adoption`)).status, 401);
    assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/assessment/adoption`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/assessment/reviews/${finalAdoption.id}`, { method: 'POST', headers,
      body: JSON.stringify({ ...decision(version), score: 16, recused: false, actorId: reviewer.id }) })).status, 400);
  } finally { await app.close(); }
  await testPhase3D(db, f);
  console.log('Phase 3C passed: independent Ethics/owner recusal, live role/scope/Auditor blocks, evidence, immutable decisions, audit rollback, legacy preparation, concurrent adoption, fresh rounds without carried approvals, all-band gating and managed-seed/HTTP checks.');
}
