import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import {
  OpenDataApprovalDecision,
  OpenDataCandidateStatus,
  OpenDataPersonalDataAssessment,
  OpenDataPublicationFormat,
  OpenDataPublicationFrequency,
  OpenDataReviewDecision,
} from '@prisma/client';
import { OpenDataService } from '../src/open-data/open-data.service';
import {
  canTransitionOpenDataStatus,
  scoreOpenDataAssessment,
  scoreOpenDataEligibility,
} from '../src/open-data/open-data.logic';

process.env.EVIDENCE_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'dgop-open-data-evidence-'));

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
    assessments: overrides.assessments ?? [],
    approvals: overrides.approvals ?? [],
    publications: overrides.publications ?? [],
    reviews: overrides.reviews ?? [],
    usageMetrics: overrides.usageMetrics ?? [],
    ndiSpec: Object.prototype.hasOwnProperty.call(overrides, 'ndiSpec')
      ? overrides.ndiSpec
      : { id: 'spec-open-data' },
    workflowCases: [],
    workflowTasks: [],
    evidence: [],
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
        if (data.candidate) data.candidate = { ...data.candidate, ...args.data };
        return { ...(data.candidate ?? { id: 'candidate-1', code: 'ODC-1' }), ...args.data, asset: data.asset };
      },
      findMany: async () => [],
    },
    openDataAssessment: {
      create: async (args: any) => {
        const row = { id: `assessment-${data.assessments.length + 1}`, ...args.data };
        data.assessments.push(row);
        return row;
      },
      findFirst: async () => data.assessments.find((row: any) => row.status === 'completed') ?? null,
      update: async (args: any) => {
        const index = data.assessments.findIndex((row: any) => row.id === args.where.id);
        if (index >= 0) data.assessments[index] = { ...data.assessments[index], ...args.data };
        return data.assessments[index] ?? null;
      },
    },
    openDataApproval: {
      count: async () => data.approvals.filter((row: any) => row.decision === 'pending').length,
      findMany: async () => data.approvals,
      findFirst: async (args: any) =>
        data.approvals.find((row: any) => row.id === args?.where?.id && row.candidateId === args?.where?.candidateId) ?? null,
      upsert: async (args: any) => {
        const key = args.where.candidateId_step;
        const index = data.approvals.findIndex((row: any) => row.candidateId === key.candidateId && row.step === key.step);
        if (index >= 0) {
          data.approvals[index] = { ...data.approvals[index], ...args.update };
          return data.approvals[index];
        }
        const row = { id: `approval-${data.approvals.length + 1}`, ...args.create };
        data.approvals.push(row);
        return row;
      },
      update: async (args: any) => {
        const index = data.approvals.findIndex((row: any) => row.id === args.where.id);
        data.approvals[index] = { ...data.approvals[index], ...args.data };
        return data.approvals[index];
      },
    },
    openDataPublication: {
      create: async (args: any) => {
        const row = { id: `publication-${data.publications.length + 1}`, ...args.data };
        data.publications.push(row);
        return row;
      },
      update: async (args: any) => {
        const index = data.publications.findIndex((row: any) => row.id === args.where.id);
        if (index >= 0) data.publications[index] = { ...data.publications[index], ...args.data };
        return data.publications[index] ?? null;
      },
    },
    openDataReview: {
      create: async (args: any) => {
        const row = { id: `review-${data.reviews.length + 1}`, ...args.data };
        data.reviews.push(row);
        return row;
      },
    },
    openDataUsageMetric: {
      aggregate: async () => ({
        _sum: {
          downloads: data.usageMetrics.reduce((sum: number, row: any) => sum + row.downloads, 0),
          apiCalls: data.usageMetrics.reduce((sum: number, row: any) => sum + row.apiCalls, 0),
          uniqueUsers: data.usageMetrics.reduce((sum: number, row: any) => sum + row.uniqueUsers, 0),
        },
      }),
      create: async (args: any) => {
        const row = { id: `usage-${data.usageMetrics.length + 1}`, ...args.data };
        data.usageMetrics.push(row);
        return row;
      },
    },
    workflowCase: {
      count: async () => data.workflowCases.length,
      findUnique: async () => null,
      create: async (args: any) => {
        const row = { id: `case-${data.workflowCases.length + 1}`, ...args.data };
        data.workflowCases.push(row);
        return args.select ? { id: row.id } : row;
      },
    },
    workflowTask: {
      create: async (args: any) => {
        const row = { id: `task-${data.workflowTasks.length + 1}`, ...args.data };
        data.workflowTasks.push(row);
        return args.select ? { id: row.id } : row;
      },
      update: async (args: any) => {
        const index = data.workflowTasks.findIndex((row: any) => row.id === args.where.id);
        if (index >= 0) data.workflowTasks[index] = { ...data.workflowTasks[index], ...args.data };
        return data.workflowTasks[index] ?? null;
      },
    },
    workflowEvent: {
      create: async (args: any) => args.data,
    },
    ndiSpecification: {
      findFirst: async () => data.ndiSpec,
    },
    ndiEvidence: {
      create: async (args: any) => {
        const row = { id: `evidence-${data.evidence.length + 1}`, ...args.data };
        data.evidence.push(row);
        return args.select ? { id: row.id } : row;
      },
    },
    auditLog: {
      create: async (args: any) => data.audit.push(args.data),
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  const audit = { log: async (entry: any) => data.audit.push(entry) };
  const scope = { resolve: async () => data.scope };
  const workflow = {
    openRoutedCase: async (input: any) => {
      const task = {
        id: `task-${data.workflowTasks.length + 1}`,
        caseId: `case-${data.workflowCases.length + 1}`,
        title: input.initialTaskTitle,
        type: 'approval',
        status: 'pending',
        assigneeUserId: input.initialAssigneeUserId ?? null,
        dueDate: input.initialDueDate ?? null,
      };
      const wfCase = {
        id: task.caseId,
        code: input.preferredCode,
        title: input.title,
        description: input.description,
        type: input.type,
        status: input.status,
        assetId: input.assetId ?? null,
        tasks: [task],
      };
      data.workflowCases.push(wfCase);
      data.workflowTasks.push(task);
      return wfCase;
    },
  };
  return { service: new OpenDataService(prisma as any, audit as any, scope as any, workflow as any), data };
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

test('assessment scoring blocks publication when public, privacy, legal, or metadata checks fail', () => {
  const result = scoreOpenDataAssessment({
    publicClassification: false,
    restrictedInformation: true,
    aggregationApplied: false,
    anonymizationApplied: false,
    dqAcceptable: true,
    metadataComplete: false,
    privacyReviewComplete: false,
    legalReviewComplete: true,
    personalDataAssessment: OpenDataPersonalDataAssessment.personal_data,
  });
  assert.equal(result.resultSignal, 'blocked');
  assert.ok(result.blockers.includes('publicClassification'));
  assert.ok(result.blockers.includes('restrictedInformation'));
  assert.ok(result.blockers.includes('metadataComplete'));
  assert.ok(result.requiredApprovalSteps.includes('odiao'));
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

test('list rejects invalid candidate status before Prisma receives it', async () => {
  let candidateFinds = 0;
  const service = new OpenDataService(
    {
      openDataCandidate: {
        findMany: async () => {
          candidateFinds++;
          return [];
        },
        count: async () => 0,
      },
    } as never,
    { log: async () => undefined } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  await assert.rejects(
    () => service.list(['open_data_officer'], { status: 'publishedish', page: '1', pageSize: '10' }),
    BadRequestException,
  );
  assert.equal(candidateFinds, 0);
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

test('saveAssessment: completed assessment creates approval tasks and ODIAO workflow link', async () => {
  const candidate = {
    id: 'candidate-ready',
    code: 'ODC-READY',
    assetId: asset.id,
    titleEn: 'Ready dataset',
    titleAr: 'Ready dataset',
    status: OpenDataCandidateStatus.assessment,
    ownerPersonId: 'owner-1',
    stewardPersonId: 'steward-1',
    odiaoReviewerPerson: { userId: 'user-odiao' },
    personalDataAssessment: OpenDataPersonalDataAssessment.aggregated,
    publicationValueScore: 90,
    publicationFrequency: OpenDataPublicationFrequency.monthly,
    publicationFormat: OpenDataPublicationFormat.csv,
    eligibilityScore: 100,
    eligibilityJson: { overallSignal: 'ready' },
    createdBy: 'owner@dgop.local',
    publishedAt: null,
    nextReviewAt: null,
  };
  const { service, data } = makeService({ candidate, dqScore: { id: 'score-ready', score: 94 } });
  await service.saveAssessment(
    ['system_admin'],
    candidate.id,
    {
      complete: true,
      publicClassification: true,
      restrictedInformation: false,
      aggregationApplied: true,
      anonymizationApplied: true,
      dqAcceptable: true,
      metadataComplete: true,
      privacyReviewComplete: true,
      legalReviewComplete: true,
      note: 'Ready for approval.',
    },
    'odiao@dgop.local',
  );
  assert.equal(data.assessments.length, 1);
  assert.equal(data.assessments[0].status, 'completed');
  assert.equal(data.approvals.length, 6);
  assert.ok(data.approvals.some((row: any) => row.step === 'odiao' && row.workflowCaseId));
  assert.equal(data.workflowCases[0].type, 'open_data_publication_approval');
  assert.equal(data.workflowTasks[0].assigneeUserId, 'user-odiao');
  assert.equal(data.updated.status, OpenDataCandidateStatus.under_review);
});

test('updateStatus: manual approval is blocked until all assessment approvals are approved', async () => {
  const candidate = {
    id: 'candidate-pending',
    code: 'ODC-PENDING',
    assetId: asset.id,
    status: OpenDataCandidateStatus.under_review,
    ownerPersonId: 'owner-1',
    stewardPersonId: 'steward-1',
    personalDataAssessment: OpenDataPersonalDataAssessment.aggregated,
    publicationValueScore: 90,
    publicationFrequency: OpenDataPublicationFrequency.monthly,
    publicationFormat: OpenDataPublicationFormat.csv,
    eligibilityScore: 100,
    eligibilityJson: { overallSignal: 'ready' },
    createdBy: 'owner@dgop.local',
    publishedAt: null,
    nextReviewAt: null,
  };
  const { service } = makeService({
    candidate,
    asset: {
      ...asset,
      classificationId: 'class-public',
      classification: { id: 'class-public', code: 'public', nameEn: 'Public', nameAr: 'Public', rank: 1, color: '#2ecc71' },
    },
    dqScore: { id: 'score-ready', score: 94 },
    assessments: [{ status: 'completed', resultSignal: 'ready' }],
    approvals: [{ id: 'approval-1', candidateId: candidate.id, step: 'owner', decision: OpenDataApprovalDecision.pending }],
  });
  await assert.rejects(
    () =>
      service.updateStatus(
        ['system_admin'],
        candidate.id,
        { status: OpenDataCandidateStatus.approved },
        'admin@dgop.local',
      ),
    /approvals/,
  );
});

test('updateApproval: all approved steps move candidate to approved', async () => {
  const candidate = {
    id: 'candidate-approval',
    code: 'ODC-APPROVAL',
    assetId: asset.id,
    status: OpenDataCandidateStatus.under_review,
    ownerPersonId: 'owner-1',
    stewardPersonId: 'steward-1',
    personalDataAssessment: OpenDataPersonalDataAssessment.aggregated,
    publicationValueScore: 90,
    publicationFrequency: OpenDataPublicationFrequency.monthly,
    publicationFormat: OpenDataPublicationFormat.csv,
    eligibilityScore: 100,
    eligibilityJson: { overallSignal: 'ready' },
    createdBy: 'owner@dgop.local',
    publishedAt: null,
    nextReviewAt: null,
  };
  const approvals = ['owner', 'steward', 'privacy', 'legal', 'data_quality', 'odiao'].map((step, index) => ({
    id: `approval-${index + 1}`,
    candidateId: candidate.id,
    step,
    decision: step === 'odiao' ? OpenDataApprovalDecision.pending : OpenDataApprovalDecision.approved,
  }));
  const { service, data } = makeService({ candidate, approvals });
  data.assessments.push({
    id: 'assessment-approved',
    candidateId: candidate.id,
    status: 'completed',
    evidenceId: null,
    readinessScore: 100,
    riskScore: 0,
    resultSignal: 'ready',
    blockersJson: [],
    reviewItemsJson: [],
  });
  await service.updateApproval(
    ['system_admin'],
    candidate.id,
    'approval-6',
    { decision: OpenDataApprovalDecision.approved, note: 'Approved.' },
    'odiao@dgop.local',
  );
  assert.equal(data.updated.status, OpenDataCandidateStatus.approved);
  assert.equal(data.approvals.find((row: any) => row.id === 'approval-6').decidedBy, 'odiao@dgop.local');
  assert.equal(data.evidence.length, 1);
  assert.equal(data.evidence[0].specId, 'spec-open-data');
  assert.equal(data.evidence[0].status, 'submitted');
  assert.equal(data.evidence[0].reviewedBy, null);
  assert.equal(data.assessments[0].evidenceId, 'evidence-1');
});

test('updateApproval: rejects users without authority for the approval step', async () => {
  const candidate = {
    id: 'candidate-authz',
    code: 'ODC-AUTHZ',
    assetId: asset.id,
    status: OpenDataCandidateStatus.under_review,
    ownerPersonId: 'owner-1',
    ownerPerson: { email: 'owner@dgop.local' },
    stewardPersonId: 'steward-1',
    personalDataAssessment: OpenDataPersonalDataAssessment.aggregated,
    publicationValueScore: 90,
    publicationFrequency: OpenDataPublicationFrequency.monthly,
    publicationFormat: OpenDataPublicationFormat.csv,
    eligibilityScore: 100,
    eligibilityJson: { overallSignal: 'ready' },
    createdBy: 'owner@dgop.local',
    publishedAt: null,
    nextReviewAt: null,
  };
  const approvals = [{ id: 'approval-owner', candidateId: candidate.id, step: 'owner', decision: OpenDataApprovalDecision.pending }];
  const { service } = makeService({ candidate, approvals });
  await assert.rejects(
    () =>
      service.updateApproval(
        ['auditor'],
        candidate.id,
        'approval-owner',
        { decision: OpenDataApprovalDecision.approved },
        'auditor@dgop.local',
      ),
    /cannot decide/,
  );
});

test('updateApproval: missing OD NDI spec fails closed instead of skipping evidence', async () => {
  const candidate = {
    id: 'candidate-missing-spec',
    code: 'ODC-NOSPEC',
    assetId: asset.id,
    status: OpenDataCandidateStatus.under_review,
    ownerPersonId: 'owner-1',
    stewardPersonId: 'steward-1',
    personalDataAssessment: OpenDataPersonalDataAssessment.aggregated,
    publicationValueScore: 90,
    publicationFrequency: OpenDataPublicationFrequency.monthly,
    publicationFormat: OpenDataPublicationFormat.csv,
    eligibilityScore: 100,
    eligibilityJson: { overallSignal: 'ready' },
    createdBy: 'owner@dgop.local',
    publishedAt: null,
    nextReviewAt: null,
  };
  const approvals = ['owner', 'steward', 'privacy', 'legal', 'data_quality', 'odiao'].map((step, index) => ({
    id: `approval-nospec-${index + 1}`,
    candidateId: candidate.id,
    step,
    decision: step === 'odiao' ? OpenDataApprovalDecision.pending : OpenDataApprovalDecision.approved,
  }));
  const { service, data } = makeService({ candidate, approvals, ndiSpec: null });
  data.assessments.push({
    id: 'assessment-nospec',
    candidateId: candidate.id,
    status: 'completed',
    evidenceId: null,
    readinessScore: 100,
    riskScore: 0,
    resultSignal: 'ready',
    blockersJson: [],
    reviewItemsJson: [],
  });
  await assert.rejects(
    () =>
      service.updateApproval(
        ['system_admin'],
        candidate.id,
        'approval-nospec-6',
        { decision: OpenDataApprovalDecision.approved },
        'odiao@dgop.local',
      ),
    /Required Open Data NDI specification/,
  );
});

test('publish: creates portal sync record and moves candidate to published', async () => {
  const candidate = {
    id: 'candidate-publish',
    code: 'ODC-PUBLISH',
    assetId: asset.id,
    status: OpenDataCandidateStatus.approved,
    ownerPersonId: 'owner-1',
    stewardPersonId: 'steward-1',
    personalDataAssessment: OpenDataPersonalDataAssessment.aggregated,
    publicationValueScore: 90,
    publicationFrequency: OpenDataPublicationFrequency.monthly,
    publicationFormat: OpenDataPublicationFormat.csv,
    eligibilityScore: 100,
    eligibilityJson: { overallSignal: 'ready' },
    createdBy: 'owner@dgop.local',
    portalUrl: null,
    publishedAt: null,
    nextReviewAt: null,
  };
  const approvals = ['owner', 'steward', 'privacy', 'legal', 'data_quality', 'odiao'].map((step, index) => ({
    id: `approval-${index + 1}`,
    candidateId: candidate.id,
    step,
    decision: OpenDataApprovalDecision.approved,
  }));
  const { service, data } = makeService({
    candidate,
    approvals,
    assessments: [{ status: 'completed', resultSignal: 'ready' }],
  });
  await service.publish(
    ['system_admin'],
    candidate.id,
    { portalUrl: 'https://data.gov.sa/datasets/ODC-PUBLISH', portalRecordId: 'portal-1' },
    'odiao@dgop.local',
  );
  assert.equal(data.publications.length, 1);
  assert.equal(data.publications[0].syncStatus, 'simulated');
  assert.equal(data.evidence.length, 1);
  assert.equal(data.evidence[0].status, 'submitted');
  assert.equal(data.publications[0].evidenceId, 'evidence-1');
  assert.equal(data.updated.status, OpenDataCandidateStatus.published);
  assert.ok(data.updated.nextReviewAt);
});

test('createReview and recordUsage keep published data governed and measured', async () => {
  const candidate = {
    id: 'candidate-monitor',
    code: 'ODC-MONITOR',
    assetId: asset.id,
    status: OpenDataCandidateStatus.published,
    ownerPersonId: 'owner-1',
    stewardPersonId: 'steward-1',
    personalDataAssessment: OpenDataPersonalDataAssessment.aggregated,
    publicationValueScore: 90,
    publicationFrequency: OpenDataPublicationFrequency.monthly,
    publicationFormat: OpenDataPublicationFormat.csv,
    eligibilityScore: 100,
    eligibilityJson: { overallSignal: 'ready' },
    createdBy: 'owner@dgop.local',
    publishedAt: new Date(),
    nextReviewAt: null,
  };
  const { service, data } = makeService({ candidate });
  await service.recordUsage(
    ['system_admin'],
    candidate.id,
    { downloads: 22, apiCalls: 7, uniqueUsers: 5, source: 'portal_mock' },
    'odiao@dgop.local',
  );
  await service.createReview(
    ['system_admin'],
    candidate.id,
    { decision: OpenDataReviewDecision.continue_publication, note: 'Still useful.' },
    'odiao@dgop.local',
  );
  assert.equal(data.usageMetrics[0].downloads, 22);
  assert.equal(data.reviews[0].decision, OpenDataReviewDecision.continue_publication);
  assert.equal(data.updated.status, OpenDataCandidateStatus.published);
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
