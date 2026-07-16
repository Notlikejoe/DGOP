import assert from 'node:assert/strict';
import {
  ArchitectureReviewDecision,
  MdmMatchStatus,
  MdmResolutionStep,
  MetadataCertificationStatus,
  ReferenceDataVersionStatus,
} from '@prisma/client';
import {
  certificationStatus,
  clampScore,
  defaultMatchStatus,
  defaultMatchStep,
  isArchitectureDecisionFinal,
  referenceVersionStatus,
} from '../src/extended-domains/extended-domains.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('match scoring defaults guide the five-step resolution flow', () => {
  assert.equal(clampScore(121), 100);
  assert.equal(clampScore(-10), 0);
  assert.equal(defaultMatchStatus(91), MdmMatchStatus.under_review);
  assert.equal(defaultMatchStep(96), MdmResolutionStep.survivorship);
  assert.equal(defaultMatchStep(82), MdmResolutionStep.compare);
  assert.equal(defaultMatchStep(40), MdmResolutionStep.identify);
});

test('metadata certification requires scores and operating checks', () => {
  assert.equal(
    certificationStatus({
      qualityScore: 85,
      completenessScore: 90,
      ownerConfirmed: true,
      glossaryAligned: true,
      lineageReviewed: true,
    }),
    MetadataCertificationStatus.certified,
  );
  assert.equal(
    certificationStatus({
      qualityScore: 85,
      completenessScore: 90,
      ownerConfirmed: true,
      glossaryAligned: false,
      lineageReviewed: true,
    }),
    MetadataCertificationStatus.needs_remediation,
  );
});

test('reference and architecture decisions map to stable states', () => {
  assert.equal(referenceVersionStatus('submit'), ReferenceDataVersionStatus.under_review);
  assert.equal(referenceVersionStatus('activate'), ReferenceDataVersionStatus.active);
  assert.equal(referenceVersionStatus('reject'), ReferenceDataVersionStatus.rejected);
  assert.equal(isArchitectureDecisionFinal(ArchitectureReviewDecision.pending), false);
  assert.equal(isArchitectureDecisionFinal(ArchitectureReviewDecision.approved_with_conditions), true);
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      console.error(`  ✗ ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
