import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BaseCrudService } from './base-crud.service';

@Injectable()
export class RoleTypesService extends BaseCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'roleType',
      entityType: 'role_type',
      orderBy: { nameEn: 'asc' },
      deleteDependencies: [
        { model: 'raciTemplateItem', field: 'roleTypeId', label: 'RACI templates' },
        { model: 'stewardshipAssignment', field: 'roleTypeId', label: 'ownership assignments', where: { deletedAt: null } },
        { model: 'assignmentRule', field: 'roleTypeId', label: 'assignment rules', where: { deletedAt: null } },
      ],
    });
  }
}
