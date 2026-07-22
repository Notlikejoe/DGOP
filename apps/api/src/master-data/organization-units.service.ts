import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HierarchyCrudService } from './hierarchy-crud.service';

@Injectable()
export class OrganizationUnitsService extends HierarchyCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'organizationUnit',
      entityType: 'organization_unit',
      orderBy: { nameEn: 'asc' },
      deleteDependencies: [
        { model: 'organizationUnit', field: 'parentId', label: 'child organization units', where: { deletedAt: null } },
        { model: 'systemPlatform', field: 'ownerOrgUnitId', label: 'systems', where: { deletedAt: null } },
        { model: 'dataAsset', field: 'orgUnitId', label: 'data assets', where: { deletedAt: null } },
        { model: 'roleDataScope', field: 'refId', label: 'role data scopes', where: { scopeType: 'org_unit' } },
      ],
    });
  }
}
