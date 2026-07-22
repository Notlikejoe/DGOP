import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { trimRecord, validateMasterText } from './master-data.logic';

export interface DeleteDependency {
  /** Prisma model accessor name, e.g. 'dataAsset'. */
  model: string;
  /** Foreign-key field that points at this entity id. */
  field: string;
  /** Human-readable blocker label returned in validation errors. */
  label: string;
  /** Extra Prisma where constraints, usually { deletedAt: null }. */
  where?: Record<string, unknown>;
}

export interface CrudOptions {
  /** Prisma model accessor name, e.g. 'organizationUnit'. */
  model: string;
  /** Audit entity type, e.g. 'organization_unit'. */
  entityType: string;
  include?: Record<string, unknown>;
  orderBy?: unknown;
  validation?: 'standard' | 'none';
  immutableCode?: boolean;
  uniqueCode?: boolean;
  deleteDependencies?: DeleteDependency[];
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
    protected readonly opts: CrudOptions,
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
    const prepared = await this.prepareCreate(data);
    const entity = await this.delegate.create({ data: prepared, include: this.opts.include });
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
    const current = await this.get(id);
    const prepared = await this.prepareUpdate(id, data, current);
    const entity = await this.delegate.update({
      where: { id },
      data: prepared,
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
    const current = await this.get(id);
    await this.beforeRemove(id, current);
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

  protected async prepareCreate(data: any): Promise<any> {
    const prepared = trimRecord({ ...data });
    this.assertStandardValidation(prepared, true, true);
    if (this.opts.uniqueCode !== false && prepared.code) {
      await this.assertUniqueCode(prepared.code);
    }
    return prepared;
  }

  protected async prepareUpdate(id: string, data: any, current: any): Promise<any> {
    const prepared = trimRecord({ ...data });
    const hasCode = Object.prototype.hasOwnProperty.call(prepared, 'code');
    if (hasCode && this.opts.immutableCode !== false && prepared.code !== current.code) {
      throw new BadRequestException(`${this.opts.entityType} code is immutable after creation`);
    }
    this.assertStandardValidation(prepared, hasCode, false);
    if (this.opts.uniqueCode !== false && hasCode && prepared.code) {
      await this.assertUniqueCode(prepared.code, id);
    }
    return prepared;
  }

  protected async beforeRemove(id: string, _current: any): Promise<void> {
    const blockers: string[] = [];
    for (const dependency of this.opts.deleteDependencies ?? []) {
      const delegate = (this.prisma as unknown as Record<string, any>)[dependency.model];
      if (!delegate?.count) continue;
      const count = await delegate.count({
        where: { ...(dependency.where ?? {}), [dependency.field]: id },
      });
      if (count > 0) blockers.push(`${dependency.label} (${count})`);
    }
    if (blockers.length) {
      throw new BadRequestException(
        `Cannot delete ${this.opts.entityType}; it is used by ${blockers.join(', ')}`,
      );
    }
  }

  protected async assertUniqueCode(code: unknown, exceptId?: string): Promise<void> {
    if (typeof code !== 'string' || !code.trim()) return;
    const duplicate = await this.delegate.findFirst({
      where: {
        code: code.trim(),
        deletedAt: null,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(`${this.opts.entityType} code already exists`);
    }
  }

  private assertStandardValidation(data: Record<string, unknown>, hasCode: boolean, requireNames: boolean): void {
    if (this.opts.validation === 'none') return;
    const errors = validateMasterText(data, {
      requireCode: hasCode,
      requireNames,
      allowCode: true,
      entityLabel: this.opts.entityType,
    });
    if (errors.length) throw new BadRequestException(errors.join('; '));
  }
}
