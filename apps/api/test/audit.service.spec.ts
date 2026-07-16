/**
 * Unit tests for Sprint 31 audit hash-chain verification.
 * Run with: ts-node test/audit.service.spec.ts
 */
import assert from 'node:assert';
import { AuditService } from '../src/audit/audit.service';
import { hashAuditEntry, verifyAuditHashChain } from '../src/audit/audit.logic';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

test('hashAuditEntry is stable for equivalent metadata ordering', () => {
  const base = {
    actor: 'admin@dgop.local',
    action: 'evidence.read',
    entityType: 'evidence',
    entityId: 'evidence-1',
    createdAt: new Date('2026-07-16T10:00:00.000Z'),
    previousHash: null,
    chainVersion: 1,
  };
  const first = hashAuditEntry({ ...base, metadata: { b: 2, a: 1 } });
  const second = hashAuditEntry({ ...base, metadata: { a: 1, b: 2 } });
  assert.strictEqual(first, second);
});

test('AuditService writes linked hashes and verification detects tampering', async () => {
  const rows: any[] = [];
  const prisma = {
    auditLog: {
      findFirst: async () => rows.at(-1) ? { entryHash: rows.at(-1).entryHash } : null,
      create: async (args: any) => {
        const row = { id: `audit-${rows.length + 1}`, ...args.data };
        rows.push(row);
        return row;
      },
      findMany: async () => rows,
    },
  };
  const service = new AuditService(prisma as never);
  await service.log({
    actor: 'admin@dgop.local',
    action: 'evidence.read',
    entityType: 'evidence',
    entityId: 'evidence-1',
    metadata: { sensitiveRead: true },
  });
  await service.log({
    actor: 'admin@dgop.local',
    action: 'integration.event.process',
    entityType: 'integration_event',
    entityId: 'event-1',
  });

  assert.strictEqual(rows.length, 2);
  assert.ok(rows[0].entryHash);
  assert.strictEqual(rows[1].previousHash, rows[0].entryHash);
  assert.strictEqual((await service.verifyChain()).valid, true);

  rows[1].action = 'integration.event.deleted';
  assert.strictEqual(verifyAuditHashChain(rows).valid, false);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  \u2713 ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  \u2717 ${t.name}`);
      console.error(`    ${(err as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
