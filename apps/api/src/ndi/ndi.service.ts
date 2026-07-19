import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateNdiSpecDto,
  MATURITY_LEVELS,
  MaturityLevel,
  SPEC_TYPES,
  SpecType,
  UpdateNdiSpecDto,
} from './ndi.dto';
import { parseCsv } from '../common/csv';
import { parsePageParams, toPaged, type Paged } from '../common/pagination';
import {
  V5_DOMAIN_MODEL_DEFINITIONS,
  domainModelGapCount,
  domainModelStatus,
  evidenceQualityScore,
  type V5DomainModelInput,
} from './ndi.logic';

export interface SpecFilters {
  search?: string;
  domainId?: string;
  type?: string;
  maturityLevel?: string;
  status?: string; // 'active' | 'inactive' | undefined (all)
}

const SPEC_STATUS_FILTERS = ['active', 'inactive'] as const;
type SpecStatusFilter = (typeof SPEC_STATUS_FILTERS)[number];

const domainSelect = { select: { id: true, code: true, nameEn: true, nameAr: true } };
const ownerSelect = { select: { id: true, fullNameEn: true, fullNameAr: true, email: true } };
const specInclude = { domain: domainSelect, owner: ownerSelect };

function isSpecType(value: string): value is SpecType {
  return (SPEC_TYPES as readonly string[]).includes(value);
}

function isMaturityLevel(value: string): value is MaturityLevel {
  return (MATURITY_LEVELS as readonly string[]).includes(value);
}

function filterEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  label: string,
): T | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new BadRequestException(`Invalid ${label}: ${raw}`);
}

@Injectable()
export class NdiSpecificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** NDI domains plus a count of active specifications for hub navigation. */
  async listDomains() {
    const [domains, grouped] = await Promise.all([
      this.prisma.ndiDomain.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.ndiSpecification.groupBy({
        by: ['domainId'],
        where: { deletedAt: null, isActive: true },
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(grouped.map((g) => [g.domainId, g._count._all]));
    return domains.map((d) => ({ ...d, specCount: counts.get(d.id) ?? 0 }));
  }

  async domainTraceability() {
    const [
      specs,
      workflowCases,
      ndiAuditPacks,
      mdmMatches,
      referenceVersions,
      metadataCertifications,
      architectureReviews,
      glossaryTerms,
      lineageMaps,
      businessImpactAssessments,
      dataAssetValuations,
      dataValueKpis,
    ] = await Promise.all([
      this.prisma.ndiSpecification.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          domain: { select: { id: true, code: true, shortCode: true, nameEn: true, nameAr: true } },
          evidence: {
            where: { deletedAt: null },
            select: { status: true, expiryDate: true },
          },
        },
      }),
      this.prisma.workflowCase.groupBy({
        by: ['type'],
        _count: { _all: true },
      }),
      this.prisma.ndiAuditPack.count(),
      this.prisma.mdmMatchCandidate.count(),
      this.prisma.referenceDataVersion.count(),
      this.prisma.metadataCertification.count(),
      this.prisma.architectureReview.count(),
      this.prisma.businessGlossaryTerm.count(),
      this.prisma.businessLineageMap.count(),
      this.prisma.businessImpactAssessment.count(),
      this.prisma.dataAssetValuation.count(),
      this.prisma.dataValueKpi.count(),
    ]);

    const now = new Date();
    const workflowCountByType = new Map(workflowCases.map((row) => [row.type, row._count._all]));
    const operationalCountByModel: Record<string, number> = {
      DG: ndiAuditPacks,
      MCM: mdmMatches,
      RMD: referenceVersions,
      DAM: architectureReviews,
      DCM: metadataCertifications + glossaryTerms + lineageMaps,
      BIA: businessImpactAssessments,
      DVR: dataAssetValuations + dataValueKpis,
    };

    const models = V5_DOMAIN_MODEL_DEFINITIONS.map((definition) => {
      const modelSpecs = specs.filter((spec) => definition.ndiDomainCodes.includes(spec.domain.code));
      const evidence = modelSpecs.flatMap((spec) => spec.evidence);
      const approvedEvidenceCount = evidence.filter(
        (row) => row.status === 'approved' && (!row.expiryDate || row.expiryDate.getTime() > now.getTime()),
      ).length;
      const expiredEvidenceCount = evidence.filter(
        (row) => row.status === 'expired' || (row.expiryDate && row.expiryDate.getTime() <= now.getTime()),
      ).length;
      const rejectedEvidenceCount = evidence.filter((row) => row.status === 'rejected' || row.status === 'revoked').length;
      const pendingEvidenceCount = evidence.filter((row) => row.status === 'submitted' || row.status === 'under_review').length;
      const workflowCaseCount = definition.workflowTypes.reduce(
        (sum, type) => sum + (workflowCountByType.get(type) ?? 0),
        0,
      );
      const input: V5DomainModelInput = {
        specCount: modelSpecs.length,
        approvedEvidenceCount,
        evidenceCount: evidence.length,
        expiredEvidenceCount,
        rejectedEvidenceCount,
        pendingEvidenceCount,
        operationalRecordCount: operationalCountByModel[definition.code] ?? 0,
        workflowCaseCount,
      };
      return {
        ...definition,
        status: domainModelStatus(input),
        evidenceQualityScore: evidenceQualityScore(input),
        openGapCount: domainModelGapCount(input),
        metrics: input,
        ndiDomains: [...new Map(modelSpecs.map((spec) => [spec.domain.id, spec.domain])).values()],
        nextAction: this.domainModelNextAction(input),
      };
    });

    return {
      generatedAt: now.toISOString(),
      summary: {
        models: models.length,
        ready: models.filter((row) => row.status === 'ready').length,
        watch: models.filter((row) => row.status === 'watch').length,
        blocked: models.filter((row) => row.status === 'blocked').length,
        specifications: specs.length,
        approvedEvidence: models.reduce((sum, row) => sum + row.metrics.approvedEvidenceCount, 0),
        openGaps: models.reduce((sum, row) => sum + row.openGapCount, 0),
      },
      models,
    };
  }

  private domainModelNextAction(input: V5DomainModelInput): string {
    if (input.specCount <= 0) return 'Add or map NDI specifications for this operating model.';
    if (input.operationalRecordCount <= 0) return 'Create at least one live operating record in the related DGOP workspace.';
    if (input.approvedEvidenceCount <= 0) return 'Attach and approve evidence so the model is audit-ready.';
    if (input.pendingEvidenceCount > 0) return 'Review pending evidence and clear the evidence queue.';
    if (input.expiredEvidenceCount > 0 || input.rejectedEvidenceCount > 0) return 'Replace rejected or expired evidence with current approved proof.';
    return 'Keep evidence current and refresh the operating record during the next governance cycle.';
  }

  private filterWhere(filters: SpecFilters): Record<string, unknown>[] {
    const and: Record<string, unknown>[] = [];
    if (filters.domainId) and.push({ domainId: filters.domainId });
    const type = filterEnum<SpecType>(filters.type, SPEC_TYPES, 'NDI specification type');
    const maturityLevel = filterEnum<MaturityLevel>(filters.maturityLevel, MATURITY_LEVELS, 'NDI maturity level');
    const status = filterEnum<SpecStatusFilter>(filters.status, SPEC_STATUS_FILTERS, 'NDI status filter');
    if (type) and.push({ type });
    if (maturityLevel) and.push({ maturityLevel });
    if (status === 'active') and.push({ isActive: true });
    else if (status === 'inactive') and.push({ isActive: false });
    if (filters.search) {
      const term = filters.search.trim();
      and.push({
        OR: [
          { code: { contains: term, mode: 'insensitive' } },
          { nameEn: { contains: term, mode: 'insensitive' } },
          { nameAr: { contains: term, mode: 'insensitive' } },
          { criterion: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    return and;
  }

  async list(
    filters: SpecFilters,
    page?: string | number,
    pageSize?: string | number,
  ): Promise<unknown[] | Paged<unknown>> {
    const where = { AND: [{ deletedAt: null }, ...this.filterWhere(filters)] };
    const orderBy = [
      { domain: { sortOrder: 'asc' as const } },
      { sortOrder: 'asc' as const },
      { code: 'asc' as const },
    ];
    const params = parsePageParams(page, pageSize);
    if (!params) {
      return this.prisma.ndiSpecification.findMany({
        where,
        include: specInclude,
        orderBy,
      });
    }
    const [rows, total] = await Promise.all([
      this.prisma.ndiSpecification.findMany({
        where,
        include: specInclude,
        orderBy,
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.ndiSpecification.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async get(id: string) {
    const spec = await this.prisma.ndiSpecification.findFirst({
      where: { id, deletedAt: null },
      include: specInclude,
    });
    if (!spec) throw new NotFoundException('ndi_specification not found');
    return spec;
  }

  private async assertDomain(domainId: string): Promise<void> {
    const domain = await this.prisma.ndiDomain.findUnique({ where: { id: domainId } });
    if (!domain) throw new BadRequestException('NDI domain not found');
  }

  async create(dto: CreateNdiSpecDto, actor: string) {
    await this.assertDomain(dto.domainId);
    const existing = await this.prisma.ndiSpecification.findUnique({ where: { code: dto.code } });
    if (existing) throw new BadRequestException(`Specification code already exists: ${dto.code}`);
    const spec = await this.prisma.ndiSpecification.create({
      data: {
        code: dto.code,
        domainId: dto.domainId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        criterion: dto.criterion ?? null,
        type: dto.type ?? 'standard',
        maturityLevel: dto.maturityLevel ?? 'level_1',
        descriptionEn: dto.descriptionEn ?? null,
        descriptionAr: dto.descriptionAr ?? null,
        acceptanceCriteria: dto.acceptanceCriteria ?? null,
        reference: dto.reference ?? null,
        ownerPersonId: dto.ownerPersonId ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: specInclude,
    });
    await this.audit.log({
      actor,
      action: 'ndi_specification.create',
      entityType: 'ndi_specification',
      entityId: spec.id,
      metadata: { code: spec.code },
    });
    return spec;
  }

  async update(id: string, dto: UpdateNdiSpecDto, actor: string) {
    const existing = await this.prisma.ndiSpecification.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('ndi_specification not found');
    if (dto.domainId) await this.assertDomain(dto.domainId);
    const data: Record<string, unknown> = { ...dto };
    // An empty owner selection clears the link rather than failing the FK.
    if ('ownerPersonId' in data) data.ownerPersonId = dto.ownerPersonId || null;
    const spec = await this.prisma.ndiSpecification.update({
      where: { id },
      data,
      include: specInclude,
    });
    await this.audit.log({
      actor,
      action: 'ndi_specification.update',
      entityType: 'ndi_specification',
      entityId: id,
    });
    return spec;
  }

  async remove(id: string, actor: string) {
    const existing = await this.prisma.ndiSpecification.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('ndi_specification not found');
    await this.prisma.ndiSpecification.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      actor,
      action: 'ndi_specification.delete',
      entityType: 'ndi_specification',
      entityId: id,
    });
    return { success: true };
  }

  // ---------- CSV Import ----------
  async importCsv(csv: string, actor: string) {
    const rows = parseCsv(csv);
    if (rows.length === 0) throw new BadRequestException('CSV has no data rows');

    const domains = await this.prisma.ndiDomain.findMany();
    const domainMap = new Map(domains.map((d) => [d.code.toLowerCase(), d.id]));
    let created = 0;
    let updated = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2; // 1-based + header row
      const code = (row['code'] ?? '').trim();
      const nameEn = (row['nameen'] ?? '').trim();
      const nameAr = (row['namear'] ?? '').trim();
      const domainCode = (row['domaincode'] ?? '').trim();
      if (!code || !nameEn || !nameAr || !domainCode) {
        errors.push({ row: line, message: 'Missing required code/nameEn/nameAr/domainCode' });
        continue;
      }
      const domainId = domainMap.get(domainCode.toLowerCase());
      if (!domainId) {
        errors.push({ row: line, message: `Unknown domainCode: ${domainCode}` });
        continue;
      }
      const type = (row['type'] ?? 'standard').trim().toLowerCase() || 'standard';
      if (!isSpecType(type)) {
        errors.push({ row: line, message: `Invalid type: ${type}` });
        continue;
      }
      const maturityLevel = (row['maturitylevel'] ?? 'level_1').trim().toLowerCase() || 'level_1';
      if (!isMaturityLevel(maturityLevel)) {
        errors.push({ row: line, message: `Invalid maturityLevel: ${maturityLevel}` });
        continue;
      }
      const activeRaw = (row['isactive'] ?? '').trim().toLowerCase();
      const isActive = activeRaw === '' ? true : !['false', '0', 'no'].includes(activeRaw);

      const data = {
        domainId,
        nameEn,
        nameAr,
        criterion: (row['criterion'] ?? '').trim() || null,
        type,
        maturityLevel,
        descriptionEn: (row['descriptionen'] ?? '').trim() || null,
        descriptionAr: (row['descriptionar'] ?? '').trim() || null,
        acceptanceCriteria: (row['acceptancecriteria'] ?? '').trim() || null,
        reference: (row['reference'] ?? '').trim() || null,
        isActive,
      };

      try {
        const existing = await this.prisma.ndiSpecification.findUnique({ where: { code } });
        if (existing) {
          await this.prisma.ndiSpecification.update({
            where: { code },
            data: { ...data, deletedAt: null },
          });
          updated++;
        } else {
          await this.prisma.ndiSpecification.create({ data: { code, ...data } });
          created++;
        }
      } catch (e) {
        errors.push({ row: line, message: (e as Error).message });
      }
    }

    await this.audit.log({
      actor,
      action: 'ndi_specification.import',
      entityType: 'ndi_specification',
      entityId: 'bulk',
      metadata: { created, updated, errors: errors.length },
    });
    return { processed: rows.length, created, updated, errors };
  }
}
