import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GovernanceEscalationLevel, GovernanceLifecycleStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDecisionRightDto,
  CreateDomainCouncilDto,
  CreateGovernanceCharterDto,
  CreateGovernancePolicyDto,
  CreateImprovementItemDto,
  CreateMaturityAssessmentDto,
} from './governance-lifecycle.dto';
import {
  lifecycleReadiness,
  missingCharterElements,
  overallMaturityScore,
} from './governance-lifecycle.logic';

@Injectable()
export class GovernanceLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async workspace() {
    const [
      activeCharters,
      approvedPolicies,
      activeCouncils,
      activeDecisionRights,
      latestAssessment,
      openImprovements,
      charters,
      policies,
      councils,
      decisionRights,
    ] = await Promise.all([
      this.prisma.governanceCharter.count({ where: { status: { in: [GovernanceLifecycleStatus.active, GovernanceLifecycleStatus.approved] } } }),
      this.prisma.governancePolicy.count({ where: { status: GovernanceLifecycleStatus.approved } }),
      this.prisma.dataDomainCouncil.count({ where: { status: { in: [GovernanceLifecycleStatus.active, GovernanceLifecycleStatus.approved] } } }),
      this.prisma.governanceDecisionRight.count({ where: { status: { in: [GovernanceLifecycleStatus.active, GovernanceLifecycleStatus.approved] } } }),
      this.prisma.governanceMaturityAssessment.findFirst({ orderBy: { createdAt: 'desc' }, include: { dimensions: true } }),
      this.prisma.continuousImprovementItem.count({ where: { status: { notIn: [GovernanceLifecycleStatus.approved, GovernanceLifecycleStatus.retired] } } }),
      this.prisma.governanceCharter.findMany({ orderBy: { updatedAt: 'desc' }, take: 5 }),
      this.prisma.governancePolicy.findMany({ orderBy: { updatedAt: 'desc' }, take: 8 }),
      this.prisma.dataDomainCouncil.findMany({ include: { members: true }, orderBy: { updatedAt: 'desc' }, take: 5 }),
      this.prisma.governanceDecisionRight.findMany({ orderBy: { updatedAt: 'desc' }, take: 8 }),
    ]);
    const latestMaturityScore = latestAssessment?.overallScore ?? null;
    const status = lifecycleReadiness({
      activeCharters,
      approvedPolicies,
      activeCouncils,
      activeDecisionRights,
      latestMaturityScore,
      openImprovements,
    });
    return {
      generatedAt: new Date().toISOString(),
      status,
      summary: {
        activeCharters,
        approvedPolicies,
        activeCouncils,
        activeDecisionRights,
        latestMaturityScore,
        openImprovements,
      },
      charters: charters.map((row) => ({
        ...row,
        missingElements: missingCharterElements(row.eightElementsJson),
      })),
      policies,
      councils,
      decisionRights,
      latestAssessment,
    };
  }

  async createCharter(dto: CreateGovernanceCharterDto, user: AuthUser) {
    const missing = missingCharterElements(dto.eightElementsJson);
    if (missing.length) throw new BadRequestException(`Charter is missing mandatory elements: ${missing.join(', ')}`);
    await this.assertOptionalRole(dto.ownerRoleCode);
    await this.assertOptionalRole(dto.sponsorRoleCode);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.governanceCharter.upsert({
        where: { code: dto.code },
        create: {
          code: dto.code,
          nameEn: dto.nameEn,
          nameAr: dto.nameAr ?? null,
          purpose: dto.purpose,
          scope: dto.scope,
          eightElementsJson: dto.eightElementsJson as Prisma.InputJsonObject,
          sponsorRoleCode: dto.sponsorRoleCode ?? null,
          ownerRoleCode: dto.ownerRoleCode ?? null,
          status: dto.status ?? GovernanceLifecycleStatus.draft,
          reviewDueAt: dto.reviewDueAt ? new Date(dto.reviewDueAt) : null,
          approvedAt: dto.status === GovernanceLifecycleStatus.approved ? new Date() : null,
          createdBy: user.email,
        },
        update: {
          nameEn: dto.nameEn,
          nameAr: dto.nameAr ?? null,
          purpose: dto.purpose,
          scope: dto.scope,
          eightElementsJson: dto.eightElementsJson as Prisma.InputJsonObject,
          sponsorRoleCode: dto.sponsorRoleCode ?? null,
          ownerRoleCode: dto.ownerRoleCode ?? null,
          status: dto.status ?? GovernanceLifecycleStatus.draft,
          reviewDueAt: dto.reviewDueAt ? new Date(dto.reviewDueAt) : null,
          approvedAt: dto.status === GovernanceLifecycleStatus.approved ? new Date() : undefined,
          updatedBy: user.email,
        },
      });
      await this.audit.log({ actor: user.email, action: 'governance_lifecycle.charter.upsert', entityType: 'governance_charter', entityId: row.id }, tx);
      return row;
    });
  }

  async createPolicy(dto: CreateGovernancePolicyDto, user: AuthUser) {
    await this.assertOptionalRole(dto.ownerRoleCode);
    if (dto.domainId) await this.assertDomain(dto.domainId);
    if (dto.approvalCaseId) await this.assertWorkflowCase(dto.approvalCaseId);
    if (dto.parentCode) {
      const parent = await this.prisma.governancePolicy.findUnique({ where: { code: dto.parentCode }, select: { code: true } });
      if (!parent) throw new BadRequestException('Parent policy code was not found');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.governancePolicy.upsert({
        where: { code: dto.code },
        create: {
          code: dto.code,
          titleEn: dto.titleEn,
          titleAr: dto.titleAr ?? null,
          level: dto.level,
          parentCode: dto.parentCode ?? null,
          domainId: dto.domainId ?? null,
          ownerRoleCode: dto.ownerRoleCode ?? null,
          version: dto.version ?? '1.0',
          status: dto.status ?? GovernanceLifecycleStatus.draft,
          effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : null,
          reviewDueAt: dto.reviewDueAt ? new Date(dto.reviewDueAt) : null,
          body: dto.body ?? null,
          controlsJson: (dto.controlsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          approvalCaseId: dto.approvalCaseId ?? null,
          createdBy: user.email,
        },
        update: {
          titleEn: dto.titleEn,
          titleAr: dto.titleAr ?? null,
          level: dto.level,
          parentCode: dto.parentCode ?? null,
          domainId: dto.domainId ?? null,
          ownerRoleCode: dto.ownerRoleCode ?? null,
          version: dto.version ?? '1.0',
          status: dto.status ?? GovernanceLifecycleStatus.draft,
          effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : null,
          reviewDueAt: dto.reviewDueAt ? new Date(dto.reviewDueAt) : null,
          body: dto.body ?? null,
          controlsJson: (dto.controlsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          approvalCaseId: dto.approvalCaseId ?? null,
          updatedBy: user.email,
        },
      });
      await this.audit.log({ actor: user.email, action: 'governance_lifecycle.policy.upsert', entityType: 'governance_policy', entityId: row.id }, tx);
      return row;
    });
  }

  async createCouncil(dto: CreateDomainCouncilDto, user: AuthUser) {
    await this.assertOptionalRole(dto.leadStewardRoleCode);
    if (dto.domainId) await this.assertDomain(dto.domainId);
    for (const member of dto.members ?? []) await this.assertOptionalRole(member.roleCode);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.dataDomainCouncil.upsert({
        where: { code: dto.code },
        create: {
          code: dto.code,
          nameEn: dto.nameEn,
          nameAr: dto.nameAr ?? null,
          domainId: dto.domainId ?? null,
          leadStewardRoleCode: dto.leadStewardRoleCode ?? null,
          cadence: dto.cadence ?? 'monthly',
          quorum: dto.quorum ?? 3,
          status: dto.status ?? GovernanceLifecycleStatus.active,
          createdBy: user.email,
          members: {
            create: (dto.members ?? []).map((member) => ({
              personEmail: member.personEmail ?? null,
              roleCode: member.roleCode ?? null,
              memberRole: member.memberRole,
              votingWeight: member.votingWeight ?? 1,
            })),
          },
        },
        update: {
          nameEn: dto.nameEn,
          nameAr: dto.nameAr ?? null,
          domainId: dto.domainId ?? null,
          leadStewardRoleCode: dto.leadStewardRoleCode ?? null,
          cadence: dto.cadence ?? 'monthly',
          quorum: dto.quorum ?? 3,
          status: dto.status ?? GovernanceLifecycleStatus.active,
          updatedBy: user.email,
        },
        include: { members: true },
      });
      if (dto.members) {
        await tx.dataDomainCouncilMember.deleteMany({ where: { councilId: row.id } });
        await tx.dataDomainCouncilMember.createMany({
          data: dto.members.map((member) => ({
            councilId: row.id,
            personEmail: member.personEmail ?? null,
            roleCode: member.roleCode ?? null,
            memberRole: member.memberRole,
            votingWeight: member.votingWeight ?? 1,
          })),
        });
      }
      await this.audit.log({ actor: user.email, action: 'governance_lifecycle.council.upsert', entityType: 'data_domain_council', entityId: row.id }, tx);
      return tx.dataDomainCouncil.findUnique({ where: { id: row.id }, include: { members: true } });
    });
  }

  async createDecisionRight(dto: CreateDecisionRightDto, user: AuthUser) {
    await this.assertRole(dto.ownerRoleCode);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.governanceDecisionRight.upsert({
        where: { code: dto.code },
        create: {
          code: dto.code,
          decisionArea: dto.decisionArea,
          decisionType: dto.decisionType,
          ownerRoleCode: dto.ownerRoleCode,
          consultedRoleCodesJson: (dto.consultedRoleCodesJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          timeframeBusinessDays: dto.timeframeBusinessDays ?? 5,
          escalationLevel: dto.escalationLevel ?? GovernanceEscalationLevel.domain_council,
          evidenceRequiredJson: (dto.evidenceRequiredJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          status: dto.status ?? GovernanceLifecycleStatus.active,
          createdBy: user.email,
        },
        update: {
          decisionArea: dto.decisionArea,
          decisionType: dto.decisionType,
          ownerRoleCode: dto.ownerRoleCode,
          consultedRoleCodesJson: (dto.consultedRoleCodesJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          timeframeBusinessDays: dto.timeframeBusinessDays ?? 5,
          escalationLevel: dto.escalationLevel ?? GovernanceEscalationLevel.domain_council,
          evidenceRequiredJson: (dto.evidenceRequiredJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          status: dto.status ?? GovernanceLifecycleStatus.active,
          updatedBy: user.email,
        },
      });
      await this.audit.log({ actor: user.email, action: 'governance_lifecycle.decision_right.upsert', entityType: 'governance_decision_right', entityId: row.id }, tx);
      return row;
    });
  }

  async createMaturityAssessment(dto: CreateMaturityAssessmentDto, user: AuthUser) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd <= periodStart) throw new BadRequestException('Maturity assessment period end must be after start');
    const overallScore = overallMaturityScore(dto.dimensions);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.governanceMaturityAssessment.upsert({
        where: { code: dto.code },
        create: {
          code: dto.code,
          title: dto.title,
          scopeType: dto.scopeType,
          scopeId: dto.scopeId ?? null,
          periodStart,
          periodEnd,
          overallScore,
          status: dto.status ?? GovernanceLifecycleStatus.under_review,
          assessedBy: user.email,
          dimensions: {
            create: dto.dimensions.map((dimension) => ({
              dimension: dimension.dimension,
              score: dimension.score,
              evidenceJson: (dimension.evidenceJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              gapsJson: (dimension.gapsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              actionsJson: (dimension.actionsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            })),
          },
        },
        update: {
          title: dto.title,
          scopeType: dto.scopeType,
          scopeId: dto.scopeId ?? null,
          periodStart,
          periodEnd,
          overallScore,
          status: dto.status ?? GovernanceLifecycleStatus.under_review,
          assessedBy: user.email,
        },
      });
      await tx.governanceMaturityAssessmentDimension.deleteMany({ where: { assessmentId: row.id } });
      await tx.governanceMaturityAssessmentDimension.createMany({
        data: dto.dimensions.map((dimension) => ({
          assessmentId: row.id,
          dimension: dimension.dimension,
          score: dimension.score,
          evidenceJson: (dimension.evidenceJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          gapsJson: (dimension.gapsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          actionsJson: (dimension.actionsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        })),
      });
      await this.audit.log({ actor: user.email, action: 'governance_lifecycle.maturity.upsert', entityType: 'governance_maturity_assessment', entityId: row.id, metadata: { overallScore } }, tx);
      return tx.governanceMaturityAssessment.findUnique({ where: { id: row.id }, include: { dimensions: true } });
    });
  }

  async createImprovementItem(dto: CreateImprovementItemDto, user: AuthUser) {
    await this.assertOptionalRole(dto.ownerRoleCode);
    if (dto.maturityAssessmentId) {
      const assessment = await this.prisma.governanceMaturityAssessment.findUnique({ where: { id: dto.maturityAssessmentId }, select: { id: true } });
      if (!assessment) throw new NotFoundException('maturity assessment not found');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.continuousImprovementItem.upsert({
        where: { code: dto.code },
        create: {
          code: dto.code,
          title: dto.title,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId ?? null,
          maturityAssessmentId: dto.maturityAssessmentId ?? null,
          ownerRoleCode: dto.ownerRoleCode ?? null,
          priority: dto.priority ?? 'medium',
          status: dto.status ?? GovernanceLifecycleStatus.draft,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          evidenceJson: (dto.evidenceJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          createdBy: user.email,
        },
        update: {
          title: dto.title,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId ?? null,
          maturityAssessmentId: dto.maturityAssessmentId ?? null,
          ownerRoleCode: dto.ownerRoleCode ?? null,
          priority: dto.priority ?? 'medium',
          status: dto.status ?? GovernanceLifecycleStatus.draft,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          evidenceJson: (dto.evidenceJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          updatedBy: user.email,
        },
      });
      await this.audit.log({ actor: user.email, action: 'governance_lifecycle.improvement.upsert', entityType: 'continuous_improvement_item', entityId: row.id }, tx);
      return row;
    });
  }

  private async assertOptionalRole(roleCode?: string | null): Promise<void> {
    if (roleCode) await this.assertRole(roleCode);
  }

  private async assertRole(roleCode: string): Promise<void> {
    const role = await this.prisma.role.findFirst({ where: { code: roleCode, isActive: true, deletedAt: null }, select: { id: true } });
    if (!role) throw new BadRequestException(`Role ${roleCode} was not found`);
  }

  private async assertDomain(domainId: string): Promise<void> {
    const domain = await this.prisma.dataDomain.findFirst({ where: { id: domainId, isActive: true, deletedAt: null }, select: { id: true } });
    if (!domain) throw new BadRequestException('Data domain was not found');
  }

  private async assertWorkflowCase(caseId: string): Promise<void> {
    const wfCase = await this.prisma.workflowCase.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!wfCase) throw new BadRequestException('Approval workflow case was not found');
  }
}
