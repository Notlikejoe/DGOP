import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { AiIntakeService } from '../src/ai-governance/ai-intake.service';

export async function testIntakeVisibility(db: PrismaClient, app: INestApplication, officerId: string) {
  const intake = app.get(AiIntakeService);
  const requester = await db.user.findUniqueOrThrow({ where: { email: 'intake-requester@phase2a.test' } });
  const rows = await intake.listVisible(officerId);
  const shared = rows.find(row => row.requesterUserId === requester.id && row.workflowCase && row.intakeRevisions[0]?.submittedAt);
  assert.ok(shared, 'Organization readers see other requesters submitted native AIUC cases');
  assert.equal(shared.canEdit, false);
  assert.equal((await intake.getVisible(officerId, shared.id)).canEdit, false);
  const privateDraft = await intake.createDraft(requester.id, { usecase_name: 'Private synthetic visibility draft' });
  assert.equal((await intake.getVisible(requester.id, privateDraft.id)).canEdit, true);
  assert.ok(!(await intake.listVisible(officerId)).some(row => row.id === privateDraft.id));
  await assert.rejects(intake.getVisible(officerId, privateDraft.id), /not found/);
  await assert.rejects(intake.updateDraft(officerId, shared.id, shared.version, { problem_desc: 'Forbidden edit' }));

  const role = await db.role.findUniqueOrThrow({ where: { code: 'AI_GOVERNANCE_OFFICER' } });
  const domain = await db.roleDataScope.create({ data: { roleId: role.id, scopeType: 'data_domain', refId: randomUUID() } });
  try { await assert.rejects(intake.getVisible(officerId, shared.id), /not found/); }
  finally { await db.roleDataScope.delete({ where: { id: domain.id } }); }
  const org = await db.roleDataScope.create({ data: { roleId: role.id, scopeType: 'org_unit', refId: randomUUID() } });
  try { await assert.rejects(intake.getVisible(officerId, shared.id), /not found/); }
  finally { await db.roleDataScope.delete({ where: { id: org.id } }); }
  try {
    await db.role.update({ where: { id: role.id }, data: { maxClassificationRank: 0 } });
    await assert.rejects(intake.getVisible(officerId, shared.id), /not found/);
  } finally { await db.role.update({ where: { id: role.id }, data: { maxClassificationRank: role.maxClassificationRank } }); }
  const grant = await db.rolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { resource: 'case.view.aiuc', action: 'org' } } });
  await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: grant.roleId, permissionId: grant.permissionId } } });
  try { await assert.rejects(intake.getVisible(officerId, shared.id), /not found/); }
  finally { await db.rolePermission.create({ data: { roleId: grant.roleId, permissionId: grant.permissionId } }); }

  const auditorRole = await db.role.findUniqueOrThrow({ where: { code: 'auditor' } });
  const auditor = await db.user.create({ data: { email: `intake-auditor-${randomUUID()}@isolated.test`, displayName: 'Synthetic intake Auditor', passwordHash: 'not-a-login', userRoles: { create: { roleId: auditorRole.id } } } });
  const visible = await intake.listVisible(auditor.id);
  assert.ok(visible.some(row => row.id === shared.id));
  assert.ok(visible.every(row => !row.canEdit));
  assert.ok(!visible.some(row => row.id === privateDraft.id));
  const lookup = await intake.lookups(auditor.id);
  assert.equal(lookup.canCreate, false);
  const referenced = new Set(visible.flatMap(row => [row.requesterUserId, ...['proposed_owner', 'data_owner', 'executive_sponsor'].map(field => (row.intakeRevisions[0]?.payload as Record<string, unknown>)?.[field])]).filter(id => typeof id === 'string'));
  assert.ok(lookup.executiveSponsors.every(user => referenced.has(user.id)), 'Read-only lookup directory contains only visible case references');
  await assert.rejects(intake.createDraft(auditor.id, {}), /explicit eligible/);
  const jwt = app.get(JwtService), base = (await app.getUrl()) + '/api/ai/use-cases';
  const headers = { authorization: 'Bearer ' + jwt.sign({ sub: auditor.id, tokenVersion: 0, roles: ['system_admin'] }) };
  for (const url of [base, base + '/lookups', base + '/' + shared.id]) assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal((await fetch(base + '/' + privateDraft.id, { headers })).status, 404);
  assert.equal((await fetch(base)).status, 401);
  console.log('AI intake visibility passed: live own/org/all grants, submitted-case access, private drafts, scope, revocation, requester-only editing, Auditor restricted lookups and authenticated HTTP reads.');
}
