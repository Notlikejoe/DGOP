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
    });
  }
}
