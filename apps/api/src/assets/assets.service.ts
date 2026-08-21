import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService, EffectiveScope } from '../access/scope.service';
import {
  CreateAssetDto,
  CreateAssetRelationshipDto,
  OWNER_STATUSES,
  UpdateAssetDto,
} from './assets.dto';
import {
  DATA_ASSET_TYPES,
  LIFECYCLE_STATUSES,
  LIFECYCLE_PHASES,
  V6_LIFECYCLE_STATES,
  assetTypePanel,
  isKnownAssetTypeInput,
  normalizeAssetCode,
  normalizeAssetSubtype,
  normalizeAssetType,
  normalizeAssetTypeInput,
  normalizeOptionalText,
  uniqueIds,
  validateAssetCrossFields,
  validateAssetText,
  validateAssetTypeFields,
} from './assets.logic';
import { parseCsv } from '../common/csv';
import { boundedFirstPageParams, parsePageParams, toPaged } from '../common/pagination';
import { parseQueryEnum } from '../common/query-filters';

export interface AssetFilters {
  search?: string;
  domainId?: string;
  subjectId?: string;
  classificationId?: string;
  systemId?: string;
  capabilityId?: string;
  orgUnitId?: string;
  ownerStatus?: string;
  lifecycleStatus?: string;
  assetType?: string;
  assetSubtype?: string;
  v6LifecycleState?: string;
}

const refSelect = { select: { id: true, code: true, nameEn: true, nameAr: true } };
const classSelect = {
  select: { id: true, code: true, nameEn: true, nameAr: true, rank: true, color: true },
};

const listInclude = {
  domain: refSelect,
  orgUnit: refSelect,
  system: refSelect,
  capability: refSelect,
  classification: classSelect,
  subjects: { include: { dataSubject: refSelect } },
};

const detailInclude = {
  ...listInclude,
  outgoingRelations: { include: { targetAsset: refSelect } },
  incomingRelations: { include: { sourceAsset: refSelect } },
  openDataCandidates: {
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      titleEn: true,
      titleAr: true,
      status: true,
      eligibilityScore: true,
      classificationSignal: true,
      dataQualitySignal: true,
      personalDataSignal: true,
      ownershipSignal: true,
      publicationValueSignal: true,
      nextReviewAt: true,
      publishedAt: true,
    },
    orderBy: { updatedAt: 'desc' as const },
    take: 5,
  },
};

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /** Builds the Prisma where-fragment enforcing a user's effective data scope. */
  private scopeWhere(scope: EffectiveScope): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (scope.orgUnits !== 'all') where['orgUnitId'] = { in: scope.orgUnits };
    if (scope.domains !== 'all') where['domainId'] = { in: scope.domains };
    if (scope.maxClassRank != null) {
      // Show unclassified assets and those at or below the user's clearance rank.
      where['OR'] = [
        { classificationId: null },
        { classification: { rank: { lte: scope.maxClassRank } } },
      ];
    }
    return where;
  }

  private filterWhere(filters: AssetFilters): Record<string, unknown>[] {
    const and: Record<string, unknown>[] = [];
    if (filters.domainId) and.push({ domainId: filters.domainId });
    if (filters.classificationId) and.push({ classificationId: filters.classificationId });
    if (filters.systemId) and.push({ systemId: filters.systemId });
    if (filters.capabilityId) and.push({ capabilityId: filters.capabilityId });
    if (filters.orgUnitId) and.push({ orgUnitId: filters.orgUnitId });
    const ownerStatus = parseQueryEnum(filters.ownerStatus, OWNER_STATUSES, 'asset owner status', (value) =>
      value.toLowerCase(),
    );
    const lifecycleStatus = parseQueryEnum(filters.lifecycleStatus, LIFECYCLE_STATUSES, 'asset lifecycle status', (value) =>
      value.toLowerCase(),
    );
    const assetType = parseQueryEnum(filters.assetType, DATA_ASSET_TYPES, 'asset type', (value) =>
      isKnownAssetTypeInput(value) ? normalizeAssetType(value) : normalizeAssetTypeInput(value),
    );
    const v6LifecycleState = parseQueryEnum(filters.v6LifecycleState, V6_LIFECYCLE_STATES, 'v6 lifecycle state', (value) =>
      value.toLowerCase(),
    );
    if (ownerStatus) and.push({ ownerStatus });
    if (lifecycleStatus) and.push({ lifecycleStatus });
    if (assetType) and.push({ assetType });
    if (filters.assetSubtype) {
      and.push({ assetSubtype: normalizeAssetSubtype(assetType ?? filters.assetType ?? 'dataset', filters.assetSubtype) });
    }
    if (v6LifecycleState) and.push({ v6LifecycleState });
    if (filters.subjectId) and.push({ subjects: { some: { dataSubjectId: filters.subjectId } } });
    if (filters.search) {
      const term = filters.search.trim();
      and.push({
        OR: [
          { code: { contains: term, mode: 'insensitive' } },
          { nameEn: { contains: term, mode: 'insensitive' } },
          { nameAr: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    return and;
  }

  private withAssetTypePanel<T extends { assetType?: string | null }>(asset: T): T & { assetTypePanel: ReturnType<typeof assetTypePanel> } {
    return {
      ...asset,
      assetTypePanel: assetTypePanel(asset.assetType),
    };
  }

  private async assertWritableScope(
    roleCodes: string[],
    target: {
      domainId?: string | null;
      orgUnitId?: string | null;
      classificationId?: string | null;
    },
  ): Promise<void> {
    const scope = await this.scope.resolve(roleCodes);
    const unrestricted =
      scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
    if (unrestricted) return;

    if (scope.domains !== 'all') {
      if (!target.domainId || !scope.domains.includes(target.domainId)) {
        throw new BadRequestException('Data asset domain is outside your data scope');
      }
    }
    if (scope.orgUnits !== 'all') {
      if (!target.orgUnitId || !scope.orgUnits.includes(target.orgUnitId)) {
        throw new BadRequestException('Data asset organization unit is outside your data scope');
      }
    }
    if (scope.maxClassRank != null && target.classificationId) {
      const classification = await this.prisma.classification.findFirst({
        where: { id: target.classificationId, deletedAt: null },
        select: { rank: true },
      });
      if (!classification || classification.rank > scope.maxClassRank) {
        throw new BadRequestException('Data asset classification is outside your clearance');
      }
    }
  }

  async list(
    roleCodes: string[],
    filters: AssetFilters,
    page?: string | number,
    pageSize?: string | number,
  ) {
    const scope = await this.scope.resolve(roleCodes);
    const where = {
      AND: [{ deletedAt: null }, this.scopeWhere(scope), ...this.filterWhere(filters)],
    };
    const query = {
      where,
      include: listInclude,
      orderBy: { code: 'asc' as const },
    };
    const params = parsePageParams(page, pageSize);
    if (!params) {
      const bounded = boundedFirstPageParams(pageSize);
      const rows = await this.prisma.dataAsset.findMany({ ...query, skip: bounded.skip, take: bounded.take });
      return rows.map((row) => this.withAssetTypePanel(row));
    }
    const [rows, total] = await Promise.all([
      this.prisma.dataAsset.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.dataAsset.count({ where }),
    ]);
    return toPaged(rows.map((row) => this.withAssetTypePanel(row)), total, params);
  }

  async get(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.prisma.dataAsset.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scopeWhere(scope)] },
      include: detailInclude,
    });
    if (!asset) throw new NotFoundException('data_asset not found');
    return this.withAssetTypePanel(asset);
  }

  private ownerStatusFor(ownerName?: string | null): string {
    return ownerName && ownerName.trim() ? 'assigned' : 'unassigned';
  }

  private toPrismaJson(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) return undefined;
    return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
  }

  private assertAssetText(
    dto: CreateAssetDto | UpdateAssetDto | (UpdateAssetDto & { code?: unknown }),
    options: { requireCode: boolean; requireNames: boolean; allowCode: boolean },
  ): void {
    const errors = validateAssetText(dto, options);
    if (errors.length) throw new BadRequestException(errors.join('; '));
  }

  private normalizeCreateDto(dto: CreateAssetDto): CreateAssetDto {
    this.assertAssetText(dto, { requireCode: true, requireNames: true, allowCode: true });
    return {
      ...dto,
      code: normalizeAssetCode(dto.code),
      nameEn: dto.nameEn.trim(),
      nameAr: dto.nameAr.trim(),
      description: normalizeOptionalText(dto.description) ?? undefined,
      ownerName: normalizeOptionalText(dto.ownerName) ?? null,
      assetType: normalizeAssetType(dto.assetType),
      assetSubtype: normalizeAssetSubtype(normalizeAssetType(dto.assetType), dto.assetSubtype),
      v6LifecycleState: dto.v6LifecycleState ?? 'registered',
      lifecyclePhase: dto.lifecyclePhase ?? 'discover',
      lifecycleStatus: dto.lifecycleStatus ?? 'draft',
      subjectIds: uniqueIds(dto.subjectIds),
    };
  }

  private normalizeUpdateDto(dto: UpdateAssetDto & { code?: unknown }): UpdateAssetDto {
    this.assertAssetText(dto, { requireCode: false, requireNames: false, allowCode: false });
    return {
      ...dto,
      nameEn: typeof dto.nameEn === 'string' ? dto.nameEn.trim() : dto.nameEn,
      nameAr: typeof dto.nameAr === 'string' ? dto.nameAr.trim() : dto.nameAr,
      description: normalizeOptionalText(dto.description),
      ownerName: normalizeOptionalText(dto.ownerName),
      assetType: dto.assetType === undefined ? undefined : normalizeAssetType(dto.assetType),
      assetSubtype: dto.assetSubtype === undefined ? undefined : normalizeAssetSubtype(dto.assetType ?? 'dataset', dto.assetSubtype),
      v6LifecycleState: dto.v6LifecycleState,
      lifecyclePhase: dto.lifecyclePhase,
      subjectIds: dto.subjectIds === undefined ? undefined : uniqueIds(dto.subjectIds),
    };
  }

  private async assertAssetIntegrity(target: {
    domainId?: string | null;
    orgUnitId?: string | null;
    systemId?: string | null;
    capabilityId?: string | null;
    classificationId?: string | null;
    subjectIds?: string[];
    assetType?: string | null;
    assetSubtype?: string | null;
    lifecyclePhase?: string | null;
    v6LifecycleState?: string | null;
    previousV6LifecycleState?: string | null;
    typeMetadataJson?: unknown | null;
  }): Promise<void> {
    const [domain, orgUnit, system, capability, classification, subjects] = await Promise.all([
      target.domainId
        ? this.prisma.dataDomain.findFirst({
            where: { id: target.domainId, deletedAt: null, isActive: true },
            select: { id: true },
          })
        : Promise.resolve(null),
      target.orgUnitId
        ? this.prisma.organizationUnit.findFirst({
            where: { id: target.orgUnitId, deletedAt: null, isActive: true },
            select: { id: true },
          })
        : Promise.resolve(null),
      target.systemId
        ? this.prisma.systemPlatform.findFirst({
            where: { id: target.systemId, deletedAt: null, isActive: true },
            select: { id: true, code: true, ownerOrgUnitId: true },
          })
        : Promise.resolve(null),
      target.capabilityId
        ? this.prisma.businessCapability.findFirst({
            where: { id: target.capabilityId, deletedAt: null, isActive: true },
            select: { id: true },
          })
        : Promise.resolve(null),
      target.classificationId
        ? this.prisma.classification.findFirst({
            where: { id: target.classificationId, deletedAt: null, isActive: true },
            select: { id: true, code: true, rank: true },
          })
        : Promise.resolve(null),
      target.subjectIds?.length
        ? this.prisma.dataSubject.findMany({
            where: { id: { in: target.subjectIds }, deletedAt: null, isActive: true },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    if (target.domainId && !domain) throw new BadRequestException('Data asset domain is not active or does not exist');
    if (target.orgUnitId && !orgUnit) {
      throw new BadRequestException('Data asset organization unit is not active or does not exist');
    }
    if (target.systemId && !system) throw new BadRequestException('Data asset system is not active or does not exist');
    if (target.capabilityId && !capability) {
      throw new BadRequestException('Data asset capability is not active or does not exist');
    }
    if (target.classificationId && !classification) {
      throw new BadRequestException('Data asset classification is not active or does not exist');
    }
    if (target.subjectIds?.length && subjects.length !== target.subjectIds.length) {
      throw new BadRequestException('One or more data subjects are not active or do not exist');
    }

    const errors = validateAssetCrossFields({
      subjectIds: target.subjectIds ?? [],
      classification,
      orgUnitId: target.orgUnitId,
      system,
    });
    errors.push(...validateAssetTypeFields(target));
    if (errors.length) throw new BadRequestException(errors.join('; '));
  }

  async create(roleCodes: string[], dto: CreateAssetDto, actor: string) {
    const normalized = this.normalizeCreateDto(dto);
    await this.assertWritableScope(roleCodes, normalized);
    await this.assertAssetIntegrity(normalized);
    const { subjectIds, ...rest } = normalized;
    const createData: Prisma.DataAssetUncheckedCreateInput = {
      ...rest,
      typeMetadataJson: this.toPrismaJson(rest.typeMetadataJson),
      ownerName: normalized.ownerName ?? null,
      ownerStatus: this.ownerStatusFor(normalized.ownerName),
      lifecycleStatus: normalized.lifecycleStatus ?? 'draft',
    };
    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dataAsset.create({ data: createData, select: { id: true } });
      if (subjectIds?.length) {
        await tx.assetSubject.createMany({
          data: subjectIds.map((dataSubjectId) => ({ assetId: created.id, dataSubjectId })),
          skipDuplicates: true,
        });
      }
      const loaded = await tx.dataAsset.findUnique({ where: { id: created.id }, include: detailInclude });
      if (!loaded) throw new BadRequestException('Could not create data asset');
      return loaded;
    });
    await this.audit.log({
      actor,
      action: 'data_asset.create',
      entityType: 'data_asset',
      entityId: asset.id,
      metadata: { code: asset.code },
    });
    return this.withAssetTypePanel(asset);
  }

  async update(id: string, roleCodes: string[], dto: UpdateAssetDto & { code?: unknown }, actor: string) {
    const existing = await this.get(roleCodes, id);
    const normalized = this.normalizeUpdateDto(dto);
    const subjectIds =
      normalized.subjectIds !== undefined
        ? normalized.subjectIds
        : existing.subjects.map((subject) => subject.dataSubject.id);
    const nextAssetSubtype =
      normalized.assetSubtype !== undefined
        ? normalized.assetSubtype
        : normalized.assetType !== undefined && normalized.assetType !== existing.assetType
          ? null
          : existing.assetSubtype;
    const nextIntegrityTarget = {
      domainId: normalized.domainId !== undefined ? normalized.domainId : existing.domainId,
      orgUnitId: normalized.orgUnitId !== undefined ? normalized.orgUnitId : existing.orgUnitId,
      systemId: normalized.systemId !== undefined ? normalized.systemId : existing.systemId,
      capabilityId: normalized.capabilityId !== undefined ? normalized.capabilityId : existing.capabilityId,
      classificationId:
        normalized.classificationId !== undefined ? normalized.classificationId : existing.classificationId,
      subjectIds,
      assetType: normalized.assetType !== undefined ? normalized.assetType : existing.assetType,
      assetSubtype: nextAssetSubtype,
      lifecyclePhase: normalized.lifecyclePhase !== undefined ? normalized.lifecyclePhase : existing.lifecyclePhase,
      v6LifecycleState: normalized.v6LifecycleState !== undefined ? normalized.v6LifecycleState : existing.v6LifecycleState,
      previousV6LifecycleState: existing.v6LifecycleState,
      typeMetadataJson: normalized.typeMetadataJson !== undefined ? normalized.typeMetadataJson : existing.typeMetadataJson,
    };
    await this.assertWritableScope(roleCodes, {
      domainId: nextIntegrityTarget.domainId,
      orgUnitId: nextIntegrityTarget.orgUnitId,
      classificationId: nextIntegrityTarget.classificationId,
    });
    await this.assertAssetIntegrity(nextIntegrityTarget);
    const persisted = await this.prisma.dataAsset.findFirst({ where: { id, deletedAt: null } });
    if (!persisted) throw new NotFoundException('data_asset not found');
    const { subjectIds: nextSubjectIds, ...rest } = normalized;

    const data: Record<string, unknown> = { ...rest };
    if (normalized.typeMetadataJson !== undefined) {
      data['typeMetadataJson'] = this.toPrismaJson(normalized.typeMetadataJson);
    }
    if (normalized.assetType !== undefined && normalized.assetSubtype === undefined && normalized.assetType !== existing.assetType) {
      data['assetSubtype'] = null;
    }
    if (normalized.ownerName !== undefined) {
      data['ownerName'] = normalized.ownerName ?? null;
      data['ownerStatus'] = this.ownerStatusFor(normalized.ownerName);
    }

    const asset = await this.prisma.$transaction(async (tx) => {
      if (nextSubjectIds) {
        await tx.assetSubject.deleteMany({ where: { assetId: id } });
        if (nextSubjectIds.length) {
          await tx.assetSubject.createMany({
            data: nextSubjectIds.map((dataSubjectId) => ({ assetId: id, dataSubjectId })),
            skipDuplicates: true,
          });
        }
      }
      return tx.dataAsset.update({ where: { id }, data, include: detailInclude });
    });

    await this.audit.log({
      actor,
      action: 'data_asset.update',
      entityType: 'data_asset',
      entityId: id,
    });
    return this.withAssetTypePanel(asset);
  }

  async remove(id: string, roleCodes: string[], actor: string) {
    await this.get(roleCodes, id);
    await this.prisma.dataAsset.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      actor,
      action: 'data_asset.delete',
      entityType: 'data_asset',
      entityId: id,
    });
    return { success: true };
  }

  // ---------- Relationships ----------
  async addRelationship(assetId: string, roleCodes: string[], dto: CreateAssetRelationshipDto, actor: string) {
    await this.get(roleCodes, assetId);
    if (dto.targetAssetId === assetId) {
      throw new BadRequestException('An asset cannot relate to itself');
    }
    await this.get(roleCodes, dto.targetAssetId);

    const existing = await this.prisma.assetRelationship.findUnique({
      where: {
        sourceAssetId_targetAssetId_type: {
          sourceAssetId: assetId,
          targetAssetId: dto.targetAssetId,
          type: dto.type,
        },
      },
    });
    if (existing) throw new BadRequestException('Relationship already exists');

    const rel = await this.prisma.assetRelationship.create({
      data: {
        sourceAssetId: assetId,
        targetAssetId: dto.targetAssetId,
        type: dto.type,
        description: dto.description ?? null,
      },
      include: { targetAsset: refSelect },
    });
    await this.audit.log({
      actor,
      action: 'data_asset.relationship.create',
      entityType: 'data_asset',
      entityId: assetId,
      metadata: { targetAssetId: dto.targetAssetId, type: dto.type },
    });
    return rel;
  }

  async removeRelationship(assetId: string, roleCodes: string[], relId: string, actor: string) {
    await this.get(roleCodes, assetId);
    const rel = await this.prisma.assetRelationship.findFirst({
      where: { id: relId, sourceAssetId: assetId },
    });
    if (!rel) throw new NotFoundException('relationship not found');
    await this.prisma.assetRelationship.delete({ where: { id: relId } });
    await this.audit.log({
      actor,
      action: 'data_asset.relationship.delete',
      entityType: 'data_asset',
      entityId: assetId,
      metadata: { relationshipId: relId },
    });
    return { success: true };
  }

  // ---------- CSV Import ----------
  async importPreview(roleCodes: string[], csv: string) {
    const plan = await this.buildImportPlan(roleCodes, csv);
    return {
      processed: plan.processed,
      validRows: plan.rows.length,
      errors: plan.errors,
      rows: plan.rows.map((row) => ({
        row: row.row,
        code: row.code,
        action: row.action,
        assetType: row.data.assetType,
        assetSubtype: row.data.assetSubtype,
        v6LifecycleState: row.data.v6LifecycleState,
        lifecyclePhase: row.data.lifecyclePhase,
        subjectCount: row.subjectIds.length,
      })),
    };
  }

  async importCsv(roleCodes: string[], csv: string, actor: string) {
    const plan = await this.buildImportPlan(roleCodes, csv);
    let created = 0;
    let updated = 0;
    const errors = [...plan.errors];

    for (const row of plan.rows) {
      try {
        if (row.existingId) {
          const existingId = row.existingId;
          await this.prisma.$transaction(async (tx) => {
            await tx.dataAsset.update({
              where: { id: existingId },
              data: this.importUpdateData(row.data),
            });
            await tx.assetSubject.deleteMany({ where: { assetId: existingId } });
            if (row.subjectIds.length) {
              await tx.assetSubject.createMany({
                data: row.subjectIds.map((dataSubjectId) => ({ assetId: existingId, dataSubjectId })),
                skipDuplicates: true,
              });
            }
          });
          updated++;
        } else {
          await this.prisma.$transaction(async (tx) => {
            const createdAsset = await tx.dataAsset.create({
              data: this.importCreateData(row.code, row.data),
              select: { id: true },
            });
            if (row.subjectIds.length) {
              await tx.assetSubject.createMany({
                data: row.subjectIds.map((dataSubjectId) => ({ assetId: createdAsset.id, dataSubjectId })),
                skipDuplicates: true,
              });
            }
          });
          created++;
        }
      } catch (e) {
        errors.push({ row: row.row, message: (e as Error).message });
      }
    }

    await this.audit.log({
      actor,
      action: 'data_asset.import',
      entityType: 'data_asset',
      entityId: 'bulk',
      metadata: { created, updated, errors: errors.length, previewErrors: plan.errors.length },
    });
    return { processed: plan.processed, created, updated, errors };
  }

  private async buildImportPlan(roleCodes: string[], csv: string) {
    const rows = parseCsv(csv);
    if (rows.length === 0) throw new BadRequestException('CSV has no data rows');

    const [domains, orgUnits, systems, capabilities, classifications, subjects] =
      await Promise.all([
        this.prisma.dataDomain.findMany({ where: { deletedAt: null, isActive: true } }),
        this.prisma.organizationUnit.findMany({ where: { deletedAt: null, isActive: true } }),
        this.prisma.systemPlatform.findMany({ where: { deletedAt: null, isActive: true } }),
        this.prisma.businessCapability.findMany({ where: { deletedAt: null, isActive: true } }),
        this.prisma.classification.findMany({ where: { deletedAt: null, isActive: true } }),
        this.prisma.dataSubject.findMany({ where: { deletedAt: null, isActive: true } }),
      ]);
    const byCode = (list: { id: string; code: string }[]) =>
      new Map(list.map((x) => [x.code.toLowerCase(), x.id]));
    const domainMap = byCode(domains);
    const orgMap = byCode(orgUnits);
    const systemMap = byCode(systems);
    const capMap = byCode(capabilities);
    const classMap = byCode(classifications);
    const subjectMap = byCode(subjects);
    const systemById = new Map(systems.map((system) => [system.id, system]));
    const classificationById = new Map(classifications.map((classification) => [classification.id, classification]));

    const errors: { row: number; message: string }[] = [];
    const plannedRows: Array<{
      row: number;
      code: string;
      action: 'create' | 'update';
      existingId: string | null;
      subjectIds: string[];
      data: {
        nameEn: string;
        nameAr: string;
        description: string | null;
        assetType: string;
        assetSubtype: string | null;
        v6LifecycleState: string;
        lifecyclePhase: string;
        lifecycleStatus: string;
        typeMetadataJson: Record<string, unknown> | null;
        ownerName: string | null;
        ownerStatus: string;
        domainId: string | null;
        orgUnitId: string | null;
        systemId: string | null;
        capabilityId: string | null;
        classificationId: string | null;
      };
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2; // 1-based + header row
      const code = normalizeAssetCode(row['code'] ?? '');
      const nameEn = (row['nameen'] ?? '').trim();
      const nameAr = (row['namear'] ?? '').trim();
      const lifecycleStatus = (row['lifecyclestatus'] ?? 'draft').trim() || 'draft';
      const assetType = normalizeAssetType(row['assettype'] ?? 'dataset');
      const assetSubtype = normalizeAssetSubtype(assetType, row['assetsubtype'] ?? '');
      const v6LifecycleState = (row['v6lifecyclestate'] ?? 'registered').trim() || 'registered';
      const lifecyclePhase = (row['lifecyclephase'] ?? 'discover').trim() || 'discover';
      const ownerName = normalizeOptionalText(row['ownername'] ?? '') ?? null;
      const description = normalizeOptionalText(row['description'] ?? '') ?? null;
      const typeMetadataJson = this.parseTypeMetadata(row['typemetadatajson'] ?? row['typemetadata'] ?? '', line, errors);
      if (typeMetadataJson === undefined) continue;
      const textErrors = validateAssetText(
        { code, nameEn, nameAr, description, lifecycleStatus, ownerName, assetType, assetSubtype, v6LifecycleState, lifecyclePhase },
        { requireCode: true, requireNames: true, allowCode: true },
      );
      if (textErrors.length) {
        errors.push({ row: line, message: textErrors.join('; ') });
        continue;
      }
      const resolve = (
        map: Map<string, string>,
        col: string,
      ): string | null | undefined => {
        const v = (row[col] ?? '').trim();
        if (!v) return null;
        const id = map.get(v.toLowerCase());
        if (!id) {
          errors.push({ row: line, message: `Unknown ${col}: ${v}` });
          return undefined;
        }
        return id;
      };
      const domainId = resolve(domainMap, 'domaincode');
      const orgUnitId = resolve(orgMap, 'orgunitcode');
      const systemId = resolve(systemMap, 'systemcode');
      const capabilityId = resolve(capMap, 'capabilitycode');
      const classificationId = resolve(classMap, 'classificationcode');
      if ([domainId, orgUnitId, systemId, capabilityId, classificationId].includes(undefined)) {
        continue; // unknown reference reported above
      }
      try {
        await this.assertWritableScope(roleCodes, { domainId, orgUnitId, classificationId });
      } catch (e) {
        errors.push({ row: line, message: (e as Error).message });
        continue;
      }

      const subjectCodes = (row['subjectcodes'] ?? '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      const subjectIds: string[] = [];
      let subjectError = false;
      for (const sc of subjectCodes) {
        const id = subjectMap.get(sc.toLowerCase());
        if (!id) {
          errors.push({ row: line, message: `Unknown subjectCode: ${sc}` });
          subjectError = true;
          break;
        }
        subjectIds.push(id);
      }
      if (subjectError) continue;
      const uniqueSubjectIds = uniqueIds(subjectIds);
      const crossErrors = validateAssetCrossFields({
        subjectIds: uniqueSubjectIds,
        classification: classificationId ? classificationById.get(classificationId) : null,
        orgUnitId,
        system: systemId ? systemById.get(systemId) : null,
      });
      const existing = await this.prisma.dataAsset.findUnique({
        where: { code },
        select: { id: true, v6LifecycleState: true },
      });
      crossErrors.push(...validateAssetTypeFields({
        assetType,
        assetSubtype,
        lifecyclePhase,
        v6LifecycleState,
        previousV6LifecycleState: existing?.v6LifecycleState ?? null,
        typeMetadataJson,
      }));
      if (crossErrors.length) {
        errors.push({ row: line, message: crossErrors.join('; ') });
        continue;
      }

      const data = {
        nameEn,
        nameAr,
        description,
        assetType,
        assetSubtype,
        v6LifecycleState,
        lifecyclePhase,
        lifecycleStatus,
        typeMetadataJson,
        ownerName,
        ownerStatus: this.ownerStatusFor(ownerName),
        domainId: domainId ?? null,
        orgUnitId: orgUnitId ?? null,
        systemId: systemId ?? null,
        capabilityId: capabilityId ?? null,
        classificationId: classificationId ?? null,
      };

      plannedRows.push({
        row: line,
        code,
        action: existing ? 'update' : 'create',
        existingId: existing?.id ?? null,
        subjectIds: uniqueSubjectIds,
        data,
      });
    }

    return { processed: rows.length, rows: plannedRows, errors };
  }

  private importUpdateData(
    data: Record<string, unknown> & { typeMetadataJson: Record<string, unknown> | null },
  ): Prisma.DataAssetUncheckedUpdateInput {
    const { typeMetadataJson, ...rest } = data;
    return {
      ...rest,
      typeMetadataJson: this.toPrismaJson(typeMetadataJson),
      deletedAt: null,
      isActive: true,
    } as Prisma.DataAssetUncheckedUpdateInput;
  }

  private importCreateData(
    code: string,
    data: Record<string, unknown> & { typeMetadataJson: Record<string, unknown> | null },
  ): Prisma.DataAssetUncheckedCreateInput {
    const { typeMetadataJson, ...rest } = data;
    return {
      code,
      ...rest,
      typeMetadataJson: this.toPrismaJson(typeMetadataJson),
    } as Prisma.DataAssetUncheckedCreateInput;
  }

  private parseTypeMetadata(
    value: string | undefined,
    row: number,
    errors: { row: number; message: string }[],
  ): Record<string, unknown> | null | undefined {
    const text = String(value ?? '').trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push({ row, message: 'typeMetadataJson must be a JSON object' });
        return undefined;
      }
      return parsed as Record<string, unknown>;
    } catch {
      errors.push({ row, message: 'typeMetadataJson must be valid JSON' });
      return undefined;
    }
  }
}
