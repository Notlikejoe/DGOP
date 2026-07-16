import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ArchitectureReviewDecision,
  CaseStatus,
  MdmMatchStatus,
  MetadataCertificationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService, EffectiveScope } from '../access/scope.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CreateArchitectureReviewDto,
  CreateMdmMatchDto,
  CreateMetadataCertificationDto,
  CreateReferenceVersionDto,
  DecideArchitectureReviewDto,
  ReferenceDecisionDto,
  ResolveMdmMatchDto,
  SaveMetadataCertificationDto,
} from './extended-domains.dto';
import {
  certificationStatus,
  clampScore,
  defaultMatchStatus,
  defaultMatchStep,
  isArchitectureDecisionFinal,
  referenceVersionStatus,
} from './extended-domains.logic';

const assetSelect = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
};

@Injectable()
export class ExtendedDomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly workflow?: WorkflowService,
  ) {}

  private assetScopeWhere(scope: EffectiveScope): Prisma.DataAssetWhereInput {
    const where: Prisma.DataAssetWhereInput = { deletedAt: null, isActive: true };
    if (scope.orgUnits !== 'all') where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== 'all') where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [{ classificationId: null }, { classification: { rank: { lte: scope.maxClassRank } } }];
    }
    return where;
  }

  private isUnrestricted(scope: EffectiveScope): boolean {
    return scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
  }

  private async visibleAssetIds(roleCodes: string[], scope = this.scope.resolve(roleCodes)): Promise<Set<string> | 'all'> {
    const resolved = await scope;
    if (this.isUnrestricted(resolved)) return 'all';
    const rows = await this.prisma.dataAsset.findMany({ where: this.assetScopeWhere(resolved), select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  private assetRecordWhere(assetIds: Set<string> | 'all', field = 'assetId'): Record<string, unknown> {
    if (assetIds === 'all') return {};
    return assetIds.size ? { [field]: { in: [...assetIds] } } : { id: '__no_visible_extended_records__' };
  }

  private matchWhere(assetIds: Set<string> | 'all'): Prisma.MdmMatchCandidateWhereInput {
    if (assetIds === 'all') return {};
    if (assetIds.size === 0) return { id: '__no_visible_mdm_matches__' };
    return { OR: [{ sourceAssetId: { in: [...assetIds] } }, { candidateAssetId: { in: [...assetIds] } }] };
  }

  private referenceWhere(scope: EffectiveScope, assetIds: Set<string> | 'all'): Prisma.ReferenceDataVersionWhereInput {
    if (this.isUnrestricted(scope)) return {};
    const branches: Prisma.ReferenceDataVersionWhereInput[] = [];
    if (assetIds !== 'all' && assetIds.size > 0) branches.push({ assetId: { in: [...assetIds] } });
    if (scope.domains !== 'all' && scope.domains.length > 0) branches.push({ domainId: { in: scope.domains } });
    return branches.length ? { OR: branches } : { id: '__no_visible_reference_versions__' };
  }

  private async assertAssetVisible(roleCodes: string[], assetId: string) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.prisma.dataAsset.findFirst({
      where: { AND: [{ id: assetId }, this.assetScopeWhere(scope)] },
      select: { id: true, code: true, nameEn: true, domainId: true },
    });
    if (!asset) throw new NotFoundException('data asset not found');
    return asset;
  }

  private async assertDomainVisible(roleCodes: string[], domainId?: string | null): Promise<void> {
    if (!domainId) return;
    const scope = await this.scope.resolve(roleCodes);
    if (scope.domains !== 'all' && !scope.domains.includes(domainId)) throw new NotFoundException('data domain not found');
    const domain = await this.prisma.dataDomain.findFirst({ where: { id: domainId, deletedAt: null }, select: { id: true } });
    if (!domain) throw new NotFoundException('data domain not found');
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid date value');
    return parsed;
  }

  async summary(roleCodes: string[]) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, Promise.resolve(scope));
    const [matches, referenceVersions, certifications, reviews] = await Promise.all([
      this.prisma.mdmMatchCandidate.findMany({ where: this.matchWhere(assetIds), select: { status: true, matchScore: true } }),
      this.prisma.referenceDataVersion.findMany({ where: this.referenceWhere(scope, assetIds), select: { status: true } }),
      this.prisma.metadataCertification.findMany({
        where: this.assetRecordWhere(assetIds) as Prisma.MetadataCertificationWhereInput,
        select: { status: true, qualityScore: true, completenessScore: true },
      }),
      this.prisma.architectureReview.findMany({
        where: this.assetRecordWhere(assetIds) as Prisma.ArchitectureReviewWhereInput,
        select: { decision: true, riskLevel: true },
      }),
    ]);
    return {
      mdmCandidates: matches.length,
      highConfidenceMatches: matches.filter((row) => row.matchScore >= 90).length,
      referenceVersions: referenceVersions.length,
      referencePending: referenceVersions.filter((row) => ['draft', 'under_review'].includes(row.status)).length,
      certifications: certifications.length,
      certifiedAssets: certifications.filter((row) => row.status === MetadataCertificationStatus.certified).length,
      architectureReviews: reviews.length,
      architecturePending: reviews.filter((row) => row.decision === ArchitectureReviewDecision.pending).length,
    };
  }

  async workspace(roleCodes: string[]) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, Promise.resolve(scope));
    const [summary, mdmMatches, referenceVersions, certifications, architectureReviews] = await Promise.all([
      this.summary(roleCodes),
      this.prisma.mdmMatchCandidate.findMany({
        where: this.matchWhere(assetIds),
        include: {
          sourceAsset: { select: assetSelect },
          candidateAsset: { select: assetSelect },
          evidence: { select: { id: true, title: true, sha256: true, status: true } },
        },
        orderBy: [{ status: 'asc' }, { matchScore: 'desc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
      this.prisma.referenceDataVersion.findMany({
        where: this.referenceWhere(scope, assetIds),
        include: {
          domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          asset: { select: assetSelect },
          evidence: { select: { id: true, title: true, sha256: true, status: true } },
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
      this.prisma.metadataCertification.findMany({
        where: this.assetRecordWhere(assetIds) as Prisma.MetadataCertificationWhereInput,
        include: {
          asset: { select: assetSelect },
          workflowCase: { select: { id: true, code: true, status: true } },
          evidence: { select: { id: true, title: true, sha256: true, status: true } },
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
      this.prisma.architectureReview.findMany({
        where: this.assetRecordWhere(assetIds) as Prisma.ArchitectureReviewWhereInput,
        include: {
          asset: { select: assetSelect },
          workflowCase: { select: { id: true, code: true, status: true } },
          evidence: { select: { id: true, title: true, sha256: true, status: true } },
        },
        orderBy: [{ decision: 'asc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
    ]);
    return { summary, mdmMatches, referenceVersions, certifications, architectureReviews };
  }

  async createMatch(roleCodes: string[], dto: CreateMdmMatchDto, actor: string) {
    if (dto.sourceAssetId === dto.candidateAssetId) throw new BadRequestException('Match candidates require two different assets');
    await Promise.all([
      this.assertAssetVisible(roleCodes, dto.sourceAssetId),
      this.assertAssetVisible(roleCodes, dto.candidateAssetId),
    ]);
    const score = clampScore(dto.matchScore, 0);
    const code = await this.nextCode('mdmMatchCandidate', 'MCM');
    const row = await this.prisma.mdmMatchCandidate.create({
      data: {
        code,
        sourceAssetId: dto.sourceAssetId,
        candidateAssetId: dto.candidateAssetId,
        matchScore: score,
        status: defaultMatchStatus(score),
        resolutionStep: defaultMatchStep(score),
        sourceTrustRank: clampScore(dto.sourceTrustRank, 50),
        survivorshipRulesJson: dto.survivorshipRulesJson as Prisma.InputJsonValue | undefined,
        proposedGoldenRecordJson: dto.proposedGoldenRecordJson as Prisma.InputJsonValue | undefined,
        evidenceId: dto.evidenceId ?? null,
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'extended_domains.mdm_match.create', entityType: 'mdm_match_candidate', entityId: row.id, metadata: { code } });
    return row;
  }

  async resolveMatch(roleCodes: string[], id: string, dto: ResolveMdmMatchDto, actor: string) {
    await this.findVisibleMatch(roleCodes, id);
    const final = dto.status === MdmMatchStatus.merged || dto.status === MdmMatchStatus.rejected || dto.status === MdmMatchStatus.superseded;
    const row = await this.prisma.mdmMatchCandidate.update({
      where: { id },
      data: {
        status: dto.status,
        resolutionStep: dto.resolutionStep,
        resolutionNote: dto.resolutionNote,
        survivorshipRulesJson: dto.survivorshipRulesJson as Prisma.InputJsonValue | undefined,
        proposedGoldenRecordJson: dto.proposedGoldenRecordJson as Prisma.InputJsonValue | undefined,
        evidenceId: dto.evidenceId ?? undefined,
        decidedBy: final ? actor : undefined,
        decidedAt: final ? new Date() : undefined,
      },
    });
    await this.audit.log({ actor, action: 'extended_domains.mdm_match.resolve', entityType: 'mdm_match_candidate', entityId: id, metadata: { status: dto.status, step: dto.resolutionStep } });
    return row;
  }

  async createReferenceVersion(roleCodes: string[], dto: CreateReferenceVersionDto, actor: string) {
    const asset = dto.assetId ? await this.assertAssetVisible(roleCodes, dto.assetId) : null;
    const domainId = dto.domainId ?? asset?.domainId ?? null;
    await this.assertDomainVisible(roleCodes, domainId);
    const row = await this.prisma.referenceDataVersion.create({
      data: {
        code: dto.code,
        name: dto.name,
        version: dto.version,
        domainId,
        assetId: dto.assetId ?? null,
        changeSummary: dto.changeSummary ?? null,
        sourceTrustRank: clampScore(dto.sourceTrustRank, 50),
        valuesCount: dto.valuesCount ?? 0,
        effectiveFrom: this.parseDate(dto.effectiveFrom),
        effectiveTo: this.parseDate(dto.effectiveTo),
        evidenceId: dto.evidenceId ?? null,
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'extended_domains.reference_version.create', entityType: 'reference_data_version', entityId: row.id, metadata: { code: row.code, version: row.version } });
    return row;
  }

  async decideReferenceVersion(roleCodes: string[], id: string, dto: ReferenceDecisionDto, actor: string) {
    await this.findVisibleReference(roleCodes, id);
    const status = referenceVersionStatus(dto.decision);
    const row = await this.prisma.referenceDataVersion.update({
      where: { id },
      data: {
        status,
        approvedBy: ['approve', 'activate'].includes(dto.decision) ? actor : undefined,
        approvedAt: ['approve', 'activate'].includes(dto.decision) ? new Date() : undefined,
      },
    });
    await this.audit.log({ actor, action: 'extended_domains.reference_version.decide', entityType: 'reference_data_version', entityId: id, metadata: { decision: dto.decision, status } });
    return row;
  }

  async createCertification(roleCodes: string[], dto: CreateMetadataCertificationDto, actor: string) {
    await this.assertAssetVisible(roleCodes, dto.assetId);
    const code = await this.nextCode('metadataCertification', 'META');
    return this.prisma.$transaction(async (tx) => {
      const workflowCaseId = await this.createWorkflow(tx, 'metadata_certification', `Metadata certification ${code}`, dto.assetId, roleCodes, actor);
      const qualityScore = clampScore(dto.qualityScore, 0);
      const completenessScore = clampScore(dto.completenessScore, 0);
      const row = await tx.metadataCertification.create({
        data: {
          code,
          assetId: dto.assetId,
          status: MetadataCertificationStatus.submitted,
          qualityScore,
          completenessScore,
          ownerConfirmed: dto.ownerConfirmed ?? false,
          glossaryAligned: dto.glossaryAligned ?? false,
          lineageReviewed: dto.lineageReviewed ?? false,
          certificationNote: dto.certificationNote ?? null,
          expiresAt: this.parseDate(dto.expiresAt),
          workflowCaseId,
          evidenceId: dto.evidenceId ?? null,
          createdBy: actor,
        },
      });
      await this.audit.log({ actor, action: 'extended_domains.metadata_certification.create', entityType: 'metadata_certification', entityId: row.id, metadata: { code, workflowCaseId } });
      return row;
    });
  }

  async saveCertification(roleCodes: string[], id: string, dto: SaveMetadataCertificationDto, actor: string) {
    const existing = await this.findVisibleCertification(roleCodes, id);
    const qualityScore = dto.qualityScore === undefined ? existing.qualityScore : clampScore(dto.qualityScore, existing.qualityScore);
    const completenessScore = dto.completenessScore === undefined ? existing.completenessScore : clampScore(dto.completenessScore, existing.completenessScore);
    const ownerConfirmed = dto.ownerConfirmed ?? existing.ownerConfirmed;
    const glossaryAligned = dto.glossaryAligned ?? existing.glossaryAligned;
    const lineageReviewed = dto.lineageReviewed ?? existing.lineageReviewed;
    const status = dto.status ?? certificationStatus({ qualityScore, completenessScore, ownerConfirmed, glossaryAligned, lineageReviewed });
    const row = await this.prisma.metadataCertification.update({
      where: { id },
      data: {
        status,
        qualityScore,
        completenessScore,
        ownerConfirmed,
        glossaryAligned,
        lineageReviewed,
        certificationNote: dto.certificationNote,
        expiresAt: dto.expiresAt ? this.parseDate(dto.expiresAt) : undefined,
        evidenceId: dto.evidenceId ?? undefined,
        certifiedBy: status === MetadataCertificationStatus.certified ? actor : undefined,
        certifiedAt: status === MetadataCertificationStatus.certified ? new Date() : undefined,
        updatedBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'extended_domains.metadata_certification.save', entityType: 'metadata_certification', entityId: id, metadata: { status } });
    return row;
  }

  async createArchitectureReview(roleCodes: string[], dto: CreateArchitectureReviewDto, actor: string) {
    await this.assertAssetVisible(roleCodes, dto.assetId);
    const code = await this.nextCode('architectureReview', 'DAM');
    return this.prisma.$transaction(async (tx) => {
      const workflowCaseId = await this.createWorkflow(tx, 'architecture_review', `Architecture review ${code}`, dto.assetId, roleCodes, actor);
      const row = await tx.architectureReview.create({
        data: {
          code,
          assetId: dto.assetId,
          reviewType: dto.reviewType ?? 'data_model',
          title: dto.title,
          architectureDecision: dto.architectureDecision ?? null,
          lineageImpact: dto.lineageImpact ?? null,
          riskLevel: dto.riskLevel ?? 'medium',
          conditionsJson: dto.conditionsJson as Prisma.InputJsonValue | undefined,
          evidenceId: dto.evidenceId ?? null,
          workflowCaseId,
          createdBy: actor,
        },
      });
      await this.audit.log({ actor, action: 'extended_domains.architecture_review.create', entityType: 'architecture_review', entityId: row.id, metadata: { code, workflowCaseId } });
      return row;
    });
  }

  async decideArchitectureReview(roleCodes: string[], id: string, dto: DecideArchitectureReviewDto, actor: string) {
    await this.findVisibleArchitectureReview(roleCodes, id);
    const row = await this.prisma.architectureReview.update({
      where: { id },
      data: {
        decision: dto.decision,
        architectureDecision: dto.architectureDecision,
        lineageImpact: dto.lineageImpact,
        conditionsJson: dto.conditionsJson as Prisma.InputJsonValue | undefined,
        evidenceId: dto.evidenceId ?? undefined,
        reviewedBy: isArchitectureDecisionFinal(dto.decision) ? actor : undefined,
        reviewedAt: isArchitectureDecisionFinal(dto.decision) ? new Date() : undefined,
        updatedBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'extended_domains.architecture_review.decide', entityType: 'architecture_review', entityId: id, metadata: { decision: dto.decision } });
    return row;
  }

  private async createWorkflow(tx: Prisma.TransactionClient, type: string, title: string, assetId: string, roleCodes: string[], actor: string): Promise<string> {
    if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const workflowCase = await this.workflow.openRoutedCase({
      roleCodes,
      actor,
      title,
      description: 'Extended-domain governance review created automatically.',
      type,
      status: CaseStatus.submitted,
      assetId,
      initialDueDate: dueDate,
      initialTaskTitle: `${title} review`,
      preferredCode: await this.nextWorkflowCode(tx, type === 'metadata_certification' ? 'WF-META' : 'WF-DAM'),
    }, tx);
    await tx.workflowEvent.create({
      data: {
        caseId: workflowCase.id,
        actor,
        action: 'workflow.create',
        toStatus: CaseStatus.submitted,
        comment: 'Created from extended-domain governance workflow.',
      },
    });
    return workflowCase.id;
  }

  private async nextWorkflowCode(tx: Prisma.TransactionClient, prefix: string): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await tx.workflowCase.count({ where: { code: { startsWith: `${prefix}-${day}` } } });
    return `${prefix}-${day}-${String(count + 1).padStart(3, '0')}`;
  }

  private async nextCode(model: 'mdmMatchCandidate' | 'metadataCertification' | 'architectureReview', prefix: string): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const where = { code: { startsWith: `${prefix}-${day}` } };
    const count =
      model === 'mdmMatchCandidate'
        ? await this.prisma.mdmMatchCandidate.count({ where })
        : model === 'metadataCertification'
          ? await this.prisma.metadataCertification.count({ where })
          : await this.prisma.architectureReview.count({ where });
    return `${prefix}-${day}-${String(count + 1).padStart(3, '0')}`;
  }

  private async findVisibleMatch(roleCodes: string[], id: string) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const row = await this.prisma.mdmMatchCandidate.findFirst({ where: { AND: [{ id }, this.matchWhere(assetIds)] } });
    if (!row) throw new NotFoundException('mdm_match_candidate not found');
    return row;
  }

  private async findVisibleReference(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const assetIds = await this.visibleAssetIds(roleCodes, Promise.resolve(scope));
    const row = await this.prisma.referenceDataVersion.findFirst({ where: { AND: [{ id }, this.referenceWhere(scope, assetIds)] } });
    if (!row) throw new NotFoundException('reference_data_version not found');
    return row;
  }

  private async findVisibleCertification(roleCodes: string[], id: string) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const row = await this.prisma.metadataCertification.findFirst({
      where: { AND: [{ id }, this.assetRecordWhere(assetIds) as Prisma.MetadataCertificationWhereInput] },
    });
    if (!row) throw new NotFoundException('metadata_certification not found');
    return row;
  }

  private async findVisibleArchitectureReview(roleCodes: string[], id: string) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const row = await this.prisma.architectureReview.findFirst({
      where: { AND: [{ id }, this.assetRecordWhere(assetIds) as Prisma.ArchitectureReviewWhereInput] },
    });
    if (!row) throw new NotFoundException('architecture_review not found');
    return row;
  }
}
