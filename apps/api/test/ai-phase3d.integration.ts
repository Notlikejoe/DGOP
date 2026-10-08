import assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { ScopeService } from '../src/access/scope.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiRiskResponseService } from '../src/ai-governance/ai-risk-response.service';
import { RESPONSE_STRATEGIES } from '../src/ai-governance/ai-risk-response.dto';
import { AIRS_STAGE, AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { jsonRecord } from '../src/ai-governance/ai-risk-scoring';
import { testPhase3E } from './ai-phase3e.integration';

export async function testPhase3D(db: PrismaClient, f: { riskId: string; riskOwnerId: string; useCaseOwnerId: string;
  otherRiskOwnerId: string; privacyId: string; securityId: string; auditorId: string; officerId: string }) {
  const prisma = db as PrismaService, audit = new AuditService(prisma), auth = new AiAuthorizationService(prisma, audit), routing = new AiWorkflowRoutingService(prisma);
  const risks = new AiRiskIntakeService(prisma, auth, new ScopeService(prisma), routing, new AiIdentifiersService(), audit);
  const service = new AiRiskResponseService(prisma, auth, risks, routing, audit);
  const failed = new AiRiskResponseService(prisma, auth, risks, routing, { logRequired: async () => { throw new Error('Injected response audit failure'); } } as unknown as AuditService);
  const original = await db.aiRisk.findUniqueOrThrow({ where: { id: f.riskId } });
  const evidence = await db.ndiEvidence.findFirstOrThrow({ where: { deletedAt: null } });
  const proposal = (expectedVersion: number, strategyCode: typeof RESPONSE_STRATEGIES[number] = 'MITIGATE', offshoreProcessing = false) => ({
    expectedVersion, strategyCode, offshoreProcessing, justification: 'Evidence-backed strategy proposed by the accountable Risk Owner',
    evidenceIds: [evidence.id], ...(strategyCode === 'TRANSFER' ? { provider: 'Synthetic provider', contractEvidenceIds: [evidence.id] } : {}) });
  const decision = (expectedVersion: number, choice: 'approve' | 'return' = 'approve') => ({ expectedVersion, decision: choice,
    justification: 'Independent strategy and consultation evidence review', evidenceIds: [evidence.id] });
  async function publish() {
    await db.governedReferenceList.upsert({ where: { code: 'R_STRATEGY' }, create: { code: 'R_STRATEGY', nameEn: 'Strategies', nameAr: 'الاستراتيجيات', ownerRoleCode: 'AI_GOVERNANCE_OFFICER' }, update: {} });
    await db.governedReferenceVersion.updateMany({ where: { listCode: 'R_STRATEGY', state: 'published' }, data: { state: 'retired', effectiveTo: new Date() } });
    const prior = await db.governedReferenceVersion.aggregate({ where: { listCode: 'R_STRATEGY' }, _max: { version: true } });
    const row = await db.governedReferenceVersion.create({ data: { listCode: 'R_STRATEGY', version: (prior._max.version ?? 0) + 1, createdBy: 'phase3d-synthetic-fixture',
      values: { create: RESPONSE_STRATEGIES.map((code, index) => ({ code, labelEn: code, labelAr: code, sortOrder: index + 1 })) } } });
    await db.governedReferenceVersion.update({ where: { id: row.id }, data: { state: 'published', effectiveFrom: new Date('2020-01-01'), approvedAt: new Date('2020-01-01'), approvedBy: 'phase3d-synthetic-fixture' } });
    return row.id;
  }
  let context = await service.context(f.riskOwnerId, f.riskId), version = context.version;
  assert.equal(context.references.ready, false); assert.equal(context.awaitingProposal, true); assert.equal(context.canPropose, false);
  await assert.rejects(service.propose(f.riskOwnerId, f.riskId, proposal(version)), /R_STRATEGY/);
  const referenceId = await publish();
  // A pending Phase 3C case can be prepared explicitly; GET never writes tasks.
  const oldTask = await db.workflowTask.findFirstOrThrow({ where: { caseId: original.workflowCaseId!, status: 'pending', templateStage: { code: AIRS_STAGE.proposal } } });
  await db.workflowTask.delete({ where: { id: oldTask.id } });
  assert.equal((await service.context(f.riskOwnerId, f.riskId)).canPrepare, true);
  await assert.rejects(failed.prepare(f.riskOwnerId, f.riskId, version), /Injected response audit failure/);
  const prepared = await Promise.allSettled([service.prepare(f.riskOwnerId, f.riskId, version), service.prepare(f.riskOwnerId, f.riskId, version)]);
  assert.equal(prepared.filter(row => row.status === 'fulfilled').length, 1); version++;
  assert.equal(await db.workflowTask.count({ where: { caseId: original.workflowCaseId!, status: 'pending', templateStage: { code: AIRS_STAGE.proposal } } }), 1);
  await assert.rejects(service.propose(f.otherRiskOwnerId, f.riskId, proposal(version)));
  await assert.rejects(service.propose(f.riskOwnerId, f.riskId, proposal(version - 1)), /changed/);
  await assert.rejects(service.propose(f.riskOwnerId, f.riskId, { ...proposal(version), justification: ' ' }), /justification/);
  await assert.rejects(service.propose(f.riskOwnerId, f.riskId, { ...proposal(version), evidenceIds: ['00000000-0000-4000-8000-000000000001'] }), /must exist/);
  await assert.rejects(service.propose(f.riskOwnerId, f.riskId, { ...proposal(version, 'TRANSFER'), contractEvidenceIds: [] }), /provider and contract/);
  await assert.rejects(failed.propose(f.riskOwnerId, f.riskId, proposal(version)), /Injected response audit failure/);
  assert.equal(await db.aiRiskResponse.count({ where: { riskId: f.riskId } }), 0);
  const proposed = await Promise.allSettled([service.propose(f.riskOwnerId, f.riskId, proposal(version)), service.propose(f.riskOwnerId, f.riskId, proposal(version))]);
  assert.equal(proposed.filter(row => row.status === 'fulfilled').length, 1); version++;
  context = await service.context(f.officerId, f.riskId);
  assert.equal(context.response!.referenceVersionId, referenceId); assert.equal(context.tasks.length, 1);
  let officerTask = context.tasks.find(task => task.kind === 'officer')!;
  const officerRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_GOVERNANCE_OFFICER' } });
  await db.userRole.create({ data: { userId: f.riskOwnerId, roleId: officerRole.id } });
  await assert.rejects(service.decide(f.riskOwnerId, f.riskId, officerTask.id, decision(version)), /WF-05/);
  await db.userRole.delete({ where: { userId_roleId: { userId: f.riskOwnerId, roleId: officerRole.id } } });
  await assert.rejects(failed.decide(f.officerId, f.riskId, officerTask.id, decision(version, 'return')), /Injected response audit failure/);
  await service.decide(f.officerId, f.riskId, officerTask.id, decision(version++, 'return'));
  assert.equal((await service.context(f.riskOwnerId, f.riskId)).canPropose, true);
  await service.propose(f.riskOwnerId, f.riskId, proposal(version++, 'TRANSFER', true));
  context = await service.context(f.officerId, f.riskId); officerTask = context.tasks.find(task => task.kind === 'officer')!;
  assert.equal(context.consultationRequired, true); assert.equal(context.tasks.length, 3); assert.equal(officerTask.canApprove, false);
  await assert.rejects(service.decide(f.officerId, f.riskId, officerTask.id, decision(version)), /Both required/);
  let privacyTask = context.tasks.find(task => task.kind === 'privacy')!, securityTask = context.tasks.find(task => task.kind === 'security')!;
  await assert.rejects(service.decide(f.securityId, f.riskId, privacyTask.id, decision(version)), /configured response role/);
  const privacyRole = await db.role.findUniqueOrThrow({ where: { code: 'privacy_officer' } });
  const excluded = await db.roleDataScope.create({ data: { roleId: privacyRole.id, scopeType: 'org_unit', refId: 'excluded-response-org', includeDescendants: false } });
  await assert.rejects(service.context(f.privacyId, f.riskId), /not found/);
  await db.roleDataScope.delete({ where: { id: excluded.id } });
  await db.userRole.create({ data: { userId: f.auditorId, roleId: privacyRole.id } });
  const decisionsBeforeAuditor=await db.aiRiskResponseDecision.count();
  await assert.rejects(service.decide(f.auditorId, f.riskId, privacyTask.id, decision(version)), /explicit eligible role grant/);
  assert.equal(await db.aiRiskResponseDecision.count(),decisionsBeforeAuditor,'An Auditor with a real consultation role cannot record a business decision');
  assert.equal((await db.aiRisk.findUniqueOrThrow({where:{id:f.riskId}})).version,version);
  await db.userRole.delete({ where: { userId_roleId: { userId: f.auditorId, roleId: privacyRole.id } } });
  await assert.rejects(failed.decide(f.privacyId, f.riskId, privacyTask.id, decision(version)), /Injected response audit failure/);
  await service.decide(f.privacyId, f.riskId, privacyTask.id, decision(version++, 'return'));
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: securityTask.id } })).status, 'cancelled');
  await service.propose(f.riskOwnerId, f.riskId, proposal(version++, 'TRANSFER', true));
  context = await service.context(f.officerId, f.riskId); officerTask = context.tasks.find(task => task.kind === 'officer')!;
  assert.equal(context.consulted, false, 'consultations from a returned proposal never carry forward');
  privacyTask = context.tasks.find(task => task.kind === 'privacy')!; securityTask = context.tasks.find(task => task.kind === 'security')!;
  const claims = await Promise.allSettled([service.decide(f.privacyId, f.riskId, privacyTask.id, decision(version)), service.decide(f.privacyId, f.riskId, privacyTask.id, decision(version))]);
  assert.equal(claims.filter(row => row.status === 'fulfilled').length, 1); version++;
  await assert.rejects(service.decide(f.privacyId, f.riskId, privacyTask.id, decision(version)), /task not found/);
  await service.decide(f.securityId, f.riskId, securityTask.id, decision(version++));
  assert.equal((await service.context(f.officerId, f.riskId)).tasks[0].canApprove, true);
  await assert.rejects(failed.decide(f.officerId, f.riskId, officerTask.id, decision(version)), /Injected response audit failure/);
  const approved = await Promise.allSettled([service.decide(f.officerId, f.riskId, officerTask.id, decision(version)), service.decide(f.officerId, f.riskId, officerTask.id, decision(version))]);
  assert.equal(approved.filter(row => row.status === 'fulfilled').length, 1); version++;
  assert.equal((await service.context(f.officerId, f.riskId)).tasks.length, 0);
  const rootNext = await db.workflowTask.findFirstOrThrow({ where: { caseId: original.workflowCaseId!, status: 'pending', templateStage: { code: 'airs-treatment-plan' } } });
  assert.equal(jsonRecord(rootNext.formDataJson)['plannedActionsRequired'], 1); assert.equal(jsonRecord(rootNext.formDataJson)['completedActionsRequired'], true);
  const history = await db.aiRiskResponse.findMany({ where: { riskId: f.riskId }, include: { decisions: true } });
  assert.equal(history.length, 3);
  await assert.rejects(db.aiRiskResponse.update({ where: { id: history[0].id }, data: { strategyCode: 'AVOID' } }));
  await assert.rejects(db.aiRiskResponse.delete({ where: { id: history[0].id } }));
  await assert.rejects(db.aiRiskResponseDecision.update({ where: { id: history[0].decisions[0].id }, data: { justification: 'Changed' } }));
  await assert.rejects(db.aiRiskResponseDecision.delete({ where: { id: history[0].decisions[0].id } }));

  // All five choices route to protected prerequisites; none executes downstream governance early.
  for (const [ref, strategy, stage] of [['AIR-900','MITIGATE','airs-treatment-plan'],['AIR-901','ACCEPT','airs-acceptance-gate'],
    ['AIR-902','ESCALATE','airs-escalation-gate'],['AIR-903','AVOID','airs-avoidance-review']] as const) {
    const risk = await db.aiRisk.findUniqueOrThrow({ where: { riskRef: ref } });
    let v = (await service.context(f.riskOwnerId, risk.id)).version;
    if (ref === 'AIR-900') {
      await service.propose(f.riskOwnerId, risk.id, proposal(v++, 'TRANSFER'));
      let gate = await service.context(f.officerId, risk.id);
      assert.equal(gate.consultationRequired, false); assert.equal(gate.tasks.length, 1);
      await db.governedReferenceVersion.update({ where: { id: referenceId }, data: { state: 'retired', effectiveTo: new Date() } });
      gate = await service.context(f.officerId, risk.id);
      assert.equal(gate.tasks[0].canApprove, false); assert.equal(gate.tasks[0].canReturn, true);
      await assert.rejects(service.decide(f.officerId, risk.id, gate.tasks[0].id, decision(v)), /publication changed/);
      await service.decide(f.officerId, risk.id, gate.tasks[0].id, decision(v++, 'return'));
      await publish();
    }
    await service.propose(f.riskOwnerId, risk.id, proposal(v++, strategy));
    const gate = await service.context(f.officerId, risk.id), task = gate.tasks.find(task => task.kind === 'officer')!;
    const result = await service.decide(f.officerId, risk.id, task.id, decision(v));
    const next = await db.workflowTask.findUniqueOrThrow({ where: { id: result.nextTaskId! }, include: { templateStage: true } });
    assert.equal(next.templateStage!.code, stage); assert.equal(next.status, 'pending');
    const data = jsonRecord(next.formDataJson);
    assert.equal(data['prerequisitesPending'], true); assert.equal(data['riskAccepted'], false); assert.equal(data['planApproved'], false);
    assert.equal((await db.workflowCase.findUniqueOrThrow({ where: { id: risk.workflowCaseId! } })).status, 'under_review');
  }
  const final = await db.aiRisk.findUniqueOrThrow({ where: { id: f.riskId } });
  assert.equal(final.version, version); assert.equal(JSON.stringify(final.handoffPayload), JSON.stringify(original.handoffPayload));
  assert.equal(JSON.stringify(final.intakeData), JSON.stringify(original.intakeData));
  assert.equal(await db.aiAssessmentRound.count({ where: { riskId: f.riskId, kind: 'residual' } }), 0);
  assert.equal(await db.aiTreatmentAction.count({ where: { riskId: f.riskId } }), 0);
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl(), jwt = app.get(JwtService), headers = { authorization: `Bearer ${jwt.sign({ sub: f.riskOwnerId, tokenVersion: 0, roles: ['system_admin'] })}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/response`)).status, 401);
    assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/response`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/risks/${f.riskId}/response/propose`, { method: 'POST', headers,
      body: JSON.stringify({ ...proposal(version), score: 16, riskAccepted: true, actorId: f.officerId }) })).status, 400);
  } finally { await app.close(); }
  await testPhase3E(db,f);
  console.log('Phase 3D passed: version-pinned proposals, all five prerequisite routes, conditional transfer consultations, publication retirement, live scope/roles/SoD, immutable history, required-audit rollback, concurrent exactly-once actions and HTTP protection.');
}
