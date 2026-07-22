import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  LIFECYCLE_STATUSES,
  normalizeAssetCode,
  normalizeOptionalText,
  uniqueIds,
  validateAssetCrossFields,
  validateAssetText,
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
    if (ownerStatus) and.push({ ownerStatus });
    if (lifecycleStatus) and.push({ lifecycleStatus });
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
      return this.prisma.dataAsset.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const [rows, total] = await Promise.all([
      this.prisma.dataAsset.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.dataAsset.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async get(roleCodes: string[], id: string) {
    const scope = await this.scope.resolve(roleCodes);
    const asset = await this.prisma.dataAsset.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scopeWhere(scope)] },
      include: detailInclude,
    });
    if (!asset) throw new NotFoundException('data_asset not found');
    return asset;
  }

  private ownerStatusFor(ownerName?: string | null): string {
    return ownerName && ownerName.trim() ? 'assigned' : 'unassigned';
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
    if (errors.length) throw new BadRequestException(errors.join('; '));
  }

  async create(roleCodes: string[], dto: CreateAssetDto, actor: string) {
    const normalized = this.normalizeCreateDto(dto);
    await this.assertWritableScope(roleCodes, normalized);
    await this.assertAssetIntegrity(normalized);
    const { subjectIds, ...rest } = normalized;
    const asset = await this.prisma.dataAsset.create({
      data: {
        ...rest,
        ownerName: normalized.ownerName ?? null,
        ownerStatus: this.ownerStatusFor(normalized.ownerName),
        lifecycleStatus: normalized.lifecycleStatus ?? 'draft',
        subjects: subjectIds?.length
          ? { create: subjectIds.map((dataSubjectId) => ({ dataSubjectId })) }
          : undefined,
      },
      include: detailInclude,
    });
    await this.audit.log({
      actor,
      action: 'data_asset.create',
      entityType: 'data_asset',
      entityId: asset.id,
      metadata: { code: asset.code },
    });
    return asset;
  }

  async update(id: string, roleCodes: string[], dto: UpdateAssetDto & { code?: unknown }, actor: string) {
    const existing = await this.get(roleCodes, id);
    const normalized = this.normalizeUpdateDto(dto);
    const subjectIds =
      normalized.subjectIds !== undefined
        ? normalized.subjectIds
        : existing.subjects.map((subject) => subject.dataSubject.id);
    const nextIntegrityTarget = {
      domainId: normalized.domainId !== undefined ? normalized.domainId : existing.domainId,
      orgUnitId: normalized.orgUnitId !== undefined ? normalized.orgUnitId : existing.orgUnitId,
      systemId: normalized.systemId !== undefined ? normalized.systemId : existing.systemId,
      capabilityId: normalized.capabilityId !== undefined ? normalized.capabilityId : existing.capabilityId,
      classificationId:
        normalized.classificationId !== undefined ? normalized.classificationId : existing.classificationId,
      subjectIds,
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
    return asset;
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
  async importCsv(roleCodes: string[], csv: string, actor: string) {
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

    let created = 0;
    let updated = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2; // 1-based + header row
      const code = normalizeAssetCode(row['code'] ?? '');
      const nameEn = (row['nameen'] ?? '').trim();
      const nameAr = (row['namear'] ?? '').trim();
      const lifecycleStatus = (row['lifecyclestatus'] ?? 'draft').trim() || 'draft';
      const ownerName = normalizeOptionalText(row['ownername'] ?? '') ?? null;
      const description = normalizeOptionalText(row['description'] ?? '') ?? null;
      const textErrors = validateAssetText(
        { code, nameEn, nameAr, description, lifecycleStatus, ownerName },
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
      if (crossErrors.length) {
        errors.push({ row: line, message: crossErrors.join('; ') });
        continue;
      }

      const data = {
        nameEn,
        nameAr,
        description,
        lifecycleStatus,
        ownerName,
        ownerStatus: this.ownerStatusFor(ownerName),
        domainId: domainId ?? null,
        orgUnitId: orgUnitId ?? null,
        systemId: systemId ?? null,
        capabilityId: capabilityId ?? null,
        classificationId: classificationId ?? null,
      };

      try {
        const existing = await this.prisma.dataAsset.findUnique({ where: { code } });
        if (existing) {
          await this.prisma.$transaction(async (tx) => {
            await tx.dataAsset.update({ where: { code }, data: { ...data, deletedAt: null, isActive: true } });
            await tx.assetSubject.deleteMany({ where: { assetId: existing.id } });
            if (uniqueSubjectIds.length) {
              await tx.assetSubject.createMany({
                data: uniqueSubjectIds.map((dataSubjectId) => ({ assetId: existing.id, dataSubjectId })),
                skipDuplicates: true,
              });
            }
          });
          updated++;
        } else {
          await this.prisma.dataAsset.create({
            data: {
              code,
              ...data,
              subjects: uniqueSubjectIds.length
                ? { create: uniqueSubjectIds.map((dataSubjectId) => ({ dataSubjectId })) }
                : undefined,
            },
          });
          created++;
        }
      } catch (e) {
        errors.push({ row: line, message: (e as Error).message });
      }
    }

    await this.audit.log({
      actor,
      action: 'data_asset.import',
      entityType: 'data_asset',
      entityId: 'bulk',
      metadata: { created, updated, errors: errors.length },
    });
    return { processed: rows.length, created, updated, errors };
  }
}
