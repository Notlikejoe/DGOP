import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiIntakeService } from '../src/ai-governance/ai-intake.service';
import { AiClassificationService } from '../src/ai-governance/ai-classification.service';
import { AI_CLASSIFICATION_CRITERIA } from '../src/ai-governance/ai-governance.contracts';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';

export async function testPhase2A(db: PrismaClient) {
  const prisma = db as PrismaService;
  const audit = new AuditService(prisma);
  const authorization = new AiAuthorizationService(prisma, audit);
  const service = new AiIntakeService(prisma, authorization, new AiIdentifiersService(), audit);
  const classification = new AiClassificationService(prisma, authorization, audit);

  async function createActor(label: string, roleCode: string) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await db.user.create({
      data: {
        email: `${label}@phase2a.test`, displayName: label, passwordHash: 'not-a-login',
        userRoles: { create: { roleId: role.id } },
      },
    });
    const person = await db.person.create({
      data: { fullNameEn: label, fullNameAr: label, email: `${label}-person@phase2a.test`, userId: user.id },
    });
    return { ...user, person };
  }

  const requester = await createActor('intake-requester', 'business_steward');
  const owner = await createActor('intake-owner', 'AI_USECASE_OWNER');
  const dataOwner = await createActor('intake-data-owner', 'data_owner');
  const sponsor = await createActor('intake-sponsor', 'AI_EXECUTIVE_TEAM');
  const triageReviewer = await createActor('intake-triage', 'AI_WORKING_GROUP');

  const lists: Record<string, Array<[string, string, string]>> = {
    L_STREAMS: [['STREAM_1', 'Stream 1', 'المسار الأول']],
    L_PROGRAMS: [['PROGRAM_1', 'Program 1', 'البرنامج الأول']],
    L_HUMAN: [['HUMAN_APPROVAL', 'Human approval', 'اعتماد بشري']],
    L_STAGE: [['PILOT', 'Pilot', 'تجربة محدودة']],
    L_MODEL: [['INTERNAL', 'Internal', 'تطوير داخلي']],
    L_AVAIL: [['AVAILABLE', 'Available', 'متاحة']],
    R_YN: [['YES', 'Yes', 'نعم'], ['NO', 'No', 'لا']],
    L_CLASS: [['RESTRICTED', 'Restricted', 'مقيدة'], ['UNKNOWN', 'Unknown', 'غير معروف']],
    L_BUDGET: [['FUNDED', 'Funded', 'معتمدة']],
  };
  for (const [code, values] of Object.entries(lists)) {
    await db.governedReferenceList.create({
      data: { code, nameEn: code, nameAr: code, ownerRoleCode: 'AI_GOVERNANCE_OFFICER' },
    });
    const version = await db.governedReferenceVersion.create({ data: { listCode: code, version: 1, createdBy: 'phase2a-fixture' } });
    await db.governedReferenceValue.createMany({
      data: values.map(([valueCode, labelEn, labelAr], sortOrder) => ({ versionId: version.id, code: valueCode, labelEn, labelAr, sortOrder })),
    });
    await db.governedReferenceVersion.update({
      where: { id: version.id },
      data: { state: 'published', effectiveFrom: new Date('2020-01-01'), approvedBy: 'phase2a-fixture', approvedAt: new Date('2020-01-01') },
    });
  }

  await db.governedReferenceList.upsert({
    where: { code: 'R_SDAIA_SCORE' },
    create: { code: 'R_SDAIA_SCORE', nameEn: 'SDAIA score', nameAr: 'درجة سدايا', ownerRoleCode: 'AI_GOVERNANCE_OFFICER' },
    update: {},
  });
  await db.governedReferenceVersion.updateMany({
    where: { listCode: 'R_SDAIA_SCORE', state: 'published' },
    data: { state: 'retired', effectiveTo: new Date('2099-01-01') },
  });
  const scoreVersionNumber = (await db.governedReferenceVersion.aggregate({ where: { listCode: 'R_SDAIA_SCORE' }, _max: { version: true } }))._max.version ?? 0;
  const scoreVersion = await db.governedReferenceVersion.create({ data: { listCode: 'R_SDAIA_SCORE', version: scoreVersionNumber + 1, createdBy: 'phase2a-fixture' } });
  await db.governedReferenceValue.createMany({
    data: [1, 2, 3, 4, 5].map(score => ({
      versionId: scoreVersion.id,
      code: `SCORE_${score}`,
      labelEn: `Score ${score}`,
      labelAr: `الدرجة ${score}`,
      sortOrder: score,
      metadata: {
        score,
        anchors: Object.fromEntries(AI_CLASSIFICATION_CRITERIA.map(criterion => [criterion, {
          labelEn: `${criterion} anchor ${score}`,
          labelAr: `${criterion} ${score}`,
        }])),
      },
    })),
  });
  await db.governedReferenceVersion.update({
    where: { id: scoreVersion.id },
    data: { state: 'published', effectiveFrom: new Date('2020-01-01'), approvedBy: 'phase2a-fixture', approvedAt: new Date('2020-01-01') },
  });

  await db.governedReferenceList.upsert({
    where: { code: 'R_SDAIA_TIER' },
    create: { code: 'R_SDAIA_TIER', nameEn: 'SDAIA tier', nameAr: 'تصنيف سدايا', ownerRoleCode: 'AI_GOVERNANCE_OFFICER' },
    update: {},
  });
  await db.governedReferenceVersion.updateMany({
    where: { listCode: 'R_SDAIA_TIER', state: 'published' },
    data: { state: 'retired', effectiveTo: new Date('2099-01-01') },
  });
  const tierVersionNumber = (await db.governedReferenceVersion.aggregate({ where: { listCode: 'R_SDAIA_TIER' }, _max: { version: true } }))._max.version ?? 0;
  const tierVersion = await db.governedReferenceVersion.create({ data: { listCode: 'R_SDAIA_TIER', version: tierVersionNumber + 1, createdBy: 'phase2a-fixture' } });
  await db.governedReferenceValue.createMany({
    data: [
      { code: 'MINIMAL', labelEn: 'Minimal or none', labelAr: 'مخاطر قليلة أو معدومة', metadata: { automatic: true, minScore: 1, maxScore: 2 } },
      { code: 'LIMITED', labelEn: 'Limited', labelAr: 'مخاطر محدودة', metadata: { automatic: true, minScore: 3, maxScore: 3 } },
      { code: 'HIGH', labelEn: 'High', labelAr: 'مخاطر عالية', metadata: { automatic: true, minScore: 4, maxScore: 5 } },
      { code: 'UNACCEPTABLE', labelEn: 'Unacceptable', labelAr: 'مخاطر غير مقبولة', metadata: { automatic: false } },
    ].map((value, sortOrder) => ({ ...value, sortOrder, versionId: tierVersion.id })),
  });
  await db.governedReferenceVersion.update({
    where: { id: tierVersion.id },
    data: { state: 'published', effectiveFrom: new Date('2020-01-01'), approvedBy: 'phase2a-fixture', approvedAt: new Date('2020-01-01') },
  });

  const draft = await service.createDraft(requester.id, { usecase_name: 'Assisted matching', proposed_owner: owner.id });
  assert.equal(draft.version, 1);
  assert.equal(draft.workflowCaseId, null);
  assert.equal(draft.intakeRevisions[0].revision, 1);

  const complete = {
    request_date: '2026-09-10', requester: requester.id, usecase_name: 'Assisted matching', proposed_owner: owner.id,
    strategic_streams: ['STREAM_1'], values_alignment: 'Supports equitable access', program_platform: 'PROGRAM_1',
    problem_desc: 'Manual matching takes too long', beneficiary_group: 'Job seekers', current_state: 'Manual review',
    objective_value: 'Reduce review time', success_kpi: 'Minutes per match', kpi_baseline: '30', kpi_target: '10',
    simpler_alternatives: { answer: true, justification: 'Rules were insufficient' },
    existing_solutions_check: { answer: true, details: 'Checked Jadarat and Taqat' },
    human_role: 'HUMAN_APPROVAL', target_stage: 'PILOT', execution_model: 'INTERNAL', data_source: 'Matching records',
    data_owner: dataOwner.id, data_availability: 'AVAILABLE', personal_data_flag: 'YES', data_classification: 'RESTRICTED',
    budget_band: 'FUNDED', executive_sponsor: sponsor.id,
    constraints_dependencies: { text: '', none: true }, attachments: [],
  };
  const revised = await service.updateDraft(requester.id, draft.id, 1, complete);
  assert.equal(revised.version, 2);
  assert.equal(revised.conditions.personalDataInvolved, true);
  await assert.rejects(service.updateDraft(requester.id, draft.id, 1, { problem_desc: 'stale' }));

  const submitted = await service.submit(requester.id, draft.id, 2);
  assert.match(submitted.workflowCase!.code, /^AIUC-\d{4}-\d{6}$/u);
  assert.equal(submitted.workflowCase!.status, 'submitted');
  assert.equal(submitted.useCaseRef, null, 'AI-### must wait for triage acceptance');
  assert.equal(submitted.version, 3);
  assert.equal(submitted.intakeRevisions[0].revision, 3);
  assert.ok(submitted.intakeRevisions[0].submittedAt);
  assert.equal(await db.aiIntakeRevision.count({ where: { useCaseId: draft.id } }), 3);
  const initialTriageTask = await db.workflowTask.findFirstOrThrow({
    where: { caseId: submitted.workflowCase!.id, status: 'pending', assigneeRoleCode: 'AI_WORKING_GROUP' },
  });
  assert.equal(initialTriageTask.type, 'review');
  assert.ok(initialTriageTask.dueDate);
  await assert.rejects(service.updateDraft(requester.id, draft.id, 3, { problem_desc: 'too late' }));
  await assert.rejects(service.submit(requester.id, draft.id, 3));

  assert.equal((await service.triageQueue(triageReviewer.id)).length, 1);
  await assert.rejects(service.triage(triageReviewer.id, draft.id, 3, 'return'));
  const returned = await service.triage(triageReviewer.id, draft.id, 3, 'return', 'Clarify the current-state baseline');
  assert.equal(returned.workflowCase!.status, 'awaiting_information');
  assert.equal(returned.version, 4);
  assert.equal(returned.useCaseRef, null);
  const clarified = await service.updateDraft(requester.id, draft.id, 4, { current_state: 'Manual review measured over the last quarter' });
  assert.equal(clarified.version, 5);
  assert.equal(clarified.intakeRevisions[0].revision, 4);
  const resubmitted = await service.resubmit(requester.id, draft.id, 5);
  assert.equal(resubmitted.workflowCase!.status, 'submitted');
  assert.equal(resubmitted.version, 6);
  assert.equal(resubmitted.intakeRevisions[0].revision, 5);
  const accepted = await service.triage(triageReviewer.id, draft.id, 6, 'accept');
  assert.equal(accepted.workflowCase!.status, 'under_review');
  assert.match(accepted.useCaseRef!, /^AI-\d{3,}$/u);
  assert.equal(accepted.version, 7);
  assert.equal(await db.workflowTask.count({ where: { caseId: accepted.workflowCase!.id, status: 'pending', title: { contains: 'classification' } } }), 1);
  const classificationConfig = await classification.configuration(triageReviewer.id);
  assert.equal(classificationConfig.ready, true);
  assert.equal((await classification.queue(triageReviewer.id)).length, 1);
  await assert.rejects(classification.assess(triageReviewer.id, draft.id, 7, {
    kind: 'classification', scores: Array(5).fill({ value: 3, justification: 'Evidence reviewed' }),
  }));
  const assessed = await classification.assess(triageReviewer.id, draft.id, 7, {
    kind: 'classification',
    scores: [1, 2, 3, 4, 5, 4].map(value => ({ value, justification: `Criterion evidence supports score ${value}` })),
  });
  assert.equal(assessed.version, 8);
  assert.equal((assessed.assessments[0].result as { scoreMax: number }).scoreMax, 5);
  assert.equal((assessed.assessments[0].result as { proposedTierCode: string }).proposedTierCode, 'HIGH');
  assert.equal(await db.aiAssessmentRound.count({ where: { useCaseId: draft.id, kind: 'classification' } }), 1);
  assert.equal(await db.workflowTask.count({ where: { caseId: accepted.workflowCase!.id, status: 'pending', assigneeRoleCode: 'AI_GOVERNANCE_OFFICER' } }), 1);
  assert.equal((await classification.queue(triageReviewer.id)).length, 0);
  await assert.rejects(classification.assess(triageReviewer.id, draft.id, 8, {
    kind: 'classification', scores: Array(6).fill({ value: 3, justification: 'Cannot assess twice' }),
  }));
  await assert.rejects(service.updateDraft(requester.id, draft.id, 7, { problem_desc: 'too late again' }));
  assert.equal((await service.triageQueue(triageReviewer.id)).length, 0);
  assert.equal(await db.auditLog.count({ where: { entityId: draft.id, action: { startsWith: 'aiuc.intake.' } } }), 5);
  assert.equal((await service.listOwn(requester.id)).length, 1);
  assert.equal((await service.getOwn(requester.id, draft.id)).id, draft.id);

  const incomplete = await service.createDraft(requester.id, { usecase_name: 'Incomplete request', proposed_owner: owner.id });
  await assert.rejects(service.submit(requester.id, incomplete.id, 1));
  assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: incomplete.id } })).workflowCaseId, null);

  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const jwt = app.get(JwtService);
    const headers = {
      authorization: `Bearer ${jwt.sign({ sub: requester.id, tokenVersion: 0, roles: ['business_steward'] })}`,
      'content-type': 'application/json',
    };
    const reviewerHeaders = {
      authorization: `Bearer ${jwt.sign({ sub: triageReviewer.id, tokenVersion: 0, roles: ['AI_WORKING_GROUP'] })}`,
      'content-type': 'application/json',
    };
    assert.equal((await fetch(`${base}/api/ai/use-cases`)).status, 401);
    const httpCreate = await fetch(`${base}/api/ai/use-cases`, {
      method: 'POST', headers,
      body: JSON.stringify({ payload: { usecase_name: 'HTTP draft', proposed_owner: owner.id } }),
    });
    assert.equal(httpCreate.status, 201);
    assert.equal((await fetch(`${base}/api/ai/use-cases`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/triage`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/configuration`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/configuration`, { headers: reviewerHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/queue`, { headers: reviewerHeaders })).status, 200);
    const lookups = await fetch(`${base}/api/ai/use-cases/lookups`, { headers });
    assert.equal(lookups.status, 200);
    assert.equal((await lookups.json() as { ready: boolean }).ready, true);
    const rejected = await fetch(`${base}/api/ai/use-cases`, {
      method: 'POST', headers,
      body: JSON.stringify({ payload: {}, injectedField: true }),
    });
    assert.equal(rejected.status, 400);
  } finally {
    await app.close();
  }

  console.log('Phase 2 integration passed: intake revisions, five-day triage, return/resubmit, AI numbering, governed six-criterion max-rule classification, immutable rounds, task handoff and HTTP authorization.');
}
