import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalStatus,
  AssignmentTargetType,
  OpenDataCandidateStatus,
  OpenDataPersonalDataAssessment,
  OpenDataPublicationFormat,
  OpenDataPublicationFrequency,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { parsePageParams, toPaged } from '../common/pagination';
import {
  CreateOpenDataCandidateDto,
  UpdateOpenDataCandidateDto,
  UpdateOpenDataStatusDto,
} from './open-data.dto';
import {
  canTransitionOpenDataStatus,
  nextOpenDataReviewDate,
  type OpenDataEligibility,
  scoreOpenDataEligibility,
} from './open-data.logic';

export interface OpenDataCandidateFilters {
  search?: string;
  status?: OpenDataCandidateStatus;
  assetId?: string;
  page?: string | number;
  pageSize?: string | number;
}

const personSelect = {
  select: { id: true, fullNameEn: true, fullNameAr: true, email: true, jobTitle: true },
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
};

type CandidateWithInclude = Prisma.OpenDataCandidateGetPayload<{
  include: typeof candidateInclude;
}>;

@Injectable()
export class OpenDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
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
    return new Date(value);
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
    const [total, assessment, underReview, approved, published, rejected, overdueReview, candidates] =
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
    const signals = await this.buildEligibility(current.assetId, {
      ownerPersonId: current.ownerPersonId,
      stewardPersonId: current.stewardPersonId,
      personalDataAssessment: current.personalDataAssessment,
      publicationValueScore: current.publicationValueScore,
    });
    const approvalStatuses: OpenDataCandidateStatus[] = [
      OpenDataCandidateStatus.approved,
      OpenDataCandidateStatus.published,
    ];
    if (
      approvalStatuses.includes(dto.status) &&
      signals.eligibility.overallSignal !== 'ready'
    ) {
      throw new BadRequestException('Open Data review items must be resolved before approval or publication');
    }
    const publishedAt =
      this.parseNullableDate(dto.publishedAt) ??
      (dto.status === OpenDataCandidateStatus.published ? new Date() : current.publishedAt);
    const nextReviewAt =
      this.parseNullableDate(dto.nextReviewAt) ??
      (dto.status === OpenDataCandidateStatus.published && publishedAt
        ? nextOpenDataReviewDate(publishedAt, current.publicationFrequency)
        : current.nextReviewAt);
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
