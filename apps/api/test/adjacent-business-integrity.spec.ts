import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { validate } from 'class-validator';
import { BusinessValueService } from '../src/business-value/business-value.service';
import {
  ExtendedRegisterQueryDto,
  UpdateMdmGoldenRecordDto,
} from '../src/extended-domains/extended-domains.dto';
import { ArchitectureReviewDecision } from '@prisma/client';
import { isArchitectureDecisionFinal } from '../src/extended-domains/extended-domains.logic';

async function main() {
  // Syntax contracts guard the entire repaired service families, including newly added methods.
  for (const relative of [
    'extended-domains/extended-domains.service.ts',
    'business-value/business-value.service.ts',
    'data-sharing/data-sharing.service.ts',
  ]) {
    const file = join(__dirname, '../src', relative),
      source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
    let audits = 0;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const call = node.expression,
          receiver = call.expression.getText(source);
        if (receiver === 'this.audit') {
          assert.equal(
            call.name.text,
            'logRequired',
            relative + ' must require business audit writes',
          );
          assert.equal(
            node.arguments.length,
            2,
            relative + ' must pass its transaction client',
          );
          audits++;
        }
        if (
          ts.isPropertyAccessExpression(call.expression) &&
          call.expression.expression.getText(source) === 'this.prisma'
        )
          assert(
            !/^(create|update|delete|upsert)/.test(call.name.text),
            relative + ' must not write through the root Prisma client',
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert(audits > 0);
  }
  assert.equal(
    isArchitectureDecisionFinal(ArchitectureReviewDecision.needs_changes),
    false,
  );
  assert.equal(
    isArchitectureDecisionFinal(ArchitectureReviewDecision.approved),
    true,
  );
  assert(
    (await validate(Object.assign(new UpdateMdmGoldenRecordDto(), {}))).some(
      (error) => error.property === 'expectedVersion',
    ),
  );
  assert.equal(
    (
      await validate(
        Object.assign(new UpdateMdmGoldenRecordDto(), { expectedVersion: 1 }),
      )
    ).length,
    0,
  );
  for (const values of [{ pageSize: 201 }, { search: 'x'.repeat(201) }])
    assert(
      (await validate(Object.assign(new ExtendedRegisterQueryDto(), values)))
        .length,
    );
  assert.equal(
    (
      await validate(
        Object.assign(new ExtendedRegisterQueryDto(), {
          page: 1,
          pageSize: 200,
          search: 'أصل',
        }),
      )
    ).length,
    0,
  );
  let created = 0;
  const tx = {
    dataValueKpi: {
      create: async (args: any) => {
        created++;
        return { id: 'kpi', ...args.data };
      },
    },
  };
  const client = { $transaction: async (work: any) => work(tx) };
  const service = new BusinessValueService(
    client as never,
    {
      logRequired: async (_entry: any, writer: any) => assert.equal(writer, tx),
    } as never,
    {
      resolve: async () => ({
        orgUnits: 'all',
        domains: 'all',
        maxClassRank: null,
      }),
    } as never,
  );
  (service as any).nextCode = async () => 'DVK-TEST';
  const base = {
    name: 'Measured savings',
    valueType: 'savings',
    period: '2026',
    actualValue: 0,
    targetValue: 100,
  };
  await assert.rejects(
    () =>
      service.createKpi(
        [],
        { ...base, status: 'realized' },
        'reviewer@example.test',
      ),
    /must match/,
  );
  assert.equal(created, 0);
  assert.equal(
    (await service.createKpi([], base, 'reviewer@example.test')).status,
    'at_risk',
  );
  assert.equal(
    (
      await service.createKpi(
        [],
        { ...base, actualValue: 70 },
        'reviewer@example.test',
      )
    ).status,
    'measuring',
  );
  assert.equal(
    (
      await service.createKpi(
        [],
        { ...base, actualValue: 100 },
        'reviewer@example.test',
      )
    ).status,
    'realized',
  );
  assert.equal(
    (
      await service.createKpi(
        [],
        { ...base, targetValue: 0 },
        'reviewer@example.test',
      )
    ).status,
    'planned',
  );
  console.log(
    'PASS required transactional audit syntax contracts, optimistic golden versions, bounded registers, nonterminal reassessment and measured KPI thresholds',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
