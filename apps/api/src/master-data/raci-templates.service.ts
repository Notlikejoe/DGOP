import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRaciTemplateDto, UpdateRaciTemplateDto } from './dto';
import {
  assertUniqueRoleResponsibility,
  trimRecord,
  validateMasterText,
} from './master-data.logic';

const include = {
  items: {
    include: { roleType: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
  },
};

@Injectable()
export class RaciTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.raciTemplate.findMany({
      where: { deletedAt: null },
      include,
      orderBy: { nameEn: 'asc' },
    });
  }

  async get(id: string) {
    const tpl = await this.prisma.raciTemplate.findFirst({ where: { id, deletedAt: null }, include });
    if (!tpl) throw new NotFoundException('raci_template not found');
    return tpl;
  }

  async create(dto: CreateRaciTemplateDto, actor: string) {
    const { items, ...data } = this.prepareDto(dto, { requireAll: true });
    await this.assertUniqueCode(data.code);
    await this.assertActiveRoleTypes(items);
    const tpl = await this.prisma.raciTemplate.create({
      data: {
        ...data,
        items: { create: items.map((i) => ({ roleTypeId: i.roleTypeId, responsibility: i.responsibility })) },
      },
      include,
    });
    await this.audit.log({
      actor,
      action: 'raci_template.create',
      entityType: 'raci_template',
      entityId: tpl.id,
      metadata: { code: tpl.code, items: items.length },
    });
    return tpl;
  }

  async update(id: string, dto: UpdateRaciTemplateDto, actor: string) {
    const current = await this.get(id);
    const { items, ...data } = this.prepareDto(dto, { requireAll: false });
    if (data.code && data.code !== current.code) {
      throw new BadRequestException('raci_template code is immutable after creation');
    }
    if (data.code) await this.assertUniqueCode(data.code, id);
    if (items) await this.assertActiveRoleTypes(items);
    // Replace items when provided.
    const tpl = await this.prisma.$transaction(async (tx) => {
      if (items) {
        await tx.raciTemplateItem.deleteMany({ where: { templateId: id } });
      }
      return tx.raciTemplate.update({
        where: { id },
        data: {
          ...data,
          ...(items
            ? {
                items: {
                  create: items.map((i) => ({
                    roleTypeId: i.roleTypeId,
                    responsibility: i.responsibility,
                  })),
                },
              }
            : {}),
        },
        include,
      });
    });
    await this.audit.log({
      actor,
      action: 'raci_template.update',
      entityType: 'raci_template',
      entityId: id,
    });
    return tpl;
  }

  async remove(id: string, actor: string) {
    await this.get(id);
    await this.prisma.raciTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      actor,
      action: 'raci_template.delete',
      entityType: 'raci_template',
      entityId: id,
    });
    return { success: true };
  }

  private prepareDto<T extends CreateRaciTemplateDto | UpdateRaciTemplateDto>(
    dto: T,
    options: { requireAll: boolean },
  ): T {
    const normalized = trimRecord({ ...dto }) as T;
    const errors = validateMasterText(normalized, {
      requireCode: options.requireAll || Object.prototype.hasOwnProperty.call(normalized, 'code'),
      requireNames: options.requireAll,
      entityLabel: 'raci_template',
    });
    if ('processType' in normalized && normalized.processType !== null && normalized.processType !== undefined) {
      if (typeof normalized.processType !== 'string') {
        errors.push('Process type must be text');
      } else if (normalized.processType.length > 80) {
        errors.push('Process type must be 80 characters or fewer');
      }
    }
    if ('items' in normalized && normalized.items) {
      errors.push(...assertUniqueRoleResponsibility(normalized.items));
    }
    if (errors.length) throw new BadRequestException(errors.join('; '));
    return normalized;
  }

  private async assertUniqueCode(code: unknown, exceptId?: string): Promise<void> {
    if (typeof code !== 'string' || !code) return;
    const existing = await this.prisma.raciTemplate.findFirst({
      where: { code, deletedAt: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('raci_template code already exists');
  }

  private async assertActiveRoleTypes(items: RaciItemLike[]): Promise<void> {
    const ids = [...new Set(items.map((item) => item.roleTypeId))];
    if (ids.length === 0) throw new BadRequestException('At least one RACI responsibility is required');
    const active = await this.prisma.roleType.findMany({
      where: { id: { in: ids }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    const activeIds = new Set(active.map((role) => role.id));
    const missing = ids.filter((id) => !activeIds.has(id));
    if (missing.length) {
      throw new BadRequestException(`Unknown or inactive role types: ${missing.join(', ')}`);
    }
  }
}

type RaciItemLike = { roleTypeId: string; responsibility: string };
