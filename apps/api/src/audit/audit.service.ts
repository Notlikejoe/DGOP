import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parsePageParams, toPaged, type Paged } from '../common/pagination';
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
      // Auditing must never break the request flow.
      this.logger.error(`Failed to write audit log for ${entry.action}`, err as Error);
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
    const parsed = Number(limit ?? 1000);
    const take = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 5000) : 1000;
    const rows = await this.prisma.auditLog.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: {
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
      },
    });
    return {
      totalRowsRead: rows.length,
      ...verifyAuditHashChain(rows),
    };
  }
}
