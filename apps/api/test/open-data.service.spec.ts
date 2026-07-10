import assert from 'node:assert/strict';
import {
  OpenDataCandidateStatus,
  OpenDataPersonalDataAssessment,
  OpenDataPublicationFormat,
  OpenDataPublicationFrequency,
} from '@prisma/client';
import { OpenDataService } from '../src/open-data/open-data.service';
import {
  canTransitionOpenDataStatus,
  scoreOpenDataEligibility,
} from '../src/open-data/open-data.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

const allScope = { orgUnits: 'all', domains: 'all', maxClassRank: null };
const scopedFinance = { orgUnits: 'all', domains: ['finance'], maxClassRank: 2 };

const asset = {
  id: 'asset-1',
  code: 'AST-OPEN',
  nameEn: 'Public Finance Extract',
  nameAr: 'مستخلص مالي عام',
  description: 'Demo asset',
  ownerStatus: 'assigned',
  ownerName: 'Owner',
  domainId: 'finance',
  orgUnitId: null,
  classificationId: 'class-internal',
  classification: { id: 'class-internal', code: 'internal', nameEn: 'Internal', nameAr: 'داخلي', rank: 2, color: '#1f6feb' },
  subjects: [],
};

const restrictedAsset = {
  ...asset,
  id: 'asset-secret',
  classificationId: 'class-secret',
  classification: { id: 'class-secret', code: 'secret', nameEn: 'Secret', nameAr: 'سري', rank: 4, color: '#c0392b' },
  subjects: [{ dataSubject: { id: 'subject-patient', code: 'patient', nameEn: 'Patient', nameAr: 'مريض' } }],
};

function makeService(overrides: Record<string, any> = {}) {
  const data: Record<string, any> = {
    scope: overrides.scope ?? allScope,
    visibleAssets: overrides.visibleAssets ?? [asset],
    asset: overrides.asset ?? asset,
    candidate: overrides.candidate,
    existingCandidate: overrides.existingCandidate ?? null,
    dqScore: overrides.dqScore ?? { id: 'score-1', score: 88 },
    dqProfile: overrides.dqProfile ?? null,
    assignments: overrides.assignments ?? [
      { personId: 'owner-1', roleType: { code: 'data_owner' } },
      { personId: 'steward-1', roleType: { code: 'business_steward' } },
    ],
    created: null,
    updated: null,
    audit: [],
  };

  const prisma = {
    dataAsset: {
      findMany: async () => data.visibleAssets.map((a: any) => ({ id: a.id })),
      findFirst: async (args: any) => {
        if (args?.where?.id === data.asset.id) return data.asset;
        if (args?.where?.id === restrictedAsset.id && data.asset.id === restrictedAsset.id) return data.asset;
        return null;
      },
    },
    person: {
      findFirst: async (args: any) => {
        const id = args?.where?.id;
        return id && !String(id).startsWith('missing') ? { id } : null;
      },
    },
    stewardshipAssignment: {
      findMany: async () => data.assignments,
    },
    dataQualityScore: {
      findFirst: async () => data.dqScore,
    },
    dataQualityProfile: {
      findFirst: async () => data.dqProfile,
    },
    openDataCandidate: {
      count: async () => 0,
      findUnique: async () => null,
      findFirst: async (args: any) => {
        if (args?.where?.AND) return data.candidate ?? null;
        return data.existingCandidate;
      },
      create: async (args: any) => {
        data.created = args.data;
        return { id: 'candidate-1', ...args.data, asset: data.asset };
      },
      update: async (args: any) => {
        data.updated = args.data;
        return { ...(data.candidate ?? { id: 'candidate-1', code: 'ODC-1' }), ...args.data, asset: data.asset };
      },
      findMany: async () => [],
    },
  };
  const audit = { log: async (entry: any) => data.audit.push(entry) };
  const scope = { resolve: async () => data.scope };
  return { service: new OpenDataService(prisma as any, audit as any, scope as any), data };
}

test('eligibility flags restricted personal data as blocked', () => {
  const result = scoreOpenDataEligibility({
    classificationRank: 4,
    qualityScore: 91,
    personalDataAssessment: OpenDataPersonalDataAssessment.sensitive_personal_data,
    ownerPersonId: 'owner',
    stewardPersonId: 'steward',
    publicationValueScore: 80,
  });
  assert.equal(result.overallSignal, 'blocked');
  assert.ok(result.blockers.includes('classificationSignal'));
  assert.ok(result.blockers.includes('personalDataSignal'));
});

test('status lifecycle rejects direct draft to published transition', () => {
  assert.equal(
    canTransitionOpenDataStatus(OpenDataCandidateStatus.draft, OpenDataCandidateStatus.published),
    false,
  );
  assert.equal(
    canTransitionOpenDataStatus(OpenDataCandidateStatus.under_review, OpenDataCandidateStatus.approved),
    true,
  );
});

test('create: links asset defaults, DQ score, people, and eligibility signals', async () => {
  const { service, data } = makeService();
  const candidate = await service.create(
    ['system_admin'],
    {
      assetId: asset.id,
      publicationFrequency: OpenDataPublicationFrequency.quarterly,
      publicationFormat: OpenDataPublicationFormat.csv,
      personalDataAssessment: OpenDataPersonalDataAssessment.aggregated,
      publicationValueScore: 82,
    },
    'admin@dgop.local',
  );
  assert.equal(candidate.code, 'ODC-0001');
  assert.equal(data.created.ownerPersonId, 'owner-1');
  assert.equal(data.created.stewardPersonId, 'steward-1');
  assert.equal(data.created.dqScoreId, 'score-1');
  assert.equal(data.created.dataQualitySignal, 'ready');
  assert.equal(data.created.personalDataSignal, 'ready');
  assert.equal(data.audit[0].action, 'open_data_candidate.create');
});

test('create: rejects another active candidate for the same asset', async () => {
  const { service } = makeService({
    existingCandidate: { id: 'existing', status: OpenDataCandidateStatus.assessment },
  });
  await assert.rejects(
    () => service.create(['system_admin'], { assetId: asset.id }, 'admin@dgop.local'),
    /already exists/,
  );
});

test('create: scoped users cannot register hidden assets', async () => {
  const { service } = makeService({ scope: scopedFinance, visibleAssets: [] });
  await assert.rejects(
    () => service.create(['data_owner'], { assetId: asset.id }, 'owner@dgop.local'),
    /data asset not found/,
  );
});

test('updateStatus: approval is blocked when eligibility has blockers', async () => {
  const candidate = {
    id: 'candidate-secret',
    code: 'ODC-SECRET',
    assetId: restrictedAsset.id,
    status: OpenDataCandidateStatus.under_review,
    ownerPersonId: 'owner-1',
    stewardPersonId: 'steward-1',
    personalDataAssessment: OpenDataPersonalDataAssessment.sensitive_personal_data,
    publicationValueScore: 90,
    publicationFrequency: OpenDataPublicationFrequency.monthly,
    publishedAt: null,
    nextReviewAt: null,
  };
  const { service } = makeService({
    asset: restrictedAsset,
    visibleAssets: [restrictedAsset],
    candidate,
    dqScore: { id: 'score-2', score: 92 },
  });
  await assert.rejects(
    () =>
      service.updateStatus(
        ['system_admin'],
        candidate.id,
        { status: OpenDataCandidateStatus.approved },
        'admin@dgop.local',
      ),
    /review items/,
  );
});

test('updateStatus: approval is blocked while readiness still needs review', async () => {
  const candidate = {
    id: 'candidate-review',
    code: 'ODC-REVIEW',
    assetId: asset.id,
    status: OpenDataCandidateStatus.under_review,
    ownerPersonId: 'owner-1',
    stewardPersonId: 'steward-1',
    personalDataAssessment: OpenDataPersonalDataAssessment.aggregated,
    publicationValueScore: 90,
    publicationFrequency: OpenDataPublicationFrequency.monthly,
    publishedAt: null,
    nextReviewAt: null,
  };
  const { service } = makeService({
    candidate,
    dqScore: { id: 'score-review', score: 72 },
  });
  await assert.rejects(
    () =>
      service.updateStatus(
        ['system_admin'],
        candidate.id,
        { status: OpenDataCandidateStatus.approved },
        'admin@dgop.local',
      ),
    /review items/,
  );
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
