import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { AiHistoryService } from '../src/ai-governance/ai-history.service';

export async function testAiHistory(db: PrismaClient, officerId: string, riskOwnerId: string, useCaseId: string) {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  try {
    const readRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_GOVERNANCE_OFFICER' } });
    const reader = await db.user.create({ data: { email: `history-reader-${randomUUID()}@example.test`, passwordHash: 'not-a-login', displayName: 'Isolated history reader', userRoles: { create: { roleId: readRole.id } } } });
    officerId = reader.id;
    const history = app.get(AiHistoryService), baseline = await history.list(officerId, 1, 50);
    assert.ok(baseline.rows.some(c => c.id === useCaseId));
    assert.equal(baseline.readOnly, true); assert.equal(baseline.demoMode, false, 'Test/production never inherit demo labels');
    const page1 = await history.list(officerId, 1, 1), page2 = await history.list(officerId, 2, 1);
    assert.equal(page1.total, baseline.total); assert.equal(page2.total, baseline.total);
    assert.notEqual(page1.rows[0]?.id, page2.rows[0]?.id);
    await assert.rejects(history.list(riskOwnerId), /explicit eligible/);
    const role = await db.role.findUniqueOrThrow({ where: { code: 'AI_GOVERNANCE_OFFICER' } });
    try {
      await db.role.update({ where: { id: role.id }, data: { maxClassificationRank: 0 } });
      assert.equal((await history.list(officerId)).total, 0, 'Live classification scope filters parent AND nested risk histories');
    } finally { await db.role.update({ where: { id: role.id }, data: { maxClassificationRank: role.maxClassificationRank } }); }
    const scopedParent = await db.aiUseCase.findUniqueOrThrow({ where: { id: useCaseId }, include: { asset: true } });
    assert.ok(scopedParent.asset?.domainId);
    const domainScope = await db.roleDataScope.create({ data: { roleId: role.id, scopeType: 'data_domain', refId: scopedParent.asset.domainId!, includeDescendants: false } });
    const scope = await db.roleDataScope.create({ data: { roleId: role.id, scopeType: 'org_unit', refId: randomUUID(), includeDescendants: false } });
    try { assert.equal((await history.list(officerId)).total, 0, 'Out-of-organization histories do not leak through a shared use case'); }
    finally { await db.roleDataScope.deleteMany({ where: { id: { in: [scope.id, domainScope.id] } } }); }
    const parent = await db.aiUseCase.findUniqueOrThrow({ where: { id: useCaseId } });
    try {
      await db.aiUseCase.update({ where: { id: useCaseId }, data: { isSampleData: true, version: { increment: 1 } } });
      assert.ok(!(await history.list(officerId, 1, 50)).rows.some(c => c.id === useCaseId), 'Source samples cannot become native accepted journey histories');
    } finally { await db.aiUseCase.update({ where: { id: useCaseId }, data: { isSampleData: parent.isSampleData, version: { increment: 1 } } }); }
    assert.equal((await history.list(officerId, 1, 50)).total, baseline.total);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl(), jwt = app.get(JwtService);
    const headers = { authorization: `Bearer ${jwt.sign({ sub: officerId, tokenVersion: 0, roles: ['system_admin'] })}` };
    assert.equal((await fetch(base + '/api/ai/history', { headers })).status, 200, 'Live native roles, not token role claims, resolve access');
    assert.equal((await fetch(base + '/api/ai/history')).status, 401);
    assert.equal((await fetch(base + '/api/ai/history?pageSize=51', { headers })).status, 400);
    const forged = { authorization: `Bearer ${jwt.sign({ sub: riskOwnerId, tokenVersion: 0, roles: ['AI_GOVERNANCE_OFFICER'] })}` };
    assert.equal((await fetch(base + '/api/ai/history', { headers: forged })).status, 403);
    console.log('Native AI journey history passed: paging, live grants, parent/nested scope, sample exclusion, HTTP bounds and forged-role denial.');
  } finally { await app.close(); }
}
