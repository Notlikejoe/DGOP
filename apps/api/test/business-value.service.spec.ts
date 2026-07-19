import assert from 'node:assert/strict';
import { BusinessGlossaryStatus, BusinessImpactLevel, DataValueStatus, LifecycleDecisionStatus } from '@prisma/client';
import { BusinessValueService } from '../src/business-value/business-value.service';
import {
  averageScore,
  clampScore,
  dataValueStatus,
  glossaryHealth,
  impactLevelFromScore,
  lifecycleSignal,
} from '../src/business-value/business-value.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('impact scores map to executive-readable business impact levels', () => {
  assert.equal(clampScore(140), 100);
  assert.equal(clampScore(-10), 0);
  assert.equal(impactLevelFromScore(90), BusinessImpactLevel.critical);
  assert.equal(impactLevelFromScore(70), BusinessImpactLevel.high);
  assert.equal(impactLevelFromScore(40), BusinessImpactLevel.medium);
  assert.equal(impactLevelFromScore(20), BusinessImpactLevel.low);
});

test('value KPIs show planned, at-risk, measuring, and realized states', () => {
  assert.equal(dataValueStatus(0, 0), DataValueStatus.planned);
  assert.equal(dataValueStatus(20, 100), DataValueStatus.at_risk);
  assert.equal(dataValueStatus(75, 100), DataValueStatus.measuring);
  assert.equal(dataValueStatus(120, 100), DataValueStatus.realized);
});

test('glossary health is blocked by overdue recertification even with approved terms', () => {
  const health = glossaryHealth(
    [
      { status: BusinessGlossaryStatus.approved, reviewDueAt: new Date('2026-01-01T00:00:00Z') },
      { status: BusinessGlossaryStatus.approved, reviewDueAt: null },
    ],
    new Date('2026-07-14T00:00:00Z'),
  );
  assert.equal(health.readinessScore, 100);
  assert.equal(health.reviewDue, 1);
  assert.equal(health.status, 'at_risk');
});

test('lifecycle decisions expose blocked and ready operating signals', () => {
  assert.equal(lifecycleSignal({ status: LifecycleDecisionStatus.rejected }), 'blocked');
  assert.equal(lifecycleSignal({ status: LifecycleDecisionStatus.implemented }), 'ready');
  assert.equal(
    lifecycleSignal({ status: LifecycleDecisionStatus.proposed, disposalDueAt: new Date('2026-01-01T00:00:00Z') }, new Date('2026-07-14T00:00:00Z')),
    'blocked',
  );
});

test('survey averaging tolerates empty and null inputs', () => {
  assert.equal(averageScore([]), 0);
  assert.equal(averageScore([100, null, 50]), 50);
});

test('lineage maps require a visible asset or domain anchor', async () => {
  let persisted = false;
  const service = new BusinessValueService(
    {
      businessLineageMap: {
        create: async () => {
          persisted = true;
          return {};
        },
      },
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: ['ou-1'], domains: ['domain-1'], maxClassRank: 2 }) } as never,
  );

  await assert.rejects(
    () => service.createLineage(['business_value_steward'], { processName: 'Revenue reporting' }, 'creator@dgop.local'),
    /Lineage maps need a visible asset or domain/,
  );
  assert.equal(persisted, false);
});

test('glossary creators cannot make their own final review decision', async () => {
  let updated = false;
  const service = new BusinessValueService(
    {
      businessGlossaryTerm: {
        findFirst: async () => ({
          id: 'term-1',
          definition: 'Current definition',
          version: 1,
          createdBy: 'creator@dgop.local',
        }),
        update: async () => {
          updated = true;
          return {};
        },
      },
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  await assert.rejects(
    () =>
      service.decideGlossaryTerm(
        ['system_admin'],
        'term-1',
        { status: BusinessGlossaryStatus.approved },
        'creator@dgop.local',
      ),
    /creators cannot make the final review decision/,
  );
  assert.equal(updated, false);
});

test('lifecycle creators cannot approve their own lifecycle decision', async () => {
  let updated = false;
  const service = new BusinessValueService(
    {
      assetLifecycleDecision: {
        findFirst: async () => ({
          id: 'lifecycle-1',
          assetId: 'asset-1',
          proposedStatus: 'retired',
          createdBy: 'creator@dgop.local',
        }),
        update: async () => {
          updated = true;
          return {};
        },
      },
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  await assert.rejects(
    () =>
      service.decideLifecycle(
        ['system_admin'],
        'lifecycle-1',
        { status: LifecycleDecisionStatus.approved },
        'creator@dgop.local',
      ),
    /creators cannot approve or reject their own decision/,
  );
  assert.equal(updated, false);
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  OK ${t.name}`);
    } catch (err) {
      console.error(`  FAIL ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
