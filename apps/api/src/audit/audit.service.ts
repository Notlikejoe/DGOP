import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parsePageParams, toPaged, type Paged } from '../common/pagination';
import { isProductionLikeRuntime } from '../common/runtime-safety';
import { hashAuditEntry, verifyAuditHashChain } from './audit.logic';

export interface AuditEntry {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditFilters {
  actor?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
}

type AuditWriter = PrismaService | Prisma.TransactionClient;
const LEGACY_BASELINE_ACTION = 'audit_chain.legacy_baseline.accepted';
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function auditFailClosed(): boolean {
  const configured = process.env.DGOP_AUDIT_FAIL_CLOSED?.trim().toLowerCase();
  if (configured) return !FALSE_VALUES.has(configured);
  return isProductionLikeRuntime();
}
const AUDIT_CHAIN_PAGE_SIZE = 1000;
const AUDIT_CHAIN_MAX_LIMIT = 5000;

const auditChainSelect = {
  id: true,
  actor: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  previousHash: true,
  entryHash: true,
  chainVersion: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, client: AuditWriter = this.prisma): Promise<void> {
    try {
      const previous = await client.auditLog.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { entryHash: true },
      });
      const createdAt = new Date();
      const previousHash = previous?.entryHash ?? null;
      const chainVersion = 1;
      const entryHash = hashAuditEntry({
        actor: entry.actor,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? null,
        createdAt,
        previousHash,
        chainVersion,
      });
      await client.auditLog.create({
        data: {
          actor: entry.actor,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          previousHash,
          entryHash,
          chainVersion,
          createdAt,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for ${entry.action}`, err as Error);
      if (auditFailClosed()) {
        throw new InternalServerErrorException('Audit trail could not be recorded');
      }
    }
  }

  /** Distinct entity types and actions for filter dropdowns. */
  async facets(): Promise<{ entityTypes: string[]; actions: string[] }> {
    const [types, actions] = await Promise.all([
      this.prisma.auditLog.findMany({
        distinct: ['entityType'],
        select: { entityType: true },
        orderBy: { entityType: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      }),
    ]);
    return {
      entityTypes: types.map((t) => t.entityType),
      actions: actions.map((a) => a.action),
    };
  }

  /** Paginated, filtered audit trail (newest first). */
  async list(
    filters: AuditFilters,
    page?: string | number,
    pageSize?: string | number,
  ): Promise<Paged<unknown>> {
    const and: Record<string, unknown>[] = [];
    if (filters.actor) and.push({ actor: { contains: filters.actor.trim(), mode: 'insensitive' } });
    if (filters.action) and.push({ action: filters.action });
    if (filters.entityType) and.push({ entityType: filters.entityType });
    const createdAt: Record<string, Date> = {};
    if (filters.from) {
      const d = new Date(filters.from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (filters.to) {
      const d = new Date(filters.to);
      if (!Number.isNaN(d.getTime())) createdAt.lte = d;
    }
    if (Object.keys(createdAt).length) and.push({ createdAt });

    const where = and.length ? { AND: and } : {};
    // Always paginate: default to page 1 when not supplied (audit can grow large).
    const params = parsePageParams(page ?? 1, pageSize)!;
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async verifyChain(limit?: string | number) {
    const parsed = limit === undefined || limit === null || String(limit).trim() === ''
      ? null
      : Number(limit);
    const takeLimit = parsed === null
      ? null
      : Number.isFinite(parsed)
        ? Math.min(Math.max(parsed, 1), AUDIT_CHAIN_MAX_LIMIT)
        : AUDIT_CHAIN_PAGE_SIZE;
    const totalRows = await this.prisma.auditLog.count();
    const rows: Prisma.AuditLogGetPayload<{ select: typeof auditChainSelect }>[] = [];
    let cursorId: string | undefined;
    while (takeLimit === null || rows.length < takeLimit) {
      const take = takeLimit === null
        ? AUDIT_CHAIN_PAGE_SIZE
        : Math.min(AUDIT_CHAIN_PAGE_SIZE, takeLimit - rows.length);
      if (take <= 0) break;
      const page = await this.prisma.auditLog.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        take,
        select: auditChainSelect,
      });
      rows.push(...page);
      if (page.length < take) break;
      cursorId = page[page.length - 1].id;
    }
    return {
      totalRows,
      totalRowsRead: rows.length,
      truncated: rows.length < totalRows,
      limit: takeLimit,
      ...verifyAuditHashChain(rows),
    };
  }

  async legacyBaselineAccepted(): Promise<boolean> {
    const row = await this.prisma.auditLog.findFirst({
      where: {
        action: LEGACY_BASELINE_ACTION,
        entityType: 'audit_chain',
        entryHash: { not: null },
      },
      select: { id: true },
    });
    return !!row;
  }

  async acceptLegacyBaseline(actor: string, limit?: string | number) {
    const chain = await this.verifyChain(limit);
    if (!chain.valid) {
      throw new BadRequestException('Audit chain must verify cleanly before accepting a legacy baseline');
    }
    if (chain.truncated) {
      throw new BadRequestException('Full audit chain verification is required before accepting a legacy baseline');
    }
    if (chain.legacyRows === 0) {
      return { ...chain, accepted: false, alreadyAccepted: false };
    }

    const alreadyAccepted = await this.legacyBaselineAccepted();
    if (!alreadyAccepted) {
      await this.log({
        actor,
        action: LEGACY_BASELINE_ACTION,
        entityType: 'audit_chain',
        metadata: {
          legacyRows: chain.legacyRows,
          checkedRows: chain.checked,
          totalRowsRead: chain.totalRowsRead,
          acceptedAt: new Date().toISOString(),
        },
      });
      const recorded = await this.legacyBaselineAccepted();
      if (!recorded) {
        throw new InternalServerErrorException('Could not record legacy audit baseline acceptance');
      }
    }
    return { ...chain, accepted: true, alreadyAccepted };
  }
}
