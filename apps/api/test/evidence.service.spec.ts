/**
 * Lightweight unit tests for the evidence lifecycle service (no jest dependency).
 * Run with: ts-node test/evidence.service.spec.ts
 */
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

// Point storage at a throwaway temp dir before importing the service.
process.env.EVIDENCE_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'dgop-evidence-'));

import { EvidenceService } from '../src/evidence/evidence.service';

type Over = {
  evidenceRow?: any;
  rows?: any[];
  spec?: any;
  onUpdate?: (args: any) => void;
};

function makeService(over: Over): EvidenceService {
  const prisma = {
    ndiEvidence: {
      findMany: async () => over.rows ?? [],
      findFirst: async () => over.evidenceRow ?? null,
      create: async (a: any) => ({ id: 'e_new', ...a.data }),
      update: async (a: any) => {
        over.onUpdate?.(a);
        return { ...(over.evidenceRow ?? {}), ...a.data, id: a.where.id };
      },
    },
    ndiSpecification: {
      findFirst: async () => over.spec ?? { id: 'spec1', code: 'DG.1.1' },
    },
  };
  const audit = { log: async () => {} };
  return new EvidenceService(prisma as never, audit as never);
}

const base = {
  id: 'e1',
  specId: 'spec1',
  title: 'Policy doc',
  status: 'submitted',
  fileName: 'x.pdf',
  originalName: 'policy.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 10,
  sha256: 'abc',
  submittedBy: 'alice@dgop.local',
  submittedAt: new Date(),
  reviewedBy: null,
  reviewedAt: null,
  reviewComment: null,
  expiryDate: null as Date | null,
};

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

test('effectiveStatus: approved past expiry reads as expired', async () => {
  const svc = makeService({
    rows: [{ ...base, status: 'approved', expiryDate: new Date('2020-01-01') }],
  });
  const list = await svc.listBySpec('spec1');
  assert.strictEqual((list[0] as any).effectiveStatus, 'expired');
});

test('effectiveStatus: approved with future expiry stays approved', async () => {
  const svc = makeService({
    rows: [{ ...base, status: 'approved', expiryDate: new Date('2999-01-01') }],
  });
  const list = await svc.listBySpec('spec1');
  assert.strictEqual((list[0] as any).effectiveStatus, 'approved');
});

test('submit: draft -> submitted', async () => {
  let captured: any = null;
  const svc = makeService({
    evidenceRow: { ...base, status: 'draft' },
    onUpdate: (a) => (captured = a.data),
  });
  await svc.submit('e1', 'alice@dgop.local');
  assert.strictEqual(captured.status, 'submitted');
});

test('submit: approved cannot be submitted', async () => {
  const svc = makeService({ evidenceRow: { ...base, status: 'approved' } });
  await assert.rejects(() => svc.submit('e1', 'alice@dgop.local'), /draft or rejected/i);
});

test('review: submitter cannot review own evidence (SoD)', async () => {
  const svc = makeService({ evidenceRow: { ...base, status: 'submitted', submittedBy: 'alice@dgop.local' } });
  await assert.rejects(
    () => svc.review('e1', { decision: 'approve' }, 'alice@dgop.local'),
    /cannot review evidence you submitted/i,
  );
});

test('review: approve sets approved status', async () => {
  let captured: any = null;
  const svc = makeService({
    evidenceRow: { ...base, status: 'submitted', submittedBy: 'alice@dgop.local' },
    onUpdate: (a) => (captured = a.data),
  });
  await svc.review('e1', { decision: 'approve', comment: 'ok' }, 'bob@dgop.local');
  assert.strictEqual(captured.status, 'approved');
  assert.strictEqual(captured.reviewedBy, 'bob@dgop.local');
  assert.strictEqual(captured.reviewComment, 'ok');
});

test('review: reject sets rejected status', async () => {
  let captured: any = null;
  const svc = makeService({
    evidenceRow: { ...base, status: 'submitted', submittedBy: 'alice@dgop.local' },
    onUpdate: (a) => (captured = a.data),
  });
  await svc.review('e1', { decision: 'reject' }, 'bob@dgop.local');
  assert.strictEqual(captured.status, 'rejected');
});

test('review: draft cannot be reviewed', async () => {
  const svc = makeService({ evidenceRow: { ...base, status: 'draft' } });
  await assert.rejects(
    () => svc.review('e1', { decision: 'approve' }, 'bob@dgop.local'),
    /only submitted evidence/i,
  );
});

test('revoke: only approved evidence can be revoked', async () => {
  const svc = makeService({ evidenceRow: { ...base, status: 'submitted' } });
  await assert.rejects(() => svc.revoke('e1', 'bob@dgop.local'), /only approved/i);
});

test('create: computes a sha256 and stores draft by default', async () => {
  const svc = makeService({ spec: { id: 'spec1', code: 'DG.1.1' } });
  const file = {
    originalname: 'policy.pdf',
    mimetype: 'application/pdf',
    size: 5,
    buffer: Buffer.from('hello'),
  };
  const res: any = await svc.create({ specId: 'spec1', title: 'Doc' }, file as never, 'alice@dgop.local');
  assert.strictEqual(res.status, 'draft');
  // sha256('hello') is a known value
  assert.strictEqual(res.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('create: submit=true uploads as submitted', async () => {
  const svc = makeService({ spec: { id: 'spec1', code: 'DG.1.1' } });
  const file = { originalname: 'a.pdf', mimetype: 'application/pdf', size: 3, buffer: Buffer.from('abc') };
  const res: any = await svc.create(
    { specId: 'spec1', title: 'Doc', submit: 'true' },
    file as never,
    'alice@dgop.local',
  );
  assert.strictEqual(res.status, 'submitted');
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
