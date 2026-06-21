import { Injectable } from '@nestjs/common';
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
    });
  }
}
