import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, AssignmentTargetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import {
  ApplyRecommendationDto,
  CreateAssignmentDto,
  CreateRuleDto,
  RULE_SCOPES,
  UpdateAssignmentDto,
  UpdateRuleDto,
} from './assignments.dto';

const DATA_OWNER_CODE = 'data_owner';

// Recommendation priority after a direct asset assignment (highest first).
const RULE_PRIORITY: AssignmentTargetType[] = [
  AssignmentTargetType.domain,
  AssignmentTargetType.capability,
  AssignmentTargetType.subject,
  AssignmentTargetType.org_unit,
  AssignmentTargetType.system,
];

interface NameRef {
  id: string;
  code?: string;
  nameEn: string;
  nameAr: string;
}

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  // ---------- data-scope helpers ----------
  /**
   * Resolves the set of asset and domain ids the requester may see. `'all'` means unrestricted
   * on that dimension. Used to keep ownership lists and the exception queue within data scope.
   */
  private async scopeContext(
    roleCodes: string[],
  ): Promise<{ assetIds: Set<string> | 'all'; domainIds: Set<string> | 'all' }> {
    const scope = await this.scope.resolve(roleCodes);
    const unrestricted =
      scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
    if (unrestricted) return { assetIds: 'all', domainIds: 'all' };
    const where: Record<string, unknown> = {};
    if (scope.orgUnits !== 'all') where['orgUnitId'] = { in: scope.orgUnits };
    if (scope.domains !== 'all') where['domainId'] = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where['OR'] = [
        { classificationId: null },
        { classification: { rank: { lte: scope.maxClassRank } } },
      ];
    }
    const assets = await this.prisma.dataAsset.findMany({
      where: { AND: [{ deletedAt: null }, where] },
      select: { id: true },
    });
    return {
      assetIds: new Set(assets.map((a) => a.id)),
      domainIds: scope.domains === 'all' ? 'all' : new Set(scope.domains),
    };
  }

  /** Whether an assignment/conflict target is visible under the resolved scope. */
  private targetInScope(
    ctx: { assetIds: Set<string> | 'all'; domainIds: Set<string> | 'all' },
    targetType: string,
    targetId: string,
  ): boolean {
    if (targetType === 'asset') return ctx.assetIds === 'all' || ctx.assetIds.has(targetId);
    if (targetType === 'domain') return ctx.domainIds === 'all' || ctx.domainIds.has(targetId);
    return true;
  }

  // ---------- shared lookups ----------
  private async dimensionMaps(): Promise<Record<string, Map<string, NameRef>>> {
    const [assets, domains, caps, subjects, orgs, systems] = await Promise.all([
      this.prisma.dataAsset.findMany({ where: { deletedAt: null }, select: { id: true, code: true, nameEn: true, nameAr: true } }),
      this.prisma.dataDomain.findMany({ where: { deletedAt: null }, select: { id: true, code: true, nameEn: true, nameAr: true } }),
      this.prisma.businessCapability.findMany({ where: { deletedAt: null }, select: { id: true, code: true, nameEn: true, nameAr: true } }),
      this.prisma.dataSubject.findMany({ where: { deletedAt: null }, select: { id: true, code: true, nameEn: true, nameAr: true } }),
      this.prisma.organizationUnit.findMany({ where: { deletedAt: null }, select: { id: true, code: true, nameEn: true, nameAr: true } }),
      this.prisma.systemPlatform.findMany({ where: { deletedAt: null }, select: { id: true, code: true, nameEn: true, nameAr: true } }),
    ]);
    const toMap = (rows: NameRef[]) => new Map(rows.map((r) => [r.id, r]));
    return {
      asset: toMap(assets),
      domain: toMap(domains),
      capability: toMap(caps),
      subject: toMap(subjects),
      org_unit: toMap(orgs),
      system: toMap(systems),
    };
  }

  private targetLabel(maps: Record<string, Map<string, NameRef>>, type: string, id: string): NameRef | null {
    return maps[type]?.get(id) ?? null;
  }

  // ---------- assignments CRUD ----------
  async listAssignments(
    roleCodes: string[],
    filters: {
      targetType?: string;
      targetId?: string;
      roleTypeId?: string;
      personId?: string;
      status?: string;
      approvalStatus?: string;
    },
  ) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.targetType) where['targetType'] = filters.targetType;
    if (filters.targetId) where['targetId'] = filters.targetId;
    if (filters.roleTypeId) where['roleTypeId'] = filters.roleTypeId;
    if (filters.personId) where['personId'] = filters.personId;
    if (filters.approvalStatus) where['approvalStatus'] = filters.approvalStatus;
    if (filters.status === 'active') where['isActive'] = true;
    if (filters.status === 'inactive') where['isActive'] = false;

    const [rows, maps, ctx] = await Promise.all([
      this.prisma.stewardshipAssignment.findMany({
        where,
        include: { roleType: true, person: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.dimensionMaps(),
      this.scopeContext(roleCodes),
    ]);
    const now = new Date();
    return rows
      .filter((r) => this.targetInScope(ctx, r.targetType, r.targetId))
      .map((r) => ({
        ...r,
        target: this.targetLabel(maps, r.targetType, r.targetId),
        isCurrentlyActive: this.windowActive(r, now),
      }));
  }

  private windowActive(
    a: { isActive: boolean; effectiveDate: Date; expiryDate: Date | null },
    now: Date,
  ): boolean {
    if (!a.isActive) return false;
    if (a.effectiveDate > now) return false;
    if (a.expiryDate && a.expiryDate < now) return false;
    return true;
  }

  async getAssignment(id: string) {
    const a = await this.prisma.stewardshipAssignment.findFirst({
      where: { id, deletedAt: null },
      include: { roleType: true, person: true },
    });
    if (!a) throw new NotFoundException('assignment not found');
    return a;
  }

  /** Rejects an expiry date that is not strictly after the effective date. */
  private validateWindow(effective: Date, expiry: Date | null): void {
    if (expiry && expiry <= effective) {
      throw new BadRequestException('Expiry date must be after the effective date');
    }
  }

  async createAssignment(
    dto: CreateAssignmentDto,
    actor: string,
    source?: string,
    approvalStatus: ApprovalStatus = ApprovalStatus.approved,
  ) {
    await this.assertRefsExist(dto.targetType, dto.targetId, dto.roleTypeId, dto.personId);
    const resolvedSource = source ?? (dto.justification ? 'override' : 'manual');
    const isPrimary = dto.isPrimary ?? true;
    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();
    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
    this.validateWindow(effectiveDate, expiryDate);

    // Integrity: a target+role should have a single authoritative primary owner/steward.
    if (isPrimary && approvalStatus === ApprovalStatus.approved) {
      const existingPrimary = await this.prisma.stewardshipAssignment.findMany({
        where: {
          targetType: dto.targetType,
          targetId: dto.targetId,
          roleTypeId: dto.roleTypeId,
          isPrimary: true,
          isActive: true,
          approvalStatus: ApprovalStatus.approved,
          deletedAt: null,
        },
      });
      if (existingPrimary.length > 0) {
        if (!dto.demoteExisting) {
          throw new BadRequestException(
            'A primary assignment already exists for this target and role. Demote it or mark this one as backup.',
          );
        }
        await this.prisma.stewardshipAssignment.updateMany({
          where: { id: { in: existingPrimary.map((a) => a.id) } },
          data: { isPrimary: false },
        });
      }
    }

    const created = await this.prisma.stewardshipAssignment.create({
      data: {
        targetType: dto.targetType,
        targetId: dto.targetId,
        roleTypeId: dto.roleTypeId,
        personId: dto.personId,
        isPrimary,
        effectiveDate,
        expiryDate,
        justification: dto.justification ?? null,
        source: resolvedSource,
        approvalStatus,
      },
      include: { roleType: true, person: true },
    });
    await this.afterChange(created.targetType, created.targetId);
    await this.audit.log({
      actor,
      action: 'assignment.create',
      entityType: 'stewardship_assignment',
      entityId: created.id,
      metadata: { targetType: created.targetType, targetId: created.targetId, source: created.source },
    });
    return created;
  }

  async updateAssignment(id: string, dto: UpdateAssignmentDto, actor: string) {
    const existing = await this.getAssignment(id);
    const data: Record<string, unknown> = {};
    if (dto.personId !== undefined) data['personId'] = dto.personId;
    if (dto.isPrimary !== undefined) data['isPrimary'] = dto.isPrimary;
    if (dto.effectiveDate !== undefined) data['effectiveDate'] = new Date(dto.effectiveDate);
    if (dto.expiryDate !== undefined) data['expiryDate'] = dto.expiryDate ? new Date(dto.expiryDate) : null;
    if (dto.justification !== undefined) data['justification'] = dto.justification;
    if (dto.isActive !== undefined) data['isActive'] = dto.isActive;

    const effective = (data['effectiveDate'] as Date) ?? existing.effectiveDate;
    const expiry =
      dto.expiryDate !== undefined ? (data['expiryDate'] as Date | null) : existing.expiryDate;
    this.validateWindow(effective, expiry);

    const updated = await this.prisma.stewardshipAssignment.update({
      where: { id },
      data,
      include: { roleType: true, person: true },
    });
    await this.afterChange(existing.targetType, existing.targetId);
    await this.audit.log({
      actor,
      action: 'assignment.update',
      entityType: 'stewardship_assignment',
      entityId: id,
    });
    return updated;
  }

  /**
   * Sets an assignment's approval state and re-syncs the asset owner. Only `approved`
   * assignments are authoritative; `pending`/`rejected` leave the owner/exception untouched.
   * Used by the workflow engine when an approval task is decided.
   */
  async setApprovalStatus(id: string, status: ApprovalStatus, actor: string) {
    const existing = await this.getAssignment(id);
    const updated = await this.prisma.stewardshipAssignment.update({
      where: { id },
      data: {
        approvalStatus: status,
        reviewedBy: actor,
        reviewedAt: new Date(),
        // A rejected proposal is deactivated so it never becomes authoritative.
        isActive: status === ApprovalStatus.rejected ? false : existing.isActive,
      },
      include: { roleType: true, person: true },
    });
    await this.afterChange(existing.targetType, existing.targetId);
    await this.audit.log({
      actor,
      action: `assignment.${status}`,
      entityType: 'stewardship_assignment',
      entityId: id,
    });
    return updated;
  }

  async removeAssignment(id: string, actor: string) {
    const existing = await this.getAssignment(id);
    await this.prisma.stewardshipAssignment.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.afterChange(existing.targetType, existing.targetId);
    await this.audit.log({
      actor,
      action: 'assignment.delete',
      entityType: 'stewardship_assignment',
      entityId: id,
    });
    return { success: true };
  }

  /** Keep a data asset's lightweight owner fields in sync with its data_owner assignment. */
  private async afterChange(targetType: AssignmentTargetType, targetId: string): Promise<void> {
    if (targetType !== AssignmentTargetType.asset) return;
    const asset = await this.prisma.dataAsset.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!asset) return;
    const now = new Date();
    const owner = await this.prisma.stewardshipAssignment.findFirst({
      where: {
        targetType: AssignmentTargetType.asset,
        targetId,
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        deletedAt: null,
        effectiveDate: { lte: now },
        OR: [{ expiryDate: null }, { expiryDate: { gte: now } }],
        roleType: { code: DATA_OWNER_CODE },
      },
      include: { person: true },
      orderBy: { effectiveDate: 'desc' },
    });
    await this.prisma.dataAsset.update({
      where: { id: targetId },
      data: owner
        ? { ownerStatus: 'assigned', ownerName: owner.person.fullNameEn }
        : { ownerStatus: 'unassigned', ownerName: null },
    });
  }

  private async assertRefsExist(
    targetType: AssignmentTargetType,
    targetId: string,
    roleTypeId: string,
    personId: string,
  ): Promise<void> {
    const model: Record<AssignmentTargetType, string> = {
      asset: 'dataAsset',
      domain: 'dataDomain',
      capability: 'businessCapability',
      subject: 'dataSubject',
      org_unit: 'organizationUnit',
      system: 'systemPlatform',
    };
    const delegate = (this.prisma as unknown as Record<string, any>)[model[targetType]];
    const target = await delegate.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!target) throw new BadRequestException(`Target ${targetType} not found`);
    const role = await this.prisma.roleType.findFirst({ where: { id: roleTypeId, deletedAt: null } });
    if (!role) throw new BadRequestException('Role type not found');
    const person = await this.prisma.person.findFirst({ where: { id: personId, deletedAt: null } });
    if (!person) throw new BadRequestException('Person not found');
  }

  // ---------- rules CRUD ----------
  async listRules(filters: { scopeType?: string; roleTypeId?: string }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.scopeType) where['scopeType'] = filters.scopeType;
    if (filters.roleTypeId) where['roleTypeId'] = filters.roleTypeId;
    const [rows, maps] = await Promise.all([
      this.prisma.assignmentRule.findMany({
        where,
        include: { roleType: true, person: true },
        orderBy: [{ scopeType: 'asc' }, { priority: 'asc' }],
      }),
      this.dimensionMaps(),
    ]);
    return rows.map((r) => ({ ...r, ref: this.targetLabel(maps, r.scopeType, r.refId) }));
  }

  /** Blocks an ambiguous duplicate rule (same scope + ref + role + priority). */
  private async assertRuleUnique(
    scopeType: AssignmentTargetType,
    refId: string,
    roleTypeId: string,
    priority: number,
    exceptId?: string,
  ): Promise<void> {
    const dup = await this.prisma.assignmentRule.findFirst({
      where: {
        scopeType,
        refId,
        roleTypeId,
        priority,
        isActive: true,
        deletedAt: null,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
    });
    if (dup) {
      throw new BadRequestException(
        'A rule with the same scope, reference, role and priority already exists',
      );
    }
  }

  async createRule(dto: CreateRuleDto, actor: string) {
    if (!RULE_SCOPES.includes(dto.scopeType)) {
      throw new BadRequestException('Rules cannot target an individual asset');
    }
    await this.assertRefsExist(dto.scopeType, dto.refId, dto.roleTypeId, dto.personId);
    await this.assertRuleUnique(dto.scopeType, dto.refId, dto.roleTypeId, dto.priority ?? 100);
    const created = await this.prisma.assignmentRule.create({
      data: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description ?? null,
        scopeType: dto.scopeType,
        refId: dto.refId,
        roleTypeId: dto.roleTypeId,
        personId: dto.personId,
        isPrimary: dto.isPrimary ?? true,
        priority: dto.priority ?? 100,
      },
      include: { roleType: true, person: true },
    });
    await this.audit.log({
      actor,
      action: 'assignment_rule.create',
      entityType: 'assignment_rule',
      entityId: created.id,
    });
    return created;
  }

  async updateRule(id: string, dto: UpdateRuleDto, actor: string) {
    const existing = await this.prisma.assignmentRule.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('rule not found');
    const scopeType = dto.scopeType ?? existing.scopeType;
    const refId = dto.refId ?? existing.refId;
    const roleTypeId = dto.roleTypeId ?? existing.roleTypeId;
    const personId = dto.personId ?? existing.personId;
    if (dto.scopeType && !RULE_SCOPES.includes(dto.scopeType)) {
      throw new BadRequestException('Rules cannot target an individual asset');
    }
    if (dto.scopeType || dto.refId || dto.roleTypeId || dto.personId) {
      await this.assertRefsExist(scopeType, refId, roleTypeId, personId);
    }
    const priority = dto.priority ?? existing.priority;
    await this.assertRuleUnique(scopeType, refId, roleTypeId, priority, id);
    const updated = await this.prisma.assignmentRule.update({
      where: { id },
      data: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description,
        scopeType: dto.scopeType,
        refId: dto.refId,
        roleTypeId: dto.roleTypeId,
        personId: dto.personId,
        isPrimary: dto.isPrimary,
        priority: dto.priority,
        isActive: dto.isActive,
      },
      include: { roleType: true, person: true },
    });
    await this.audit.log({ actor, action: 'assignment_rule.update', entityType: 'assignment_rule', entityId: id });
    return updated;
  }

  async removeRule(id: string, actor: string) {
    const existing = await this.prisma.assignmentRule.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('rule not found');
    await this.prisma.assignmentRule.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log({ actor, action: 'assignment_rule.delete', entityType: 'assignment_rule', entityId: id });
    return { success: true };
  }

  // ---------- recommendation engine ----------
  async recommend(roleCodes: string[], assetId: string) {
    const ctx = await this.scopeContext(roleCodes);
    if (!this.targetInScope(ctx, 'asset', assetId)) {
      throw new NotFoundException('data_asset not found');
    }
    const asset = await this.prisma.dataAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: { subjects: true },
    });
    if (!asset) throw new NotFoundException('data_asset not found');

    const now = new Date();
    const [roleTypes, assignments, rules] = await Promise.all([
      this.prisma.roleType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { nameEn: 'asc' } }),
      this.prisma.stewardshipAssignment.findMany({
        where: { targetType: AssignmentTargetType.asset, targetId: assetId, deletedAt: null, isActive: true },
        include: { person: true },
      }),
      this.prisma.assignmentRule.findMany({ where: { deletedAt: null, isActive: true }, include: { person: true } }),
    ]);

    // Asset dimension values keyed by rule scope type.
    const dimValues: Record<string, string[]> = {
      domain: asset.domainId ? [asset.domainId] : [],
      capability: asset.capabilityId ? [asset.capabilityId] : [],
      subject: asset.subjects.map((s) => s.dataSubjectId),
      org_unit: asset.orgUnitId ? [asset.orgUnitId] : [],
      system: asset.systemId ? [asset.systemId] : [],
    };

    return roleTypes.map((rt) => {
      const current = assignments.find(
        (a) =>
          a.roleTypeId === rt.id &&
          a.isPrimary &&
          a.approvalStatus === ApprovalStatus.approved &&
          this.windowActive(a, now),
      );
      let recommended: { scopeType: string; rule: (typeof rules)[number] } | null = null;
      for (const scope of RULE_PRIORITY) {
        const ids = dimValues[scope] ?? [];
        if (ids.length === 0) continue;
        const match = rules
          .filter((r) => r.roleTypeId === rt.id && r.scopeType === scope && ids.includes(r.refId))
          .sort((a, b) => a.priority - b.priority)[0];
        if (match) {
          recommended = { scopeType: scope, rule: match };
          break;
        }
      }
      const status = current ? 'assigned' : recommended ? 'recommended' : 'exception';
      return {
        roleType: rt,
        current: current ? { id: current.id, person: current.person, source: current.source } : null,
        recommended: recommended
          ? { scopeType: recommended.scopeType, ruleId: recommended.rule.id, person: recommended.rule.person }
          : null,
        status,
      };
    });
  }

  async applyRecommendation(roleCodes: string[], dto: ApplyRecommendationDto, actor: string) {
    const recs = await this.recommend(roleCodes, dto.assetId);
    const rec = recs.find((r) => r.roleType.id === dto.roleTypeId);
    if (!rec || !rec.recommended) {
      throw new BadRequestException('No recommendation available for this role type');
    }
    return this.createAssignment(
      {
        targetType: AssignmentTargetType.asset,
        targetId: dto.assetId,
        roleTypeId: dto.roleTypeId,
        personId: rec.recommended.person.id,
        isPrimary: true,
        justification: dto.justification ?? undefined,
      },
      actor,
      dto.justification ? 'override' : 'rule',
    );
  }

  // ---------- conflicts ----------
  async conflicts(roleCodes: string[]) {
    const [rows, maps, ctx] = await Promise.all([
      this.prisma.stewardshipAssignment.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          isPrimary: true,
          approvalStatus: ApprovalStatus.approved,
        },
        include: { roleType: true, person: true },
      }),
      this.dimensionMaps(),
      this.scopeContext(roleCodes),
    ]);
    // Group by target + role type; a conflict is >1 primary with overlapping windows.
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!this.targetInScope(ctx, r.targetType, r.targetId)) continue;
      const key = `${r.targetType}:${r.targetId}:${r.roleTypeId}`;
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }
    const conflicts: unknown[] = [];
    for (const [key, arr] of groups) {
      if (arr.length < 2) continue;
      const overlapping = arr.filter((a) =>
        arr.some((b) => a.id !== b.id && this.windowsOverlap(a, b)),
      );
      if (overlapping.length < 2) continue;
      const [targetType, targetId] = key.split(':');
      conflicts.push({
        targetType,
        targetId,
        target: this.targetLabel(maps, targetType, targetId),
        roleType: arr[0].roleType,
        assignments: overlapping.map((a) => ({
          id: a.id,
          person: a.person,
          effectiveDate: a.effectiveDate,
          expiryDate: a.expiryDate,
          source: a.source,
        })),
      });
    }
    return conflicts;
  }

  private windowsOverlap(
    a: { effectiveDate: Date; expiryDate: Date | null },
    b: { effectiveDate: Date; expiryDate: Date | null },
  ): boolean {
    const aEnd = a.expiryDate ?? new Date('9999-12-31');
    const bEnd = b.expiryDate ?? new Date('9999-12-31');
    return a.effectiveDate <= bEnd && b.effectiveDate <= aEnd;
  }

  // ---------- exception queue ----------
  async exceptions(roleCodes: string[]) {
    const now = new Date();
    const ctx = await this.scopeContext(roleCodes);
    const [assets, ownerAssignments, rules] = await Promise.all([
      this.prisma.dataAsset.findMany({
        where: {
          deletedAt: null,
          ...(ctx.assetIds === 'all' ? {} : { id: { in: [...ctx.assetIds] } }),
        },
        include: { subjects: true, domain: true, classification: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.stewardshipAssignment.findMany({
        where: {
          targetType: AssignmentTargetType.asset,
          deletedAt: null,
          isActive: true,
          isPrimary: true,
          approvalStatus: ApprovalStatus.approved,
          roleType: { code: DATA_OWNER_CODE },
        },
      }),
      this.prisma.assignmentRule.findMany({
        where: { deletedAt: null, isActive: true, roleType: { code: DATA_OWNER_CODE } },
      }),
    ]);

    const ownedAssetIds = new Set(
      ownerAssignments.filter((a) => this.windowActive(a, now)).map((a) => a.targetId),
    );

    const exceptions = assets
      .filter((asset) => {
        if (ownedAssetIds.has(asset.id)) return false;
        // Does any data_owner rule resolve for this asset?
        const dimValues: Record<string, string[]> = {
          domain: asset.domainId ? [asset.domainId] : [],
          capability: asset.capabilityId ? [asset.capabilityId] : [],
          subject: asset.subjects.map((s) => s.dataSubjectId),
          org_unit: asset.orgUnitId ? [asset.orgUnitId] : [],
          system: asset.systemId ? [asset.systemId] : [],
        };
        const hasRule = RULE_PRIORITY.some((scope) =>
          rules.some((r) => r.scopeType === scope && (dimValues[scope] ?? []).includes(r.refId)),
        );
        return !hasRule;
      })
      .map((asset) => ({
        id: asset.id,
        code: asset.code,
        nameEn: asset.nameEn,
        nameAr: asset.nameAr,
        domain: asset.domain ? { nameEn: asset.domain.nameEn, nameAr: asset.domain.nameAr } : null,
        classification: asset.classification
          ? { nameEn: asset.classification.nameEn, nameAr: asset.classification.nameAr, color: asset.classification.color }
          : null,
        reason: 'no_owner',
      }));

    return exceptions;
  }
}
