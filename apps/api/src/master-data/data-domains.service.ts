import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HierarchyCrudService } from './hierarchy-crud.service';

@Injectable()
export class DataDomainsService extends HierarchyCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'dataDomain',
      entityType: 'data_domain',
      orderBy: { nameEn: 'asc' },
      deleteDependencies: [
        { model: 'dataDomain', field: 'parentId', label: 'child data domains', where: { deletedAt: null } },
        { model: 'dataAsset', field: 'domainId', label: 'data assets', where: { deletedAt: null } },
        { model: 'dataQualityRule', field: 'domainId', label: 'data quality rules' },
        { model: 'dataQualityProfile', field: 'domainId', label: 'data quality profiles' },
        { model: 'maskingPolicy', field: 'domainId', label: 'masking policies' },
        { model: 'roleDataAccessMap', field: 'domainId', label: 'data access maps' },
        { model: 'roleDataScope', field: 'refId', label: 'role data scopes', where: { scopeType: 'data_domain' } },
      ],
    });
  }
}
