import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BaseCrudService } from './base-crud.service';

@Injectable()
export class StatusValuesService extends BaseCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'statusValue',
      entityType: 'status_value',
      orderBy: [{ domain: 'asc' }, { sortOrder: 'asc' }],
    });
  }
}
