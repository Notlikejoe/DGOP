import assert from 'node:assert/strict';
import { GovernanceLifecycleStatus, GovernanceMaturityDimension } from '@prisma/client';
import {
  lifecycleReadiness,
  missingCharterElements,
  overallMaturityScore,
} from '../src/governance-lifecycle/governance-lifecycle.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('charter validation requires all eight mandatory operating elements', () => {
  const missing = missingCharterElements({
    mandate: 'Mandate',
    scope: 'Scope',
    decision_rights: 'Decision rights',
  });
  assert.deepEqual(missing, ['roles', 'cadence', 'evidence', 'escalation', 'metrics']);
});

test('maturity rollup averages bounded dimension scores', () => {
  const score = overallMaturityScore([
    { dimension: GovernanceMaturityDimension.operating_model, score: 80 },
    { dimension: GovernanceMaturityDimension.people_capability, score: 110 },
    { dimension: GovernanceMaturityDimension.process_controls, score: -20 },
    { dimension: GovernanceMaturityDimension.technology_evidence, score: 70 },
  ]);
  assert.equal(score, 63);
});

test('lifecycle readiness blocks until core governance engines have records', () => {
  assert.equal(
    lifecycleReadiness({
      activeCharters: 0,
      approvedPolicies: 0,
      activeCouncils: 0,
      activeDecisionRights: 0,
      latestMaturityScore: null,
      openImprovements: 0,
    }),
    GovernanceLifecycleStatus.draft,
  );
  assert.equal(
    lifecycleReadiness({
      activeCharters: 1,
      approvedPolicies: 3,
      activeCouncils: 0,
      activeDecisionRights: 4,
      latestMaturityScore: 65,
      openImprovements: 7,
    }),
    GovernanceLifecycleStatus.under_review,
  );
  assert.equal(
    lifecycleReadiness({
      activeCharters: 1,
      approvedPolicies: 3,
      activeCouncils: 1,
      activeDecisionRights: 4,
      latestMaturityScore: 82,
      openImprovements: 3,
    }),
    GovernanceLifecycleStatus.approved,
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
