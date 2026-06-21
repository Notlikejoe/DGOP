import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface CrudOptions {
  /** Prisma model accessor name, e.g. 'organizationUnit'. */
  model: string;
  /** Audit entity type, e.g. 'organization_unit'. */
  entityType: string;
  include?: Record<string, unknown>;
  orderBy?: unknown;
}

/**
 * Generic soft-delete CRUD with audit logging.
 * Subclasses provide the Prisma model name and audit entity type.
 */
@Injectable()
export class BaseCrudService {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditService,
    private readonly opts: CrudOptions,
  ) {}

  // Prisma exposes each model as a delegate property on the client.
  protected get delegate(): any {
    return (this.prisma as unknown as Record<string, any>)[this.opts.model];
  }

  list() {
    return this.delegate.findMany({
      where: { deletedAt: null },
      include: this.opts.include,
      orderBy: this.opts.orderBy ?? { createdAt: 'asc' },
    });
  }

  async get(id: string) {
    const entity = await this.delegate.findFirst({
      where: { id, deletedAt: null },
      include: this.opts.include,
    });
    if (!entity) throw new NotFoundException(`${this.opts.entityType} not found`);
    return entity;
  }

  async create(data: any, actor: string) {
    const entity = await this.delegate.create({ data, include: this.opts.include });
    await this.audit.log({
      actor,
      action: `${this.opts.entityType}.create`,
      entityType: this.opts.entityType,
      entityId: entity.id,
      metadata: { code: entity.code },
    });
    return entity;
  }

  async update(id: string, data: any, actor: string) {
    await this.get(id);
    const entity = await this.delegate.update({
      where: { id },
      data,
      include: this.opts.include,
    });
    await this.audit.log({
      actor,
      action: `${this.opts.entityType}.update`,
      entityType: this.opts.entityType,
      entityId: id,
    });
    return entity;
  }

  async remove(id: string, actor: string) {
    await this.get(id);
    await this.delegate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      actor,
      action: `${this.opts.entityType}.delete`,
      entityType: this.opts.entityType,
      entityId: id,
    });
    return { success: true };
  }
}
