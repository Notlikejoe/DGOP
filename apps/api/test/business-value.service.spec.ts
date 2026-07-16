import assert from 'node:assert/strict';
import { BusinessGlossaryStatus, BusinessImpactLevel, DataValueStatus, LifecycleDecisionStatus } from '@prisma/client';
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
