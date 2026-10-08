import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, TaskDecision } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIntakeService } from '../src/ai-governance/ai-intake.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiRegisterQueryDto } from '../src/ai-governance/ai-register-query.dto';
import { WorkflowService } from '../src/workflow/workflow.service';

/** Runs only after the full native lifecycle fixtures in the isolated test harness. */
export async function testAiStability(db: PrismaClient) {
  const url = new URL(process.env.DGOP_AI_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55438'); assert.match(url.pathname, /^\/dgop_ai_test_/);
  const requester = await db.user.findUniqueOrThrow({ where: { email: 'intake-requester@phase2a.test' } });
  const adminRole = await db.role.findUniqueOrThrow({ where: { code: 'system_admin' } });
  const officerRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_GOVERNANCE_OFFICER' } });
  const riskRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_RISK_OWNER' } });
  const custodianRole = await db.role.findUniqueOrThrow({ where: { code: 'dmo_admin' } });
  async function actor(label: string, roleIds: string[]) {
    return db.user.create({ data: { email: `${label}@stability.isolated.test`, displayName: `Synthetic ${label}`, passwordHash: 'not-a-login', userRoles: { create: roleIds.map(roleId => ({ roleId })) } } });
  }
  const admin = await actor('oversight', [adminRole.id]);
  const noAi = await actor('no-ai-grants', []);
  const dual = await actor('dual-role', [adminRole.id, officerRole.id, custodianRole.id]);
  const owner = await actor('risk-owner', [riskRole.id]);
  const ownerPerson = await db.person.create({ data: { fullNameEn: 'Synthetic pagination Risk Owner', fullNameAr: 'مالك خطر اصطناعي', userId: owner.id } });
  const registered = await db.aiUseCase.findFirstOrThrow({ where: { assetId: { not: null }, isSampleData: false, deletedAt: null, workflowCase: { is: { type: 'AIUC' } } } });
  const fixtureCount = 105, now = new Date();
  const caseIds = Array.from({ length: fixtureCount }, () => randomUUID());
  const useCaseIds = Array.from({ length: fixtureCount }, () => randomUUID());
  const riskCaseIds = Array.from({ length: fixtureCount }, () => randomUUID());
  const riskIds = Array.from({ length: fixtureCount }, () => randomUUID());
  // These are explicitly synthetic register fixtures, not evidence of completed approval journeys.
  await db.workflowCase.createMany({ data: caseIds.map((id, index) => ({ id, code: `AIUC-PAGINATION-${index + 1}`, type: 'AIUC', title: `Synthetic pagination AIUC ${index + 1}`, status: 'submitted', createdBy: requester.email })) });
  await db.aiUseCase.createMany({ data: useCaseIds.map((id, index) => ({ id, workflowCaseId: caseIds[index], requesterUserId: requester.id, createdBy: requester.id, name: `Synthetic pagination AIUC ${index + 1}`, updatedAt: new Date(now.getTime() - index * 1000) })) });
  await db.aiIntakeRevision.createMany({ data: useCaseIds.map((useCaseId, index) => ({ useCaseId, revision: 1, payload: { usecase_name: `Synthetic pagination AIUC ${index + 1}`, requester: requester.id }, createdBy: requester.id, submittedAt: now })) });
  await db.workflowCase.createMany({ data: riskCaseIds.map((id, index) => ({ id, code: `AIRS-PAGINATION-${index + 1}`, type: 'AIRS', title: `Synthetic pagination AIRS ${index + 1}`, status: 'draft', createdBy: owner.email })) });
  await db.aiRisk.createMany({ data: riskIds.map((id, index) => ({ id, useCaseId: registered.id, workflowCaseId: riskCaseIds[index], ownerPersonId: ownerPerson.id, createdBy: owner.id, title: `Synthetic pagination AIRS ${index + 1}`, cause: 'Synthetic pagination fixture', event: 'Synthetic fixture event', effect: 'Synthetic fixture effect', updatedAt: new Date(now.getTime() - index * 1000) })) });
  const privateDraft = await db.aiUseCase.create({ data: { requesterUserId: requester.id, createdBy: requester.id, name: 'Private synthetic stability draft', intakeRevisions: { create: { revision: 1, createdBy: requester.id, payload: { usecase_name: 'Private synthetic stability draft' } } } } });
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl(), jwt = app.get(JwtService);
    // Deliberately forged token roles must never supply live privileges.
    const bearer = (id: string) => ({ authorization: `Bearer ${jwt.sign({ sub: id, tokenVersion: 0, roles: ['system_admin'] })}` });
    const request = async (path: string, id = admin.id, method = 'GET', body?: unknown) => fetch(`${base}/api/${path}`, { method, headers: { ...bearer(id), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const intake = app.get(AiIntakeService), risks = app.get(AiRiskIntakeService), authorization = app.get(AiAuthorizationService);
    // Before asset handoff, a specialist's classification ceiling comes from
    // the submitted intake's real governed mapping, not an administrator role.
    const privacyRole=await db.role.findUniqueOrThrow({where:{code:'privacy_officer'}});
    const specialist=await actor('specialist-scope',[adminRole.id,privacyRole.id]);
    const classVersion=await db.governedReferenceVersion.findFirstOrThrow({where:{listCode:'L_CLASS',state:'published',effectiveFrom:{lte:now},OR:[{effectiveTo:null},{effectiveTo:{gt:now}}]},include:{values:true}});
    const classValue=classVersion.values.find(value=>value.metadata&&typeof value.metadata==='object'&&!Array.isArray(value.metadata)&&typeof (value.metadata as Record<string,unknown>)['assetClassificationCode']==='string');
    assert.ok(classValue,'Classification fixtures must provide a real published asset mapping');
    const mappedClass=await db.classification.findUniqueOrThrow({where:{code:(classValue.metadata as Record<string,unknown>)['assetClassificationCode'] as string}});
    const provisional=await db.aiUseCase.create({data:{name:'Synthetic submitted specialist scope',createdBy:requester.id,requesterUserId:requester.id,organizationUnitId:registered.organizationUnitId,intakeRevisions:{create:{revision:1,schemaVersion:1,submittedAt:now,createdBy:requester.id,payload:{data_classification:classValue.code}}}}});
    try{
      await db.role.update({where:{id:privacyRole.id},data:{maxClassificationRank:mappedClass.rank}});
      const allowed=await db.$transaction(tx=>authorization.authorizeBusiness(specialist.id,'case.view.aiuc.org',tx,provisional.id));
      assert.deepEqual(allowed.roles,['privacy_officer']);
      assert.equal((await authorization.filterReadScope({...allowed,administratorOversight:false},[{id:provisional.id}])).length,1);
      await db.role.update({where:{id:privacyRole.id},data:{maxClassificationRank:mappedClass.rank-1}});
      await assert.rejects(db.$transaction(tx=>authorization.authorizeBusiness(specialist.id,'case.view.aiuc.org',tx,provisional.id)),/granted business scope/);
      assert.equal((await authorization.filterReadScope({...allowed,administratorOversight:false},[{id:provisional.id}])).length,0);
    }finally{await db.role.update({where:{id:privacyRole.id},data:{maxClassificationRank:privacyRole.maxClassificationRank}});}
    const capsResponse = await request('ai/capabilities'); assert.equal(capsResponse.status, 200);
    const noCapsResponse=await request('ai/capabilities',noAi.id);assert.equal(noCapsResponse.status,200);
    const noCaps=await noCapsResponse.json() as {readMode:string;permissions:string[];screens:Record<string,boolean>};assert.equal(noCaps.readMode,'none');assert.deepEqual(noCaps.permissions,[]);assert.ok(Object.values(noCaps.screens).every(value=>!value));
    assert.equal((await fetch(`${base}/api/ai/capabilities`)).status,401);
    const caps = await capsResponse.json() as { administratorOversight: boolean; permissions: string[]; screens: Record<string, boolean> };
    assert.equal(caps.administratorOversight, true); assert.ok(Object.values(caps.screens).every(Boolean)); assert.ok(!caps.permissions.includes('case.approve.aiuc')); assert.ok(!caps.permissions.includes('refdata.publish'));
    for (const path of ['ai/use-cases/classification/configuration', 'ai/use-cases/classification/queue', 'ai/use-cases/classification/verification/queue', 'ai/use-cases/classification/reviews/queue', 'ai/use-cases/decisions/queue', 'ai/use-cases/registration/queue', 'ai/review-operations/cadence-config', 'ai/review-operations/report', 'ai/dashboard', 'ai/migration-previews/context', 'ai/migration-previews']) {
      const response = await request(path); assert.equal(response.status, 200, `${path}: ${await response.text()}`);
    }
    for (const [path, ids, service] of [['ai/use-cases', useCaseIds, intake], ['ai/risks', riskIds, risks]] as const) {
      const search = path === 'ai/use-cases' ? 'Synthetic pagination AIUC' : 'Synthetic pagination AIRS';
      const query = `search=${encodeURIComponent(search)}`;
      const firstResponse = await request(`${path}?${query}`); assert.equal(firstResponse.status, 200);
      const first = await firstResponse.json() as { data: Array<{ id: string; canEdit: boolean }>; total: number; page: number; pageSize: number; totalPages: number; summary: { total: number } };
      assert.equal(first.total, fixtureCount); assert.equal(first.pageSize, 25); assert.equal(first.totalPages, 5); assert.equal(first.summary.total, fixtureCount); assert.equal(first.data.length, 25); assert.ok(first.data.every(row => !row.canEdit));
      const found = new Set(first.data.map(row => row.id));
      for (let page = 2; page <= first.totalPages; page++) {
        const response = await request(`${path}?${query}&page=${page}`); assert.equal(response.status, 200);
        const result = await response.json() as typeof first;
        assert.equal(result.summary.total, first.summary.total); assert.equal(result.total, fixtureCount);
        for (const row of result.data) { assert.ok(!found.has(row.id), 'Stable pagination must not repeat rows'); found.add(row.id); }
      }
      assert.deepEqual(found, new Set(ids));
      const oldest = await request(`${path}?search=${encodeURIComponent(search + ' 105')}`); assert.equal(oldest.status, 200);
      const last = await oldest.json() as typeof first; assert.equal(last.total, 1); assert.equal(last.data[0].id, ids[104]); assert.equal(last.summary.total, 1);
      for (const invalid of ['page=0', 'page=-1', 'page=1.5', 'pageSize=201', 'status=fabricated', `search=${'x'.repeat(201)}`]) assert.equal((await request(`${path}?${invalid}`)).status, 400, invalid);
      await assert.rejects(path === 'ai/use-cases' ? intake.listVisible(admin.id, Object.assign(new AiRegisterQueryDto(), { pageSize: 201 })) : risks.list(admin.id, Object.assign(new AiRegisterQueryDto(), { pageSize: 201 })));
    }
    assert.equal((await request(`ai/use-cases/${privateDraft.id}`)).status, 404);
    assert.equal((await request(`ai/use-cases/${privateDraft.id}`, requester.id)).status, 200);
    await assert.rejects(intake.updateDraft(admin.id, privateDraft.id, 1, { problem_desc: 'Forbidden oversight edit' }), /explicit eligible role grant/);
    assert.equal((await request(`ai/use-cases/${useCaseIds[0]}/triage`, admin.id, 'POST', { expectedVersion: 1, decision: 'accept' })).status, 403);
    const business = await authorization.authorize(dual.id, 'case.approve.aiuc');
    assert.deepEqual(business.roles,['AI_GOVERNANCE_OFFICER'],'Only the live purpose-granted business role supplies mutation scope');
    await assert.rejects(authorization.enforceDuty(business, 'approve_aiuc', { requesterId: dual.id }, useCaseIds[0]), /GEN-26/);
    await authorization.enforceDuty(business, 'approve_aiuc', { requesterId: requester.id }, useCaseIds[0]);
    const grant = await db.rolePermission.findFirstOrThrow({ where: { roleId: officerRole.id, permission: { resource: 'case.approve', action: 'aiuc' } } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: grant.roleId, permissionId: grant.permissionId } } });
    try { await assert.rejects(authorization.authorize(dual.id, 'case.approve.aiuc'), /explicit eligible role grant/); }
    finally { await db.rolePermission.create({ data: { roleId: grant.roleId, permissionId: grant.permissionId } }); }
    const constrainedOfficer=await db.roleDataScope.create({data:{roleId:officerRole.id,scopeType:'org_unit',refId:randomUUID()}});
    try {
      assert.equal((await request(`ai/use-cases/${registered.id}`,dual.id)).status,200,'Platform oversight still reads the submitted record');
      await assert.rejects(db.$transaction(tx=>authorization.authorize(dual.id,'case.approve.aiuc',tx,registered.id)),/granted business scope/);
    } finally {await db.roleDataScope.delete({where:{id:constrainedOfficer.id}});}
    const workflow = app.get(WorkflowService);
    const businessCase = await db.workflowCase.create({ data: { code: 'WFC-SYNTHETIC-STABILITY', type: 'general', title: 'Synthetic independent business decision', status: 'submitted', createdBy: requester.email, tasks: { create: { title: 'Synthetic independent approval', type: 'approval', assigneeRoleCode: 'dmo_admin', assigneeUserId: dual.id } } }, include: { tasks: true } });
    const task = businessCase.tasks[0];
    await assert.rejects(workflow.decideTask(task.id, { decision: TaskDecision.approved }, { id: admin.id, email: admin.email, roles: ['system_admin'] }), /Only the assigned user/);
    const editPermission = await db.permission.upsert({ where: { resource_action: { resource: 'workflow_tasks', action: 'edit' } }, create: { resource: 'workflow_tasks', action: 'edit' }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: custodianRole.id, permissionId: editPermission.id } }, create: { roleId: custodianRole.id, permissionId: editPermission.id }, update: {} });
    await db.workflowCase.update({where:{id:businessCase.id},data:{assetId:registered.assetId}});
    const constrainedCustodian=await db.roleDataScope.create({data:{roleId:custodianRole.id,scopeType:'org_unit',refId:randomUUID()}});
    try {await assert.rejects(workflow.decideTask(task.id,{decision:TaskDecision.approved},{id:dual.id,email:dual.email,roles:['system_admin','dmo_admin']}),/not found/);}
    finally {await db.roleDataScope.delete({where:{id:constrainedCustodian.id}});}
    assert.equal((await workflow.decideTask(task.id, { decision: TaskDecision.approved }, { id: dual.id, email: dual.email, roles: ['system_admin', 'dmo_admin'] })).status, 'completed');
  } finally { await app.close(); }
  console.log('AI stability integration passed: 105-row HTTP registers, complete stable pagination/search/summary, private drafts, all administrator read surfaces, explicit grant revocation, independent business duties and assignment enforcement.');
}
