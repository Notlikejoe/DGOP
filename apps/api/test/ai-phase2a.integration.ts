import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiIntakeService } from '../src/ai-governance/ai-intake.service';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';

export async function testPhase2A(db: PrismaClient) {
  const prisma = db as PrismaService;
  const audit = new AuditService(prisma);
  const authorization = new AiAuthorizationService(prisma, audit);
  const service = new AiIntakeService(prisma, authorization, new AiIdentifiersService(), audit);

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
  await assert.rejects(service.updateDraft(requester.id, draft.id, 3, { problem_desc: 'too late' }));
  await assert.rejects(service.submit(requester.id, draft.id, 3));
  assert.equal(await db.auditLog.count({ where: { entityId: draft.id, action: { startsWith: 'aiuc.intake.' } } }), 3);
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
    assert.equal((await fetch(`${base}/api/ai/use-cases`)).status, 401);
    const httpCreate = await fetch(`${base}/api/ai/use-cases`, {
      method: 'POST', headers,
      body: JSON.stringify({ payload: { usecase_name: 'HTTP draft', proposed_owner: owner.id } }),
    });
    assert.equal(httpCreate.status, 201);
    assert.equal((await fetch(`${base}/api/ai/use-cases`, { headers })).status, 200);
    const rejected = await fetch(`${base}/api/ai/use-cases`, {
      method: 'POST', headers,
      body: JSON.stringify({ payload: {}, injectedField: true }),
    });
    assert.equal(rejected.status, 400);
  } finally {
    await app.close();
  }

  console.log('Phase 2A integration passed: draft revisions, live grants, governed references, directory checks, optimistic locking, atomic submit numbering, immutable submission and HTTP authorization/DTO checks.');
}
