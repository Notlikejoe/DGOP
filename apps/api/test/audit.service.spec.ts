/**
 * Unit tests for Sprint 31 audit hash-chain verification.
 * Run with: ts-node test/audit.service.spec.ts
 */
import assert from 'node:assert';
import { AuditService } from '../src/audit/audit.service';
import { hashAuditEntry, sanitizeAuditMetadata, verifyAuditHashChain } from '../src/audit/audit.logic';

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

test('sanitizeAuditMetadata redacts sensitive keys before persistence', () => {
  const sanitized = sanitizeAuditMetadata({
    user: 'admin@dgop.local',
    password: 'PlainText#123',
    webhookToken: 'token-value',
    nested: {
      authorization: 'Bearer abc.def.ghi',
      ok: 'safe',
      values: [{ apiKey: 'key-1' }, { reason: 'bad_password' }],
    },
  }) as any;

  assert.strictEqual(sanitized.user, 'admin@dgop.local');
  assert.strictEqual(sanitized.password, '[REDACTED]');
  assert.strictEqual(sanitized.webhookToken, '[REDACTED]');
  assert.strictEqual(sanitized.nested.authorization, '[REDACTED]');
  assert.strictEqual(sanitized.nested.ok, 'safe');
  assert.strictEqual(sanitized.nested.values[0].apiKey, '[REDACTED]');
  assert.strictEqual(sanitized.nested.values[1].reason, 'bad_password');
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
      count: async () => rows.length,
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

test('AuditService hashes and stores redacted metadata', async () => {
  const rows: any[] = [];
  const prisma = {
    auditLog: {
      findFirst: async () => rows.at(-1) ? { entryHash: rows.at(-1).entryHash } : null,
      create: async (args: any) => {
        const row = { id: `audit-${rows.length + 1}`, ...args.data };
        rows.push(row);
        return row;
      },
      count: async () => rows.length,
      findMany: async () => rows,
    },
  };
  const service = new AuditService(prisma as never);

  await service.log({
    actor: 'admin@dgop.local',
    action: 'integration.webhook.receive',
    entityType: 'integration_event',
    entityId: 'event-1',
    metadata: { connector: 'catalog', webhookToken: 'raw-token', authorization: 'Bearer raw' },
  });

  assert.strictEqual(rows[0].metadata.webhookToken, '[REDACTED]');
  assert.strictEqual(rows[0].metadata.authorization, '[REDACTED]');
  assert.strictEqual((await service.verifyChain()).valid, true);
});

test('AuditService accepts a valid legacy audit baseline without rewriting legacy rows', async () => {
  const rows: any[] = [
    {
      id: 'legacy-1',
      actor: 'admin@dgop.local',
      action: 'asset.create',
      entityType: 'data_asset',
      entityId: 'asset-1',
      metadata: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      previousHash: null,
      entryHash: null,
      chainVersion: null,
    },
  ];
  const prisma = {
    auditLog: {
      findFirst: async (args?: any) => {
        if (args?.where?.action === 'audit_chain.legacy_baseline.accepted') {
          return rows.find((row) => row.action === 'audit_chain.legacy_baseline.accepted' && row.entryHash) ?? null;
        }
        return rows.at(-1) ? { entryHash: rows.at(-1).entryHash } : null;
      },
      create: async (args: any) => {
        const row = { id: `audit-${rows.length + 1}`, ...args.data };
        rows.push(row);
        return row;
      },
      count: async () => rows.length,
      findMany: async () => rows,
    },
  };
  const service = new AuditService(prisma as never);

  const accepted = await service.acceptLegacyBaseline('admin@dgop.local');

  assert.strictEqual(accepted.valid, true);
  assert.strictEqual(accepted.legacyRows, 1);
  assert.strictEqual(accepted.accepted, true);
  assert.strictEqual(rows[0].entryHash, null);
  assert.strictEqual(await service.legacyBaselineAccepted(), true);
});

test('AuditService fails legacy baseline acceptance when the control event is not recorded', async () => {
  const previous = process.env.DGOP_AUDIT_FAIL_CLOSED;
  process.env.DGOP_AUDIT_FAIL_CLOSED = 'false';
  const rows: any[] = [
    {
      id: 'legacy-1',
      actor: 'admin@dgop.local',
      action: 'asset.create',
      entityType: 'data_asset',
      entityId: 'asset-1',
      metadata: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      previousHash: null,
      entryHash: null,
      chainVersion: null,
    },
  ];
  const prisma = {
    auditLog: {
      findFirst: async (args?: any) => {
        if (args?.where?.action === 'audit_chain.legacy_baseline.accepted') return null;
        return rows.at(-1) ? { entryHash: rows.at(-1).entryHash } : null;
      },
      create: async () => {
        throw new Error('database unavailable');
      },
      count: async () => rows.length,
      findMany: async () => rows,
    },
  };
  const service = new AuditService(prisma as never);
  (service as any).logger = { error: () => undefined };

  try {
    await assert.rejects(
      () => service.acceptLegacyBaseline('admin@dgop.local'),
      /Could not record legacy audit baseline acceptance/,
    );
  } finally {
    if (previous === undefined) delete process.env.DGOP_AUDIT_FAIL_CLOSED;
    else process.env.DGOP_AUDIT_FAIL_CLOSED = previous;
  }
});

test('AuditService fails closed when strict audit persistence is enabled', async () => {
  const previous = process.env.DGOP_AUDIT_FAIL_CLOSED;
  process.env.DGOP_AUDIT_FAIL_CLOSED = 'true';
  const prisma = {
    auditLog: {
      findFirst: async () => null,
      create: async () => {
        throw new Error('database unavailable');
      },
    },
  };
  const service = new AuditService(prisma as never);
  (service as any).logger = { error: () => undefined };

  try {
    await assert.rejects(
      () => service.log({ actor: 'admin@dgop.local', action: 'asset.create', entityType: 'data_asset' }),
      /Audit trail could not be recorded/,
    );
  } finally {
    if (previous === undefined) delete process.env.DGOP_AUDIT_FAIL_CLOSED;
    else process.env.DGOP_AUDIT_FAIL_CLOSED = previous;
  }
});

test('AuditService marks limited verification as truncated and refuses baseline acceptance', async () => {
  const rows: any[] = [
    {
      id: 'legacy-1',
      actor: 'admin@dgop.local',
      action: 'asset.create',
      entityType: 'data_asset',
      entityId: 'asset-1',
      metadata: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      previousHash: null,
      entryHash: null,
      chainVersion: null,
    },
    {
      id: 'legacy-2',
      actor: 'admin@dgop.local',
      action: 'asset.update',
      entityType: 'data_asset',
      entityId: 'asset-1',
      metadata: null,
      createdAt: new Date('2026-07-01T00:01:00.000Z'),
      previousHash: null,
      entryHash: null,
      chainVersion: null,
    },
  ];
  const prisma = {
    auditLog: {
      findFirst: async (args?: any) => {
        if (args?.where?.action === 'audit_chain.legacy_baseline.accepted') return null;
        return rows.at(-1) ? { entryHash: rows.at(-1).entryHash } : null;
      },
      create: async (args: any) => {
        const row = { id: `audit-${rows.length + 1}`, ...args.data };
        rows.push(row);
        return row;
      },
      count: async () => rows.length,
      findMany: async (args?: any) => rows.slice(0, args?.take ?? rows.length),
    },
  };
  const service = new AuditService(prisma as never);

  const limited = await service.verifyChain(1);

  assert.strictEqual(limited.valid, true);
  assert.strictEqual(limited.truncated, true);
  await assert.rejects(
    () => service.acceptLegacyBaseline('admin@dgop.local', 1),
    /Full audit chain verification/,
  );
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
