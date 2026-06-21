import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRaciTemplateDto, UpdateRaciTemplateDto } from './dto';

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
    const { items, ...data } = dto;
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
    await this.get(id);
    const { items, ...data } = dto;
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
}
