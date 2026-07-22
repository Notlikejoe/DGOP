import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HierarchyCrudService } from './hierarchy-crud.service';

@Injectable()
export class BusinessCapabilitiesService extends HierarchyCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'businessCapability',
      entityType: 'business_capability',
      orderBy: { nameEn: 'asc' },
      deleteDependencies: [
        { model: 'businessCapability', field: 'parentId', label: 'child capabilities', where: { deletedAt: null } },
        { model: 'dataAsset', field: 'capabilityId', label: 'data assets', where: { deletedAt: null } },
      ],
    });
  }
}
