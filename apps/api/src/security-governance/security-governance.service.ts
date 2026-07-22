import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccessDecision,
  AccessReviewDecision,
  AccessReviewStatus,
  CaseStatus,
  ClassificationRequestStatus,
  DlpIncidentStatus,
  MaskingTechnique,
  Prisma,
  SecuritySeverity,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CreateAccessReviewDto,
  CreateClassificationChangeRequestDto,
  CreateDlpIncidentDto,
  CreateMaskingPolicyDto,
  CreateRoleDataAccessMapDto,
  SimulateAccessDecisionDto,
  UpdateAccessReviewItemDto,
} from './security-governance.dto';
import { evaluateAbacDecision, validateRoleDataAccessMapIntegrity } from './security-governance.logic';

type PrismaWriter = PrismaService | Prisma.TransactionClient;
const SECURITY_MAINTENANCE_ROLES = new Set(['system_admin', 'dmo_admin']);

function accessScopeKey(domainId?: string | null, classificationId?: string | null): string {
  return `domain:${domainId ?? 'all'}|class:${classificationId ?? 'all'}`;
}

const mappingInclude = {
  role: { select: { id: true, code: true, nameEn: true, nameAr: true, maxClassificationRank: true } },
  domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  classification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
  maskingPolicy: { select: { id: true, code: true, nameEn: true, nameAr: true, technique: true, previewBefore: true, previewAfter: true } },
};

const policyInclude = {
  domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  classification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
};

function reviewInclude(itemWhere?: Prisma.AccessReviewItemWhereInput) {
  return {
    ownerUser: { select: { id: true, email: true, displayName: true } },
    items: {
      ...(itemWhere && Object.keys(itemWhere).length ? { where: itemWhere } : {}),
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        role: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        asset: {
          select: {
            id: true,
            code: true,
            nameEn: true,
            nameAr: true,
            domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
            classification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
          },
        },
        domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        classification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
      },
      orderBy: [{ decision: 'asc' as const }, { createdAt: 'asc' as const }],
    },
  };
}

const dlpInclude = {
  asset: {
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      classification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
    },
  },
  classification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
  assignedPerson: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true } },
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
};

const classificationRequestInclude = {
  asset: {
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
  },
  fromClassification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
  toClassification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
};

@Injectable()
export class SecurityGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly workflow?: WorkflowService,
  ) {}

  private async visibleAssetIds(roleCodes: string[]): Promise<Set<string> | 'all'> {
    const scope = await this.scope.resolve(roleCodes);
    const unrestricted =
      scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
    if (unrestricted) return 'all';
    const where: Prisma.DataAssetWhereInput = { deletedAt: null };
    if (scope.orgUnits !== 'all') where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== 'all') where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [{ classificationId: null }, { classification: { rank: { lte: scope.maxClassRank } } }];
    }
    const rows = await this.prisma.dataAsset.findMany({ where, select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  private isUnrestricted(scope: EffectiveScope): boolean {
    return scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
  }

  private async assertDomainInScope(scope: EffectiveScope, domainId?: string | null): Promise<void> {
    if (!domainId) return;
    const domain = await this.prisma.dataDomain.findFirst({ where: { id: domainId, deletedAt: null } });
    if (!domain) throw new BadRequestException('Data domain not found');
    if (scope.orgUnits !== 'all') {
      throw new ForbiddenException('Domain-level security changes require unrestricted organization scope');
    }
    if (scope.domains !== 'all' && !scope.domains.includes(domainId)) {
      throw new ForbiddenException('Data domain is outside your data scope');
    }
  }

  private async assertClassificationInScope(scope: EffectiveScope, classificationId?: string | null): Promise<void> {
    if (!classificationId) return;
    const classification = await this.prisma.classification.findFirst({
      where: { id: classificationId, deletedAt: null },
      select: { rank: true },
    });
    if (!classification) throw new BadRequestException('Classification not found');
    if (scope.maxClassRank != null && classification.rank > scope.maxClassRank) {
      throw new ForbiddenException('Classification is above your data scope');
    }
  }

  private async assertSecurityTarget(
    roleCodes: string[],
    target: { assetId?: string | null; domainId?: string | null; classificationId?: string | null },
    options: { requireTarget?: boolean; rejectUnboundedClassification?: boolean } = {},
  ): Promise<void> {
    const [scope, assetIds] = await Promise.all([this.scope.resolve(roleCodes), this.visibleAssetIds(roleCodes)]);
    if (target.assetId) {
      const asset = await this.prisma.dataAsset.findFirst({ where: { id: target.assetId, deletedAt: null } });
      if (!asset) throw new BadRequestException('Data asset not found');
      if (assetIds !== 'all' && !assetIds.has(target.assetId)) {
        throw new ForbiddenException('Data asset is outside your data scope');
      }
    }
    await this.assertDomainInScope(scope, target.domainId);
    await this.assertClassificationInScope(scope, target.classificationId);
    const hasConcreteScope = !!target.assetId || !!target.domainId || !!target.classificationId;
    if (!hasConcreteScope && !this.isUnrestricted(scope)) {
      throw new ForbiddenException('Global security changes require unrestricted data scope');
    }
    if (!target.assetId && scope.orgUnits !== 'all') {
      throw new ForbiddenException('Organization-scoped security changes must be linked to a visible asset');
    }
    if (!target.assetId && !target.domainId && scope.domains !== 'all') {
      throw new ForbiddenException('Domain-scoped security changes must be linked to an allowed domain or asset');
    }
    if (options.requireTarget && !hasConcreteScope) {
      throw new BadRequestException('Security review item must include an asset, domain, or classification');
    }
    if (options.rejectUnboundedClassification && !target.assetId && !target.classificationId && scope.maxClassRank != null) {
      throw new ForbiddenException('Classification-limited users must choose a classification or asset');
    }
  }

  private async assertMaskingPolicyInScope(roleCodes: string[], maskingPolicyId?: string | null): Promise<void> {
    if (!maskingPolicyId) return;
    const policy = await this.prisma.maskingPolicy.findFirst({
      where: { id: maskingPolicyId, deletedAt: null },
      select: { domainId: true, classificationId: true },
    });
    if (!policy) throw new BadRequestException('Masking policy not found');
    await this.assertSecurityTarget(roleCodes, policy, { rejectUnboundedClassification: true });
  }

  private scopedAssetWhere(assetIds: Set<string> | 'all'): Prisma.DataAssetWhereInput {
    if (assetIds === 'all') return {};
    return { OR: [{ id: { in: [...assetIds] } }] };
  }

  private assetClassificationScope(
    scope: EffectiveScope,
    assetIds: Set<string> | 'all',
  ): Prisma.DlpIncidentWhereInput {
    if (assetIds === 'all') return {};
    const or: Prisma.DlpIncidentWhereInput[] = [];
    if (assetIds.size > 0) or.push({ assetId: { in: [...assetIds] } });
    if (scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank != null) {
      or.push({
        AND: [
          { assetId: null },
          { classificationId: { not: null } },
          { classification: { rank: { lte: scope.maxClassRank } } },
        ],
      });
    }
    return or.length ? { OR: or } : { id: { equals: '__no_visible_security_records__' } };
  }

  private assetDomainClassificationScope(
    scope: EffectiveScope,
    assetIds: Set<string> | 'all',
  ): Prisma.AbacDecisionLogWhereInput {
    if (assetIds === 'all') return {};
    const or: Prisma.AbacDecisionLogWhereInput[] = [];
    if (assetIds.size > 0) or.push({ assetId: { in: [...assetIds] } });
    if (scope.orgUnits === 'all') {
      const unlinked: Prisma.AbacDecisionLogWhereInput[] = [{ assetId: null }];
      if (scope.domains !== 'all') {
        unlinked.push({ domainId: { in: scope.domains } });
      }
      if (scope.maxClassRank != null) {
        unlinked.push({
          OR: [
            { classificationId: null },
            { classification: { rank: { lte: scope.maxClassRank } } },
          ],
        });
      }
      if (unlinked.length > 1) or.push({ AND: unlinked });
    }
    return or.length ? { OR: or } : { id: { equals: '__no_visible_security_decisions__' } };
  }

  private requiredAssetScope(assetIds: Set<string> | 'all') {
    if (assetIds === 'all') return {};
    return { assetId: { in: [...assetIds] } };
  }

  private domainClassWhere<T extends object>(scope: EffectiveScope): T {
    const and: Record<string, unknown>[] = [];
    if (scope.domains !== 'all') and.push({ OR: [{ domainId: null }, { domainId: { in: scope.domains } }] });
    if (scope.maxClassRank != null) {
      and.push({ OR: [{ classificationId: null }, { classification: { rank: { lte: scope.maxClassRank } } }] });
    }
    return (and.length ? { AND: and } : {}) as T;
  }

  private reviewItemScope(scope: EffectiveScope, assetIds: Set<string> | 'all'): Prisma.AccessReviewItemWhereInput {
    if (assetIds === 'all') {
      return this.domainClassWhere<Prisma.AccessReviewItemWhereInput>(scope);
    }
    const or: Prisma.AccessReviewItemWhereInput[] = [];
    if (assetIds.size > 0) or.push({ assetId: { in: [...assetIds] } });
    if (scope.orgUnits === 'all') {
      const unlinked: Prisma.AccessReviewItemWhereInput[] = [{ assetId: null }];
      if (scope.domains !== 'all') {
        unlinked.push({ domainId: { in: scope.domains } });
      } else if (scope.maxClassRank == null) {
        return or.length ? { OR: or } : { id: { equals: '__no_visible_access_review_items__' } };
      }
      if (scope.maxClassRank != null) {
        unlinked.push({
          OR: [
            { classificationId: null },
            { classification: { rank: { lte: scope.maxClassRank } } },
          ],
        });
      }
      if (unlinked.length > 1) or.push({ AND: unlinked });
    }
    return or.length ? { OR: or } : { id: { equals: '__no_visible_access_review_items__' } };
  }

  private async nextCode(prefix: string, model: 'maskingPolicy' | 'accessReview' | 'dlpIncident'): Promise<string> {
    const count =
      model === 'maskingPolicy'
        ? await this.prisma.maskingPolicy.count()
        : model === 'accessReview'
          ? await this.prisma.accessReview.count()
          : await this.prisma.dlpIncident.count();
    for (let i = 1; i <= 50; i++) {
      const code = `${prefix}-${String(count + i).padStart(4, '0')}`;
      const exists =
        model === 'maskingPolicy'
          ? await this.prisma.maskingPolicy.findUnique({ where: { code } })
          : model === 'accessReview'
            ? await this.prisma.accessReview.findUnique({ where: { code } })
            : await this.prisma.dlpIncident.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `${prefix}-${Date.now()}`;
  }

  private async nextWorkflowCaseCode(client: PrismaWriter, prefix: string): Promise<string> {
    const count = await client.workflowCase.count();
    for (let i = 1; i <= 50; i++) {
      const code = `WFC-${prefix}-${String(count + i).padStart(4, '0')}`;
      const exists = await client.workflowCase.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `WFC-${prefix}-${Date.now()}`;
  }

  private async createSecurityWorkflow(
    client: PrismaWriter,
    roleCodes: string[],
    actor: string,
    kind: 'dlp' | 'classification',
    target: { title: string; description?: string | null; assetId?: string | null; assigneePersonId?: string | null },
  ): Promise<string> {
    const code = await this.nextWorkflowCaseCode(client, kind === 'dlp' ? 'DLP' : 'CLS');
    const assignee = target.assigneePersonId
      ? await client.person.findUnique({ where: { id: target.assigneePersonId }, select: { userId: true, fullNameEn: true } })
      : null;
    if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');
    const wfCase = await this.workflow.openRoutedCase(
      {
        roleCodes,
        actor,
        title: target.title,
        description: target.description,
        type: kind === 'dlp' ? 'dlp_incident' : 'classification_change_request',
        status: CaseStatus.submitted,
        assetId: target.assetId,
        preferredCode: code,
        initialAssigneeUserId: assignee?.userId ?? null,
        initialTaskTitle: kind === 'dlp' ? 'Review and contain protection incident' : 'Review requested classification change',
      },
      client as Prisma.TransactionClient,
    );
    return wfCase.id;
  }

  private assertSecurityMaintenanceRole(roleCodes: string[]): void {
    if (!roleCodes.some((role) => SECURITY_MAINTENANCE_ROLES.has(role))) {
      throw new ForbiddenException('Only security administrators can repair workflow links');
    }
  }

  async backfillWorkflowLinks(roleCodes: string[], actor: string) {
    this.assertSecurityMaintenanceRole(roleCodes);
    if (!this.workflow) throw new BadRequestException('Workflow engine is unavailable');

    const result = await this.prisma.$transaction(async (tx) => {
      const dlpRows = await tx.dlpIncident.findMany({
        where: { workflowCaseId: null },
        select: {
          id: true,
          title: true,
          description: true,
          assetId: true,
          assignedPersonId: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      const classificationRows = await tx.classificationChangeRequest.findMany({
        where: { workflowCaseId: null },
        select: {
          id: true,
          reason: true,
          assetId: true,
          asset: { select: { code: true, nameEn: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });

      let dlpIncidents = 0;
      let classificationRequests = 0;
      for (const incident of dlpRows) {
        const workflowCaseId = await this.createSecurityWorkflow(tx, roleCodes, actor, 'dlp', {
          title: `Review DLP incident: ${incident.title}`,
          description: incident.description,
          assetId: incident.assetId,
          assigneePersonId: incident.assignedPersonId,
        });
        await tx.dlpIncident.update({
          where: { id: incident.id },
          data: { workflowCaseId },
        });
        dlpIncidents++;
      }
      for (const request of classificationRows) {
        const assetLabel = request.asset?.code ?? request.asset?.nameEn ?? request.assetId;
        const workflowCaseId = await this.createSecurityWorkflow(tx, roleCodes, actor, 'classification', {
          title: `Review classification change: ${assetLabel}`,
          description: request.reason,
          assetId: request.assetId,
        });
        await tx.classificationChangeRequest.update({
          where: { id: request.id },
          data: { workflowCaseId },
        });
        classificationRequests++;
      }
      return { dlpIncidents, classificationRequests };
    });

    await this.audit.log({
      actor,
      action: 'security_governance.workflow_links.backfill',
      entityType: 'security_governance',
      metadata: result,
    });
    return result;
  }

  async summary(roleCodes: string[]) {
    const [scope, assetIds] = await Promise.all([this.scope.resolve(roleCodes), this.visibleAssetIds(roleCodes)]);
    const mappingWhere = { isActive: true, ...this.domainClassWhere<Prisma.RoleDataAccessMapWhereInput>(scope) };
    const policyWhere = { deletedAt: null, isActive: true, ...this.domainClassWhere<Prisma.MaskingPolicyWhereInput>(scope) };
    const dlpScope = this.assetClassificationScope(scope, assetIds);
    const decisionScope = this.assetDomainClassificationScope(scope, assetIds);
    const itemScope = this.reviewItemScope(scope, assetIds);
    const [mappings, policies, pendingReviews, openDlp, pendingClassification, recentDecisions] = await Promise.all([
      this.prisma.roleDataAccessMap.count({ where: mappingWhere }),
      this.prisma.maskingPolicy.count({ where: policyWhere }),
      this.prisma.accessReviewItem.count({ where: { AND: [itemScope, { decision: AccessReviewDecision.pending }] } }),
      this.prisma.dlpIncident.count({
        where: {
          AND: [
            dlpScope,
            { status: { notIn: [DlpIncidentStatus.closed, DlpIncidentStatus.false_positive] } },
          ],
        },
      }),
      this.prisma.classificationChangeRequest.count({
        where: { AND: [this.requiredAssetScope(assetIds), { status: ClassificationRequestStatus.pending }] },
      }),
      this.prisma.abacDecisionLog.findMany({
        where: decisionScope,
        include: {
          role: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          asset: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          maskingPolicy: { select: { id: true, code: true, nameEn: true, nameAr: true, technique: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);
    const attention = pendingReviews + openDlp + pendingClassification;
    return {
      mappings,
      maskingPolicies: policies,
      pendingAccessReviews: pendingReviews,
      openDlpIncidents: openDlp,
      pendingClassificationRequests: pendingClassification,
      recentDecisions,
      riskLevel: attention >= 6 || openDlp > 0 ? 'high' : attention > 0 ? 'medium' : 'low',
    };
  }

  async accessMap(roleCodes: string[]) {
    const scope = await this.scope.resolve(roleCodes);
    const where: Prisma.RoleDataAccessMapWhereInput = {
      isActive: true,
      ...this.domainClassWhere<Prisma.RoleDataAccessMapWhereInput>(scope),
    };
    return this.prisma.roleDataAccessMap.findMany({
      where,
      include: mappingInclude,
      orderBy: [{ role: { nameEn: 'asc' } }, { updatedAt: 'desc' }],
    });
  }

  async maskingPolicies(roleCodes: string[]) {
    const scope = await this.scope.resolve(roleCodes);
    return this.prisma.maskingPolicy.findMany({
      where: { deletedAt: null, ...this.domainClassWhere<Prisma.MaskingPolicyWhereInput>(scope) },
      include: policyInclude,
      orderBy: [{ isActive: 'desc' }, { nameEn: 'asc' }],
    });
  }

  async accessReviews(roleCodes: string[]) {
    const [scope, assetIds] = await Promise.all([this.scope.resolve(roleCodes), this.visibleAssetIds(roleCodes)]);
    const itemScope = this.reviewItemScope(scope, assetIds);
    return this.prisma.accessReview.findMany({
      where: Object.keys(itemScope).length ? { items: { some: itemScope } } : {},
      include: reviewInclude(itemScope),
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      take: 25,
    });
  }

  async dlpIncidents(roleCodes: string[]) {
    const [scope, assetIds] = await Promise.all([this.scope.resolve(roleCodes), this.visibleAssetIds(roleCodes)]);
    return this.prisma.dlpIncident.findMany({
      where: this.assetClassificationScope(scope, assetIds),
      include: dlpInclude,
      orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }],
      take: 50,
    });
  }

  async classificationRequests(roleCodes: string[]) {
    const assetIds = await this.visibleAssetIds(roleCodes);
    return this.prisma.classificationChangeRequest.findMany({
      where: this.requiredAssetScope(assetIds),
      include: classificationRequestInclude,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });
  }

  async decisionLog(roleCodes: string[]) {
    const [scope, assetIds] = await Promise.all([this.scope.resolve(roleCodes), this.visibleAssetIds(roleCodes)]);
    return this.prisma.abacDecisionLog.findMany({
      where: this.assetDomainClassificationScope(scope, assetIds),
      include: {
        actorUser: { select: { id: true, email: true, displayName: true } },
        role: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        asset: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        classification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
        maskingPolicy: { select: { id: true, code: true, nameEn: true, nameAr: true, technique: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createMaskingPolicy(roleCodes: string[], dto: CreateMaskingPolicyDto, actor: string) {
    await this.assertSecurityTarget(roleCodes, dto, { rejectUnboundedClassification: true });
    const code = dto.code?.trim() || (await this.nextCode('MSK', 'maskingPolicy'));
    const policy = await this.prisma.maskingPolicy.create({
      data: {
        code,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        technique: dto.technique as MaskingTechnique,
        description: dto.description ?? null,
        domainId: dto.domainId || null,
        classificationId: dto.classificationId || null,
        appliesToPersonalData: dto.appliesToPersonalData ?? true,
        fieldsJson: dto.fieldsJson ? (dto.fieldsJson as Prisma.InputJsonObject) : undefined,
        previewBefore: dto.previewBefore ?? null,
        previewAfter: dto.previewAfter ?? null,
        createdBy: actor,
      },
      include: policyInclude,
    });
    await this.audit.log({ actor, action: 'masking_policy.create', entityType: 'masking_policy', entityId: policy.id, metadata: { code } });
    return policy;
  }

  async upsertAccessMap(roleCodes: string[], dto: CreateRoleDataAccessMapDto, actor: string) {
    const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, deletedAt: null, isActive: true } });
    if (!role) throw new BadRequestException('Role not found');
    await this.assertSecurityTarget(roleCodes, dto, { rejectUnboundedClassification: true });
    await this.assertMaskingPolicyInScope(roleCodes, dto.maskingPolicyId);
    const integrityErrors = validateRoleDataAccessMapIntegrity(dto);
    if (integrityErrors.length) {
      throw new BadRequestException(`Invalid role-data access map: ${integrityErrors.join('; ')}`);
    }
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + (dto.reviewCadenceDays ?? 90));
    const scopeKey = accessScopeKey(dto.domainId || null, dto.classificationId || null);
    const data = {
      roleId: dto.roleId,
      domainId: dto.domainId || null,
      classificationId: dto.classificationId || null,
      maskingPolicyId: dto.maskingPolicyId || null,
      scopeKey,
      personalDataAllowed: dto.personalDataAllowed ?? false,
      approvalRequired: dto.approvalRequired ?? true,
      businessJustification: dto.businessJustification ?? null,
      reviewCadenceDays: dto.reviewCadenceDays ?? 90,
      nextReviewAt,
      createdBy: actor,
    };
    const existing = await this.prisma.roleDataAccessMap.findFirst({
      where: {
        roleId: dto.roleId,
        scopeKey,
        isActive: true,
      },
    });
    const row = existing
      ? await this.prisma.roleDataAccessMap.update({ where: { id: existing.id }, data, include: mappingInclude })
      : await this.createAccessMapWithRaceRecovery(dto.roleId, scopeKey, data);
    await this.audit.log({
      actor,
      action: 'role_data_access_map.upsert',
      entityType: 'role_data_access_map',
      entityId: row.id,
      metadata: {
        role: role.code,
        scopeKey,
        personalDataAllowed: data.personalDataAllowed,
        approvalRequired: data.approvalRequired,
        hasMaskingPolicy: !!data.maskingPolicyId,
      },
    });
    return row;
  }

  private async createAccessMapWithRaceRecovery(
    roleId: string,
    scopeKey: string,
    data: Prisma.RoleDataAccessMapUncheckedCreateInput,
  ) {
    try {
      return await this.prisma.roleDataAccessMap.create({ data, include: mappingInclude });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.roleDataAccessMap.findFirst({
          where: { roleId, scopeKey, isActive: true },
          select: { id: true },
        });
        if (existing) {
          return this.prisma.roleDataAccessMap.update({ where: { id: existing.id }, data, include: mappingInclude });
        }
      }
      throw error;
    }
  }

  async createAccessReview(roleCodes: string[], dto: CreateAccessReviewDto, actor: string) {
    if (!dto.items?.length) throw new BadRequestException('Access review must include at least one item');
    for (const item of dto.items) {
      await this.assertSecurityTarget(roleCodes, item, {
        requireTarget: true,
        rejectUnboundedClassification: true,
      });
    }
    const code = dto.code?.trim() || (await this.nextCode('ARV', 'accessReview'));
    const review = await this.prisma.accessReview.create({
      data: {
        code,
        title: dto.title,
        description: dto.description ?? null,
        status: AccessReviewStatus.active,
        ownerUserId: dto.ownerUserId || null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdBy: actor,
        items: {
          create: dto.items.map((item) => ({
            userId: item.userId,
            roleId: item.roleId,
            assetId: item.assetId || null,
            domainId: item.domainId || null,
            classificationId: item.classificationId || null,
          })),
        },
      },
      include: reviewInclude(),
    });
    await this.audit.log({ actor, action: 'access_review.create', entityType: 'access_review', entityId: review.id, metadata: { code, items: dto.items.length } });
    return review;
  }

  async updateReviewItem(id: string, roleCodes: string[], dto: UpdateAccessReviewItemDto, actor: string) {
    const existing = await this.prisma.accessReviewItem.findUnique({
      where: { id },
      include: { review: { select: { ownerUserId: true, status: true } } },
    });
    if (!existing) throw new NotFoundException('Access review item not found');
    await this.assertSecurityTarget(roleCodes, existing, {
      requireTarget: true,
      rejectUnboundedClassification: true,
    });
    if (existing.review.status === AccessReviewStatus.completed) {
      throw new BadRequestException('Completed access reviews cannot be changed');
    }
    const actorUser = existing.review.ownerUserId
      ? await this.prisma.user.findUnique({ where: { email: actor }, select: { id: true } })
      : null;
    const isAdmin = roleCodes.some((role) => ['system_admin', 'dmo_admin'].includes(role));
    if (existing.review.ownerUserId && actorUser?.id !== existing.review.ownerUserId && !isAdmin) {
      throw new ForbiddenException('Only the review owner or an administrator can decide this item');
    }
    const item = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.accessReviewItem.update({
        where: { id },
        data: {
          decision: dto.decision as AccessReviewDecision,
          justification: dto.justification ?? null,
          reviewer: actor,
          reviewedAt: new Date(),
        },
      });
      const pending = await tx.accessReviewItem.count({
        where: { reviewId: existing.reviewId, decision: AccessReviewDecision.pending },
      });
      if (pending === 0) {
        await tx.accessReview.update({
          where: { id: existing.reviewId },
          data: { status: AccessReviewStatus.completed, completedAt: new Date() },
        });
      }
      return updated;
    });
    await this.audit.log({ actor, action: 'access_review_item.decide', entityType: 'access_review_item', entityId: id, metadata: { decision: item.decision } });
    return item;
  }

  async createDlpIncident(roleCodes: string[], dto: CreateDlpIncidentDto, actor: string) {
    await this.assertSecurityTarget(roleCodes, dto);
    const code = dto.code?.trim() || (await this.nextCode('DLP', 'dlpIncident'));
    const incident = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dlpIncident.create({
        data: {
          code,
          title: dto.title,
          description: dto.description ?? null,
          severity: (dto.severity ?? 'medium') as SecuritySeverity,
          status: (dto.status ?? 'new') as DlpIncidentStatus,
          assetId: dto.assetId || null,
          classificationId: dto.classificationId || null,
          assignedPersonId: dto.assignedPersonId || null,
          detectionSource: dto.detectionSource ?? 'manual',
          createdBy: actor,
        },
      });
      const workflowCaseId = await this.createSecurityWorkflow(tx, roleCodes, actor, 'dlp', {
        title: `Review DLP incident: ${created.title}`,
        description: created.description,
        assetId: created.assetId,
        assigneePersonId: created.assignedPersonId,
      });
      return tx.dlpIncident.update({
        where: { id: created.id },
        data: { workflowCaseId },
        include: dlpInclude,
      });
    });
    await this.audit.log({ actor, action: 'dlp_incident.create', entityType: 'dlp_incident', entityId: incident.id, metadata: { code, severity: incident.severity } });
    return incident;
  }

  async createClassificationRequest(roleCodes: string[], dto: CreateClassificationChangeRequestDto, actor: string) {
    await this.assertSecurityTarget(roleCodes, { assetId: dto.assetId, classificationId: dto.toClassificationId });
    const asset = await this.prisma.dataAsset.findFirst({
      where: { id: dto.assetId, deletedAt: null },
      select: { id: true, code: true, nameEn: true, classificationId: true },
    });
    if (!asset) throw new BadRequestException('Data asset not found');
    const target = await this.prisma.classification.findFirst({ where: { id: dto.toClassificationId, deletedAt: null } });
    if (!target) throw new BadRequestException('Target classification not found');
    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.classificationChangeRequest.create({
        data: {
          assetId: asset.id,
          fromClassificationId: asset.classificationId,
          toClassificationId: target.id,
          reason: dto.reason,
          requestedBy: actor,
        },
      });
      const workflowCaseId = await this.createSecurityWorkflow(tx, roleCodes, actor, 'classification', {
        title: `Review classification change: ${asset.code}`,
        description: dto.reason,
        assetId: asset.id,
      });
      return tx.classificationChangeRequest.update({
        where: { id: created.id },
        data: { workflowCaseId },
        include: classificationRequestInclude,
      });
    });
    await this.audit.log({ actor, action: 'classification_change_request.create', entityType: 'classification_change_request', entityId: request.id });
    return request;
  }

  async simulateDecision(roleCodes: string[], dto: SimulateAccessDecisionDto, actorEmail: string) {
    await this.assertSecurityTarget(roleCodes, { assetId: dto.assetId });
    const [asset, role, actorUser] = await Promise.all([
      this.prisma.dataAsset.findFirst({
        where: { id: dto.assetId, deletedAt: null },
        include: {
          domain: true,
          classification: true,
        },
      }),
      this.prisma.role.findFirst({ where: { id: dto.roleId, deletedAt: null, isActive: true } }),
      this.prisma.user.findUnique({ where: { email: actorEmail } }),
    ]);
    if (!asset) throw new NotFoundException('Data asset not found');
    if (!role) throw new NotFoundException('Role not found');
    const mappings = await this.prisma.roleDataAccessMap.findMany({
      where: {
        roleId: role.id,
        isActive: true,
        OR: [{ domainId: asset.domainId }, { domainId: null }],
      },
      include: mappingInclude,
    });
    const mapping = mappings
      .sort((a, b) => {
        const aSpecific = (a.domainId ? 1 : 0) + (a.classificationId ? 1 : 0);
        const bSpecific = (b.domainId ? 1 : 0) + (b.classificationId ? 1 : 0);
        return bSpecific - aSpecific;
      })
      .find((row) => !row.classification || !asset.classification || row.classification.rank >= asset.classification.rank);
    const result = evaluateAbacDecision({
      hasMapping: !!mapping,
      requestedAction: dto.requestedAction ?? 'read',
      purpose: dto.purpose ?? 'governance',
      networkZone: dto.networkZone ?? 'internal',
      personalDataRequested: dto.personalDataRequested ?? false,
      legalBasisConfirmed: dto.legalBasisConfirmed ?? false,
      emergencyAccess: dto.emergencyAccess ?? false,
      approvalTicketId: dto.approvalTicketId ?? null,
      businessJustification: dto.businessJustification ?? null,
      personalDataAllowed: mapping?.personalDataAllowed ?? false,
      approvalRequired: mapping?.approvalRequired ?? true,
      hasMaskingPolicy: !!mapping?.maskingPolicy,
      assetClassificationRank: asset.classification?.rank ?? null,
      allowedClassificationRank: role.maxClassificationRank,
    });
    const log = await this.prisma.abacDecisionLog.create({
      data: {
        actorUserId: actorUser?.id ?? null,
        roleId: role.id,
        assetId: asset.id,
        domainId: asset.domainId,
        classificationId: asset.classificationId,
        maskingPolicyId: mapping?.maskingPolicyId ?? null,
        requestedAction: result.normalizedAction,
        decision: result.decision as AccessDecision,
        reason: result.reason,
      },
      include: {
        role: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        asset: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        classification: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true } },
        maskingPolicy: { select: { id: true, code: true, nameEn: true, nameAr: true, technique: true } },
      },
    });
    await this.audit.log({
      actor: actorEmail,
      action: 'abac_decision.simulate',
      entityType: 'abac_decision',
      entityId: log.id,
      metadata: {
        decision: result.decision,
        risk: result.risk,
        purpose: result.purpose,
        networkZone: result.networkZone,
        obligations: result.obligations,
        violations: result.violations,
        ruleTrace: result.ruleTrace,
        hasBusinessJustification: !!dto.businessJustification?.trim(),
        approvalTicketId: dto.approvalTicketId ?? null,
      },
    });
    return {
      ...log,
      abac: {
        risk: result.risk,
        purpose: result.purpose,
        networkZone: result.networkZone,
        obligations: result.obligations,
        violations: result.violations,
        ruleTrace: result.ruleTrace,
      },
    };
  }
}
