import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BaseCrudService } from './base-crud.service';

@Injectable()
export class SystemsService extends BaseCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'systemPlatform',
      entityType: 'system',
      include: { ownerOrgUnit: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
      orderBy: { nameEn: 'asc' },
      deleteDependencies: [
        { model: 'dataAsset', field: 'systemId', label: 'data assets', where: { deletedAt: null } },
      ],
    });
  }

  protected override async prepareCreate(data: any): Promise<any> {
    const prepared = await super.prepareCreate(data);
    await this.assertOwnerOrgUnit(prepared.ownerOrgUnitId ?? null);
    return prepared;
  }

  protected override async prepareUpdate(id: string, data: any, current: any): Promise<any> {
    const prepared = await super.prepareUpdate(id, data, current);
    if (Object.prototype.hasOwnProperty.call(prepared, 'ownerOrgUnitId')) {
      await this.assertOwnerOrgUnit(prepared.ownerOrgUnitId ?? null);
    }
    return prepared;
  }

  private async assertOwnerOrgUnit(ownerOrgUnitId: string | null): Promise<void> {
    if (!ownerOrgUnitId) return;
    const orgUnit = await this.prisma.organizationUnit.findFirst({
      where: { id: ownerOrgUnitId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!orgUnit) throw new BadRequestException('Owner organization unit must be active');
  }
}
