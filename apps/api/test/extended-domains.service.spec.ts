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
  evaluateMdmMatch,
  isArchitectureDecisionFinal,
  rankMdmMatches,
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

test('MDM matching engine scores identity, context, and survivorship signals', () => {
  const result = evaluateMdmMatch(
    {
      id: 'asset-1',
      code: 'CUST-MASTER',
      nameEn: 'Customer Master Records',
      description: 'Golden customer profile for CRM and onboarding',
      domainId: 'domain-customer',
      domainCode: 'CUSTOMER',
      systemId: 'crm',
      systemCode: 'CRM',
      capabilityId: 'cap-onboarding',
      classificationId: 'restricted',
      externalCatalogId: 'crm.customer.master',
      catalogSource: 'catalog-a',
      catalogTrustLevel: 'authoritative',
      subjects: ['CUSTOMER'],
    },
    {
      id: 'asset-2',
      code: 'CUSTOMER-PROFILE',
      nameEn: 'Customer Profile Master',
      description: 'CRM customer onboarding profile',
      domainId: 'domain-customer',
      domainCode: 'CUSTOMER',
      systemId: 'crm',
      systemCode: 'CRM',
      capabilityId: 'cap-onboarding',
      classificationId: 'restricted',
      externalCatalogId: 'crm.customer.master',
      catalogSource: 'catalog-a',
      catalogTrustLevel: 'trusted',
      subjects: ['CUSTOMER'],
    },
  );

  assert.ok(result);
  assert.ok(result.matchScore >= 85);
  assert.equal(result.status, MdmMatchStatus.under_review);
  assert.equal(result.resolutionStep, MdmResolutionStep.survivorship);
  assert.equal(result.proposedGoldenRecordJson['preferredRecordAssetId'], 'asset-1');
  assert.ok(result.factors.some((factor) => factor.key === 'system_catalog' && factor.score === 100));
});

test('rankMdmMatches filters below-threshold pairs and ignores self matches', () => {
  const source = {
    id: 'asset-1',
    code: 'FIN-LEDGER',
    nameEn: 'Finance Ledger',
    domainId: 'finance',
    catalogTrustLevel: 'trusted',
  };
  const results = rankMdmMatches(
    [source],
    [
      source,
      {
        id: 'asset-2',
        code: 'HR-TRAINING',
        nameEn: 'Training Attendance',
        domainId: 'hr',
        catalogTrustLevel: 'observed',
      },
      {
        id: 'asset-3',
        code: 'FIN-LEDGER-COPY',
        nameEn: 'Finance Ledger Extract',
        domainId: 'finance',
        catalogTrustLevel: 'observed',
      },
    ],
    { threshold: 60, limit: 5 },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].candidateAssetId, 'asset-3');
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

test('runMdmMatching creates governed candidates with engine explanations', async () => {
  let assetQuery = 0;
  let persisted: any;
  let auditMetadata: any;
  const assetRow = (id: string, code: string, nameEn: string, different = false) => ({
    id,
    code,
    nameEn,
    nameAr: nameEn,
    description: different ? 'Training attendance and course completion log' : 'Customer master profile used by CRM onboarding',
    ownerName: different ? 'HR Office' : 'Customer Office',
    domainId: different ? 'domain-hr' : 'domain-customer',
    orgUnitId: different ? 'org-hr' : 'org-customer',
    systemId: different ? 'lms' : 'crm',
    capabilityId: different ? 'cap-training' : 'cap-onboarding',
    classificationId: different ? 'internal' : 'restricted',
    externalCatalogId: id === 'asset-1' || id === 'asset-2' ? 'crm.customer.master' : null,
    catalogSource: different ? 'catalog-b' : 'catalog-a',
    catalogTrustLevel: id === 'asset-1' ? 'authoritative' : 'trusted',
    domain: different ? { id: 'domain-hr', code: 'HR' } : { id: 'domain-customer', code: 'CUSTOMER' },
    system: different ? { id: 'lms', code: 'LMS' } : { id: 'crm', code: 'CRM' },
    subjects: [{ dataSubject: different ? { code: 'EMPLOYEE', nameEn: 'Employee', nameAr: 'Employee' } : { code: 'CUSTOMER', nameEn: 'Customer', nameAr: 'Customer' } }],
  });
  const service = new ExtendedDomainsService(
    {
      dataAsset: {
        findMany: async () => {
          assetQuery++;
          return assetQuery === 1
            ? [assetRow('asset-1', 'CUST-MASTER', 'Customer Master Records')]
            : [
                assetRow('asset-2', 'CUSTOMER-PROFILE', 'Customer Profile Master'),
                assetRow('asset-3', 'HR-TRAINING', 'Training Attendance', true),
              ];
        },
      },
      mdmMatchCandidate: {
        findMany: async () => [],
        count: async () => 0,
        upsert: async (args: any) => {
          persisted = args.create;
          return { id: 'match-1', ...args.create };
        },
      },
    } as never,
    {
      log: async (entry: any) => {
        auditMetadata = entry.metadata;
      },
    } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  const result = await service.runMdmMatching(
    ['system_admin'],
    { sourceAssetId: 'asset-1', threshold: 60, limit: 5 },
    'admin@dgop.local',
  );

  assert.equal(result.createdCount, 1);
  assert.equal(persisted.sourceAssetId, 'asset-1');
  assert.equal(persisted.candidateAssetId, 'asset-2');
  assert.ok(persisted.matchScore >= 85);
  assert.equal(persisted.survivorshipRulesJson.engine, 'mdm_asset_match_v1');
  assert.equal(persisted.proposedGoldenRecordJson.preferredRecordAssetId, 'asset-1');
  assert.equal(auditMetadata.createdCount, 1);
});

test('runMdmMatching skips existing reverse-direction match candidates', async () => {
  let persisted = false;
  const assetRow = (id: string) => ({
    id,
    code: id === 'asset-1' ? 'FIN-LEDGER' : 'FIN-LEDGER-COPY',
    nameEn: id === 'asset-1' ? 'Finance Ledger' : 'Finance Ledger Copy',
    nameAr: 'Finance Ledger',
    description: 'Finance ledger master data',
    ownerName: 'Finance Office',
    domainId: 'finance',
    orgUnitId: 'finance-org',
    systemId: 'erp',
    capabilityId: 'cap-finance',
    classificationId: 'restricted',
    externalCatalogId: null,
    catalogSource: 'catalog-a',
    catalogTrustLevel: 'trusted',
    domain: { id: 'finance', code: 'FIN' },
    system: { id: 'erp', code: 'ERP' },
    subjects: [],
  });
  let assetQuery = 0;
  const service = new ExtendedDomainsService(
    {
      dataAsset: {
        findMany: async () => {
          assetQuery++;
          return assetQuery === 1 ? [assetRow('asset-1')] : [assetRow('asset-2')];
        },
      },
      mdmMatchCandidate: {
        findMany: async () => [{ sourceAssetId: 'asset-2', candidateAssetId: 'asset-1' }],
        upsert: async () => {
          persisted = true;
          return {};
        },
      },
    } as never,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  const result = await service.runMdmMatching(
    ['system_admin'],
    { sourceAssetId: 'asset-1', threshold: 60, limit: 5 },
    'admin@dgop.local',
  );

  assert.equal(result.recommendedCount, 1);
  assert.equal(result.createdCount, 0);
  assert.equal(result.skippedExistingCount, 1);
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
