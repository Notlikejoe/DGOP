import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalStatus,
  AssignmentTargetType,
  CaseStatus,
  NdiEvidenceStatus,
  OpenDataApprovalDecision,
  OpenDataAssessmentStatus,
  OpenDataCandidateStatus,
  OpenDataPersonalDataAssessment,
  OpenDataPortalSyncStatus,
  OpenDataPublicationFormat,
  OpenDataPublicationFrequency,
  OpenDataSignalStatus,
  Prisma,
  TaskDecision,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { parsePageParams, toPaged } from '../common/pagination';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CreateOpenDataCandidateDto,
  CreateOpenDataReviewDto,
  CreateOpenDataUsageMetricDto,
  PublishOpenDataCandidateDto,
  SaveOpenDataAssessmentDto,
  UpdateOpenDataApprovalDto,
  UpdateOpenDataCandidateDto,
  UpdateOpenDataStatusDto,
} from './open-data.dto';
import {
  canTransitionOpenDataStatus,
  nextOpenDataReviewDate,
  openDataApprovalGate,
  scoreOpenDataAssessment,
  type OpenDataEligibility,
  scoreOpenDataEligibility,
  statusForReviewDecision,
} from './open-data.logic';

export interface OpenDataCandidateFilters {
  search?: string;
  status?: OpenDataCandidateStatus;
  assetId?: string;
  page?: string | number;
  pageSize?: string | number;
}

const personSelect = {
  select: { id: true, fullNameEn: true, fullNameAr: true, email: true, jobTitle: true, userId: true },
};

const refSelect = { select: { id: true, code: true, nameEn: true, nameAr: true } };
const classificationSelect = {
  select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true },
};

const candidateInclude = {
  asset: {
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      ownerStatus: true,
      ownerName: true,
      domainId: true,
      orgUnitId: true,
      classificationId: true,
      domain: refSelect,
      classification: classificationSelect,
      subjects: { include: { dataSubject: refSelect } },
    },
  },
  classification: classificationSelect,
  dqScore: { select: { id: true, score: true, measuredAt: true, source: true } },
  ownerPerson: personSelect,
  stewardPerson: personSelect,
  odiaoReviewerPerson: personSelect,
  assessments: {
    orderBy: { createdAt: 'desc' as const },
    take: 3,
  },
  approvals: {
    include: {
      workflowCase: { select: { id: true, code: true, status: true } },
    },
    orderBy: { step: 'asc' as const },
  },
  publications: {
    orderBy: { publishedAt: 'desc' as const },
    take: 3,
  },
  reviews: {
    orderBy: { reviewDate: 'desc' as const },
    take: 3,
  },
  usageMetrics: {
    orderBy: { metricDate: 'desc' as const },
    take: 8,
  },
};

type CandidateWithInclude = Prisma.OpenDataCandidateGetPayload<{
  include: typeof candidateInclude;
}>;

const OPEN_DATA_NDI_SPEC_CODE = 'OD.1.1';
const OPEN_DATA_SYSTEM_EVIDENCE_MIME = 'application/json';
const OPEN_DATA_ADMIN_APPROVAL_ROLES = new Set(['system_admin', 'dmo_admin']);
const OPEN_DATA_APPROVAL_ROLE_RULES: Record<string, readonly string[]> = {
  owner: ['data_owner'],
  steward: ['business_steward', 'technical_steward', 'operational_data_steward', 'project_data_steward', 'enterprise_data_steward'],
  privacy: ['privacy_officer'],
  legal: ['dmo_admin'],
  data_quality: ['dq_steward'],
  odiao: ['od_officer'],
};

@Injectable()
export class OpenDataService {
  private readonly evidenceStorageDir = resolve(process.env.EVIDENCE_STORAGE_DIR || 'storage/evidence');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly workflow?: WorkflowService,
  ) {}

  private assetScopeWhere(scope: EffectiveScope): Prisma.DataAssetWhereInput {
    const where: Prisma.DataAssetWhereInput = { deletedAt: null };
    if (scope.orgUnits !== 'all') where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== 'all') where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [
        { classificationId: null },
        { classification: { rank: { lte: scope.maxClassRank } } },
      ];
    }
    return where;
  }

  private async visibleAssetIds(roleCodes: string[]): Promise<Set<string> | 'all'> {
    const scope = await this.scope.resolve(roleCodes);
    const unrestricted =
      scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
    if (unrestricted) return 'all';
    const rows = await this.prisma.dataAsset.findMany({
      where: this.assetScopeWhere(scope),
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  private candidateScopeWhere(assetIds: Set<string> | 'all'): Prisma.OpenDataCandidateWhereInput {
    if (assetIds === 'all') return {};
    if (assetIds.size === 0) return { id: { equals: '__no_visible_open_data_candidates__' } };
    return { assetId: { in: [...assetIds] } };
  }

  private async assertAssetVisible(roleCodes: string[], assetId: string) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    if (assetIds !== 'all' && !assetIds.has(assetId)) {
      throw new NotFoundException('data asset not found');
    }
    const asset = await this.prisma.dataAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: {
        classification: classificationSelect,
        subjects: { include: { dataSubject: refSelect } },
      },
    });
    if (!asset) throw new NotFoundException('data asset not found');
    return asset;
  }

  private async requireCandidate(roleCodes: string[], id: string): Promise<CandidateWithInclude> {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const candidate = await this.prisma.openDataCandidate.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.candidateScopeWhere(assetIds)] },
      include: candidateInclude,
    });
    if (!candidate) throw new NotFoundException('open_data_candidate not found');
    return candidate;
  }

  private async assertPerson(id?: string | null, label = 'Person'): Promise<void> {
    if (!id) return;
    const person = await this.prisma.person.findFirst({
      where: { id, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!person) throw new BadRequestException(`${label} not found`);
  }

  private async defaultPeopleForAsset(assetId: string): Promise<{
    ownerPersonId: string | null;
    stewardPersonId: string | null;
  }> {
    const assignments = await this.prisma.stewardshipAssignment.findMany({
      where: {
        targetType: AssignmentTargetType.asset,
        targetId: assetId,
        approvalStatus: ApprovalStatus.approved,
        isActive: true,
        deletedAt: null,
      },
      include: { roleType: { select: { code: true } } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return {
      ownerPersonId:
        assignments.find((a) => a.roleType.code === 'data_owner')?.personId ?? null,
      stewardPersonId:
        assignments.find((a) => a.roleType.code.includes('steward'))?.personId ?? null,
    };
  }

  private inferPersonalDataAssessment(asset: {
    classification?: { rank: number } | null;
    subjects?: { dataSubject: { code: string } }[];
  }): OpenDataPersonalDataAssessment {
    const subjectCodes = asset.subjects?.map((s) => s.dataSubject.code) ?? [];
    if (!subjectCodes.length) return OpenDataPersonalDataAssessment.none;
    if ((asset.classification?.rank ?? 0) >= 3) {
      return OpenDataPersonalDataAssessment.sensitive_personal_data;
    }
    return OpenDataPersonalDataAssessment.personal_data;
  }

  private async latestDqReadiness(assetId: string): Promise<{ score: number | null; scoreId: string | null }> {
    const latestScore = await this.prisma.dataQualityScore.findFirst({
      where: { assetId },
      orderBy: { measuredAt: 'desc' },
      select: { id: true, score: true },
    });
    if (latestScore) return { score: latestScore.score, scoreId: latestScore.id };
    const latestProfile = await this.prisma.dataQualityProfile.findFirst({
      where: { assetId },
      orderBy: { createdAt: 'desc' },
      select: { qualityScore: true },
    });
    return { score: latestProfile?.qualityScore ?? null, scoreId: null };
  }

  private async nextCode(): Promise<string> {
    const count = await this.prisma.openDataCandidate.count();
    for (let i = 1; i <= 50; i++) {
      const code = `ODC-${String(count + i).padStart(4, '0')}`;
      const exists = await this.prisma.openDataCandidate.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `ODC-${Date.now()}`;
  }

  private async nextWorkflowCaseCode(client: Prisma.TransactionClient): Promise<string> {
    const count = await client.workflowCase.count();
    for (let i = 1; i <= 50; i++) {
      const code = `WFC-${String(count + i).padStart(4, '0')}`;
      const exists = await client.workflowCase.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `WFC-${Date.now()}`;
  }

  private async buildEligibility(
    assetId: string,
    input: {
      ownerPersonId?: string | null;
      stewardPersonId?: string | null;
      personalDataAssessment?: OpenDataPersonalDataAssessment | null;
      publicationValueScore?: number | null;
    },
  ) {
    const asset = await this.prisma.dataAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: {
        classification: classificationSelect,
        subjects: { include: { dataSubject: refSelect } },
      },
    });
    if (!asset) throw new NotFoundException('data asset not found');
    const dq = await this.latestDqReadiness(assetId);
    const personalDataAssessment =
      input.personalDataAssessment ?? this.inferPersonalDataAssessment(asset);
    const eligibility = scoreOpenDataEligibility({
      classificationRank: asset.classification?.rank ?? null,
      qualityScore: dq.score,
      personalDataAssessment,
      ownerPersonId: input.ownerPersonId ?? null,
      stewardPersonId: input.stewardPersonId ?? null,
      publicationValueScore: input.publicationValueScore ?? 50,
    });
    return {
      asset,
      dq,
      personalDataAssessment,
      eligibility,
      eligibilityJson: {
        overallSignal: eligibility.overallSignal,
        blockers: eligibility.blockers,
        reviewItems: eligibility.reviewItems,
        qualityScore: dq.score,
        classificationRank: asset.classification?.rank ?? null,
      },
    };
  }

  private parseNullableDate(value?: string | null): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid date');
    return parsed;
  }

  private parseDateOrNow(value?: string | null): Date {
    return this.parseNullableDate(value) ?? new Date();
  }

  private async latestCompletedAssessment(candidateId: string) {
    return this.prisma.openDataAssessment.findFirst({
      where: { candidateId, status: OpenDataAssessmentStatus.completed },
      orderBy: { completedAt: 'desc' },
    });
  }

  private async approvalGate(candidateId: string) {
    const approvals = await this.prisma.openDataApproval.findMany({
      where: { candidateId },
      select: { step: true, decision: true },
    });
    return openDataApprovalGate(approvals);
  }

  private assertPublicationReady(
    candidate: Pick<CandidateWithInclude, 'eligibilityScore' | 'id'> & {
      eligibilityJson?: Prisma.JsonValue | null;
    },
    assessment: { resultSignal: string } | null,
    gate: ReturnType<typeof openDataApprovalGate>,
  ): void {
    const eligibility = candidate.eligibilityJson as { overallSignal?: string } | null;
    if ((eligibility?.overallSignal ?? (candidate.eligibilityScore >= 80 ? 'ready' : 'needs_review')) !== 'ready') {
      throw new BadRequestException('Open Data eligibility must be ready before publication');
    }
    if (!assessment || assessment.resultSignal !== OpenDataSignalStatus.ready) {
      throw new BadRequestException('Complete a ready Open Data assessment before publication');
    }
    if (!gate.ready) {
      throw new BadRequestException('All required Open Data approvals must be approved before publication');
    }
  }

  private async openDataNdiSpecId(tx: Prisma.TransactionClient): Promise<string> {
    const spec = await tx.ndiSpecification.findFirst({
      where: { code: OPEN_DATA_NDI_SPEC_CODE, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!spec) {
      throw new BadRequestException(`Required Open Data NDI specification ${OPEN_DATA_NDI_SPEC_CODE} is not configured`);
    }
    return spec.id;
  }

  private async createOpenDataSystemEvidence(
    tx: Prisma.TransactionClient,
    candidate: CandidateWithInclude,
    actor: string,
    kind: 'approval' | 'publication',
    details: Record<string, unknown>,
  ): Promise<string | null> {
    const specId = await this.openDataNdiSpecId(tx);

    const generatedAt = new Date();
    const evidencePayload = {
      evidenceType: `open_data_${kind}`,
      generatedAt: generatedAt.toISOString(),
      ndiSpecificationCode: OPEN_DATA_NDI_SPEC_CODE,
      candidate: {
        id: candidate.id,
        code: candidate.code,
        titleEn: candidate.titleEn,
        titleAr: candidate.titleAr,
        status: candidate.status,
        assetId: candidate.assetId,
        assetCode: candidate.asset?.code ?? null,
        assetNameEn: candidate.asset?.nameEn ?? null,
        classificationCode: candidate.classification?.code ?? candidate.asset?.classification?.code ?? null,
      },
      details,
      statement:
        kind === 'approval'
          ? 'Open Data assessment approvals were completed and are linked to the OD NDI publication requirement.'
          : 'Open Data portal publication was simulated and linked to the OD NDI publication requirement.',
    };
    const buffer = Buffer.from(JSON.stringify(evidencePayload, null, 2), 'utf8');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const safeCode = candidate.code.replace(/[^A-Za-z0-9_.-]/g, '_');
    const fileName = `${safeCode}-${kind}-${generatedAt.getTime()}.json`;
    await mkdir(this.evidenceStorageDir, { recursive: true });
    await writeFile(join(this.evidenceStorageDir, fileName), buffer);

    const evidence = await tx.ndiEvidence.create({
      data: {
        specId,
        title:
          kind === 'approval'
            ? `Open Data approval evidence for ${candidate.code}`
            : `Open Data publication evidence for ${candidate.code}`,
        descriptionEn:
          kind === 'approval'
            ? `System-generated evidence that ${candidate.code} completed Open Data assessment approval gates.`
            : `System-generated evidence that ${candidate.code} was published through the Open Data portal sync workflow.`,
        status: NdiEvidenceStatus.submitted,
        fileName,
        originalName: fileName,
        mimeType: OPEN_DATA_SYSTEM_EVIDENCE_MIME,
        sizeBytes: buffer.length,
        sha256,
        submittedBy: actor,
        submittedAt: generatedAt,
        reviewedBy: null,
        reviewedAt: null,
        reviewComment: 'System-generated Open Data evidence awaiting independent evidence review.',
      },
      select: { id: true },
    });
    return evidence.id;
  }

  private hasAnyRole(roleCodes: readonly string[], allowed: Iterable<string>): boolean {
    const allowedSet = allowed instanceof Set ? allowed : new Set(allowed);
    return roleCodes.some((role) => allowedSet.has(role));
  }

  private assertApprovalAuthority(
    roleCodes: string[],
    candidate: CandidateWithInclude,
    approval: { step: string; workflowTaskId?: string | null },
    actor: string,
  ): void {
    if (approval.step === 'odiao' && candidate.createdBy === actor) {
      throw new ForbiddenException('The submitter cannot make the final ODIAO approval decision');
    }
    if (this.hasAnyRole(roleCodes, OPEN_DATA_ADMIN_APPROVAL_ROLES)) return;

    const roleAllowed = this.hasAnyRole(roleCodes, OPEN_DATA_APPROVAL_ROLE_RULES[approval.step] ?? []);
    const personAllowed =
      (approval.step === 'owner' && candidate.ownerPerson?.email === actor) ||
      (approval.step === 'steward' && candidate.stewardPerson?.email === actor) ||
      (approval.step === 'odiao' && candidate.odiaoReviewerPerson?.email === actor);

    if (!roleAllowed && !personAllowed) {
      throw new ForbiddenException(`You cannot decide the ${approval.step} Open Data approval step`);
    }
  }

  private candidateFilterWhere(filters: OpenDataCandidateFilters): Prisma.OpenDataCandidateWhereInput[] {
    const and: Prisma.OpenDataCandidateWhereInput[] = [];
    if (filters.status) and.push({ status: filters.status });
    if (filters.assetId) and.push({ assetId: filters.assetId });
    if (filters.search?.trim()) {
      const term = filters.search.trim();
      and.push({
        OR: [
          { code: { contains: term, mode: 'insensitive' } },
          { titleEn: { contains: term, mode: 'insensitive' } },
          { titleAr: { contains: term, mode: 'insensitive' } },
          { asset: { code: { contains: term, mode: 'insensitive' } } },
          { asset: { nameEn: { contains: term, mode: 'insensitive' } } },
          { asset: { nameAr: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }
    return and;
  }

  async summary(roleCodes: string[]) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const scopeWhere = this.candidateScopeWhere(assetIds);
    const now = new Date();
    const relationScopeWhere: Prisma.OpenDataCandidateWhereInput = { deletedAt: null, ...scopeWhere };
    const [total, assessment, underReview, approved, published, rejected, overdueReview, pendingApprovals, usage, candidates] =
      await Promise.all([
        this.prisma.openDataCandidate.count({ where: { deletedAt: null, ...scopeWhere } }),
        this.prisma.openDataCandidate.count({ where: { deletedAt: null, ...scopeWhere, status: OpenDataCandidateStatus.assessment } }),
        this.prisma.openDataCandidate.count({ where: { deletedAt: null, ...scopeWhere, status: OpenDataCandidateStatus.under_review } }),
        this.prisma.openDataCandidate.count({ where: { deletedAt: null, ...scopeWhere, status: OpenDataCandidateStatus.approved } }),
        this.prisma.openDataCandidate.count({ where: { deletedAt: null, ...scopeWhere, status: OpenDataCandidateStatus.published } }),
        this.prisma.openDataCandidate.count({ where: { deletedAt: null, ...scopeWhere, status: OpenDataCandidateStatus.rejected } }),
        this.prisma.openDataCandidate.count({
          where: {
            deletedAt: null,
            ...scopeWhere,
            status: { in: [OpenDataCandidateStatus.approved, OpenDataCandidateStatus.published] },
            nextReviewAt: { lt: now },
          },
        }),
        this.prisma.openDataApproval.count({
          where: {
            decision: OpenDataApprovalDecision.pending,
            candidate: { is: relationScopeWhere },
          },
        }),
        this.prisma.openDataUsageMetric.aggregate({
          where: { candidate: { is: relationScopeWhere } },
          _sum: { downloads: true, apiCalls: true, uniqueUsers: true },
        }),
        this.prisma.openDataCandidate.findMany({
          where: { deletedAt: null, ...scopeWhere },
          select: { eligibilityScore: true },
        }),
      ]);
    const avgEligibility = candidates.length
      ? Math.round(candidates.reduce((sum, c) => sum + c.eligibilityScore, 0) / candidates.length)
      : 0;
    return {
      total,
      assessment,
      underReview,
      approved,
      published,
      rejected,
      overdueReview,
      pendingApprovals,
      downloads: usage._sum.downloads ?? 0,
      apiCalls: usage._sum.apiCalls ?? 0,
      uniqueUsers: usage._sum.uniqueUsers ?? 0,
      avgEligibility,
    };
  }

  async list(roleCodes: string[], filters: OpenDataCandidateFilters) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const page = parsePageParams(filters.page ?? 1, filters.pageSize)!;
    const where: Prisma.OpenDataCandidateWhereInput = {
      AND: [{ deletedAt: null }, this.candidateScopeWhere(assetIds), ...this.candidateFilterWhere(filters)],
    };
    const [data, total] = await Promise.all([
      this.prisma.openDataCandidate.findMany({
        where,
        include: candidateInclude,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.openDataCandidate.count({ where }),
    ]);
    return toPaged(data, total, page);
  }

  async get(roleCodes: string[], id: string) {
    return this.requireCandidate(roleCodes, id);
  }

  async create(roleCodes: string[], dto: CreateOpenDataCandidateDto, actor: string) {
    const asset = await this.assertAssetVisible(roleCodes, dto.assetId);
    const existing = await this.prisma.openDataCandidate.findFirst({
      where: {
        assetId: dto.assetId,
        deletedAt: null,
        status: { notIn: [OpenDataCandidateStatus.rejected, OpenDataCandidateStatus.retired] },
      },
    });
    if (existing) {
      throw new BadRequestException('An active Open Data candidate already exists for this asset');
    }

    const defaults = await this.defaultPeopleForAsset(dto.assetId);
    const ownerPersonId = dto.ownerPersonId ?? defaults.ownerPersonId;
    const stewardPersonId = dto.stewardPersonId ?? defaults.stewardPersonId;
    const odiaoReviewerPersonId = dto.odiaoReviewerPersonId ?? null;
    await Promise.all([
      this.assertPerson(ownerPersonId, 'Owner'),
      this.assertPerson(stewardPersonId, 'Steward'),
      this.assertPerson(odiaoReviewerPersonId, 'ODIAO reviewer'),
    ]);

    const signals = await this.buildEligibility(dto.assetId, {
      ownerPersonId,
      stewardPersonId,
      personalDataAssessment: dto.personalDataAssessment,
      publicationValueScore: dto.publicationValueScore,
    });
    const candidate = await this.createCandidateRow(dto, asset, signals, {
      ownerPersonId,
      stewardPersonId,
      odiaoReviewerPersonId,
      actor,
    });
    await this.audit.log({
      actor,
      action: 'open_data_candidate.create',
      entityType: 'open_data_candidate',
      entityId: candidate.id,
      metadata: { code: candidate.code, assetId: dto.assetId },
    });
    return candidate;
  }

  async update(roleCodes: string[], id: string, dto: UpdateOpenDataCandidateDto, actor: string) {
    const current = await this.requireCandidate(roleCodes, id);
    await Promise.all([
      this.assertPerson(dto.ownerPersonId, 'Owner'),
      this.assertPerson(dto.stewardPersonId, 'Steward'),
      this.assertPerson(dto.odiaoReviewerPersonId, 'ODIAO reviewer'),
    ]);
    const ownerPersonId = dto.ownerPersonId !== undefined ? dto.ownerPersonId : current.ownerPersonId;
    const stewardPersonId = dto.stewardPersonId !== undefined ? dto.stewardPersonId : current.stewardPersonId;
    const publicationValueScore =
      dto.publicationValueScore !== undefined ? dto.publicationValueScore : current.publicationValueScore;
    const personalDataAssessment =
      dto.personalDataAssessment !== undefined ? dto.personalDataAssessment : current.personalDataAssessment;
    const signals = await this.buildEligibility(current.assetId, {
      ownerPersonId,
      stewardPersonId,
      personalDataAssessment,
      publicationValueScore,
    });
    const candidate = await this.prisma.openDataCandidate.update({
      where: { id },
      data: {
        titleEn: dto.titleEn ?? undefined,
        titleAr: dto.titleAr ?? undefined,
        description: dto.description !== undefined ? dto.description : undefined,
        publicationFrequency: dto.publicationFrequency ?? undefined,
        publicationFormat: dto.publicationFormat ?? undefined,
        portalUrl: dto.portalUrl !== undefined ? dto.portalUrl : undefined,
        ownerPersonId,
        stewardPersonId,
        odiaoReviewerPersonId:
          dto.odiaoReviewerPersonId !== undefined ? dto.odiaoReviewerPersonId : undefined,
        classificationId: signals.asset.classificationId,
        dqScoreId: signals.dq.scoreId,
        personalDataAssessment: signals.personalDataAssessment,
        classificationSignal: signals.eligibility.classificationSignal,
        dataQualitySignal: signals.eligibility.dataQualitySignal,
        personalDataSignal: signals.eligibility.personalDataSignal,
        ownershipSignal: signals.eligibility.ownershipSignal,
        publicationValueSignal: signals.eligibility.publicationValueSignal,
        publicationValueScore,
        eligibilityScore: signals.eligibility.eligibilityScore,
        eligibilityJson: signals.eligibilityJson,
        decisionNote: dto.decisionNote !== undefined ? dto.decisionNote : undefined,
        publishedAt: this.parseNullableDate(dto.publishedAt),
        nextReviewAt: this.parseNullableDate(dto.nextReviewAt),
        updatedBy: actor,
      },
      include: candidateInclude,
    });
    await this.audit.log({
      actor,
      action: 'open_data_candidate.update',
      entityType: 'open_data_candidate',
      entityId: candidate.id,
      metadata: { code: candidate.code },
    });
    return candidate;
  }

  async updateStatus(roleCodes: string[], id: string, dto: UpdateOpenDataStatusDto, actor: string) {
    const current = await this.requireCandidate(roleCodes, id);
    if (!canTransitionOpenDataStatus(current.status, dto.status)) {
      throw new BadRequestException(`Cannot move Open Data candidate from ${current.status} to ${dto.status}`);
    }
    if (dto.status === OpenDataCandidateStatus.published) {
      return this.publish(
        roleCodes,
        id,
        {
          publishedAt: dto.publishedAt,
          nextReviewAt: dto.nextReviewAt,
          note: dto.decisionNote,
        },
        actor,
      );
    }
    const signals = await this.buildEligibility(current.assetId, {
      ownerPersonId: current.ownerPersonId,
      stewardPersonId: current.stewardPersonId,
      personalDataAssessment: current.personalDataAssessment,
      publicationValueScore: current.publicationValueScore,
    });
    if (dto.status === OpenDataCandidateStatus.approved && signals.eligibility.overallSignal !== 'ready') {
      throw new BadRequestException('Open Data review items must be resolved before approval or publication');
    }
    if (dto.status === OpenDataCandidateStatus.approved) {
      const assessment = await this.latestCompletedAssessment(current.id);
      const gate = await this.approvalGate(current.id);
      this.assertPublicationReady(current, assessment, gate);
    }
    const publishedAt =
      this.parseNullableDate(dto.publishedAt) ??
      current.publishedAt;
    const nextReviewAt =
      this.parseNullableDate(dto.nextReviewAt) ??
      current.nextReviewAt;
    const candidate = await this.prisma.openDataCandidate.update({
      where: { id },
      data: {
        status: dto.status,
        decisionNote: dto.decisionNote ?? current.decisionNote,
        classificationId: signals.asset.classificationId,
        dqScoreId: signals.dq.scoreId,
        classificationSignal: signals.eligibility.classificationSignal,
        dataQualitySignal: signals.eligibility.dataQualitySignal,
        personalDataSignal: signals.eligibility.personalDataSignal,
        ownershipSignal: signals.eligibility.ownershipSignal,
        publicationValueSignal: signals.eligibility.publicationValueSignal,
        eligibilityScore: signals.eligibility.eligibilityScore,
        eligibilityJson: signals.eligibilityJson,
        publishedAt,
        nextReviewAt,
        updatedBy: actor,
      },
      include: candidateInclude,
    });
    await this.audit.log({
      actor,
      action: 'open_data_candidate.status',
      entityType: 'open_data_candidate',
      entityId: candidate.id,
      metadata: { from: current.status, to: dto.status },
    });
    return candidate;
  }

  async saveAssessment(
    roleCodes: string[],
    id: string,
    dto: SaveOpenDataAssessmentDto,
    actor: string,
  ) {
    const current = await this.requireCandidate(roleCodes, id);
    const result = scoreOpenDataAssessment({
      publicClassification: dto.publicClassification,
      restrictedInformation: dto.restrictedInformation,
      aggregationApplied: dto.aggregationApplied,
      anonymizationApplied: dto.anonymizationApplied,
      dqAcceptable: dto.dqAcceptable,
      metadataComplete: dto.metadataComplete,
      privacyReviewComplete: dto.privacyReviewComplete,
      legalReviewComplete: dto.legalReviewComplete,
      personalDataAssessment: current.personalDataAssessment,
    });
    const complete = dto.complete ?? false;
    await this.prisma.$transaction(async (tx) => {
      await tx.openDataAssessment.create({
        data: {
          candidateId: current.id,
          status: complete ? OpenDataAssessmentStatus.completed : OpenDataAssessmentStatus.draft,
          publicClassification: dto.publicClassification,
          restrictedInformation: dto.restrictedInformation,
          aggregationApplied: dto.aggregationApplied,
          anonymizationApplied: dto.anonymizationApplied,
          dqAcceptable: dto.dqAcceptable,
          metadataComplete: dto.metadataComplete,
          privacyReviewComplete: dto.privacyReviewComplete,
          legalReviewComplete: dto.legalReviewComplete,
          readinessScore: result.readinessScore,
          riskScore: result.riskScore,
          resultSignal: result.resultSignal,
          blockersJson: result.blockers,
          reviewItemsJson: result.reviewItems,
          note: dto.note ?? null,
          assessedBy: actor,
          completedAt: complete ? new Date() : null,
        },
      });
      if (complete) {
        await this.ensureApprovalTasks(tx, current, result.requiredApprovalSteps, roleCodes, actor);
        const nextStatus = canTransitionOpenDataStatus(current.status, OpenDataCandidateStatus.under_review)
          ? OpenDataCandidateStatus.under_review
          : current.status === OpenDataCandidateStatus.rejected
            ? OpenDataCandidateStatus.assessment
            : current.status;
        if (nextStatus !== current.status) {
          await tx.openDataCandidate.update({
            where: { id: current.id },
            data: { status: nextStatus, updatedBy: actor },
          });
        }
      } else if (current.status === OpenDataCandidateStatus.draft) {
        await tx.openDataCandidate.update({
          where: { id: current.id },
          data: { status: OpenDataCandidateStatus.assessment, updatedBy: actor },
        });
      }
      await this.audit.log({
        actor,
        action: complete ? 'open_data_assessment.complete' : 'open_data_assessment.save',
        entityType: 'open_data_candidate',
        entityId: current.id,
        metadata: {
          readinessScore: result.readinessScore,
          riskScore: result.riskScore,
          resultSignal: result.resultSignal,
          blockers: result.blockers,
        },
      }, tx);
    });
    return this.get(roleCodes, id);
  }

  private async ensureApprovalTasks(
    tx: Prisma.TransactionClient,
    candidate: CandidateWithInclude,
    steps: readonly string[],
    roleCodes: string[],
    actor: string,
  ): Promise<void> {
    const existing = await tx.openDataApproval.findMany({
      where: { candidateId: candidate.id },
      select: { step: true, workflowCaseId: true, workflowTaskId: true },
    });
    const byStep = new Map(existing.map((approval) => [approval.step, approval]));
    let odiaoCaseId = byStep.get('odiao')?.workflowCaseId ?? null;
    let odiaoTaskId = byStep.get('odiao')?.workflowTaskId ?? null;
    if (!odiaoCaseId) {
      if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 5);
      const wfCase = await this.workflow.openRoutedCase({
        roleCodes,
        actor,
        title: `Approve Open Data publication for ${candidate.titleEn}`,
        description: `ODIAO publication approval for ${candidate.code}.`,
        type: 'open_data_publication_approval',
        status: CaseStatus.submitted,
        assetId: candidate.assetId,
        initialAssigneeUserId: candidate.odiaoReviewerPerson?.userId ?? null,
        initialDueDate: dueDate,
        initialTaskTitle: 'ODIAO publication approval',
        preferredCode: await this.nextWorkflowCaseCode(tx),
      }, tx);
      const task = wfCase.tasks.find((row) => row.status === TaskStatus.pending) ?? wfCase.tasks[0] ?? null;
      await tx.workflowEvent.create({
        data: {
          caseId: wfCase.id,
          taskId: task?.id ?? null,
          actor,
          action: 'task.added',
          comment: 'Open Data approval task created from assessment.',
        },
      });
      odiaoCaseId = wfCase.id;
      odiaoTaskId = task?.id ?? null;
    }
    for (const step of steps) {
      await tx.openDataApproval.upsert({
        where: { candidateId_step: { candidateId: candidate.id, step } },
        update: {
          decision: OpenDataApprovalDecision.pending,
          decidedBy: null,
          decidedAt: null,
          note: null,
          workflowCaseId: step === 'odiao' ? odiaoCaseId : byStep.get(step)?.workflowCaseId ?? null,
          workflowTaskId: step === 'odiao' ? odiaoTaskId : byStep.get(step)?.workflowTaskId ?? null,
        },
        create: {
          candidateId: candidate.id,
          step,
          decision: OpenDataApprovalDecision.pending,
          workflowCaseId: step === 'odiao' ? odiaoCaseId : null,
          workflowTaskId: step === 'odiao' ? odiaoTaskId : null,
        },
      });
    }
  }

  async updateApproval(
    roleCodes: string[],
    id: string,
    approvalId: string,
    dto: UpdateOpenDataApprovalDto,
    actor: string,
  ) {
    const current = await this.requireCandidate(roleCodes, id);
    const approval = await this.prisma.openDataApproval.findFirst({
      where: { id: approvalId, candidateId: current.id },
    });
    if (!approval) throw new NotFoundException('open_data_approval not found');
    this.assertApprovalAuthority(roleCodes, current, approval, actor);
    await this.prisma.$transaction(async (tx) => {
      await tx.openDataApproval.update({
        where: { id: approval.id },
        data: {
          decision: dto.decision,
          decidedBy: actor,
          decidedAt: new Date(),
          note: dto.note ?? null,
        },
      });
      if (approval.workflowTaskId) {
        if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
        await this.workflow.recordDomainTaskDecision({
          taskId: approval.workflowTaskId,
          roleCodes,
          actor,
          decision:
            dto.decision === OpenDataApprovalDecision.approved
              ? TaskDecision.approved
              : TaskDecision.rejected,
          comment: dto.note ?? null,
          eventAction: `open_data_approval.${dto.decision}`,
        }, tx);
      }
      const approvals = await tx.openDataApproval.findMany({
        where: { candidateId: current.id },
        select: { step: true, decision: true },
      });
      const gate = openDataApprovalGate(approvals);
      const status = dto.decision === OpenDataApprovalDecision.rejected
        ? OpenDataCandidateStatus.rejected
        : dto.decision === OpenDataApprovalDecision.needs_changes
          ? OpenDataCandidateStatus.assessment
          : gate.ready
            ? OpenDataCandidateStatus.approved
            : current.status;
      if (gate.ready) {
        const assessment = await tx.openDataAssessment.findFirst({
          where: { candidateId: current.id, status: OpenDataAssessmentStatus.completed },
          orderBy: { completedAt: 'desc' },
          select: {
            id: true,
            evidenceId: true,
            readinessScore: true,
            riskScore: true,
            resultSignal: true,
            blockersJson: true,
            reviewItemsJson: true,
          },
        });
        if (assessment && !assessment.evidenceId) {
          const evidenceId = await this.createOpenDataSystemEvidence(tx, current, actor, 'approval', {
            assessmentId: assessment.id,
            readinessScore: assessment.readinessScore,
            riskScore: assessment.riskScore,
            resultSignal: assessment.resultSignal,
            blockers: assessment.blockersJson,
            reviewItems: assessment.reviewItemsJson,
            approvalGate: gate,
          });
          if (evidenceId) {
            await tx.openDataAssessment.update({
              where: { id: assessment.id },
              data: { evidenceId },
            });
          }
        }
      }
      if (status !== current.status && canTransitionOpenDataStatus(current.status, status)) {
        await tx.openDataCandidate.update({
          where: { id: current.id },
          data: { status, updatedBy: actor },
        });
      }
      await this.audit.log({
        actor,
        action: `open_data_approval.${dto.decision}`,
        entityType: 'open_data_candidate',
        entityId: current.id,
        metadata: { approvalId, step: approval.step },
      }, tx);
    });
    return this.get(roleCodes, id);
  }

  async publish(
    roleCodes: string[],
    id: string,
    dto: PublishOpenDataCandidateDto,
    actor: string,
  ) {
    const current = await this.requireCandidate(roleCodes, id);
    if (current.status !== OpenDataCandidateStatus.approved) {
      throw new BadRequestException('Only approved Open Data candidates can be published');
    }
    const assessment = await this.latestCompletedAssessment(current.id);
    const gate = await this.approvalGate(current.id);
    this.assertPublicationReady(current, assessment, gate);
    const publishedAt = this.parseDateOrNow(dto.publishedAt);
    const nextReviewAt =
      this.parseNullableDate(dto.nextReviewAt) ??
      nextOpenDataReviewDate(publishedAt, current.publicationFrequency);
    const portalRecordId = dto.portalRecordId?.trim() || `${current.code}-PORTAL`;
    await this.prisma.$transaction(async (tx) => {
      const publication = await tx.openDataPublication.create({
        data: {
          candidateId: current.id,
          portalRecordId,
          portalUrl: dto.portalUrl?.trim() || current.portalUrl || null,
          format: current.publicationFormat,
          syncStatus: OpenDataPortalSyncStatus.simulated,
          publishedAt,
          nextReviewAt,
          publishedBy: actor,
          note: dto.note ?? null,
        },
      });
      const evidenceId = await this.createOpenDataSystemEvidence(tx, current, actor, 'publication', {
        publicationId: publication.id,
        portalRecordId,
        portalUrl: dto.portalUrl?.trim() || current.portalUrl || null,
        syncStatus: OpenDataPortalSyncStatus.simulated,
        publishedAt: publishedAt.toISOString(),
        nextReviewAt: nextReviewAt?.toISOString() ?? null,
      });
      if (evidenceId) {
        await tx.openDataPublication.update({
          where: { id: publication.id },
          data: { evidenceId },
        });
      }
      await tx.openDataCandidate.update({
        where: { id: current.id },
        data: {
          status: OpenDataCandidateStatus.published,
          portalUrl: dto.portalUrl?.trim() || current.portalUrl,
          publishedAt,
          nextReviewAt,
          updatedBy: actor,
        },
      });
      await this.audit.log({
        actor,
        action: 'open_data_publication.simulate',
        entityType: 'open_data_candidate',
        entityId: current.id,
        metadata: { portalRecordId, nextReviewAt: nextReviewAt?.toISOString() ?? null },
      }, tx);
    });
    return this.get(roleCodes, id);
  }

  async createReview(
    roleCodes: string[],
    id: string,
    dto: CreateOpenDataReviewDto,
    actor: string,
  ) {
    const current = await this.requireCandidate(roleCodes, id);
    if (current.status !== OpenDataCandidateStatus.published) {
      throw new BadRequestException('Only published candidates can receive publication reviews');
    }
    const reviewDate = this.parseDateOrNow(dto.reviewDate);
    const nextReviewAt =
      this.parseNullableDate(dto.nextReviewAt) ??
      nextOpenDataReviewDate(reviewDate, current.publicationFrequency);
    const status = statusForReviewDecision(dto.decision);
    await this.prisma.$transaction(async (tx) => {
      await tx.openDataReview.create({
        data: {
          candidateId: current.id,
          reviewDate,
          decision: dto.decision,
          reviewer: actor,
          note: dto.note ?? null,
          nextReviewAt,
        },
      });
      await tx.openDataCandidate.update({
        where: { id: current.id },
        data: {
          status,
          nextReviewAt: status === OpenDataCandidateStatus.published ? nextReviewAt : current.nextReviewAt,
          updatedBy: actor,
        },
      });
      await this.audit.log({
        actor,
        action: `open_data_review.${dto.decision}`,
        entityType: 'open_data_candidate',
        entityId: current.id,
      }, tx);
    });
    return this.get(roleCodes, id);
  }

  async recordUsage(
    roleCodes: string[],
    id: string,
    dto: CreateOpenDataUsageMetricDto,
    actor: string,
  ) {
    const current = await this.requireCandidate(roleCodes, id);
    if (current.status !== OpenDataCandidateStatus.published) {
      throw new BadRequestException('Usage metrics can only be recorded for published Open Data candidates');
    }
    await this.prisma.openDataUsageMetric.create({
      data: {
        candidateId: current.id,
        metricDate: this.parseDateOrNow(dto.metricDate),
        downloads: dto.downloads ?? 0,
        apiCalls: dto.apiCalls ?? 0,
        uniqueUsers: dto.uniqueUsers ?? 0,
        source: dto.source?.trim() || 'manual',
        createdBy: actor,
      },
    });
    await this.audit.log({
      actor,
      action: 'open_data_usage.record',
      entityType: 'open_data_candidate',
      entityId: current.id,
      metadata: {
        downloads: dto.downloads ?? 0,
        apiCalls: dto.apiCalls ?? 0,
        uniqueUsers: dto.uniqueUsers ?? 0,
      },
    });
    return this.get(roleCodes, id);
  }

  private async createCandidateRow(
    dto: CreateOpenDataCandidateDto,
    asset: { nameEn: string; nameAr: string; description?: string | null },
    signals: {
      asset: { classificationId: string | null };
      dq: { scoreId: string | null };
      personalDataAssessment: OpenDataPersonalDataAssessment;
      eligibility: OpenDataEligibility;
      eligibilityJson: Prisma.InputJsonObject;
    },
    people: {
      ownerPersonId: string | null;
      stewardPersonId: string | null;
      odiaoReviewerPersonId: string | null;
      actor: string;
    },
  ): Promise<CandidateWithInclude> {
    try {
      return await this.prisma.openDataCandidate.create({
        data: {
          code: await this.nextCode(),
          assetId: dto.assetId,
          titleEn: dto.titleEn ?? asset.nameEn,
          titleAr: dto.titleAr ?? asset.nameAr,
          description: dto.description ?? asset.description ?? null,
          publicationFrequency: dto.publicationFrequency ?? OpenDataPublicationFrequency.quarterly,
          publicationFormat: dto.publicationFormat ?? OpenDataPublicationFormat.csv,
          portalUrl: dto.portalUrl ?? null,
          ownerPersonId: people.ownerPersonId,
          stewardPersonId: people.stewardPersonId,
          odiaoReviewerPersonId: people.odiaoReviewerPersonId,
          classificationId: signals.asset.classificationId,
          dqScoreId: signals.dq.scoreId,
          personalDataAssessment: signals.personalDataAssessment,
          classificationSignal: signals.eligibility.classificationSignal,
          dataQualitySignal: signals.eligibility.dataQualitySignal,
          personalDataSignal: signals.eligibility.personalDataSignal,
          ownershipSignal: signals.eligibility.ownershipSignal,
          publicationValueSignal: signals.eligibility.publicationValueSignal,
          publicationValueScore: dto.publicationValueScore ?? 50,
          eligibilityScore: signals.eligibility.eligibilityScore,
          eligibilityJson: signals.eligibilityJson,
          decisionNote: dto.decisionNote ?? null,
          nextReviewAt: this.parseNullableDate(dto.nextReviewAt) ?? null,
          createdBy: people.actor,
        },
        include: candidateInclude,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('An active Open Data candidate already exists for this asset');
      }
      throw error;
    }
  }

  async remove(roleCodes: string[], id: string, actor: string) {
    const current = await this.requireCandidate(roleCodes, id);
    const candidate = await this.prisma.openDataCandidate.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actor },
      include: candidateInclude,
    });
    await this.audit.log({
      actor,
      action: 'open_data_candidate.delete',
      entityType: 'open_data_candidate',
      entityId: current.id,
      metadata: { code: current.code },
    });
    return candidate;
  }
}
