import { parsePageParams, toPaged } from '../common/pagination';
import { Optional } from '@nestjs/common';
import { EvidenceService } from '../evidence/evidence.service';
import { governanceDecisionActor, governanceDecisionProof } from '../common/governance-decision-proof';
import { businessDecisionRoles } from '../auth/business-roles';
import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ArchitectureReviewDecision,
  CaseStatus,
  MdmGoldenRecordStatus,
  MdmMatchStatus,
  MetadataCertificationStatus,
  NdiEvidenceStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatBusinessSequence, nextAvailableBusinessCode } from '../common/business-sequence';
import { AuditService } from '../audit/audit.service';
import { ScopeService, EffectiveScope } from '../access/scope.service';
import { WorkflowService } from '../workflow/workflow.service';
import { claimGovernanceWrite, requireTransition } from '../common/governance-write';
import { parseMdmRule } from './mdm-rule';
import { operationalEvidenceWhere } from '../evidence/evidence-status';
import {
  EXTENDED_REGISTERS, ExtendedRegisterQueryDto,
  CreateArchitectureReviewDto,
  CreateMdmMatchDto,
  CreateMetadataCertificationDto,
  CreateReferenceVersionDto,
  DecideArchitectureReviewDto,
  ReferenceDecisionDto,
  ResolveMdmMatchDto,
  RunMdmMatchingDto,
  SaveMetadataCertificationDto,
  UpdateMdmGoldenRecordDto,
  UpsertMdmMatchRuleDto,
} from './extended-domains.dto';
import {
  certificationStatus,
  clampScore,
  canonicalMdmPairKey,
  defaultMatchStatus,
  defaultMatchStep,
  isArchitectureDecisionFinal,
  MdmMatchAssetProfile,
  rankMdmMatches,
  referenceVersionStatus,
} from './extended-domains.logic';

const assetSelect = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
};
const mdmAssetSelect = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  description: true,
  ownerName: true,
  domainId: true,
  orgUnitId: true,
  systemId: true,
  capabilityId: true,
  classificationId: true,
  externalCatalogId: true,
  catalogSource: true,
  catalogTrustLevel: true,
  domain: { select: { id: true, code: true } },
  system: { select: { id: true, code: true } },
  subjects: { include: { dataSubject: { select: { code: true, nameEn: true, nameAr: true } } } },
};
type MdmAssetRow = Prisma.DataAssetGetPayload<{ select: typeof mdmAssetSelect }>;

const BROAD_EVIDENCE_ROLES = new Set(['system_admin', 'dmo_admin', 'auditor']);
const FINAL_REFERENCE_DECISIONS = new Set<ReferenceDecisionDto['decision']>([
  'approve',
  'reject',
  'activate',
  'retire',
]);
@Injectable()
export class ExtendedDomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly workflow?: WorkflowService,
    @Optional() private readonly evidence?: EvidenceService,
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

  private toMdmProfile(row: MdmAssetRow): MdmMatchAssetProfile {
    return {
      id: row.id,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      description: row.description,
      ownerName: row.ownerName,
      domainId: row.domainId,
      domainCode: row.domain?.code ?? null,
      orgUnitId: row.orgUnitId,
      systemId: row.systemId,
      systemCode: row.system?.code ?? null,
      capabilityId: row.capabilityId,
      classificationId: row.classificationId,
      externalCatalogId: row.externalCatalogId,
      catalogSource: row.catalogSource,
      catalogTrustLevel: row.catalogTrustLevel,
      subjects: row.subjects.map((link) => link.dataSubject.code),
    };
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

  private async assertEvidenceLinkable(roleCodes: string[], evidenceId: string | null | undefined, actor: string): Promise<void> {
    if (!evidenceId) return;
    const broadAccess = roleCodes.some((role) => BROAD_EVIDENCE_ROLES.has(role));
    const person = broadAccess
      ? null
      : await this.prisma.person.findFirst({
          where: { deletedAt: null, isActive: true, email: actor },
          select: { id: true },
        });
    const visibility: Prisma.NdiEvidenceWhereInput[] = broadAccess
      ? []
      : [
          { submittedBy: actor },
          { reviewedBy: actor },
          ...(person ? [{ spec: { ownerPersonId: person.id } } as Prisma.NdiEvidenceWhereInput] : []),
        ];
    const now = new Date();
    const evidence = await this.prisma.ndiEvidence.findFirst({
      where: {
        id: evidenceId,
        deletedAt: null,
        OR: [
          { status: { in: [NdiEvidenceStatus.submitted, NdiEvidenceStatus.under_review] } },
          { status: NdiEvidenceStatus.approved, OR: [{ expiryDate: null }, { expiryDate: { gte: now } }] },
        ],
        ...(visibility.length ? { AND: [{ OR: visibility }] } : {}),
      },
      select: { id: true },
    });
    if (!evidence) throw new NotFoundException('evidence not found');
  }

  async summary(roleCodes: string[]) {
    const scope = await this.scope.resolve(roleCodes),
      assets = await this.visibleAssetIds(roleCodes, Promise.resolve(scope));
    const matches = this.matchWhere(assets),
      assetWhere = this.assetRecordWhere(assets),
      references = this.referenceWhere(scope, assets);
    const [
      mdmCandidates,
      highConfidenceMatches,
      goldenRecords,
      activeGoldenRecords,
      referenceVersions,
      referencePending,
      certifications,
      certifiedAssets,
      architectureReviews,
      architecturePending,
    ] = await Promise.all([
      this.prisma.mdmMatchCandidate.count({ where: matches }),
      this.prisma.mdmMatchCandidate.count({
        where: { AND: [matches, { matchScore: { gte: 90 } }] },
      }),
      this.prisma.mdmGoldenRecord.count({ where: assetWhere }),
      this.prisma.mdmGoldenRecord.count({
        where: { AND: [assetWhere, { status: 'active' }] },
      }),
      this.prisma.referenceDataVersion.count({ where: references }),
      this.prisma.referenceDataVersion.count({
        where: {
          AND: [references, { status: { in: ['draft', 'under_review'] } }],
        },
      }),
      this.prisma.metadataCertification.count({ where: assetWhere }),
      this.prisma.metadataCertification.count({
        where: { AND: [assetWhere, { status: 'certified' }] },
      }),
      this.prisma.architectureReview.count({ where: assetWhere }),
      this.prisma.architectureReview.count({
        where: {
          AND: [assetWhere, { decision: { in: ['pending', 'needs_changes'] } }],
        },
      }),
    ]);
    return {
      mdmCandidates,
      highConfidenceMatches,
      goldenRecords,
      activeGoldenRecords,
      referenceVersions,
      referencePending,
      certifications,
      certifiedAssets,
      architectureReviews,
      architecturePending,
    };
  }

  async listRegister(
    register: string,
    roleCodes: string[],
    actor?: string,
    query: ExtendedRegisterQueryDto = {},
  ) {
    if (!(EXTENDED_REGISTERS as readonly string[]).includes(register))
      throw new NotFoundException('Extended-domain register not found');
    if ((query.search?.length ?? 0) > 200)
      throw new BadRequestException('Search cannot exceed 200 characters');
    const params = parsePageParams(query.page ?? 1, query.pageSize ?? 25)!,
      scope = await this.scope.resolve(roleCodes),
      assets = await this.visibleAssetIds(roleCodes, Promise.resolve(scope));
    const base =
      register === 'matches'
        ? this.matchWhere(assets)
        : register === 'references'
          ? this.referenceWhere(scope, assets)
          : this.assetRecordWhere(assets);
    const term = query.search?.trim(),
      contains = (value: string) => ({
        contains: value,
        mode: 'insensitive' as const,
      });
    const fields: Record<string, string[]> = {
      matches: ['code', 'resolutionNote'],
      goldenRecords: ['code', 'clusterKey'],
      references: ['code', 'name', 'version', 'changeSummary'],
      certifications: ['code', 'certificationNote'],
      architecture: [
        'code',
        'title',
        'reviewType',
        'architectureDecision',
        'lineageImpact',
        'workflowCaseId',
      ],
    };
    const matchingAssets =
      register === 'goldenRecords' && term
        ? await this.prisma.dataAsset.findMany({
            where: {
              AND: [
                this.assetScopeWhere(scope),
                {
                  OR: [
                    { code: contains(term) },
                    { nameEn: contains(term) },
                    { nameAr: contains(term) },
                  ],
                },
              ],
            },
            select: { id: true },
          })
        : [];
    const relations =
      register === 'goldenRecords'
        ? [{ assetId: { in: matchingAssets.map((row) => row.id) } }]
        : register === 'matches'
          ? [
              {
                sourceAsset: {
                  is: {
                    OR: [
                      { code: contains(term ?? '') },
                      { nameEn: contains(term ?? '') },
                      { nameAr: contains(term ?? '') },
                    ],
                  },
                },
              },
              {
                candidateAsset: {
                  is: {
                    OR: [
                      { code: contains(term ?? '') },
                      { nameEn: contains(term ?? '') },
                      { nameAr: contains(term ?? '') },
                    ],
                  },
                },
              },
            ]
          : [
              {
                asset: {
                  is: {
                    OR: [
                      { code: contains(term ?? '') },
                      { nameEn: contains(term ?? '') },
                      { nameAr: contains(term ?? '') },
                    ],
                  },
                },
              },
              ...(register === 'architecture'
                ? [{ workflowCase: { is: { code: contains(term ?? '') } } }]
                : []),
            ];
    const where = {
      AND: [
        base,
        ...(term
          ? [
              {
                OR: [
                  ...fields[register].map((key) => ({ [key]: contains(term) })),
                  ...relations,
                ],
              },
            ]
          : []),
      ],
    };
    const page = async <T,>(rows: Promise<T[]>, total: Promise<number>) => {
      const [data, count] = await Promise.all([rows, total]);
      return toPaged(data, count, params);
    };
    let result: ReturnType<typeof toPaged<any>>;
    switch (register) {
      case 'matches':
        result = await page(
          this.prisma.mdmMatchCandidate.findMany({
            where: where as Prisma.MdmMatchCandidateWhereInput,
            include: {
              sourceAsset: { select: assetSelect },
              candidateAsset: { select: assetSelect },
              evidence: {
                select: { id: true, title: true, sha256: true, status: true },
              },
            },
            orderBy: [
              { status: 'asc' },
              { matchScore: 'desc' },
              { updatedAt: 'desc' },
              { id: 'asc' },
            ],
            skip: params.skip,
            take: params.take,
          }),
          this.prisma.mdmMatchCandidate.count({
            where: where as Prisma.MdmMatchCandidateWhereInput,
          }),
        );
        break;
      case 'goldenRecords':
        result = await page(
          this.prisma.mdmGoldenRecord.findMany({
            where: where as Prisma.MdmGoldenRecordWhereInput,
            include: {
              mergeSplitEvents: {
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                take: 5,
              },
            },
            orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
            skip: params.skip,
            take: params.take,
          }),
          this.prisma.mdmGoldenRecord.count({
            where: where as Prisma.MdmGoldenRecordWhereInput,
          }),
        );
        break;
      case 'references':
        result = await page(
          this.prisma.referenceDataVersion.findMany({
            where: where as Prisma.ReferenceDataVersionWhereInput,
            include: {
              domain: {
                select: { id: true, code: true, nameEn: true, nameAr: true },
              },
              asset: { select: assetSelect },
              evidence: {
                select: { id: true, title: true, sha256: true, status: true },
              },
            },
            orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
            skip: params.skip,
            take: params.take,
          }),
          this.prisma.referenceDataVersion.count({
            where: where as Prisma.ReferenceDataVersionWhereInput,
          }),
        );
        break;
      case 'certifications':
        result = await page(
          this.prisma.metadataCertification.findMany({
            where: where as Prisma.MetadataCertificationWhereInput,
            include: {
              asset: { select: assetSelect },
              workflowCase: { select: { id: true, code: true, status: true } },
              evidence: {
                select: { id: true, title: true, sha256: true, status: true },
              },
            },
            orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
            skip: params.skip,
            take: params.take,
          }),
          this.prisma.metadataCertification.count({
            where: where as Prisma.MetadataCertificationWhereInput,
          }),
        );
        break;
      default:
        result = await page(
          this.prisma.architectureReview.findMany({
            where: where as Prisma.ArchitectureReviewWhereInput,
            include: {
              asset: { select: assetSelect },
              workflowCase: { select: { id: true, code: true, status: true } },
              evidence: {
                select: { id: true, title: true, sha256: true, status: true },
              },
            },
            orderBy: [
              { decision: 'asc' },
              { updatedAt: 'desc' },
              { id: 'asc' },
            ],
            skip: params.skip,
            take: params.take,
          }),
          this.prisma.architectureReview.count({
            where: where as Prisma.ArchitectureReviewWhereInput,
          }),
        );
    }
    if (register === 'goldenRecords') {
      const references = await this.prisma.dataAsset.findMany({
          where: {
            id: {
              in: result.data
                .map((row) => row.assetId)
                .filter((id): id is string => typeof id === 'string'),
            },
          },
          select: assetSelect,
        }),
        byId = new Map(references.map((row) => [row.id, row]));
      result.data = result.data.map((row) => ({
        ...row,
        asset: byId.get(row.assetId) ?? null,
      }));
    }
    let eligible = new Set<string>();
    if (actor)
      try {
        const roles = await businessDecisionRoles(
            this.prisma,
            roleCodes,
            'extended_domains.edit',
            register === 'certifications'
              ? ['enterprise_data_steward', 'dq_steward']
              : undefined,
          ),
          decisionScope = await this.scope.resolve(roles),
          decisionAssets = await this.visibleAssetIds(
            roles,
            Promise.resolve(decisionScope),
          );
        const decisionWhere =
            register === 'matches'
              ? this.matchWhere(decisionAssets)
              : register === 'references'
                ? this.referenceWhere(decisionScope, decisionAssets)
                : this.assetRecordWhere(decisionAssets),
          ids = result.data.map((row) => row.id);
        const filter = { AND: [decisionWhere, { id: { in: ids } }] },
          select = { id: true };
        const rows =
          register === 'matches'
            ? await this.prisma.mdmMatchCandidate.findMany({
                where: filter as Prisma.MdmMatchCandidateWhereInput,
                select,
              })
            : register === 'references'
              ? await this.prisma.referenceDataVersion.findMany({
                  where: filter as Prisma.ReferenceDataVersionWhereInput,
                  select,
                })
              : register === 'certifications'
                ? await this.prisma.metadataCertification.findMany({
                    where: filter as Prisma.MetadataCertificationWhereInput,
                    select,
                  })
                : register === 'architecture'
                  ? await this.prisma.architectureReview.findMany({
                      where: filter as Prisma.ArchitectureReviewWhereInput,
                      select,
                    })
                  : await this.prisma.mdmGoldenRecord.findMany({
                      where: filter as Prisma.MdmGoldenRecordWhereInput,
                      select,
                    });
        eligible = new Set(rows.map((row) => row.id));
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    const tasks =
      register === 'architecture' && this.workflow
        ? await this.workflow.architectureDecisionAccess(
            result.data.map((row) => row.workflowCaseId).filter(Boolean),
            roleCodes,
            actor,
          )
        : new Map();
    result.data = result.data.map((row) => {
      const stage = tasks.get(row.workflowCaseId),
        canDecide = eligible.has(row.id) && row.createdBy !== actor;
      if (register === 'architecture')
        return {
          ...row,
          workflowStage: stage?.stage ?? null,
          workflowTaskId: stage?.taskId ?? null,
          canDecide:
            canDecide &&
            ['pending', 'needs_changes'].includes(row.decision) &&
            stage?.canDecide === true,
          assurance: ['pending', 'needs_changes'].includes(row.decision)
            ? 'pending'
            : row.decisionProof
              ? 'verified'
              : ['approved', 'approved_with_conditions'].includes(row.decision)
                ? 'review_needed'
                : 'recorded',
        };
      return {
        ...row,
        canSubmit:
          register === 'references' &&
          eligible.has(row.id) &&
          ['draft', 'rejected'].includes(row.status),
        canEdit: register === 'goldenRecords' && eligible.has(row.id),
        canDecide:
          canDecide &&
          (register !== 'matches' ||
            !['merged', 'rejected', 'superseded'].includes(row.status)),
      };
    });
    return result;
  }

  async workspace(roleCodes: string[], actor?: string) {
    const [summary, pages] = await Promise.all([
      this.summary(roleCodes),
      Promise.all(
        EXTENDED_REGISTERS.map((key) =>
          this.listRegister(key, roleCodes, actor),
        ),
      ),
    ]);
    const registerPages = Object.fromEntries(
      EXTENDED_REGISTERS.map((key, index) => [key, pages[index]]),
    );
    return {
      summary,
      mdmMatches: registerPages.matches.data,
      goldenRecords: registerPages.goldenRecords.data,
      referenceVersions: registerPages.references.data,
      certifications: registerPages.certifications.data,
      architectureReviews: registerPages.architecture.data,
      registerPages,
    };
  }

  async createMatch(
    roleCodes: string[],
    dto: CreateMdmMatchDto,
    actor: string,
  ) {
    if (dto.sourceAssetId === dto.candidateAssetId)
      throw new BadRequestException(
        'Match candidates require two different assets',
      );
    await Promise.all([
      this.assertAssetVisible(roleCodes, dto.sourceAssetId),
      this.assertAssetVisible(roleCodes, dto.candidateAssetId),
      this.assertEvidenceLinkable(roleCodes, dto.evidenceId, actor),
    ]);
    const score = clampScore(dto.matchScore, 0);
    const code = await this.nextCode('mdmMatchCandidate', 'MCM');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.mdmMatchCandidate.create({
        data: {
          code,
          sourceAssetId: dto.sourceAssetId,
          candidateAssetId: dto.candidateAssetId,
          matchScore: score,
          status: defaultMatchStatus(score),
          resolutionStep: defaultMatchStep(score),
          sourceTrustRank: clampScore(dto.sourceTrustRank, 50),
          survivorshipRulesJson: dto.survivorshipRulesJson as
            Prisma.InputJsonValue | undefined,
          proposedGoldenRecordJson: dto.proposedGoldenRecordJson as
            Prisma.InputJsonValue | undefined,
          evidenceId: dto.evidenceId ?? null,
          createdBy: actor,
        },
      });
      await this.audit.logRequired(
        {
          actor,
          action: 'extended_domains.mdm_match.create',
          entityType: 'mdm_match_candidate',
          entityId: row.id,
          metadata: { code },
        },
        tx,
      );
      return row;
    });
  }

  async runMdmMatching(roleCodes: string[], dto: RunMdmMatchingDto, actor: string) {
    if (!dto.sourceAssetId && !dto.domainId) {
      throw new BadRequestException('MDM matching requires a source asset or data domain');
    }
    const scope = await this.scope.resolve(roleCodes);
    const scopedAssetWhere = this.assetScopeWhere(scope);
    if (dto.domainId) await this.assertDomainVisible(roleCodes, dto.domainId);

    const sourceWhere: Prisma.DataAssetWhereInput = dto.sourceAssetId
      ? { AND: [scopedAssetWhere, { id: dto.sourceAssetId }] }
      : { AND: [scopedAssetWhere, { domainId: dto.domainId }] };
    const sourceRows = await this.prisma.dataAsset.findMany({
      where: sourceWhere,
      select: mdmAssetSelect,
      orderBy: [{ updatedAt: 'desc' }, { code: 'asc' }],
      take: dto.sourceAssetId ? 1 : 25,
    });
    if (!sourceRows.length) throw new NotFoundException('source data asset not found');

    const sourceIds = sourceRows.map((row) => row.id);
    const requestedCandidateIds = [...new Set(dto.candidateAssetIds ?? [])].filter((id) => !sourceIds.includes(id));
    const candidateWhere: Prisma.DataAssetWhereInput = requestedCandidateIds.length
      ? { AND: [scopedAssetWhere, { id: { in: requestedCandidateIds } }] }
      : { AND: [scopedAssetWhere, { id: { notIn: sourceIds } }] };
    const candidateRows = await this.prisma.dataAsset.findMany({
      where: candidateWhere,
      select: mdmAssetSelect,
      orderBy: [{ updatedAt: 'desc' }, { code: 'asc' }],
      take: requestedCandidateIds.length ? requestedCandidateIds.length : 250,
    });
    if (requestedCandidateIds.length && candidateRows.length !== requestedCandidateIds.length) {
      throw new NotFoundException('candidate data asset not found');
    }

    const sourceProfiles = sourceRows.map((row) => this.toMdmProfile(row));
    const candidateProfiles = candidateRows.map((row) => this.toMdmProfile(row));
    const sourceDomain = dto.domainId ?? sourceRows[0].domainId;
    const rules = await this.prisma.mdmMatchRule.findMany({ where: { isActive: true, OR: [{ domainId: sourceDomain }, { domainId: null }], ...(dto.ruleCode ? { code: dto.ruleCode } : {}) }, orderBy: { code: 'asc' } });
    const applicable = rules.filter((rule) => rule.domainId === sourceDomain);
    const candidates = applicable.length ? applicable : rules.filter((rule) => rule.domainId === null);
    if (candidates.length > 1) throw new BadRequestException('Multiple applicable MDM rules exist. Select an explicit ruleCode.');
    if (dto.ruleCode && !candidates.length) throw new BadRequestException('The selected MDM rule is not active for this domain');
    const selectedRule = candidates[0];
    const rule = selectedRule ? parseMdmRule(selectedRule.blockingJson, selectedRule.weightsJson, selectedRule.survivorshipJson) : undefined;
    const threshold = selectedRule?.thresholdScore ?? dto.threshold ?? 65;
    if (selectedRule && dto.threshold !== undefined && dto.threshold !== threshold) throw new BadRequestException('The saved rule owns the threshold. Omit the override or amend the governed rule.');
    const ruleReceipt = selectedRule ? { code: selectedRule.code, id: selectedRule.id, version: selectedRule.updatedAt.toISOString(), digest: createHash('sha256').update(JSON.stringify({ threshold, rule })).digest('hex') } : { code: 'builtin_mdm_asset_match_v1', id: null, version: '2026-10-04', digest: null };
    const evaluatedPairs = sourceProfiles.length * candidateProfiles.length;
    const recommendations = rankMdmMatches(sourceProfiles, candidateProfiles, {
      threshold,
      limit: dto.limit ?? 10,
      rule,
    });
    const existing = recommendations.length
      ? await this.prisma.mdmMatchCandidate.findMany({
          where: {
            OR: recommendations.flatMap((match) => [
              { sourceAssetId: match.sourceAssetId, candidateAssetId: match.candidateAssetId },
              { sourceAssetId: match.candidateAssetId, candidateAssetId: match.sourceAssetId },
            ]),
          },
          select: { sourceAssetId: true, candidateAssetId: true },
        })
      : [];
    const existingPairs = new Set(existing.map((row) => canonicalMdmPairKey(row.sourceAssetId, row.candidateAssetId)));
    const newRecommendations = recommendations.filter((match) => !existingPairs.has(match.pairKey));
    const persist = dto.persist ?? true;

    if (!persist) {
      return {
        threshold,
        rule: ruleReceipt,
        limit: dto.limit ?? 10,
        evaluatedPairs,
        recommendedCount: recommendations.length,
        createdCount: 0,
        skippedExistingCount: recommendations.length - newRecommendations.length,
        candidates: recommendations,
      };
    }

    return claimGovernanceWrite(() => this.prisma.$transaction(async (tx) => {
    if (selectedRule) {
      const currentRule = await tx.mdmMatchRule.findFirst({ where: { id: selectedRule.id, updatedAt: selectedRule.updatedAt, isActive: true } });
      if (!currentRule) throw new ConflictException('The matching rule changed. Reload the governed rule before running it.');
    }
    const created: unknown[] = [];
    for (const match of newRecommendations) {
      const present = await tx.mdmMatchCandidate.findFirst({ where: { OR: [
        { sourceAssetId: match.sourceAssetId, candidateAssetId: match.candidateAssetId },
        { sourceAssetId: match.candidateAssetId, candidateAssetId: match.sourceAssetId },
      ] } });
      if (present) continue;
      const code = await this.nextCode('mdmMatchCandidate', 'MCM', tx);
      const row = await tx.mdmMatchCandidate.create({
        data: {
          code,
          sourceAssetId: match.sourceAssetId,
          candidateAssetId: match.candidateAssetId,
          matchScore: match.matchScore,
          status: match.status,
          resolutionStep: match.resolutionStep,
          sourceTrustRank: match.sourceTrustRank,
          survivorshipRulesJson: {
            ...match.survivorshipRulesJson,
            generatedBy: actor,
            generatedAt: new Date().toISOString(),
            appliedRule: ruleReceipt,
          } as Prisma.InputJsonObject,
          proposedGoldenRecordJson: match.proposedGoldenRecordJson as Prisma.InputJsonObject,
          resolutionNote: match.explanation,
          createdBy: actor,
        },
        include: {
          sourceAsset: { select: assetSelect },
          candidateAsset: { select: assetSelect },
          evidence: { select: { id: true, title: true, sha256: true, status: true } },
        },
      });
      created.push(row);
    }

    await this.audit.logRequired({
      actor,
      action: 'extended_domains.mdm_match.run',
      entityType: 'mdm_match_candidate',
      metadata: {
        threshold,
        rule: ruleReceipt,
        limit: dto.limit ?? 10,
        sourceAssetId: dto.sourceAssetId ?? null,
        domainId: dto.domainId ?? null,
        evaluatedPairs,
        recommendedCount: recommendations.length,
        createdCount: created.length,
        skippedExistingCount: recommendations.length - created.length,
      },
    }, tx);
    return {
      threshold,
      rule: ruleReceipt,
      limit: dto.limit ?? 10,
      evaluatedPairs,
      recommendedCount: recommendations.length,
      createdCount: created.length,
      skippedExistingCount: recommendations.length - created.length,
      candidates: created,
      preview: recommendations,
    };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async resolveMatch(roleCodes: string[], id: string, dto: ResolveMdmMatchDto, actor: string) {
    roleCodes=await businessDecisionRoles(this.prisma,roleCodes,'extended_domains.edit');
    const [existing] = await Promise.all([
      this.findVisibleMatch(roleCodes, id),
      this.assertEvidenceLinkable(roleCodes, dto.evidenceId, actor),
    ]);
    const final = dto.status === MdmMatchStatus.merged || dto.status === MdmMatchStatus.rejected || dto.status === MdmMatchStatus.superseded;
    if (final && existing.createdBy === actor) {
      throw new ForbiddenException('MDM match creators cannot make the final resolution decision');
    }
    if (['merged', 'rejected', 'superseded'].includes(existing.status)) throw new ConflictException('Final MDM dispositions are immutable; create a new candidate for another review');
    if (dto.status && dto.status !== existing.status) requireTransition(existing.status, dto.status, { candidate: ['under_review'], under_review: ['merged', 'rejected', 'superseded'], merged: [], rejected: [], superseded: [] });
    if (final && !dto.resolutionNote?.trim()) throw new BadRequestException('Document the independent MDM disposition');
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await claimGovernanceWrite(() => tx.mdmMatchCandidate.update({
        where: { id, status: existing.status, updatedAt: existing.updatedAt },
        data: {
          status: dto.status,
          resolutionStep: dto.resolutionStep,
          resolutionNote: dto.resolutionNote,
          survivorshipRulesJson: dto.survivorshipRulesJson as Prisma.InputJsonValue | undefined,
          proposedGoldenRecordJson: dto.proposedGoldenRecordJson as Prisma.InputJsonValue | undefined,
          evidenceId: dto.evidenceId ?? undefined,
          decidedBy: final ? actor : undefined,
          decidedAt: final ? new Date() : undefined,
          updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
        },
        include: {
          sourceAsset: { select: { id: true, code: true, nameEn: true, domainId: true } },
          candidateAsset: { select: { id: true, code: true, nameEn: true, domainId: true } },
        },
      }));
      if (dto.status === MdmMatchStatus.merged) {
        await this.publishGoldenRecordForMatch(tx, updated, actor, dto);
      } else if (final) {
        await tx.mdmMergeSplitEvent.create({
          data: {
            matchCandidateId: updated.id,
            action: dto.status ?? MdmMatchStatus.rejected,
            reason: dto.resolutionNote ?? 'Final MDM match decision recorded.',
            beforeJson: existing.proposedGoldenRecordJson as Prisma.InputJsonValue | undefined,
            afterJson: dto.proposedGoldenRecordJson as Prisma.InputJsonValue | undefined,
            actor,
          },
        });
      }
      await this.audit.logRequired(
        { actor, action: 'extended_domains.mdm_match.resolve', entityType: 'mdm_match_candidate', entityId: id, metadata: { status: dto.status, step: dto.resolutionStep } },
        tx,
      );
      return updated;
    });
    return row;
  }

  async listMdmMatchRules(roleCodes: string[]) {
    const scope = await this.scope.resolve(roleCodes);
    const where: Prisma.MdmMatchRuleWhereInput = { isActive: true };
    if (scope.domains !== 'all') where.OR = [{ domainId: null }, { domainId: { in: scope.domains } }];
    return this.prisma.mdmMatchRule.findMany({ where, orderBy: [{ domainId: 'asc' }, { code: 'asc' }] });
  }

  async upsertMdmMatchRule(roleCodes: string[], dto: UpsertMdmMatchRuleDto, actor: string) {
    await this.assertDomainVisible(roleCodes, dto.domainId);
    parseMdmRule(dto.blockingJson, dto.weightsJson, dto.survivorshipJson);
    const existing = await this.prisma.mdmMatchRule.findUnique({ where: { code: dto.code } });
    if (existing) {
      await this.assertDomainVisible(roleCodes, existing.domainId);
      if ((dto.domainId ?? null) !== existing.domainId) throw new BadRequestException('Rule domain relocation requires a new governed rule code');
    }
    return claimGovernanceWrite(() => this.prisma.$transaction(async (tx) => {
    const settings = {
        name: dto.name,
        domainId: dto.domainId ?? null,
        thresholdScore: dto.thresholdScore ?? 85,
        blockingJson: dto.blockingJson as Prisma.InputJsonObject,
        weightsJson: dto.weightsJson as Prisma.InputJsonObject,
        survivorshipJson: (dto.survivorshipJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
    };
    const row = existing ? await tx.mdmMatchRule.update({
      where: { id: existing.id, updatedAt: existing.updatedAt },
      data: { ...settings, updatedBy: actor, updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)) },
    }) : await tx.mdmMatchRule.create({
      data: {
        ...settings,
        code: dto.code,
        createdBy: actor,
      },
    });
    await this.audit.logRequired({ actor, action: 'extended_domains.mdm_rule.upsert', entityType: 'mdm_match_rule', entityId: row.id, metadata: { code: row.code } }, tx);
    return row;
    })).catch((error: unknown) => {
      if ((error as { code?: string })?.code === 'P2002') throw new ConflictException('A matching rule with this code was created concurrently. Reload and review it.');
      throw error;
    });
  }

  async listGoldenRecords(
    roleCodes: string[],
    query: ExtendedRegisterQueryDto = {},
    actor?: string,
  ) {
    return this.listRegister('goldenRecords', roleCodes, actor, query);
  }

  async updateGoldenRecord(
    roleCodes: string[],
    id: string,
    dto: UpdateMdmGoldenRecordDto,
    actor: string,
  ) {
    if (!Number.isInteger(dto.expectedVersion) || dto.expectedVersion < 1)
      throw new BadRequestException(
        'The current golden-record version is required',
      );
    const assetIds = await this.visibleAssetIds(roleCodes);
    const existing = await this.prisma.mdmGoldenRecord.findFirst({
      where: {
        AND: [
          { id },
          this.assetRecordWhere(assetIds) as Prisma.MdmGoldenRecordWhereInput,
        ],
      },
    });
    if (!existing) throw new NotFoundException('mdm_golden_record not found');
    if (existing.version !== dto.expectedVersion)
      throw new ConflictException(
        'Golden record changed; reload before saving',
      );
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.mdmGoldenRecord.updateMany({
        where: { id, version: dto.expectedVersion },
        data: {
          status: dto.status,
          version: { increment: 1 },
          masteredRecordJson: dto.masteredRecordJson as
            Prisma.InputJsonValue | undefined,
          survivorshipRulesJson: dto.survivorshipRulesJson as
            Prisma.InputJsonValue | undefined,
          updatedBy: actor,
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          'Golden record changed; reload before saving',
        );
      const updated = await tx.mdmGoldenRecord.findUniqueOrThrow({
        where: { id },
      });
      await tx.mdmMergeSplitEvent.create({
        data: {
          goldenRecordId: id,
          action: dto.status ?? 'update',
          reason: dto.reason ?? 'Golden record updated.',
          beforeJson: {
            version: existing.version,
            status: existing.status,
            masteredRecordJson: existing.masteredRecordJson,
            survivorshipRulesJson: existing.survivorshipRulesJson,
          } as Prisma.InputJsonValue,
          afterJson: {
            version: updated.version,
            status: updated.status,
            masteredRecordJson: updated.masteredRecordJson,
            survivorshipRulesJson: updated.survivorshipRulesJson,
          } as Prisma.InputJsonValue,
          actor,
        },
      });
      await this.audit.logRequired(
        {
          actor,
          action: 'extended_domains.mdm_golden_record.update',
          entityType: 'mdm_golden_record',
          entityId: id,
          metadata: { status: updated.status },
        },
        tx,
      );
      return updated;
    });
    return row;
  }

  async createReferenceVersion(
    roleCodes: string[],
    dto: CreateReferenceVersionDto,
    actor: string,
  ) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = dto.assetId
      ? await this.assertAssetVisible(roleCodes, dto.assetId)
      : null;
    const domainId = dto.domainId ?? asset?.domainId ?? null;
    await this.assertDomainVisible(roleCodes, domainId);
    if (!asset && !domainId && !this.isUnrestricted(scope)) {
      throw new BadRequestException(
        'Reference data versions need a visible asset or domain',
      );
    }
    await this.assertEvidenceLinkable(roleCodes, dto.evidenceId, actor);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.referenceDataVersion.create({
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
      await this.audit.logRequired(
        {
          actor,
          action: 'extended_domains.reference_version.create',
          entityType: 'reference_data_version',
          entityId: row.id,
          metadata: { code: row.code, version: row.version },
        },
        tx,
      );
      return row;
    });
  }

  async decideReferenceVersion(roleCodes: string[], id: string, dto: ReferenceDecisionDto, actor: string) {
    roleCodes=await businessDecisionRoles(this.prisma,roleCodes,'extended_domains.edit');
    const existing = await this.findVisibleReference(roleCodes, id);
    if (existing.createdBy === actor && FINAL_REFERENCE_DECISIONS.has(dto.decision)) {
      throw new ForbiddenException('Reference version creators cannot make the final decision');
    }
    const status = referenceVersionStatus(dto.decision);
    requireTransition(existing.status, status, { draft: ['under_review'], under_review: ['approved', 'rejected'], rejected: ['under_review'], approved: ['active', 'retired'], active: ['retired'], retired: [] });
    if (status === 'active' && (!existing.approvedBy || !existing.approvedAt)) throw new BadRequestException('Activation requires a recorded independent approval');
    const now = new Date();
    if (status === 'active' && ((existing.effectiveFrom && existing.effectiveFrom > now) || (existing.effectiveTo && existing.effectiveTo <= now))) throw new BadRequestException('The reference version is outside its effective dates');
    const row = await this.prisma.$transaction(async (tx) => {
    const updated = await claimGovernanceWrite(() => tx.referenceDataVersion.update({
      where: { id, status: existing.status, updatedAt: existing.updatedAt },
      data: {
        status,
        approvedBy: dto.decision === 'approve' ? actor : undefined,
        approvedAt: dto.decision === 'approve' ? now : undefined,
      },
    }));
    await this.audit.logRequired({ actor, action: 'extended_domains.reference_version.decide', entityType: 'reference_data_version', entityId: id, metadata: { decision: dto.decision, status } }, tx);
    return updated;
    });
    return row;
  }

  async createCertification(
    roleCodes: string[],
    dto: CreateMetadataCertificationDto,
    actor: string,
  ) {
    await Promise.all([
      this.assertAssetVisible(roleCodes, dto.assetId),
      this.assertEvidenceLinkable(roleCodes, dto.evidenceId, actor),
    ]);
    const code = await this.nextCode('metadataCertification', 'META');
    return this.prisma.$transaction(async (tx) => {
      const workflowCaseId = await this.createWorkflow(
        tx,
        'metadata_certification',
        `Metadata certification ${code}`,
        dto.assetId,
        roleCodes,
        actor,
      );
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
      await this.audit.logRequired(
        {
          actor,
          action: 'extended_domains.metadata_certification.create',
          entityType: 'metadata_certification',
          entityId: row.id,
          metadata: { code, workflowCaseId },
        },
        tx,
      );
      return row;
    });
  }

  async saveCertification(roleCodes: string[], id: string, dto: SaveMetadataCertificationDto, actor: string) {
    roleCodes=await businessDecisionRoles(this.prisma,roleCodes,'extended_domains.edit');
    const [existing] = await Promise.all([
      this.findVisibleCertification(roleCodes, id),
      this.assertEvidenceLinkable(roleCodes, dto.evidenceId, actor),
    ]);
    const qualityScore = dto.qualityScore === undefined ? existing.qualityScore : clampScore(dto.qualityScore, existing.qualityScore);
    const completenessScore = dto.completenessScore === undefined ? existing.completenessScore : clampScore(dto.completenessScore, existing.completenessScore);
    const ownerConfirmed = dto.ownerConfirmed ?? existing.ownerConfirmed;
    const glossaryAligned = dto.glossaryAligned ?? existing.glossaryAligned;
    const lineageReviewed = dto.lineageReviewed ?? existing.lineageReviewed;
    const calculated = certificationStatus({ qualityScore, completenessScore, ownerConfirmed, glossaryAligned, lineageReviewed });
    if (dto.status === MetadataCertificationStatus.certified && calculated !== MetadataCertificationStatus.certified) throw new BadRequestException('Metadata does not meet the required certification checks');
    const status = dto.status === MetadataCertificationStatus.certified || dto.status === undefined ? calculated : dto.status;
    if (existing.createdBy === actor && status === MetadataCertificationStatus.certified) {
      throw new ForbiddenException('Metadata certification creators cannot certify their own metadata');
    }
    const row = await claimGovernanceWrite(() => this.prisma.$transaction(async (tx) => {
    if (status === MetadataCertificationStatus.certified) {
      if (!roleCodes.some((role) => ['enterprise_data_steward', 'dq_steward'].includes(role))) throw new ForbiddenException('An eligible metadata reviewer business role is required');
      const now = new Date();
      const expiresAt = dto.expiresAt ? this.parseDate(dto.expiresAt) : existing.expiresAt;
      if (expiresAt && expiresAt <= now) throw new BadRequestException('A current certification cannot already be expired');
      const [asset, score, owner, glossary, lineage, proof] = await Promise.all([
        tx.dataAsset.findFirst({ where: { id: existing.assetId, deletedAt: null, isActive: true } }),
        tx.dataQualityScore.findFirst({ where: { assetId: existing.assetId }, orderBy: { measuredAt: 'desc' } }),
        tx.stewardshipAssignment.findFirst({ where: { targetType: 'asset', targetId: existing.assetId, roleType: { code: 'data_owner' }, approvalStatus: 'approved', isActive: true, deletedAt: null, effectiveDate: { lte: now }, OR: [{ expiryDate: null }, { expiryDate: { gt: now } }], person: { isActive: true, deletedAt: null } } }),
        tx.businessGlossaryTerm.findFirst({ where: { assetId: existing.assetId, status: 'approved', OR: [{ reviewDueAt: null }, { reviewDueAt: { gt: now } }] } }),
        tx.businessLineageMap.findFirst({ where: { status: 'verified', OR: [{ sourceAssetId: existing.assetId }, { targetAssetId: existing.assetId }] } }),
        tx.ndiEvidence.findFirst({ where: { id: dto.evidenceId ?? existing.evidenceId ?? '__missing_certification_proof__', ...operationalEvidenceWhere(now) } }),
      ]);
      const fields = asset ? [asset.code, asset.nameEn, asset.nameAr, asset.description, asset.domainId, asset.orgUnitId, asset.systemId, asset.classificationId, asset.ownerName] : [];
      const liveCompleteness = fields.length ? Math.round(fields.filter(Boolean).length / fields.length * 100) : 0;
      if (!proof || !owner || !glossary || !lineage || !score || score.score < 80 || liveCompleteness < 80 || qualityScore !== score.score || completenessScore !== liveCompleteness) throw new BadRequestException('Certification requires current operational proof, approved ownership, reviewed glossary and lineage, and matching live quality/completeness metrics');
    }
    const updated = await claimGovernanceWrite(() => tx.metadataCertification.update({
      where: { id, updatedAt: existing.updatedAt, status: existing.status },
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
        certifiedBy: status === MetadataCertificationStatus.certified ? actor : null,
        certifiedAt: status === MetadataCertificationStatus.certified ? new Date() : null,
        updatedBy: actor,
      },
    }));
    await this.audit.logRequired({ actor, action: 'extended_domains.metadata_certification.save', entityType: 'metadata_certification', entityId: id, metadata: { status } }, tx);
    return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return row;
  }

  async createArchitectureReview(roleCodes: string[], dto: CreateArchitectureReviewDto, actor: string) {
    await Promise.all([
      this.assertAssetVisible(roleCodes, dto.assetId),
      this.assertEvidenceLinkable(roleCodes, dto.evidenceId, actor),
    ]);
    if(dto.previousReviewId){const previous=await this.findVisibleArchitectureReview(roleCodes,dto.previousReviewId);if(previous.assetId!==dto.assetId||['pending','needs_changes'].includes(previous.decision))throw new BadRequestException('A revision must follow a final review of the same asset');}
    const code = await this.nextCode('architectureReview', 'DAM');
    return this.prisma.$transaction(async (tx) => {
      const workflowCaseId = await this.createWorkflow(tx, 'architecture_review', `Architecture review ${code}`, dto.assetId, roleCodes, actor);
      const row = await tx.architectureReview.create({
        data: {
          code,
          assetId: dto.assetId,
          previousReviewId:dto.previousReviewId,
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
      await this.audit.logRequired({ actor, action: 'extended_domains.architecture_review.create', entityType: 'architecture_review', entityId: row.id, metadata: { code, workflowCaseId } },tx);
      return row;
    });
  }

  async decideArchitectureReview(
    roleCodes: string[],
    id: string,
    dto: DecideArchitectureReviewDto,
    actor: string,
  ) {
    const roles = await businessDecisionRoles(
        this.prisma,
        roleCodes,
        'extended_domains.edit',
      ),
      existing = await this.findVisibleArchitectureReview(roles, id);
    if (!['pending', 'needs_changes'].includes(existing.decision))
      throw new ConflictException(
        'This review has a final decision; create a new review revision',
      );
    if (existing.version !== dto.expectedVersion)
      throw new ConflictException(
        'Architecture review changed; reload before deciding',
      );
    if (existing.createdBy === actor && dto.decision !== 'pending')
      throw new ForbiddenException(
        'Architecture review creators cannot make the final decision',
      );
    if (!this.workflow || !existing.workflowCaseId)
      throw new BadRequestException(
        'A native architecture workflow is required; preserve this legacy review and open a new revision',
      );
    if (!dto.workflowTaskId)
      throw new BadRequestException(
        'The current architecture decision task is required',
      );
    if (
      ['needs_changes', 'rejected'].includes(dto.decision) &&
      (dto.decisionReason?.trim().length ?? 0) < 10
    )
      throw new BadRequestException(
        'Explain the requested changes or rejection in at least ten characters',
      );
    return claimGovernanceWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const identity = await governanceDecisionActor(
          tx,
          actor,
          'extended_domains.edit',
        );
        await this.workflow!.assertArchitectureDecisionTask(
          existing.workflowCaseId!,
          dto.workflowTaskId,
          identity.roles,
          actor,
          tx,
        );
        const approved = ['approved', 'approved_with_conditions'].includes(
            dto.decision,
          ),
          evidenceId = dto.evidenceId ?? existing.evidenceId;
        const proof =
          approved || (dto.decision === 'pending' && !!dto.evidenceId)
            ? await governanceDecisionProof(tx, this.evidence, identity, {
                evidenceId,
                justification: dto.evidenceJustification,
                targetType: 'architecture_review',
                targetId: id,
                context: {
                  assetId: existing.assetId,
                  previousReviewId: existing.previousReviewId,
                  decision: dto.decision,
                  version: existing.version + 1,
                  workflowTaskId: dto.workflowTaskId,
                },
              })
            : null;
        if (approved) {
          const linked = existing.decisionProof as {
            targetId?: string;
            context?: { assetId?: string; workflowTaskId?: string };
            document?: {
              id?: string;
              sha256?: string;
              evidenceUpdatedAt?: string;
            };
          } | null;
          if (
            !linked ||
            linked.targetId !== id ||
            linked.context?.assetId !== existing.assetId ||
            linked.context.workflowTaskId !== dto.workflowTaskId ||
            linked.document?.id !== evidenceId ||
            linked.document.sha256 !== proof?.document.sha256 ||
            linked.document.evidenceUpdatedAt !==
              proof?.document.evidenceUpdatedAt
          )
            throw new ConflictException(
              'Link the current supporting document to this decision task before approving',
            );
        }
        const claim = await tx.architectureReview.updateMany({
          where: {
            id,
            decision: existing.decision,
            version: dto.expectedVersion,
          },
          data: { version: { increment: 1 } },
        });
        if (claim.count !== 1)
          throw new ConflictException(
            'Architecture review changed; reload before deciding',
          );
        let decision = dto.decision;
        if (dto.decision !== 'pending') {
          await this.workflow!.recordDomainTaskDecision(
            {
              taskId: dto.workflowTaskId,
              roleCodes: identity.roles,
              actor,
              decision: approved ? 'approved' : 'rejected',
              comment: approved
                ? dto.evidenceJustification
                : dto.decisionReason,
              eventAction: 'architecture_review.workflow_decision',
              ...(approved && proof
                ? {
                    decisionEvidence: {
                      evidenceId: proof.document.id,
                      reviewId: id,
                      sha256: proof.document.sha256,
                    },
                  }
                : {}),
              ...(dto.decision === 'rejected'
                ? { finalOutcome: 'rejected' as const }
                : {}),
            },
            tx,
          );
          if (approved) {
            const open = await tx.workflowTask.findMany({
              where: {
                caseId: existing.workflowCaseId!,
                status: { in: ['pending', 'in_progress'] },
              },
              include: { templateStage: { select: { kind: true } } },
            });
            // Keep parallel/further reviews pending; implementation evidence legitimately follows approval.
            if (
              open.some((task) => task.templateStage?.kind !== 'implementation')
            )
              decision = ArchitectureReviewDecision.pending;
          }
        }
        const updated = await tx.architectureReview.update({
          where: { id, version: dto.expectedVersion + 1 },
          data: {
            decision,
            architectureDecision: dto.architectureDecision,
            lineageImpact: dto.lineageImpact,
            conditionsJson: dto.conditionsJson as
              Prisma.InputJsonValue | undefined,
            evidenceId: evidenceId ?? undefined,
            decisionProof: proof
              ? (proof as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            reviewedBy: dto.decision !== 'pending' ? actor : undefined,
            reviewedAt: dto.decision !== 'pending' ? new Date() : undefined,
            updatedBy: actor,
          },
        });
        await this.audit.logRequired(
          {
            actor,
            action:
              dto.decision === 'pending'
                ? 'extended_domains.architecture_review.evidence.link'
                : 'extended_domains.architecture_review.decide',
            entityType: 'architecture_review',
            entityId: id,
            metadata: {
              previousDecision: existing.decision,
              requestedDecision: dto.decision,
              decision,
              decisionReason: dto.decisionReason,
              previousVersion: existing.version,
              newVersion: updated.version,
              evidenceId,
              decisionProof: proof,
              workflowCaseId: existing.workflowCaseId,
              workflowTaskId: dto.workflowTaskId,
            },
          },
          tx,
        );
        return updated;
      }),
    );
  }

  async reviseArchitectureReview(
    roleCodes: string[],
    id: string,
    actor: string,
  ) {
    const previous = await this.findVisibleArchitectureReview(roleCodes, id);
    if (previous.decision === 'pending')
      throw new BadRequestException(
        'Finish the current review before opening another revision',
      );
    return this.createArchitectureReview(
      roleCodes,
      {
        assetId: previous.assetId,
        title: previous.title,
        previousReviewId: id,
        reviewType: previous.reviewType,
        riskLevel: previous.riskLevel,
        architectureDecision: previous.architectureDecision ?? undefined,
        lineageImpact: previous.lineageImpact ?? undefined,
      },
      actor,
    );
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
    return nextAvailableBusinessCode(
      tx,
      `workflow_case:${prefix.toLowerCase()}:${day}`,
      (value) => `${prefix}-${day}-${formatBusinessSequence(value, 3)}`,
      async (code) => !(await tx.workflowCase.findUnique({ where: { code }, select: { id: true } })),
    );
  }

  private async nextCode(model: 'mdmMatchCandidate' | 'metadataCertification' | 'architectureReview', prefix: string, client: Prisma.TransactionClient = this.prisma): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return nextAvailableBusinessCode(
      client,
      `extended_domains:${model}:${day}`,
      (value) => `${prefix}-${day}-${formatBusinessSequence(value, 3)}`,
      async (code) => !(
        model === 'mdmMatchCandidate'
          ? await client.mdmMatchCandidate.findUnique({ where: { code } })
          : model === 'metadataCertification'
            ? await client.metadataCertification.findUnique({ where: { code } })
            : await client.architectureReview.findUnique({ where: { code } })
      ),
    );
  }

  private async findVisibleMatch(roleCodes: string[], id: string) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    const row = await this.prisma.mdmMatchCandidate.findFirst({ where: { AND: [{ id }, this.matchWhere(assetIds)] } });
    if (!row) throw new NotFoundException('mdm_match_candidate not found');
    return row;
  }

  private async publishGoldenRecordForMatch(
    tx: Prisma.TransactionClient,
    match: {
      id: string;
      code: string;
      sourceAssetId: string;
      candidateAssetId: string;
      sourceAsset: {
        id: string;
        code: string;
        nameEn: string;
        domainId: string | null;
      };
      candidateAsset: {
        id: string;
        code: string;
        nameEn: string;
        domainId: string | null;
      };
      proposedGoldenRecordJson: Prisma.JsonValue | null;
      survivorshipRulesJson: Prisma.JsonValue | null;
    },
    actor: string,
    dto: ResolveMdmMatchDto,
  ) {
    const orderedIds = [match.sourceAssetId, match.candidateAssetId].sort();
    const clusterKey = orderedIds.join(':');
    const orderedAssets = [match.sourceAsset, match.candidateAsset].sort(
      (a, b) => a.id.localeCompare(b.id),
    );
    const code =
      'GOLD-' +
      orderedAssets
        .map((asset) => asset.code)
        .join('-')
        .replace(/[^a-zA-Z0-9-]+/g, '-')
        .slice(0, 80) +
      '-' +
      createHash('sha256').update(clusterKey).digest('hex').slice(0, 12);
    const masteredRecord = dto.proposedGoldenRecordJson ??
      match.proposedGoldenRecordJson ?? {
        name: match.sourceAsset.nameEn || match.candidateAsset.nameEn,
        sourceAssetCode: match.sourceAsset.code,
        candidateAssetCode: match.candidateAsset.code,
        winningSource: match.sourceAsset.code,
      };
    const survivorshipRules = dto.survivorshipRulesJson ??
      match.survivorshipRulesJson ?? { strategy: 'source_trust_rank' };
    const existingGolden = await tx.mdmGoldenRecord.findFirst({
      where: { OR: [{ code }, { clusterKey }] },
    });
    if (existingGolden)
      throw new ConflictException(
        'This cluster already has a golden record; reload it and use its explicit versioned correction action',
      );
    const golden = await tx.mdmGoldenRecord
      .create({
        data: {
          code,
          assetId: match.sourceAssetId,
          domainId: match.sourceAsset.domainId ?? match.candidateAsset.domainId,
          clusterKey,
          sourceRecordIdsJson: orderedIds,
          masteredRecordJson: masteredRecord as Prisma.InputJsonValue,
          survivorshipRulesJson: survivorshipRules as Prisma.InputJsonValue,
          status: MdmGoldenRecordStatus.active,
          createdBy: actor,
        },
      })
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === 'P2002')
          throw new ConflictException(
            'This golden-record cluster was published concurrently; reload it before correcting it',
          );
        throw error;
      });
    await tx.mdmMergeSplitEvent.create({
      data: {
        goldenRecordId: golden.id,
        matchCandidateId: match.id,
        action: 'merge',
        reason:
          dto.resolutionNote ??
          'High-confidence MDM match merged into a golden record.',
        beforeJson: match.proposedGoldenRecordJson as
          Prisma.InputJsonValue | undefined,
        afterJson: golden.masteredRecordJson as Prisma.InputJsonValue,
        actor,
      },
    });
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
