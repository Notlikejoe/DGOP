/**
 * Unit tests for NDI scoring (pure logic + service orchestration with mocks).
 * Run with: ts-node test/scoring.service.spec.ts
 */
import assert from 'node:assert';
import { BadRequestException } from '@nestjs/common';
import {
  detectGaps,
  maturityBand,
  readinessPct,
  specWeight,
  STUCK_DAYS,
} from '../src/scoring/scoring.logic';
import { ScoringService } from '../src/scoring/scoring.service';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });
const adminUser = { id: 'admin-user', email: 'admin@dgop.local', roles: ['system_admin'] };
const scopedUser = { id: 'scoped-user', email: 'owner@dgop.local', roles: ['ndi_reviewer'] };

// ---------- pure logic ----------
test('specWeight: type weight times maturity bonus', () => {
  assert.strictEqual(specWeight('policy', 'level_1'), 1.0);
  assert.ok(Math.abs(specWeight('control', 'level_5') - 1.2 * 1.4) < 1e-9);
  assert.ok(Math.abs(specWeight('guideline', 'level_3') - 0.6 * 1.2) < 1e-9);
});

test('readinessPct: weighted percentage, empty -> 0', () => {
  assert.strictEqual(readinessPct([]), 0);
  assert.strictEqual(
    readinessPct([
      { weight: 1, satisfied: true },
      { weight: 1, satisfied: false },
    ]),
    50,
  );
  // heavier satisfied spec pulls the percentage up
  assert.strictEqual(
    readinessPct([
      { weight: 3, satisfied: true },
      { weight: 1, satisfied: false },
    ]),
    75,
  );
});

test('maturityBand: thresholds map to five bands', () => {
  assert.strictEqual(maturityBand(0), 'initial');
  assert.strictEqual(maturityBand(19), 'initial');
  assert.strictEqual(maturityBand(20), 'defined');
  assert.strictEqual(maturityBand(40), 'activated');
  assert.strictEqual(maturityBand(60), 'enabled');
  assert.strictEqual(maturityBand(80), 'leading');
  assert.strictEqual(maturityBand(100), 'leading');
});

test('detectGaps: missing when no evidence and no owner', () => {
  const gaps = detectGaps({
    ownerPersonId: null,
    hasCurrentApproved: false,
    total: 0,
    expired: 0,
    rejected: 0,
    pendingCount: 0,
    oldestPendingAt: null,
  });
  assert.deepStrictEqual(gaps.sort(), ['missing', 'unassigned'].sort());
});

test('detectGaps: satisfied spec only shows unassigned (if any)', () => {
  assert.deepStrictEqual(
    detectGaps({
      ownerPersonId: 'p1',
      hasCurrentApproved: true,
      total: 1,
      expired: 0,
      rejected: 0,
      pendingCount: 0,
      oldestPendingAt: null,
    }),
    [],
  );
  assert.deepStrictEqual(
    detectGaps({
      ownerPersonId: null,
      hasCurrentApproved: true,
      total: 1,
      expired: 0,
      rejected: 0,
      pendingCount: 0,
      oldestPendingAt: null,
    }),
    ['unassigned'],
  );
});

test('detectGaps: expired and rejected surface when not satisfied', () => {
  const gaps = detectGaps({
    ownerPersonId: 'p1',
    hasCurrentApproved: false,
    total: 2,
    expired: 1,
    rejected: 1,
    pendingCount: 0,
    oldestPendingAt: null,
  });
  assert.deepStrictEqual(gaps.sort(), ['expired', 'rejected'].sort());
});

test('detectGaps: stuck only when pending older than threshold', () => {
  const fresh = new Date();
  const old = new Date(Date.now() - (STUCK_DAYS + 1) * 86_400_000);
  const base = {
    ownerPersonId: 'p1',
    hasCurrentApproved: false,
    total: 1,
    expired: 0,
    rejected: 0,
    pendingCount: 1,
  };
  assert.deepStrictEqual(detectGaps({ ...base, oldestPendingAt: fresh }), []);
  assert.deepStrictEqual(detectGaps({ ...base, oldestPendingAt: old }), ['stuck']);
});

// ---------- service with mocks ----------
function makeService(specs: any[], rollups: Map<string, any>, domains: any[]): ScoringService {
  const prisma = {
    ndiSpecification: {
      findMany: async (args: any) =>
        args?.where?.domainId
          ? specs.filter((s) => s.domainId === args.where.domainId)
          : specs,
    },
    ndiDomain: {
      findMany: async () => domains,
      findUnique: async (args: any) => domains.find((d) => d.id === args.where.id) ?? null,
    },
  };
  const evidence = { rollupForSpecs: async () => rollups };
  return new ScoringService(prisma as never, evidence as never);
}

const domainA = { id: 'dA', code: 'data_quality', shortCode: 'DQ', nameEn: 'DQ', nameAr: 'DQ', sortOrder: 1 };
const domainB = { id: 'dB', code: 'open_data', shortCode: 'OD', nameEn: 'OD', nameAr: 'OD', sortOrder: 2 };

function spec(id: string, over: Partial<any> = {}): any {
  return {
    id,
    code: id.toUpperCase(),
    nameEn: id,
    nameAr: id,
    type: 'standard',
    maturityLevel: 'level_1',
    ownerPersonId: 'p1',
    domainId: 'dA',
    owner: { fullNameEn: 'Owner', fullNameAr: 'Owner' },
    domain: domainA,
    ...over,
  };
}

function roll(over: Partial<any> = {}): any {
  return {
    total: 1,
    counts: { draft: 0, submitted: 0, under_review: 0, approved: 0, rejected: 0, expired: 0, revoked: 0 },
    hasCurrentApproved: false,
    latestApprovedAt: null,
    nearestExpiry: null,
    oldestPendingAt: null,
    ...over,
  };
}

test('readiness: overall + per-domain scores and gap totals', async () => {
  const specs = [
    spec('s1'), // satisfied
    spec('s2'), // missing evidence
    spec('s3', { domainId: 'dB', domain: domainB, ownerPersonId: null }), // missing + unassigned
  ];
  const rollups = new Map<string, any>([
    ['s1', roll({ hasCurrentApproved: true, counts: { ...roll().counts, approved: 1 } })],
  ]);
  const svc = makeService(specs, rollups, [domainA, domainB]);
  const r = await svc.readiness(adminUser);

  assert.strictEqual(r.overall.specCount, 3);
  assert.strictEqual(r.overall.satisfiedCount, 1);
  // s1 & s2 in DQ (equal weight) -> 50%; s3 in OD -> 0%
  const dq = r.domains.find((d) => d.domainId === 'dA')!;
  const od = r.domains.find((d) => d.domainId === 'dB')!;
  assert.strictEqual(dq.score, 50);
  assert.strictEqual(od.score, 0);
  assert.strictEqual(r.gapTotals.missing, 2);
  assert.strictEqual(r.gapTotals.unassigned, 1);
});

test('domainDetail: rows include score, status, gaps', async () => {
  const specs = [spec('s1'), spec('s2')];
  const rollups = new Map<string, any>([
    ['s1', roll({ hasCurrentApproved: true, counts: { ...roll().counts, approved: 1 } })],
  ]);
  const svc = makeService(specs, rollups, [domainA]);
  const d = await svc.domainDetail(adminUser, 'dA');
  assert.strictEqual(d.specs.length, 2);
  const r1 = d.specs.find((s) => s.id === 's1')!;
  assert.strictEqual(r1.satisfied, true);
  assert.strictEqual(r1.score, 100);
  assert.strictEqual(r1.evidenceStatus, 'approved');
  const r2 = d.specs.find((s) => s.id === 's2')!;
  assert.deepStrictEqual(r2.gaps, ['missing']);
});

test('gaps: queue sorted high severity first, filterable by type', async () => {
  const specs = [
    spec('s1'), // satisfied, no gap
    spec('s2', { ownerPersonId: null }), // missing(high) + unassigned(low)
  ];
  const rollups = new Map<string, any>([
    ['s1', roll({ hasCurrentApproved: true, counts: { ...roll().counts, approved: 1 } })],
  ]);
  const svc = makeService(specs, rollups, [domainA]);
  const all = await svc.gaps(adminUser);
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].severity, 'high');
  const onlyUnassigned = await svc.gaps(adminUser, { gapType: 'unassigned' });
  assert.strictEqual(onlyUnassigned.length, 1);
  assert.strictEqual(onlyUnassigned[0].gapType, 'unassigned');
});

test('gaps: rejects invalid gap type before loading specs or evidence', async () => {
  let specLoads = 0;
  let evidenceLoads = 0;
  const prisma = {
    ndiSpecification: {
      findMany: async () => {
        specLoads += 1;
        return [];
      },
    },
  };
  const evidence = {
    rollupForSpecs: async () => {
      evidenceLoads += 1;
      return new Map();
    },
  };
  const svc = new ScoringService(prisma as never, evidence as never);

  await assert.rejects(
    () => svc.gaps(adminUser, { gapType: 'almost_missing' }),
    BadRequestException,
  );
  assert.strictEqual(specLoads, 0);
  assert.strictEqual(evidenceLoads, 0);
});

test('readiness: scoped scoring only loads specs visible by owner or evidence responsibility', async () => {
  let specWhere: unknown;
  let rollupIds: string[] = [];
  const visibleSpec = spec('visible', { ownerPersonId: 'person-1' });
  const prisma = {
    person: {
      findFirst: async () => ({ id: 'person-1' }),
    },
    ndiSpecification: {
      findMany: async (args: any) => {
        specWhere = args.where;
        return [visibleSpec];
      },
    },
    ndiDomain: {
      findMany: async () => [domainA],
    },
  };
  const evidence = {
    rollupForSpecs: async (ids: string[]) => {
      rollupIds = ids;
      return new Map();
    },
  };
  const svc = new ScoringService(prisma as never, evidence as never);
  const r = await svc.readiness(scopedUser);
  const whereText = JSON.stringify(specWhere);

  assert.strictEqual(r.overall.specCount, 1);
  assert.deepStrictEqual(rollupIds, ['visible']);
  assert.ok(whereText.includes('ownerPersonId'));
  assert.ok(whereText.includes('submittedBy'));
  assert.ok(whereText.includes('reviewedBy'));
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
