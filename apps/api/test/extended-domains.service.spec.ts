import assert from 'node:assert/strict';
import {
  ArchitectureReviewDecision,
  MdmMatchStatus,
  MdmResolutionStep,
  MetadataCertificationStatus,
  ReferenceDataVersionStatus,
} from '@prisma/client';
import { ExtendedDomainsService } from '../src/extended-domains/extended-domains.service';
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

test('extended-domain creates reject hidden or non-linkable evidence IDs', async () => {
  let workflowOpened = false;
  const service = new ExtendedDomainsService(
    {
      dataAsset: {
        findFirst: async () => ({ id: 'asset-1', code: 'AST-1', nameEn: 'Asset', domainId: 'domain-1' }),
      },
      person: { findFirst: async () => null },
      ndiEvidence: { findFirst: async () => null },
      metadataCertification: {
        count: async () => 0,
        create: async () => {
          throw new Error('hidden evidence should block before metadata certification persistence');
        },
      },
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: ['domain-1'], maxClassRank: 2 }) } as never,
    {
      openRoutedCase: async () => {
        workflowOpened = true;
        return { id: 'wf-1' };
      },
    } as never,
  );

  await assert.rejects(
    () =>
      service.createCertification(
        ['metadata_steward'],
        {
          assetId: 'asset-1',
          qualityScore: 80,
          completenessScore: 80,
          evidenceId: 'evidence-hidden',
        },
        'steward@dgop.local',
      ),
    /evidence not found/,
  );
  assert.equal(workflowOpened, false);
});

test('restricted users cannot create unanchored reference data versions', async () => {
  let persisted = false;
  const service = new ExtendedDomainsService(
    {
      referenceDataVersion: {
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
    () =>
      service.createReferenceVersion(
        ['reference_steward'],
        {
          code: 'REF-1',
          name: 'Reference list',
          version: '1.0',
        },
        'steward@dgop.local',
      ),
    /Reference data versions need a visible asset or domain/,
  );
  assert.equal(persisted, false);
});

test('MDM match creators cannot make their own final resolution decision', async () => {
  let updated = false;
  const service = new ExtendedDomainsService(
    {
      mdmMatchCandidate: {
        findFirst: async () => ({ id: 'match-1', createdBy: 'creator@dgop.local' }),
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
      service.resolveMatch(
        ['system_admin'],
        'match-1',
        { status: MdmMatchStatus.merged },
        'creator@dgop.local',
      ),
    /creators cannot make the final resolution decision/,
  );
  assert.equal(updated, false);
});

test('reference version creators cannot approve their own version', async () => {
  let updated = false;
  const service = new ExtendedDomainsService(
    {
      referenceDataVersion: {
        findFirst: async () => ({ id: 'ref-1', createdBy: 'creator@dgop.local' }),
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
      service.decideReferenceVersion(
        ['system_admin'],
        'ref-1',
        { decision: 'approve' },
        'creator@dgop.local',
      ),
    /creators cannot make the final decision/,
  );
  assert.equal(updated, false);
});

test('metadata certification creators cannot certify their own metadata', async () => {
  let updated = false;
  const service = new ExtendedDomainsService(
    {
      metadataCertification: {
        findFirst: async () => ({
          id: 'cert-1',
          createdBy: 'creator@dgop.local',
          qualityScore: 90,
          completenessScore: 90,
          ownerConfirmed: true,
          glossaryAligned: true,
          lineageReviewed: true,
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
      service.saveCertification(
        ['system_admin'],
        'cert-1',
        { status: MetadataCertificationStatus.certified },
        'creator@dgop.local',
      ),
    /creators cannot certify their own metadata/,
  );
  assert.equal(updated, false);
});

test('architecture review creators cannot make their own final decision', async () => {
  let updated = false;
  const service = new ExtendedDomainsService(
    {
      architectureReview: {
        findFirst: async () => ({ id: 'review-1', createdBy: 'creator@dgop.local' }),
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
      service.decideArchitectureReview(
        ['system_admin'],
        'review-1',
        { decision: ArchitectureReviewDecision.approved },
        'creator@dgop.local',
      ),
    /creators cannot make the final decision/,
  );
  assert.equal(updated, false);
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
